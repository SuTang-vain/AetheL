import { Router, type Request, type Response } from 'express'
import dotenv from 'dotenv'

dotenv.config()

// BabeL-O 模型目录代理（M2）：读 /v1/runtime/models、写 /v1/runtime/config/select。
// AetheL 不直接访问 BabeL-O（ADR-2 代理原则）；模型配置仍归 BabeL-O（ADR-B2）。

const router = Router()

function babelBaseURL(): string {
  return process.env.BABEL_NEXUS_URL || ''
}

function babelHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const key = process.env.BABEL_NEXUS_API_KEY
  if (key) headers.Authorization = `Bearer ${key}`
  return headers
}

interface RuntimeModelsPayload {
  providers?: Array<{
    id: string
    displayName?: string
    authConfigured?: boolean
    active?: boolean
    defaultModel?: string
    models?: Array<{
      id: string
      name?: string
      contextWindow?: number
      defaultMaxTokens?: number
      capabilities?: Record<string, boolean>
    }>
  }>
}

// GET /api/ai/models — 模型目录（含 authConfigured / active 状态，供设置页选择器渲染）
router.get('/models', async (_req: Request, res: Response) => {
  try {
    const baseURL = babelBaseURL()
    if (!baseURL) {
      res.status(503).json({ success: false, error: 'BABEL_NEXUS_URL 未配置', code: 'BABEL_NOT_CONFIGURED' })
      return
    }

    const response = await fetch(`${baseURL}/v1/runtime/models`, {
      headers: babelHeaders(),
    })
    if (!response.ok) {
      res.status(response.status).json({ success: false, error: `BabeL-O models 请求失败: ${response.status}` })
      return
    }
    const data = (await response.json()) as RuntimeModelsPayload

    const providers = (data.providers || []).map((provider) => ({
      id: provider.id,
      displayName: provider.displayName || provider.id,
      authConfigured: Boolean(provider.authConfigured),
      active: Boolean(provider.active),
      defaultModel: provider.defaultModel || '',
      models: (provider.models || []).map((model) => ({
        id: model.id,
        name: model.name || model.id,
        contextWindow: model.contextWindow,
        capabilities: model.capabilities || {},
      })),
    }))

    res.json({ success: true, providers })
  } catch (error: unknown) {
    console.error('Models fetch error:', error)
    res.status(500).json({ success: false, error: (error as Error).message || 'Models fetch error' })
  }
})

// POST /api/ai/models/select — 切换 BabeL-O 模型（provider/model 规范 ID）
router.post('/models/select', async (req: Request, res: Response) => {
  try {
    const { model } = req.body
    if (!model || typeof model !== 'string') {
      res.status(400).json({ success: false, error: 'model is required' })
      return
    }

    const baseURL = babelBaseURL()
    if (!baseURL) {
      res.status(503).json({ success: false, error: 'BABEL_NEXUS_URL 未配置', code: 'BABEL_NOT_CONFIGURED' })
      return
    }

    const response = await fetch(`${baseURL}/v1/runtime/config/select`, {
      method: 'POST',
      headers: babelHeaders(),
      body: JSON.stringify({ model }),
    })
    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      res.status(response.status).json({
        success: false,
        error: data?.error?.message || `BabeL-O 模型切换失败: ${response.status}`,
        code: data?.error?.error,
      })
      return
    }

    res.json({ success: true, ...data })
  } catch (error: unknown) {
    console.error('Model select error:', error)
    res.status(500).json({ success: false, error: (error as Error).message || 'Model select error' })
  }
})

export default router
