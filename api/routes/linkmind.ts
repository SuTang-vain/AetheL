import { Router, type Request, type Response } from 'express'

/**
 * LinkMind（链藏）外部证据服务代理层。
 * 职责：AetheL 后端代理 LinkMind 的 HTTP API（contracts/openapi.yaml），
 * 前端不直接访问 LinkMind 地址，密钥/地址只存在于服务端 env。
 * 约定：LinkMind 以 3100 端口运行（3000 与 AetheL Express 冲突）。
 */

const router = Router()

const LINKMIND_PROXY_TIMEOUT_MS = Number(process.env.LINKMIND_PROXY_TIMEOUT_MS || 15_000)

function linkmindBaseUrl(): string {
  return process.env.LINKMIND_BASE_URL || ''
}

function linkmindConfigured(): boolean {
  return Boolean(linkmindBaseUrl())
}

async function proxyToLinkMind(
  upstreamPath: string,
  init: RequestInit = {},
): Promise<{ status: number; body: unknown }> {
  const baseUrl = linkmindBaseUrl()
  if (!baseUrl) {
    return {
      status: 503,
      body: { success: false, error: 'LinkMind not configured', code: 'LINKMIND_NOT_CONFIGURED' },
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LINKMIND_PROXY_TIMEOUT_MS)
  try {
    const response = await fetch(`${baseUrl}${upstreamPath}`, { ...init, signal: controller.signal })
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

router.get('/config', (_req: Request, res: Response) => {
  res.json({
    success: true,
    configured: linkmindConfigured(),
    pollIntervalMs: Number(process.env.LINKMIND_IMPORT_POLL_INTERVAL_MS || 2_000),
    pollTimeoutMs: Number(process.env.LINKMIND_IMPORT_POLL_TIMEOUT_MS || 120_000),
  })
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

    const body: Record<string, unknown> = { url }
    if (req.body?.goalId) {
      body.goalId = String(req.body.goalId)
    }

    const { status, body: upstream } = await proxyToLinkMind('/api/v1/imports', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
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
