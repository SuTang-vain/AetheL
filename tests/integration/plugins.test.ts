import { strict as assert } from 'node:assert'
import http from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
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
  LINKMIND_IMPORT_POLL_INTERVAL_MS: process.env.LINKMIND_IMPORT_POLL_INTERVAL_MS,
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

test('插件列表返回内置 manifest', async () => {
  const { response, payload } = await request(baseUrl, 'GET', '/api/plugins')
  assert.equal(response.status, 200)
  assert.equal(payload.success, true)
  const linkmind = payload.plugins.find((item: { manifest: { id: string } }) => item.manifest.id === 'linkmind')
  assert.ok(linkmind, 'linkmind manifest 存在')
  assert.equal(linkmind.manifest.name, 'LinkMind 外部证据')
  assert.equal(linkmind.state, null, '初始未安装')
})

test('安装插件后 config 来源变为 plugin', async () => {
  const install = await request(baseUrl, 'POST', '/api/plugins/linkmind/install')
  assert.equal(install.response.status, 200)
  assert.equal(install.payload.plugin.state.installed, true)
  assert.equal(install.payload.plugin.state.enabled, true)

  // 未配置 baseUrl 时仍走 env 回退
  const config = await request(baseUrl, 'GET', '/api/linkmind/config')
  assert.equal(config.payload.configured, true)
  assert.equal(config.payload.source, 'env')

  const patch = await request(baseUrl, 'PATCH', '/api/plugins/linkmind', {
    config: { baseUrl: 'http://127.0.0.1:3199', pollIntervalMs: 50 },
  })
  assert.equal(patch.response.status, 200)
  assert.equal(patch.payload.plugin.state.config.baseUrl, 'http://127.0.0.1:3199')

  const after = await request(baseUrl, 'GET', '/api/linkmind/config')
  assert.equal(after.payload.source, 'plugin')
  assert.equal(after.payload.pollIntervalMs, 50)
})

test('停用插件后回落 env 配置', async () => {
  const patch = await request(baseUrl, 'PATCH', '/api/plugins/linkmind', { enabled: false })
  assert.equal(patch.response.status, 200)
  assert.equal(patch.payload.plugin.state.enabled, false)

  const config = await request(baseUrl, 'GET', '/api/linkmind/config')
  assert.equal(config.payload.source, 'env')
})

test('卸载插件后状态保留但不可用', async () => {
  const uninstall = await request(baseUrl, 'POST', '/api/plugins/linkmind/uninstall')
  assert.equal(uninstall.response.status, 200)
  assert.equal(uninstall.payload.plugin.state.installed, false)
  assert.equal(uninstall.payload.plugin.state.enabled, false)

  const list = await request(baseUrl, 'GET', '/api/plugins')
  const linkmind = list.payload.plugins.find((item: { manifest: { id: string } }) => item.manifest.id === 'linkmind')
  assert.equal(linkmind.state.installed, false)
  assert.equal(linkmind.state.config.baseUrl, 'http://127.0.0.1:3199', '配置保留供重装恢复')
})

test('代理 health 端点直连 LinkMind', async () => {
  // env 指向的 mock 不可达时应返回 502 而非 503
  const health = await request(baseUrl, 'GET', '/api/linkmind/health')
  assert.equal(health.response.status, 502)
  assert.equal(health.payload.code, 'LINKMIND_UNREACHABLE')
})

let baseUrl = ''
let dataDir = ''
let server: http.Server

async function main() {
  dataDir = await mkdtemp(path.join(tmpdir(), 'aethel-plugins-test-'))
  process.env.AETHEL_DATA_DIR = dataDir
  process.env.LINKMIND_BASE_URL = 'http://127.0.0.1:1'
  process.env.LINKMIND_IMPORT_POLL_INTERVAL_MS = '10'

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
