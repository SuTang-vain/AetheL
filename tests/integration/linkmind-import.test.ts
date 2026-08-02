import { strict as assert } from 'node:assert'
import http from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  extractUrls,
  guessPlatformFromUrl,
  convertKnowledgeToCandidates,
  importLink,
} from '../../src/lib/linkmindImport.js'

type TestCase = {
  name: string
  run: () => Promise<void>
}

const tests: TestCase[] = []

function test(name: string, run: () => Promise<void>) {
  tests.push({ name, run })
}

async function listen(app: http.RequestListener) {
  const server = http.createServer(app)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Failed to start integration test server')
  }
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  }
}

async function request(baseUrl: string, method: string, pathname: string, body?: unknown, headers?: Record<string, string>) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(headers || {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const payload = await response.json()
  return { response, payload }
}

/** importLink 内部走 apiFetch 相对路径，Node 下需要把相对 URL 补全为测试服务地址。 */
async function withRelativeFetch<T>(fn: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const fullUrl = url.startsWith('http') ? url : `${baseUrl}${url}`
    return originalFetch(fullUrl, init)
  }) as typeof fetch
  try {
    return await fn()
  } finally {
    globalThis.fetch = originalFetch
  }
}

const KNOWLEDGE_ITEM_FIXTURE = {
  source: {
    platform: 'bilibili',
    originalUrl: 'https://www.bilibili.com/video/BV1xx411c7mD',
  },
  distillation: {
    sourceSummary: '关于本地优先 AI 工具的讨论',
    evidenceUnits: [
      { content: '视频提到本地模型不依赖外部 API', evidenceType: 'TRANSCRIPT' },
      { content: '标题：本地优先', evidenceType: 'TITLE' },
      { content: '', evidenceType: 'METADATA' },
    ],
    inferences: [
      '作者倾向本地优先方案',
      { content: '隐私是主要动机' },
    ],
    uncertainties: [
      '本地模型性能是否足够',
    ],
  },
  article: {
    title: '知识文章',
    summary: '摘要',
    keyPoints: ['点1', '点2', '点3', '点4'],
    readingMinutes: 8,
  },
  cognitiveAction: {
    recommendedMode: 'ONE_MINUTE',
  },
}

function createLinkMindMock() {
  const seenIdempotencyKeys: string[] = []
  const handler: http.RequestListener = async (req, res) => {
    const url = new URL(req.url || '/', 'http://mock.linkmind')
    res.setHeader('Content-Type', 'application/json')
    if (req.method === 'POST' && url.pathname === '/api/v1/imports') {
      let body = ''
      for await (const chunk of req) body += chunk
      const parsed = JSON.parse(body)
      const idempotencyKey = req.headers['idempotency-key']
      if (idempotencyKey) {
        seenIdempotencyKeys.push(String(idempotencyKey))
      }
      res.statusCode = 202
      res.end(JSON.stringify({ importId: 'imp-1', status: 'PROCESSING', receivedUrl: parsed.url }))
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/imports/imp-1') {
      res.statusCode = 200
      res.end(JSON.stringify({ importId: 'imp-1', status: 'COMPLETED', knowledgeItemId: 'ki-1' }))
      return
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/knowledge-items/ki-1') {
      res.statusCode = 200
      res.end(JSON.stringify(KNOWLEDGE_ITEM_FIXTURE))
      return
    }
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'not found' }))
  }
  return { handler, seenIdempotencyKeys }
}

const originalEnv = {
  AETHEL_DATA_DIR: process.env.AETHEL_DATA_DIR,
  LINKMIND_BASE_URL: process.env.LINKMIND_BASE_URL,
  LINKMIND_IMPORT_POLL_INTERVAL_MS: process.env.LINKMIND_IMPORT_POLL_INTERVAL_MS,
  LINKMIND_IMPORT_POLL_TIMEOUT_MS: process.env.LINKMIND_IMPORT_POLL_TIMEOUT_MS,
}

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

test('extractUrls 提取链接并剥离尾部标点', () => {
  const urls = extractUrls('看这个 https://www.bilibili.com/video/BV1xx411c7mD。还有 http://a.b/c.')
  assert.deepEqual(urls, ['https://www.bilibili.com/video/BV1xx411c7mD', 'http://a.b/c'])
})

