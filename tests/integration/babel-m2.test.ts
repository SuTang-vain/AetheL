import { strict as assert } from 'node:assert'
import { mkdtemp, rm } from 'node:fs/promises'
import http from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'

// M2 回归测试：模型选择器代理（/api/ai/models + /select）与 memory 改接
// （/api/memory/* → BabeL-O MemoryOS），走真实 OpenAI/HTTP 传输链路。
// 覆盖：模型列表归一化、模型切换、memory add/search/list 代理、
// 边车不可用（503 EVERCORE_MEMORY_UNAVAILABLE → MEMORY_UNAVAILABLE）、
// 未配置（BABEL_NEXUS_URL 缺失 → 503 BABEL_NOT_CONFIGURED）。

type TestCase = {
  name: string
  run: () => Promise<void>
}

const tests: TestCase[] = []

function test(name: string, run: () => Promise<void>) {
  tests.push({ name, run })
}

const MODELS_MOCK = {
  type: 'runtime_models',
  version: 42,
  tombstones: {},
  providers: [
    {
      id: 'deepseek',
      displayName: 'DeepSeek',
      adapter: 'openai-compatible',
      authMode: 'bearer',
      defaultModel: 'deepseek/deepseek-v4-flash',
      configured: true,
      authConfigured: true,
      active: true,
      models: [
        { id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek V4 Flash', contextWindow: 128000, defaultMaxTokens: 8192, capabilities: { toolCalling: true, jsonOutput: true, streaming: true } },
        { id: 'deepseek/deepseek-v4-pro', name: 'DeepSeek V4 Pro', contextWindow: 128000, defaultMaxTokens: 8192, capabilities: { toolCalling: true, jsonOutput: true, streaming: true } },
      ],
    },
    {
      id: 'anthropic',
      displayName: 'Anthropic',
      adapter: 'anthropic-compatible',
      authMode: 'bearer',
      defaultModel: 'anthropic/claude-sonnet-4',
      configured: true,
      authConfigured: false,
      active: false,
      models: [
        { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4', contextWindow: 200000, defaultMaxTokens: 8192, capabilities: { toolCalling: true, jsonOutput: true, streaming: true } },
      ],
    },
  ],
}

async function main() {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'aethel-m2-'))
  const received: Array<{ method: string; path: string; body: unknown }> = []
  let memoryDown = false

  // --- mock BabeL-O ---
  const mockServer = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => (raw += chunk))
    req.on('end', () => {
      const url = new URL(req.url || '/', 'http://mock')
      let body: unknown = null
      try {
        body = raw ? JSON.parse(raw) : null
      } catch {
        body = raw
      }
      received.push({ method: req.method || '', path: url.pathname, body })

      const json = (status: number, payload: unknown) => {
        const text = JSON.stringify(payload)
        res.writeHead(status, {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(text),
        })
        res.end(text)
      }

      if (req.method === 'GET' && url.pathname === '/v1/runtime/models') {
        json(200, MODELS_MOCK)
        return
      }
      if (req.method === 'POST' && url.pathname === '/v1/runtime/config/select') {
        json(200, { ok: true })
        return
      }
      if (url.pathname.startsWith('/v1/runtime/memory/')) {
        if (memoryDown) {
          json(503, { type: 'error', code: 'EVERCORE_MEMORY_UNAVAILABLE', message: 'Long-term memory is not available for this runtime.' })
          return
        }
        if (req.method === 'POST' && url.pathname === '/v1/runtime/memory/save-note') {
          json(200, { type: 'memory_save_result', noteId: 'note-1', status: 'saved' })
          return
        }
        if (req.method === 'POST' && url.pathname === '/v1/runtime/memory/search') {
          json(200, { type: 'memory_search_result', hits: [{ noteId: 'note-1', text: '老人吃药提醒' }] })
          return
        }
        if (req.method === 'GET' && url.pathname === '/v1/runtime/memory/candidates') {
          json(200, { type: 'memory_candidates', candidates: [{ candidateId: 'c1', messageId: 'm1' }] })
          return
        }
      }
      json(404, { error: 'not found' })
    })
  })
  await new Promise<void>((resolve) => mockServer.listen(0, resolve))
  const address = mockServer.address()
  if (!address || typeof address === 'string') throw new Error('mock listen failed')
  const mockBase = `http://127.0.0.1:${address.port}`

  // --- env 先行，再动态加载 app ---
  process.env.NODE_ENV = 'test'
  process.env.AETHEL_DATA_DIR = dataDir
  process.env.AI_PROVIDER = 'babel'
  process.env.BABEL_NEXUS_URL = mockBase
  process.env.BABEL_NEXUS_API_KEY = 'test-key'

  const { default: app } = await import('../../api/app.js')
  const server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, resolve))
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`

  async function request(pathname: string, init?: RequestInit) {
    const response = await fetch(`${baseUrl}${pathname}`, init)
    const text = await response.text()
    let payload: unknown = text
    try {
      payload = JSON.parse(text)
    } catch {
      // 保持原文
    }
    return { response, payload }
  }

  test('GET /api/ai/models 归一化模型目录（仅 authConfigured 可见、含 defaultModel）', async () => {
    received.length = 0
    const { response, payload } = await request('/api/ai/models')
    assert.equal(response.status, 200)
    const body = payload as {
      success: boolean
      providers: Array<{ id: string; authConfigured: boolean; active: boolean; defaultModel: string; models: Array<{ id: string }> }>
    }
    assert.equal(body.success, true)
    assert.equal(body.providers.length, 2)
    const deepseek = body.providers.find((p) => p.id === 'deepseek')!
    assert.equal(deepseek.authConfigured, true)
    assert.equal(deepseek.active, true)
    assert.equal(deepseek.defaultModel, 'deepseek/deepseek-v4-flash')
    assert.equal(deepseek.models.length, 2)
    assert.equal(body.providers.find((p) => p.id === 'anthropic')!.authConfigured, false)
  })

  test('POST /api/ai/models/select 透传 model 到 BabeL-O /config/select', async () => {
    received.length = 0
    const { response, payload } = await request('/api/ai/models/select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'deepseek/deepseek-v4-pro' }),
    })
    assert.equal(response.status, 200)
    assert.equal((payload as { success: boolean }).success, true)
    assert.equal(received.length, 1)
    assert.equal(received[0].path, '/v1/runtime/config/select')
    assert.deepEqual(received[0].body, { model: 'deepseek/deepseek-v4-pro' })
  })

  test('POST /api/memory/add 代理 save-note 且带 approved:true', async () => {
    received.length = 0
    const { response } = await request('/api/memory/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '老人吃药提醒很重要' }),
    })
    assert.equal(response.status, 200)
    assert.equal(received.length, 1)
    assert.equal(received[0].path, '/v1/runtime/memory/save-note')
    const body = received[0].body as { note: string; approved: boolean }
    assert.equal(body.note, '老人吃药提醒很重要')
    assert.equal(body.approved, true)
  })

  test('GET /api/memory/search 代理 search（query + topK）', async () => {
    received.length = 0
    const { response, payload } = await request('/api/memory/search?query=吃药提醒&limit=5')
    assert.equal(response.status, 200)
    assert.equal(received.length, 1)
    assert.equal(received[0].path, '/v1/runtime/memory/search')
    assert.deepEqual(received[0].body, { query: '吃药提醒', topK: 5 })
    const hits = (payload as { hits?: unknown[] }).hits
    assert.equal(hits?.length, 1)
  })

  test('GET /api/memory/list 代理 candidates', async () => {
    received.length = 0
    const { response } = await request('/api/memory/list?limit=10')
    assert.equal(response.status, 200)
    assert.equal(received.length, 1)
    assert.equal(received[0].path, '/v1/runtime/memory/candidates')
  })

  test('MemoryOS 边车不可用时返回 503 MEMORY_UNAVAILABLE（不挂起）', async () => {
    memoryDown = true
    try {
      const { response, payload } = await request('/api/memory/search?query=测试')
      assert.equal(response.status, 503)
      assert.equal((payload as { code: string }).code, 'MEMORY_UNAVAILABLE')
      const add = await request('/api/memory/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'x' }),
      })
      assert.equal(add.response.status, 503)
      assert.equal((add.payload as { code: string }).code, 'MEMORY_UNAVAILABLE')
    } finally {
      memoryDown = false
    }
  })

  // --- 未配置场景：重新起一个不带 BABEL_NEXUS_URL 的 app ---
  test('BABEL_NEXUS_URL 未配置时 /api/ai/models 返回 503 BABEL_NOT_CONFIGURED', async () => {
    const dataDir2 = await mkdtemp(path.join(tmpdir(), 'aethel-m2-noconfig-'))
    process.env.AETHEL_DATA_DIR = dataDir2
    delete process.env.BABEL_NEXUS_URL
    const { default: app2 } = await import('../../api/app.js')
    const server2 = http.createServer(app2)
    await new Promise<void>((resolve) => server2.listen(0, resolve))
    const base2 = `http://127.0.0.1:${(server2.address() as { port: number }).port}`
    try {
      const r1 = await fetch(`${base2}/api/ai/models`)
      const p1 = (await r1.json()) as { code: string }
      assert.equal(r1.status, 503)
      assert.equal(p1.code, 'BABEL_NOT_CONFIGURED')
      const r2 = await fetch(`${base2}/api/memory/search?query=x`)
      const p2 = (await r2.json()) as { code: string }
      assert.equal(r2.status, 503)
      assert.equal(p2.code, 'MEMORY_UNAVAILABLE')
    } finally {
      await new Promise<void>((resolve) => server2.close(() => resolve()))
      await rm(dataDir2, { recursive: true, force: true })
    }
  })

  try {
    let failed = 0
    for (const item of tests) {
      try {
        await item.run()
        console.log(`✓ ${item.name}`)
      } catch (error) {
        failed += 1
        console.error(`✗ ${item.name}`)
        console.error(error)
      }
    }
    if (failed > 0) {
      process.exitCode = 1
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await new Promise<void>((resolve) => mockServer.close(() => resolve()))
    await rm(dataDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
