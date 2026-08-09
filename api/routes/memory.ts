import { Router, type Request, type Response } from 'express'
import dotenv from 'dotenv'

dotenv.config()

// AetheL 记忆服务（M2）：改接 BabeL-O MemoryOS（/v1/runtime/memory/*）。
// 替代原 ModelScope OpenMemory 代理；BabeL-O 记忆是项目级（appId/projectId 作用域），
// AetheL 为单机单人应用，userId 参数保留以兼容旧 API 形状、不再透传。
// 边车不可用时 BabeL-O 返回 503 EVERCORE_MEMORY_UNAVAILABLE，此处映射为明确错误码。

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

function memoryUnavailable(res: Response, message: string): void {
  res.status(503).json({ success: false, error: message, code: 'MEMORY_UNAVAILABLE' })
}

// POST /api/memory/add — 写入记忆（save-note 走程序化批准路径）
router.post('/add', async (req: Request, res: Response) => {
  try {
    const { content, metadata = {} } = req.body

    if (!content || typeof content !== 'string') {
      res.status(400).json({ success: false, error: 'content is required' })
      return
    }

    const baseURL = babelBaseURL()
    if (!baseURL) {
      memoryUnavailable(res, 'BABEL_NEXUS_URL 未配置')
      return
    }

    const response = await fetch(`${baseURL}/v1/runtime/memory/save-note`, {
      method: 'POST',
      headers: babelHeaders(),
      body: JSON.stringify({
        note: content,
        approved: true, // AetheL 为可信本地客户端，服务端程序化批准
        ...(Object.keys(metadata).length > 0 ? { confirmation: JSON.stringify(metadata) } : {}),
      }),
    })
    const data = await response.json().catch(() => ({}))

    if (response.status === 503) {
      memoryUnavailable(res, 'BabeL-O 记忆服务不可用（EverCore 边车未运行）')
      return
    }
    if (!response.ok) {
      res.status(response.status).json({ success: false, error: data?.error?.message || `Memory add failed: ${response.status}` })
      return
    }

    res.json({ success: true, ...data })
  } catch (error: unknown) {
    console.error('Memory add error:', error)
    res.status(500).json({ success: false, error: (error as Error).message || 'Memory add error' })
  }
})

// GET /api/memory/search?query&limit — 语义搜索记忆
router.get('/search', async (req: Request, res: Response) => {
  try {
    const { query, limit = '10' } = req.query

    if (!query) {
      res.status(400).json({ success: false, error: 'query is required' })
      return
    }

    const baseURL = babelBaseURL()
    if (!baseURL) {
      memoryUnavailable(res, 'BABEL_NEXUS_URL 未配置')
      return
    }

    const response = await fetch(`${baseURL}/v1/runtime/memory/search`, {
      method: 'POST',
      headers: babelHeaders(),
      body: JSON.stringify({ query, topK: Number(limit) || 10 }),
    })
    const data = await response.json().catch(() => ({}))

    if (response.status === 503) {
      memoryUnavailable(res, 'BabeL-O 记忆服务不可用（EverCore 边车未运行）')
      return
    }
    if (!response.ok) {
      res.status(response.status).json({ success: false, error: data?.error?.message || `Memory search failed: ${response.status}` })
      return
    }

    res.json({ success: true, ...data })
  } catch (error: unknown) {
    console.error('Memory search error:', error)
    res.status(500).json({ success: false, error: (error as Error).message || 'Memory search error' })
  }
})

// GET /api/memory/list?limit — 候选记忆列表（review-only candidates）
router.get('/list', async (req: Request, res: Response) => {
  try {
    const { limit = '20' } = req.query

    const baseURL = babelBaseURL()
    if (!baseURL) {
      memoryUnavailable(res, 'BABEL_NEXUS_URL 未配置')
      return
    }

    const response = await fetch(
      `${baseURL}/v1/runtime/memory/candidates?limit=${Number(limit) || 20}`,
      { headers: babelHeaders() },
    )
    const data = await response.json().catch(() => ({}))

    if (response.status === 503) {
      memoryUnavailable(res, 'BabeL-O 记忆服务不可用（EverCore 边车未运行）')
      return
    }
    if (!response.ok) {
      res.status(response.status).json({ success: false, error: data?.error?.message || `Memory list failed: ${response.status}` })
      return
    }

    res.json({ success: true, ...data })
  } catch (error: unknown) {
    console.error('Memory list error:', error)
    res.status(500).json({ success: false, error: (error as Error).message || 'Memory list error' })
  }
})

export default router