test('extractUrls 无链接返回空数组', () => {
  assert.deepEqual(extractUrls('这是一段没有链接的文本'), [])
})

test('guessPlatformFromUrl 推断平台名', () => {
  assert.equal(guessPlatformFromUrl('https://www.bilibili.com/video/BV1xx'), 'bilibili')
  assert.equal(guessPlatformFromUrl('https://v.douyin.com/abc/'), 'douyin')
  assert.equal(guessPlatformFromUrl('https://www.youtube.com/watch?v=abc'), 'youtube')
  assert.equal(guessPlatformFromUrl('https://example.com/a'), 'example.com')
  assert.equal(guessPlatformFromUrl('not a url'), '')
})

test('convertKnowledgeToCandidates 按证据/推断/不确定/摘要/要点映射', () => {
  const candidates = convertKnowledgeToCandidates(KNOWLEDGE_ITEM_FIXTURE)
  assert.equal(candidates.length, 9)
  assert.equal(candidates.filter((item) => item.tag === '来源摘要').length, 1)
  assert.equal(candidates.filter((item) => item.tag === '外部证据').length, 2)
  assert.equal(candidates.filter((item) => item.tag === '推断').length, 2)
  assert.equal(candidates.filter((item) => item.tag === '问题').length, 1)
  assert.equal(candidates.filter((item) => item.tag === '要点').length, 3)
  const evidence = candidates.find((item) => item.content === '视频提到本地模型不依赖外部 API')
  assert.equal(evidence?.evidenceType, 'TRANSCRIPT')
  assert.equal(evidence?.sourceUrl, 'https://www.bilibili.com/video/BV1xx411c7mD')
})

test('convertKnowledgeToCandidates 对非对象输入宽容', () => {
  assert.deepEqual(convertKnowledgeToCandidates(null), [])
  assert.deepEqual(convertKnowledgeToCandidates({}), [])
})

test('代理：/api/linkmind/config 返回配置状态', async () => {
  const response = await fetch(`${baseUrl}/api/linkmind/config`)
  const payload = await response.json()
  assert.equal(payload.configured, true)
  assert.equal(payload.pollIntervalMs, 10)
})

test('代理：POST /api/linkmind/imports 透传幂等键与请求体', async () => {
  const { response, payload } = await request(
    baseUrl,
    'POST',
    '/api/linkmind/imports',
    { url: 'https://www.bilibili.com/video/BV1xx411c7mD' },
    { 'Idempotency-Key': 'test-idem-key' },
  )
  assert.equal(response.status, 202, JSON.stringify(payload))
  assert.equal(payload.importId, 'imp-1')
  assert.deepEqual(mockLinkMind.seenIdempotencyKeys, ['test-idem-key'])
})

test('代理：GET /api/linkmind/imports/:id 轮询透传', async () => {
  const { response, payload } = await request(baseUrl, 'GET', '/api/linkmind/imports/imp-1')
  assert.equal(response.status, 200)
  assert.equal(payload.status, 'COMPLETED')
  assert.equal(payload.knowledgeItemId, 'ki-1')
})

test('代理：GET /api/linkmind/knowledge-items/:id 透传', async () => {
  const { response, payload } = await request(baseUrl, 'GET', '/api/linkmind/knowledge-items/ki-1')
  assert.equal(response.status, 200)
  assert.equal(payload.distillation.sourceSummary, '关于本地优先 AI 工具的讨论')
})

test('importLink 完整流程：幂等导入→轮询→转换候选气泡', async () => {
  const result = await withRelativeFetch(() => importLink('https://www.bilibili.com/video/BV1xx411c7mD。'))
  assert.equal(result.status, 'completed')
  assert.equal(result.importId, 'imp-1')
  assert.equal(result.knowledgeItemId, 'ki-1')
  assert.equal(result.sourceSummary, '关于本地优先 AI 工具的讨论')
  assert.equal(result.candidates?.length, 9)
  assert.equal(mockLinkMind.seenIdempotencyKeys.length, 2)
})

