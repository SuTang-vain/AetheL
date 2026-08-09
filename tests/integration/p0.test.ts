import { strict as assert } from 'node:assert'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import http from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { apiFetch } from '../../src/lib/apiClient.js'
import { authedInit, registerTestUser } from '../helpers/auth.js'
import { requestSnapshotCognition, SNAPSHOT_BACKEND_ERROR_MESSAGE } from '../../src/lib/snapshotCognition.js'

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
  const response = await fetch(`${baseUrl}${pathname}`, authedInit({
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }))
  const contentType = response.headers.get('content-type') || ''
  const payload = contentType.includes('application/json') ? await response.json() : await response.text()
  return { response, payload }
}

async function main() {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'aethel-p0-'))
  process.env.NODE_ENV = 'test'
  process.env.AETHEL_DATA_DIR = dataDir
  process.env.AETHEL_USERS_DB = path.join(dataDir, 'users.db')

  const aiRoutes = await import('../../api/routes/ai.js')
  const { default: app } = await import('../../api/app.js')
  const aiCalls: Array<{ messages: Array<{ role: string; content: string }> }> = []
  aiRoutes.clearAIResponseCacheForTests()

  aiRoutes.setAICompletionOverrideForTests(async (payload) => {
    aiCalls.push(payload as { messages: Array<{ role: string; content: string }> })
    const systemPrompt = payload.messages[0]?.content || ''

    if (systemPrompt.includes('AI skill 运行器')) {
      return {
        choices: [{
          message: {
            content: JSON.stringify({
              analysisSummary: '识别到一个需要拆解的产品想法。',
              needsConfirmation: false,
              confidence: 0.86,
              confirmationPrompt: '可以先生成基础模块气泡。',
              clarificationQuestions: [],
              candidateBubbles: [{
                title: 'AI 推断模块',
                content: '根据设想推断出的模块气泡',
                tag: '产品模块',
                rationale: '来自 mock AI',
              }],
              suggestedNextActions: ['生成气泡'],
            }),
          },
        }],
      }
    }

    if (systemPrompt.includes('碎片化的灵感进行归类整理')) {
      return {
        choices: [{
          message: {
            content: JSON.stringify({
              categories: [{
                name: '核心体验',
                description: '围绕主链路体验',
                bubbleIds: ['b1', 'b2'],
                suggestedTag: '核心',
                confidence: 1.8,
              }],
              suggestedTags: [{ name: '核心', color: '#ad2c0d', reason: '归类结果' }],
              relations: [
                { sourceId: 'b1', targetId: 'b2', type: 'duplicate', reason: '表达接近' },
                { sourceId: 'b1', targetId: '', type: 'unknown', reason: '应被过滤' },
              ],
            }),
          },
        }],
      }
    }

    if (systemPrompt.includes('正在帮助用户处理多个灵感气泡之间的关系')) {
      return {
        choices: [{
          message: {
            content: JSON.stringify({
              question: '两条气泡存在重复，可以合并成一个更明确的目标。',
              options: [{
                id: 'merge',
                text: '确认合并',
                detail: '保留 b1，吸收 b2 的验收标准。',
                action: 'merge',
                targetBubbleId: 'b1',
                sourceBubbleIds: ['b2'],
                deleteBubbleIds: ['b2'],
                newContent: '为年轻产品经理提供结构化 PRD 生成体验，并明确验收标准。',
              }],
            }),
          },
        }],
      }
    }

    if (systemPrompt.includes('PRD 分章节草稿')) {
      const userPrompt = payload.messages[1]?.content || ''
      const groupId = userPrompt.includes('分组ID: growth') ? 'growth' : 'core'
      const title = groupId === 'growth' ? '增长实验' : '核心体验'
      return {
        choices: [{
          message: {
            content: JSON.stringify({
              sections: [{
                groupId,
                title,
                content: `## 目标\n形成可验证的${title}。`,
              }],
            }),
          },
        }],
      }
    }

    if (systemPrompt.includes('认知负荷优化专家')) {
      const userPrompt = payload.messages[1]?.content || ''
      if (userPrompt.includes('混合格式')) {
        return {
          choices: [{
            message: {
              content: [
                '```json',
                JSON.stringify({
                  statusSnapshot: '混合格式快照仍能被解析。',
                  logicFlow: '模型返回了代码块，但服务端应只提取有效 JSON。',
                  cognitiveGaps: ['确认解析稳定性'],
                  semanticAnchors: [{ label: '混合格式', reason: '用于验证 fenced JSON 解析', bubbleIds: [{ id: 'b1' }] }],
                  wakeTrigger: '继续检查快照解析链路。',
                  level2: [{ anchor: '混合格式', summary: '验证代码块和额外说明不会破坏快照。', bubbleIds: ['b1'] }],
                  level3: [{ bubbleId: { id: 'b1' }, source: 'mock', deepLogic: '对象形式 ID 应被归一化。' }],
                }),
                '```',
                '额外说明：{这不是 JSON}',
              ].join('\n'),
            },
          }],
        }
      }

      return {
        choices: [{
          message: {
            content: JSON.stringify({
              statusSnapshot: '围绕核心用户假设形成初步判断。',
              logicFlow: '从用户场景出发，先确认价值，再收敛模块。',
              cognitiveGaps: ['验证标准仍需明确'],
              semanticAnchors: [{ label: '用户假设', reason: '决定后续模块优先级', bubbleIds: ['b1'] }],
              wakeTrigger: '继续验证用户假设与模块优先级。',
              level2: [{ anchor: '用户假设', summary: '需要继续确认目标用户。', bubbleIds: ['b1'] }],
              level3: [{ bubbleId: 'b1', source: '气泡原文', deepLogic: '假设来自用户输入。' }],
            }),
          },
        }],
      }
    }

    return { choices: [{ message: { content: '{}' } }] }
  })

  const { server, baseUrl } = await listen(app)
  await registerTestUser(baseUrl, 'p0@aethel.local')

  test('workspace APIs write runtime data into the configured temp data dir', async () => {
    const { response, payload } = await request(baseUrl, 'POST', '/api/bubbles', {
      id: 'b1',
      content: '为年轻产品经理提供结构化 PRD 生成体验',
      tag: '用户假设',
      color: '#ad2c0d',
      x: 12,
      y: 24,
    })

    assert.equal(response.status, 201)
    assert.equal(payload.success, true)
    assert.equal(payload.bubble.id, 'b1')
    assert.equal(existsSync(path.join(dataDir, 'users', 'p0_aethel_local', 'bubbles', 'b1.md')), true)
    assert.equal(existsSync(path.join(dataDir, 'users', 'p0_aethel_local', 'workspace.json')), true)
  })

  test('workshop skill keeps the original idea as the first generated bubble', async () => {
    const originalIdea = '做一个把模糊想法拆成 PRD 的 AI 工作区'
    const { response, payload } = await request(baseUrl, 'POST', '/api/ai/workshop-skill', {
      skillId: 'idea-to-bubbles',
      input: originalIdea,
    })

    assert.equal(response.status, 200)
    assert.equal(payload.success, true)
    assert.equal(payload.candidateBubbles[0].title, '初始设想')
    assert.equal(payload.candidateBubbles[0].content, originalIdea)
    assert.equal(payload.candidateBubbles.length, 2)
  })

  test('PRD section generation returns grouped editable sections', async () => {
    const { response, payload } = await request(baseUrl, 'POST', '/api/ai/generate-prd-sections', {
      groups: [{
        id: 'core',
        title: '核心体验',
        tag: '产品模块',
        bubbles: [{ id: 'b1', content: '生成结构化 PRD section', tag: '产品模块' }],
      }],
    })

    assert.equal(response.status, 200)
    assert.equal(payload.success, true)
    assert.equal(payload.sections[0].groupId, 'core')
    assert.equal(payload.sections[0].title, '核心体验')
  })

  test('PRD section generation caches identical payloads and keeps different payloads isolated', async () => {
    aiRoutes.clearAIResponseCacheForTests()
    const beforeCount = aiCalls.filter((call) => call.messages[0]?.content.includes('PRD 分章节草稿')).length
    const payload = {
      groups: [{
        id: 'core',
        title: '核心体验',
        tag: '产品模块',
        bubbles: [{ id: 'b1', content: '生成结构化 PRD section', tag: '产品模块' }],
      }],
    }

    const first = await request(baseUrl, 'POST', '/api/ai/generate-prd-sections', payload)
    const second = await request(baseUrl, 'POST', '/api/ai/generate-prd-sections', payload)
    const afterSamePayloadCount = aiCalls.filter((call) => call.messages[0]?.content.includes('PRD 分章节草稿')).length

    assert.equal(first.response.status, 200)
    assert.equal(second.response.status, 200)
    assert.equal(afterSamePayloadCount - beforeCount, 1)
    assert.equal(second.payload.sections[0].groupId, 'core')

    const different = await request(baseUrl, 'POST', '/api/ai/generate-prd-sections', {
      groups: [{
        id: 'growth',
        title: '增长实验',
        tag: '增长',
        bubbles: [{ id: 'b3', content: '设计邀请转化实验', tag: '增长' }],
      }],
    })
    const afterDifferentPayloadCount = aiCalls.filter((call) => call.messages[0]?.content.includes('PRD 分章节草稿')).length

    assert.equal(different.response.status, 200)
    assert.equal(afterDifferentPayloadCount - afterSamePayloadCount, 1)
    assert.equal(different.payload.sections[0].groupId, 'growth')
  })

  test('PRD section generation can run independent groups in parallel', async () => {
    aiRoutes.clearAIResponseCacheForTests()
    const beforeCount = aiCalls.filter((call) => call.messages[0]?.content.includes('PRD 分章节草稿')).length
    const { response, payload } = await request(baseUrl, 'POST', '/api/ai/generate-prd-sections', {
      groups: [
        {
          id: 'core',
          title: '核心体验',
          tag: '产品模块',
          bubbles: [{ id: 'b1', content: '生成结构化 PRD section', tag: '产品模块' }],
        },
        {
          id: 'growth',
          title: '增长实验',
          tag: '增长',
          bubbles: [{ id: 'b3', content: '设计邀请转化实验', tag: '增长' }],
        },
      ],
    })
    const afterCount = aiCalls.filter((call) => call.messages[0]?.content.includes('PRD 分章节草稿')).length

    assert.equal(response.status, 200)
    assert.equal(payload.success, true)
    assert.deepEqual(payload.sections.map((section: { groupId: string }) => section.groupId), ['core', 'growth'])
    assert.equal(afterCount - beforeCount, 2)
  })

  test('snapshot generation returns progressive cognition layers', async () => {
    const { response, payload } = await request(baseUrl, 'POST', '/api/ai/snapshot', {
      bubbles: [{
        id: 'b1',
        content: '为年轻产品经理提供结构化 PRD 生成体验',
        tag: '用户假设',
        interactionWeight: 3,
      }],
      categories: [{ name: '用户假设', description: '目标用户与需求判断' }],
    })

    assert.equal(response.status, 200)
    assert.equal(payload.success, true)
    assert.equal(payload.statusSnapshot, '围绕核心用户假设形成初步判断。')
    assert.equal(payload.semanticAnchors[0].label, '用户假设')
    assert.equal(Array.isArray(payload.level3), true)
  })

  test('snapshot generation parses fenced json and normalizes cognition ids', async () => {
    const { response, payload } = await request(baseUrl, 'POST', '/api/ai/snapshot', {
      bubbles: [{
        id: 'b1',
        content: '混合格式响应也应该形成认知快照',
        tag: '混合格式',
        interactionWeight: 2,
      }],
      categories: [{ name: '混合格式', description: '解析稳定性验证' }],
    })

    assert.equal(response.status, 200)
    assert.equal(payload.success, true)
    assert.equal(payload.statusSnapshot, '混合格式快照仍能被解析。')
    assert.deepEqual(payload.semanticAnchors[0].bubbleIds, ['b1'])
    assert.equal(payload.level3[0].bubbleId, 'b1')
  })

  test('categorize response is normalized through runtime schema checks', async () => {
    const longContent = `${'很长的气泡内容'.repeat(700)}`
    const { response, payload } = await request(baseUrl, 'POST', '/api/ai/categorize', {
      bubbles: [
        { id: 'b1', content: longContent, tag: '用户假设' },
        { id: 'b2', content: '结构化 PRD 输出', tag: 'PRD' },
      ],
      existingTags: ['用户假设'],
    })

    assert.equal(response.status, 200)
    assert.equal(payload.success, true)
    assert.equal(payload.categories[0].confidence, 1)
    assert.equal(payload.relations.length, 1)
    assert.equal(payload.relations[0].type, 'duplicate')
    const categorizeCall = aiCalls.find((call) => call.messages[0]?.content.includes('碎片化的灵感进行归类整理'))
    assert.ok(categorizeCall)
    assert.ok(categorizeCall.messages[1].content.includes('[已截断]'))
  })

  test('relationship followup response is normalized through runtime schema checks', async () => {
    const { response, payload } = await request(baseUrl, 'POST', '/api/ai/followup', {
      bubbleContent: 'b1 与 b2 是否重复？',
      existingBubbles: ['b1: 结构化 PRD 生成', 'b2: PRD 输出验收标准'],
      mode: 'relationship',
      targetBubbleIds: ['b1', 'b2'],
    })

    assert.equal(response.status, 200)
    assert.equal(payload.success, true)
    assert.equal(payload.options[0].action, 'merge')
    assert.deepEqual(payload.options[0].deleteBubbleIds, ['b2'])
    assert.equal(payload.options.at(-1).text, '就这样吧')
  })

  test('apiFetch falls back to the local API when same-origin returns HTML', async () => {
    const originalFetch = globalThis.fetch
    const originalWindow = (globalThis as typeof globalThis & { window?: unknown }).window
    const calledUrls: string[] = []

    ;(globalThis as typeof globalThis & { window?: unknown }).window = { location: { hostname: 'localhost' } }
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      calledUrls.push(url)
      if (url === '/api/health') {
        return new Response('<html></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
      }
      if (url === 'http://localhost:3000/api/health') {
        return Response.json({ success: true, source: 'fallback' })
      }
      throw new Error(`Unexpected URL: ${url}`)
    }) as typeof fetch

    try {
      const response = await apiFetch('/api/health')
      const payload = await response.json()
      assert.equal(payload.source, 'fallback')
      assert.deepEqual(calledUrls, ['/api/health', 'http://localhost:3000/api/health'])
    } finally {
      globalThis.fetch = originalFetch
      ;(globalThis as typeof globalThis & { window?: unknown }).window = originalWindow
    }
  })

  test('apiFetch does not retry local origins for backend 500 responses', async () => {
    const originalFetch = globalThis.fetch
    const originalWindow = (globalThis as typeof globalThis & { window?: unknown }).window
    const calledUrls: string[] = []

    ;(globalThis as typeof globalThis & { window?: unknown }).window = { location: { hostname: 'localhost' } }
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      calledUrls.push(url)
      if (url === '/api/ai/snapshot') {
        return Response.json({ success: false, error: 'backend failed' }, { status: 500 })
      }
      throw new Error(`Unexpected URL: ${url}`)
    }) as typeof fetch

    try {
      const response = await apiFetch('/api/ai/snapshot', { method: 'POST' })
      assert.equal(response.status, 500)
      assert.deepEqual(calledUrls, ['/api/ai/snapshot'])
    } finally {
      globalThis.fetch = originalFetch
      ;(globalThis as typeof globalThis & { window?: unknown }).window = originalWindow
    }
  })

  test('snapshot cognition request throws a stable backend error instead of returning fallback', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => Response.json(
      { success: false, error: 'AI snapshot response parse failed' },
      { status: 502 },
    )) as typeof fetch

    try {
      await assert.rejects(
        () => requestSnapshotCognition(
          [{
            id: 'b1',
            content: '后端异常时不应生成本地 fallback 快照',
            tag: '异常处理',
            color: '#0891b2',
            categoryId: '',
            x: 0,
            y: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }],
          [],
          [],
        ),
        { message: SNAPSHOT_BACKEND_ERROR_MESSAGE },
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  try {
    for (const item of tests) {
      await item.run()
      console.log(`✓ ${item.name}`)
    }
  } finally {
    aiRoutes.setAICompletionOverrideForTests(null)
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
    await rm(dataDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
