import { strict as assert } from 'node:assert'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'

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
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
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

const originalEnv = {
  AETHEL_DATA_DIR: process.env.AETHEL_DATA_DIR,
  LINKMIND_BASE_URL: process.env.LINKMIND_BASE_URL,
  LINKMIND_ENV_PATH: process.env.LINKMIND_ENV_PATH,
  MODELSCOPE_API_KEY: process.env.MODELSCOPE_API_KEY,
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
  MOONSHOT_API_KEY: process.env.MOONSHOT_API_KEY,
  AI_PROVIDER: process.env.AI_PROVIDER,
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

let baseUrl = ''
let dataDir = ''
let envFilePath = ''
let server: http.Server

test('同步端点把 AetheL 生效 AI 配置写入目标 .env（保留其他行）', async () => {
  await writeFile(envFilePath, 'DATABASE_URL="postgresql://localhost:5432/linkmind"\nAI_TIMEOUT_MS="120000"\n')

  const { response, payload } = await request(baseUrl, 'POST', '/api/linkmind/sync-ai-config')
  assert.equal(response.status, 200)
  assert.equal(payload.success, true)
  assert.equal(payload.provider, 'modelscope')
  assert.equal(payload.baseURL, 'https://api-inference.modelscope.cn/v1')
  assert.match(payload.apiKeyMasked, /^.{4}\*{3}.{4}$/)

  const content = await readFile(envFilePath, 'utf8')
  assert.ok(content.includes('DATABASE_URL="postgresql://localhost:5432/linkmind"'), '保留原行')
  assert.ok(content.includes('AI_TIMEOUT_MS="120000"'), '保留原行')
  assert.ok(content.includes('AI_API_KEY="'), '写入 AI_API_KEY')
  assert.ok(content.includes('AI_BASE_URL="https://api-inference.modelscope.cn/v1"'), '写入 AI_BASE_URL')
  assert.ok(content.includes('AI_MODEL="'), '写入 AI_MODEL')
  assert.ok(!JSON.stringify(payload).includes(process.env.MODELSCOPE_API_KEY || ''), 'apiKey 不回传客户端（响应打码）')
})

test('同步端点覆盖已有 AI 配置行且不重复追加', async () => {
  await writeFile(envFilePath, 'AI_API_KEY="old-key"\nAI_BASE_URL="http://old"\nAI_MODEL="old-model"\n')

  const { response } = await request(baseUrl, 'POST', '/api/linkmind/sync-ai-config')
  assert.equal(response.status, 200)

  const content = await readFile(envFilePath, 'utf8')
  assert.ok(!content.includes('old-key'), '旧 key 被覆盖')
  assert.equal((content.match(/AI_API_KEY=/g) || []).length, 1, '不重复追加')
  assert.equal((content.match(/AI_MODEL=/g) || []).length, 1)
})

test('未配置 LINKMIND 时同步返回 503', async () => {
  delete process.env.LINKMIND_BASE_URL
  delete process.env.LINKMIND_ENV_PATH
  try {
    const { response, payload } = await request(baseUrl, 'POST', '/api/linkmind/sync-ai-config')
    assert.equal(response.status, 503)
    assert.equal(payload.code, 'LINKMIND_NOT_CONFIGURED')
  } finally {
    process.env.LINKMIND_BASE_URL = 'http://127.0.0.1:1'
  }
})

test('AetheL 无可用 AI key 时同步返回 400', async () => {
  delete process.env.MODELSCOPE_API_KEY
  delete process.env.DEEPSEEK_API_KEY
  delete process.env.MOONSHOT_API_KEY
  delete process.env.AI_PROVIDER
  try {
    // 通过 auto 重置让后端内存配置重读 env
    await request(baseUrl, 'POST', '/api/ai/config', { provider: 'auto' })
    const { response, payload } = await request(baseUrl, 'POST', '/api/linkmind/sync-ai-config')
    assert.equal(response.status, 400)
    assert.equal(payload.code, 'AI_KEY_MISSING')
  } finally {
    process.env.MODELSCOPE_API_KEY = 'sk-mock-modelscope-key-1234'
    process.env.AI_PROVIDER = 'modelscope'
    await request(baseUrl, 'POST', '/api/ai/config', { provider: 'auto' })
  }
})

async function main() {
  dataDir = await mkdtemp(path.join(tmpdir(), 'aethel-sync-test-'))
  envFilePath = path.join(dataDir, 'linkmind.env')
  process.env.AETHEL_DATA_DIR = dataDir
  process.env.LINKMIND_BASE_URL = 'http://127.0.0.1:1'
  process.env.LINKMIND_ENV_PATH = envFilePath
  process.env.MODELSCOPE_API_KEY = 'sk-mock-modelscope-key-1234'
  process.env.AI_PROVIDER = 'modelscope'

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
    await rm(dataDir, { recursive: true, force: true })
    restoreEnv()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