test('importLink 无链接返回 invalid', async () => {
  const result = await importLink('这里没有链接')
  assert.equal(result.status, 'invalid')
})

test('气泡创建：source 来源元数据白名单落盘并回读', async () => {
  const { response, payload } = await request(baseUrl, 'POST', '/api/bubbles', {
    content: '本地模型不依赖外部 API',
    tag: '外部证据',
    x: 0,
    y: 0,
    source: {
      importId: 'imp-1',
      knowledgeItemId: 'ki-1',
      url: 'https://www.bilibili.com/video/BV1xx411c7mD',
      platform: 'bilibili',
      accessedAt: '2026-08-02T00:00:00.000Z',
      sourceType: 'market',
      snippet: '摘要',
      evidenceType: 'TRANSCRIPT',
      extraField: 'should-be-dropped',
    },
  })
  assert.equal(response.status, 201)
  const created = payload.bubble
  assert.equal(created.source.importId, 'imp-1')
  assert.equal(created.source.evidenceType, 'TRANSCRIPT')
  assert.equal(created.source.extraField, undefined)

  const read = await request(baseUrl, 'GET', `/api/bubbles/${created.id}`)
  assert.equal(read.payload.bubble.source.url, 'https://www.bilibili.com/video/BV1xx411c7mD')
  assert.equal(read.payload.bubble.source.platform, 'bilibili')
})

test('气泡创建：非法 source 被清洗（缺 url → 丢弃，非法 sourceType → market）', async () => {
  const { payload } = await request(baseUrl, 'POST', '/api/bubbles', {
    content: '没有完整来源的气泡',
    source: { importId: 'imp-2', knowledgeItemId: 'ki-2', sourceType: 'hacker' },
  })
  assert.equal(payload.bubble.source, undefined)

  const withType = await request(baseUrl, 'POST', '/api/bubbles', {
    content: '非法 sourceType 归一化',
    source: {
      importId: 'imp-3',
      knowledgeItemId: 'ki-3',
      url: 'https://a.b/c',
      sourceType: 'hacker',
    },
  })
  assert.equal(withType.payload.bubble.source.sourceType, 'market')
})

test('未配置 LINKMIND_BASE_URL 时代理返回 503 且 importLink 报 not-configured', async () => {
  delete process.env.LINKMIND_BASE_URL
  try {
    const proxy = await request(baseUrl, 'POST', '/api/linkmind/imports', { url: 'https://a.b/c' })
    assert.equal(proxy.response.status, 503)
    assert.equal(proxy.payload.code, 'LINKMIND_NOT_CONFIGURED')

    const result = await withRelativeFetch(() => importLink('https://a.b/c'))
    assert.equal(result.status, 'not-configured')
  } finally {
    process.env.LINKMIND_BASE_URL = mockBaseUrl
  }
})

let baseUrl = ''
let mockBaseUrl = ''
let mockLinkMind: ReturnType<typeof createLinkMindMock>
let dataDir = ''
let server: http.Server
let mockServer: http.Server

async function main() {
  dataDir = await mkdtemp(path.join(tmpdir(), 'aethel-linkmind-test-'))
  process.env.AETHEL_DATA_DIR = dataDir
  process.env.LINKMIND_BASE_URL = 'http://127.0.0.1:1'
  process.env.LINKMIND_IMPORT_POLL_INTERVAL_MS = '10'
  process.env.LINKMIND_IMPORT_POLL_TIMEOUT_MS = '5000'

  mockLinkMind = createLinkMindMock()
  const mock = await listen(mockLinkMind.handler)
  mockServer = mock.server
  mockBaseUrl = mock.baseUrl
  process.env.LINKMIND_BASE_URL = mockBaseUrl

  const { default: app } = await import('../../api/app.js')
  const appListen = await listen(app)
  server = appListen.server
  baseUrl = appListen.baseUrl

  try {
    for (const item of tests) {
      await item.run()
      console.log(`✓ ${item.name}`)
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
    await new Promise<void>((resolve, reject) => {
      mockServer.close((error) => error ? reject(error) : resolve())
    })
    await rm(dataDir, { recursive: true, force: true })
    restoreEnv()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
