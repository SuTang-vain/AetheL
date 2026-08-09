import { strict as assert } from 'node:assert'
import { mkdtemp, rm } from 'node:fs/promises'
import { authedInit, registerTestUser } from '../helpers/auth.js'
import http from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'

// BabeL-O 引擎适配回归测试：在 HTTP 层 mock BabeL-O 的 /v1/chat/completions，
// 走 AetheL 真实 OpenAI SDK 传输链路（不经过 setAICompletionOverrideForTests）。
// 覆盖：chat 非流式 / chat 流式 SSE / categorize（JSON 模式）/ ADR-B2 空 model 透传。

type TestCase = {
  name: string
  run: () => Promise<void>
}

const tests: TestCase[] = []

function test(name: string, run: () => Promise<void>) {
  tests.push({ name, run })
}

const CATEGORIZE_MOCK = {
  categories: [
    {
      name: '老年人用药管理',
      description: '围绕老年人服药场景的产品创意',
      bubbleIds: ['b1', 'b2'],
      suggestedTag: '老年关怀',
      confidence: 0.95,
    },
  ],
  suggestedTags: [
    { name: '老年关怀', color: '#FF8C42', reason: '围绕老年人用药场景' },
  ],
  relations: [],
}

async function main() {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'aethel-babel-'))
  const received: Array<{ body: Record<string, unknown> }> = []

  // --- mock BabeL-O /v1/chat/completions ---
  const mockServer = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => (raw += chunk))
    req.on('end', () => {
      const body = JSON.parse(raw || '{}')
      received.push({ body })
      const systemPrompt = body.messages?.[0]?.content || ''
      const content = systemPrompt.includes('气泡归类')
        ? JSON.stringify(CATEGORIZE_MOCK)
        : JSON.stringify({ ok: true, engine: 'babel-mock' })

      if (body.stream) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'close',
        })
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: '您好' }, finish_reason: null }] })}\n\n`)
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: '，世界' }, finish_reason: null }] })}\n\n`)
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 2 } })}\n\n`)
        res.write('data: [DONE]\n\n')
        res.end()
        return
      }

      const jsonBody = JSON.stringify({
        id: 'chatcmpl-mock',
        object: 'chat.completion',
        model: body.model || 'mock/default',
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      })
      res.writeHead(200, {
        'Content-Type': 'application/json',
        // node-fetch (openai SDK v4) 对 chunked 响应有 premature-close 兼容问题；
        // 显式 Content-Length（真实网关由 Fastify reply.send 自动设置）。
        'Content-Length': Buffer.byteLength(jsonBody),
      })
      res.end(jsonBody)
    })
  })
  await new Promise<void>((resolve) => mockServer.listen(0, resolve))
  const address = mockServer.address()
  if (!address || typeof address === 'string') throw new Error('mock listen failed')
  const mockBase = `http://127.0.0.1:${address.port}`

  // --- env 先行，再动态加载 app ---
  process.env.NODE_ENV = 'test'
  process.env.AETHEL_DATA_DIR = dataDir
  process.env.AETHEL_USERS_DB = path.join(dataDir, 'users.db')
  process.env.AI_PROVIDER = 'babel'
  process.env.BABEL_NEXUS_URL = mockBase
  process.env.BABEL_NEXUS_API_KEY = 'test-key'

  const { default: app } = await import('../../api/app.js')
  const server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, resolve))
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  await registerTestUser(baseUrl)

  async function post(pathname: string, body: unknown) {
    const response = await fetch(`${baseUrl}${pathname}`, authedInit({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }))
    const text = await response.text()
    let payload: unknown = text
    try {
      payload = JSON.parse(text)
    } catch {
      // SSE / 非 JSON 响应保持原文
    }
    return { response, payload }
  }

  test('chat 非流式经 babel provider 返回 mock 内容', async () => {
    received.length = 0
    const { response, payload } = await post('/api/ai/chat', {
      messages: [{ role: 'user', content: '测试' }],
      stream: false,
    })
    assert.equal(response.status, 200)
    const body = payload as { success: boolean; content: string }
    assert.equal(body.success, true)
    assert.equal(body.content, '{"ok":true,"engine":"babel-mock"}')
  })

  test('ADR-B2：AetheL 向 BabeL-O 发送空 model（模型选择权在 BabeL-O）', async () => {
    assert.equal(received.length, 1)
    assert.equal(received[0].body.model, '')
  })

  test('categorize 走 babel provider，JSON 归一化生效', async () => {
    received.length = 0
    const { response, payload } = await post('/api/ai/categorize', {
      bubbles: [
        { id: 'b1', content: '给老人做吃药提醒' },
        { id: 'b2', content: '子女远程查看父母服药情况' },
      ],
      existingTags: [],
    })
    assert.equal(response.status, 200)
    const body = payload as {
      success: boolean
      categories: Array<{ name: string; bubbleIds: string[] }>
      suggestedTags: Array<{ name: string }>
    }
    assert.equal(body.success, true)
    assert.equal(body.categories[0].name, '老年人用药管理')
    assert.deepEqual(body.categories[0].bubbleIds, ['b1', 'b2'])
    assert.equal(body.suggestedTags[0].name, '老年关怀')
    const responseFormat = received[0].body.response_format as { type?: string } | undefined
    assert.equal(responseFormat?.type, 'json_object')
  })

  test('chat 流式 SSE 透传（chunk 拼接 + done 终止帧）', async () => {
    received.length = 0
    const response = await fetch(`${baseUrl}/api/ai/chat`, authedInit({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: '流式' }], stream: true }),
    }))
    assert.equal(response.status, 200)
    const raw = await response.text()
    const chunks = raw.split('\n\n').filter((line) => line.startsWith('data: '))
    const doneChunk = chunks[chunks.length - 1]
    assert.ok(doneChunk.includes('"done":true'), '缺少 done:true 终止帧')
    const contents = chunks
      .map((c) => {
        try {
          return JSON.parse(c.slice(6)).content || ''
        } catch {
          return ''
        }
      })
      .join('')
    assert.equal(contents, '您好，世界')
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
