import { strict as assert } from 'node:assert'
import http from 'node:http'

// BabeL-O 唯一引擎的 AI 配置判定测试：
// - buildAIConfigsFromEnv / isProviderConfigured 的 babel 语义
// - GET /api/ai/config 实时反映 BABEL_NEXUS_URL 配置状态

type TestCase = {
  name: string
  run: () => Promise<void> | void
}

const tests: TestCase[] = []

function test(name: string, run: () => Promise<void> | void) {
  tests.push({ name, run })
}

const originalEnv = {
  BABEL_NEXUS_URL: process.env.BABEL_NEXUS_URL,
  BABEL_NEXUS_API_KEY: process.env.BABEL_NEXUS_API_KEY,
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

async function main() {
  process.env.NODE_ENV = 'test'
  process.env.BABEL_NEXUS_URL = 'http://127.0.0.1:3999'
  process.env.BABEL_NEXUS_API_KEY = 'test-key'

  const { buildAIConfigsFromEnv, isProviderConfigured } = await import('../../api/aiProfiles.js')

  test('babel 配置拼接：baseURL 追加 /v1、model 为空（ADR-B2）', () => {
    const cfg = buildAIConfigsFromEnv().babel
    assert.equal(cfg.provider, 'babel')
    assert.equal(cfg.baseURL, 'http://127.0.0.1:3999/v1')
    assert.equal(cfg.apiKey, 'test-key')
    assert.equal(cfg.model, '')
  })

  test('BABEL_NEXUS_URL 缺失时引擎判定为不可用', () => {
    const saved = process.env.BABEL_NEXUS_URL
    delete process.env.BABEL_NEXUS_URL
    try {
      assert.equal(isProviderConfigured(buildAIConfigsFromEnv().babel), false)
    } finally {
      if (saved === undefined) delete process.env.BABEL_NEXUS_URL
      else process.env.BABEL_NEXUS_URL = saved
    }
  })

  test('BABEL_NEXUS_API_KEY 可缺省（本地 daemon 无鉴权）', () => {
    const saved = process.env.BABEL_NEXUS_API_KEY
    delete process.env.BABEL_NEXUS_API_KEY
    try {
      assert.equal(isProviderConfigured(buildAIConfigsFromEnv().babel), true)
    } finally {
      if (saved === undefined) delete process.env.BABEL_NEXUS_API_KEY
      else process.env.BABEL_NEXUS_API_KEY = saved
    }
  })

  const { default: app } = await import('../../api/app.js')
  const server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, resolve))
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`

  test('GET /api/ai/config：已配置时 provider=babel 且 hasApiKey=true', async () => {
    process.env.BABEL_NEXUS_URL = 'http://127.0.0.1:3999'
    const response = await fetch(`${baseUrl}/api/ai/config`)
    const data = await response.json()
    assert.equal(response.status, 200)
    assert.equal(data.provider, 'babel')
    assert.equal(data.hasApiKey, true)
  })

  test('移除 BABEL_NEXUS_URL 后 hasApiKey=false（实时判定）', async () => {
    delete process.env.BABEL_NEXUS_URL
    const response = await fetch(`${baseUrl}/api/ai/config`)
    const data = await response.json()
    assert.equal(data.hasApiKey, false)
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
    restoreEnv()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
