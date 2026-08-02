import { readFile, writeFile } from 'fs/promises'
import path from 'path'
import { Router, type Request, type Response } from 'express'
import { getEffectiveLinkMindConfig, readPluginState, type PluginState } from '../plugins/registry.js'
import { projectRoot } from '../storage/paths.js'
import { getRuntimeAIConfig } from './ai.js'

/**
 * LinkMind（链藏）外部证据服务代理层。
 * 职责：AetheL 后端代理 LinkMind 的 HTTP API（contracts/openapi.yaml），
 * 前端不直接访问 LinkMind 地址。
 * 配置解析：LinkMind 插件（已安装且启用）→ env 回退（开发/测试）→ 未配置。
 * 约定：LinkMind 以 3100 端口运行（3000 与 AetheL Express 冲突）。
 */

const router = Router()

const LINKMIND_PROXY_TIMEOUT_MS = Number(process.env.LINKMIND_PROXY_TIMEOUT_MS || 15_000)
const LINKMIND_IMPORT_TIMEOUT_MS = Number(process.env.LINKMIND_IMPORT_TIMEOUT_MS || 120_000)

async function proxyToLinkMind(
  upstreamPath: string,
  init: RequestInit = {},
  timeoutMs: number = LINKMIND_PROXY_TIMEOUT_MS,
): Promise<{ status: number; body: unknown }> {
  const config = await getEffectiveLinkMindConfig()
  if (!config) {
    return {
      status: 503,
      body: { success: false, error: 'LinkMind not configured', code: 'LINKMIND_NOT_CONFIGURED' },
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${config.baseUrl}${upstreamPath}`, { ...init, signal: controller.signal })
    const body = await response.json().catch(() => null)
    return { status: response.status, body }
  } catch (error: unknown) {
    return {
      status: 502,
      body: {
        success: false,
        error: 'LinkMind unreachable',
        code: 'LINKMIND_UNREACHABLE',
        detail: error instanceof Error ? error.message : String(error),
      },
    }
  } finally {
    clearTimeout(timer)
  }
}

router.get('/config', async (_req: Request, res: Response) => {
  const config = await getEffectiveLinkMindConfig()
  res.json({
    success: true,
    configured: Boolean(config),
    source: config?.source || null,
    pollIntervalMs: config?.pollIntervalMs ?? Number(process.env.LINKMIND_IMPORT_POLL_INTERVAL_MS || 2_000),
    pollTimeoutMs: config?.pollTimeoutMs ?? Number(process.env.LINKMIND_IMPORT_POLL_TIMEOUT_MS || 120_000),
  })
})

router.get('/health', async (_req: Request, res: Response) => {
  try {
    const { status, body } = await proxyToLinkMind('/api/v1/health')
    res.status(status).json(body)
  } catch (error: unknown) {
    console.error('LinkMind health error:', error)
    res.status(500).json({ success: false, error: (error as Error).message || 'LinkMind health error' })
  }
})

// 平台授权会话：状态查询
router.get('/source-session', async (_req: Request, res: Response) => {
  try {
    const { status, body } = await proxyToLinkMind('/api/v1/source-session')
    res.status(status).json(body)
  } catch (error: unknown) {
    console.error('LinkMind source-session error:', error)
    res.status(500).json({ success: false, error: (error as Error).message || 'LinkMind source-session error' })
  }
})

// 平台授权会话：open（打开授权浏览器）/ confirm / disconnect
router.post('/source-session', async (req: Request, res: Response) => {
  try {
    const action = String(req.body?.action || '').trim()
    const entryUrl = req.body?.entryUrl ? String(req.body.entryUrl).trim() : ''

    if (action === 'open') {
      if (!entryUrl) {
        res.status(400).json({ success: false, error: 'entryUrl is required' })
        return
      }
      const { status, body } = await proxyToLinkMind('/api/v1/source-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryUrl }),
      }, LINKMIND_IMPORT_TIMEOUT_MS)
      res.status(status).json(body)
      return
    }

    if (action === 'confirm' || action === 'disconnect') {
      const { status, body } = await proxyToLinkMind('/api/v1/source-session', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      res.status(status).json(body)
      return
    }

    res.status(400).json({ success: false, error: 'action must be open | confirm | disconnect' })
  } catch (error: unknown) {
    console.error('LinkMind source-session action error:', error)
    res.status(500).json({ success: false, error: (error as Error).message || 'LinkMind source-session action error' })
  }
})

function maskApiKey(apiKey: string) {
  if (apiKey.length <= 8) return '***'
  return `${apiKey.slice(0, 4)}***${apiKey.slice(-4)}`
}

/**
 * 把 AetheL 当前生效的 AI 配置（Settings 中保存的 provider/key/model）同步到 LinkMind 的 .env。
 * 只写 AI_API_KEY / AI_BASE_URL / AI_MODEL 三行，保留其余配置；key 不回传客户端。
 */
router.post('/sync-ai-config', async (_req: Request, res: Response) => {
  try {
    const config = await getEffectiveLinkMindConfig()
    if (!config) {
      res.status(503).json({ success: false, error: 'LinkMind not configured', code: 'LINKMIND_NOT_CONFIGURED' })
      return
    }

    const runtime = getRuntimeAIConfig()
    if (!runtime.apiKey) {
      res.status(400).json({
        success: false,
        error: 'AetheL 当前没有可用的 AI key，请先在设置中心 AI 引擎中保存服务商配置。',
        code: 'AI_KEY_MISSING',
      })
      return
    }

    const state = await readPluginState('linkmind')
    const envPath = process.env.LINKMIND_ENV_PATH
      || (state?.config as PluginState['config'] & { envPath?: string }).envPath
      || path.join(projectRoot, '../workflow/.env')

    let existing = ''
    try {
      existing = await readFile(envPath, 'utf8')
    } catch {
      existing = ''
    }

    const entries: Array<[string, string]> = [
      ['AI_API_KEY', runtime.apiKey],
      ['AI_BASE_URL', runtime.baseURL],
      ['AI_MODEL', runtime.model],
    ]

    const lines = existing.split('\n')
    for (const [key, value] of entries) {
      const pattern = new RegExp(`^${key}=.*$`, 'm')
      const line = `${key}="${value}"`
      if (pattern.test(existing)) {
        lines[lines.findIndex((item) => new RegExp(`^${key}=`).test(item))] = line
      } else {
        lines.push(line)
      }
    }
    const next = lines.join('\n').replace(/\n{3,}/g, '\n\n')
    await writeFile(envPath, next.endsWith('\n') ? next : `${next}\n`)

    res.json({
      success: true,
      message: 'AI 配置已同步到 LinkMind，重启 LinkMind 后生效。',
      provider: runtime.provider,
      baseURL: runtime.baseURL,
      model: runtime.model,
      apiKeyMasked: maskApiKey(runtime.apiKey),
      envPath,
    })
  } catch (error: unknown) {
    console.error('LinkMind AI config sync error:', error)
    res.status(500).json({ success: false, error: (error as Error).message || 'LinkMind AI config sync error' })
  }
})

router.post('/imports', async (req: Request, res: Response) => {
  try {
    const url = String(req.body?.url || '').trim()
    if (!url) {
      res.status(400).json({ success: false, error: 'url is required' })
      return
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    const idempotencyKey = req.header('Idempotency-Key')
    if (idempotencyKey) {
      headers['Idempotency-Key'] = idempotencyKey
    }

    const body: Record<string, unknown> = {
      url,
      // LinkMind 契约要求的授权声明（客户端无需感知）
      consent: {
        termsVersion: '1.0',
        purpose: 'PERSONAL_KNOWLEDGE',
      },
    }
    if (req.body?.goalId) {
      body.goalId = String(req.body.goalId)
    }

    // 导入创建可能同步触发 yt-dlp 元数据/字幕获取，超时放宽到 120s
    const { status, body: upstream } = await proxyToLinkMind('/api/v1/imports', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }, LINKMIND_IMPORT_TIMEOUT_MS)
    res.status(status).json(upstream)
  } catch (error: unknown) {
    console.error('LinkMind import error:', error)
    res.status(500).json({ success: false, error: (error as Error).message || 'LinkMind import error' })
  }
})

router.get('/imports/:importId', async (req: Request, res: Response) => {
  try {
    const { status, body } = await proxyToLinkMind(`/api/v1/imports/${encodeURIComponent(req.params.importId)}`)
    res.status(status).json(body)
  } catch (error: unknown) {
    console.error('LinkMind import poll error:', error)
    res.status(500).json({ success: false, error: (error as Error).message || 'LinkMind import poll error' })
  }
})

router.get('/knowledge-items/:id', async (req: Request, res: Response) => {
  try {
    const { status, body } = await proxyToLinkMind(`/api/v1/knowledge-items/${encodeURIComponent(req.params.id)}`)
    res.status(status).json(body)
  } catch (error: unknown) {
    console.error('LinkMind knowledge item error:', error)
    res.status(500).json({ success: false, error: (error as Error).message || 'LinkMind knowledge item error' })
  }
})

export default router
