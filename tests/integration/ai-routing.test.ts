import { strict as assert } from 'node:assert'
import http from 'node:http'

// BabeL-O 唯一引擎的路由语义测试：
// - 归类/快照请求携带 response_format=json_object 且 model 为空（ADR-B2）
// - fast-json 归类缓存命中、snapshot-large 不使用缓存
// - schema 校验失败不再 provider fallback，直接报错
// - provider 失败（429）直接失败，无 fallback 链

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
  await new Promise<void>((resolve) => server.listen(0, resolve))
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Failed to start integration test server')
  }
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  }
}

async function request(baseUrl: string, method: string, pathname: string, body?: unknown) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const payload = await response.json()
  return { response, payload }
}

async function main() {
  process.env.NODE_ENV = 'test'
  process.env.BABEL_NEXUS_URL = 'http://127.0.0.1:3999'
  process.env.BABEL_NEXUS_API_KEY = 'test-key'

  const aiRoutes = await import('../../api/routes/ai.js')
  const { default: app } = await import('../../api/app.js')
  const calls: Array<Record<string, unknown>> = []

  aiRoutes.clearAIResponseCacheForTests()
  aiRoutes.clearAIMetricsForTests()
  aiRoutes.setAICompletionOverrideForTests(async (payload) => {
    calls.push(payload as Record<string, unknown>)
    const content = payload.messages[0]?.content || ''

    if (content.includes('碎片化的灵感进行归类整理')) {
      return {
        choices: [{
          message: {
            content: JSON.stringify({
              categories: [{ name: '体验', description: '体验类', bubbleIds: ['b1'], confidence: 1 }],
              suggestedTags: [],
              relations: [],
            }),
          },
        }],
      }
    }

    if (content.includes('认知负荷优化专家')) {
      // 快照：默认返回完整认知结构
      return {
        choices: [{
          message: {
            content: JSON.stringify({
              statusSnapshot: '当前状态',
              logicFlow: '逻辑脉络',
              cognitiveGaps: ['缺口'],
              semanticAnchors: [{ label: '锚点', reason: '原因' }],
              wakeTrigger: '唤醒指令',
            }),
          },
        }],
      }
    }

    return { choices: [{ message: { content: '{}' } }] }
  })

  const { server, baseUrl } = await listen(app)

  test('归类请求：response_format=json_object 且 model 为空（ADR-B2）', async () => {
    calls.length = 0
    const { response, payload } = await request(baseUrl, 'POST', '/api/ai/categorize', {
      bubbles: [{ id: 'b1', content: '老人吃药提醒' }],
      existingTags: [],
    })
    assert.equal(response.status, 200)
    assert.equal(payload.success, true)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].model, '')
    assert.equal((calls[0].response_format as { type: string }).type, 'json_object')
  })

  test('fast-json followup 命中 AI 响应缓存（同 payload 只调一次）', async () => {
    calls.length = 0
    const body = { bubbleContent: '老人吃药提醒', existingBubbles: [], mode: 'single', targetBubbleIds: [] }
    await request(baseUrl, 'POST', '/api/ai/followup', body)
    await request(baseUrl, 'POST', '/api/ai/followup', body)
    assert.equal(calls.length, 1)
  })

  test('snapshot-large 不使用 AI 响应缓存（两次调用两次请求）', async () => {
    calls.length = 0
    const body = {
      bubbles: [{ id: 'b1', content: '老人吃药提醒', tag: '想法' }],
      categoryLines: [],
      tagState: { categories: [], tags: [] },
    }
    await request(baseUrl, 'POST', '/api/ai/snapshot', body)
    await request(baseUrl, 'POST', '/api/ai/snapshot', body)
    assert.equal(calls.length, 2)
  })

  test('快照 schema 校验失败直接报错（不再 provider fallback）', async () => {
    calls.length = 0
    aiRoutes.setAICompletionOverrideForTests(async () => {
      calls.push({ attempt: 'schema-fail' })
      return { choices: [{ message: { content: '{}' } }] }
    })
    const { response } = await request(baseUrl, 'POST', '/api/ai/snapshot', {
      bubbles: [{ id: 'b1', content: '老人吃药提醒', tag: '想法' }],
      categoryLines: [],
      tagState: { categories: [], tags: [] },
    })
    assert.equal(response.status, 500)
    assert.equal(calls.length, 1) // 只调用一次：无 fallback 重试
  })

  test('provider 429 直接失败（无 fallback 链）', async () => {
    calls.length = 0
    aiRoutes.setAICompletionOverrideForTests(async () => {
      calls.push({ attempt: '429' })
      throw new Error('429 rate limit')
    })
    const { response } = await request(baseUrl, 'POST', '/api/ai/categorize', {
      bubbles: [{ id: 'b1', content: 'x' }],
      existingTags: [],
    })
    assert.equal(response.status, 500)
    assert.equal(calls.length, 1) // 无 fallback：不重试下一个 provider
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
    aiRoutes.setAICompletionOverrideForTests(null)
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
