import { Router, type Request, type Response } from 'express'
import {
  getUsage,
  listUsers,
  setUserSubscription,
  type SubscriptionTier,
} from '../db/usersDb.js'
import { requireAdmin, requireAuth } from '../middleware/auth.js'
import { userDataPaths } from '../storage/paths.js'
import { readWorkspace } from '../storage/workspaceFile.js'

// 管理员 API：用户列表 / 订阅配置 / 全量记录 / 用量。
// 全部要求登录且为管理员（env ADMIN_EMAILS 指定）。

const router = Router()

router.use(requireAuth)
router.use(requireAdmin)

const SUBSCRIPTION_TIERS: SubscriptionTier[] = ['free', 'pro', 'team']

// GET /api/admin/users — 用户列表（含订阅与用量汇总）
router.get('/users', (_req: Request, res: Response) => {
  try {
    const users = listUsers()
    res.json({ success: true, users })
  } catch (error: unknown) {
    console.error('Admin users error:', error)
    res.status(500).json({ success: false, error: (error as Error).message || 'Admin users error' })
  }
})

// PATCH /api/admin/users/:email/subscription — 配置订阅等级
router.patch('/users/:email/subscription', (req: Request, res: Response) => {
  try {
    const { subscription } = req.body || {}
    if (!SUBSCRIPTION_TIERS.includes(subscription as SubscriptionTier)) {
      res.status(400).json({ success: false, error: `subscription 必须是 ${SUBSCRIPTION_TIERS.join('/')}`, code: 'INVALID_SUBSCRIPTION' })
      return
    }
    const updated = setUserSubscription(req.params.email, subscription as SubscriptionTier)
    if (!updated) {
      res.status(404).json({ success: false, error: '用户不存在', code: 'USER_NOT_FOUND' })
      return
    }
    res.json({ success: true })
  } catch (error: unknown) {
    console.error('Admin subscription error:', error)
    res.status(500).json({ success: false, error: (error as Error).message || 'Admin subscription error' })
  }
})

// GET /api/admin/records — 所有用户的结构体生成记录（气泡/快照/工作区详情）
router.get('/records', async (_req: Request, res: Response) => {
  try {
    const users = listUsers()
    const records = await Promise.all(users.map(async (user) => {
      const workspace = await readWorkspace(userDataPaths(user.email))
      return {
        email: user.email,
        bubbles: workspace.bubbles.map((bubble) => ({
          id: bubble.id,
          content: bubble.content,
          tag: bubble.tag || '',
          categoryId: bubble.categoryId || '',
          interactionWeight: bubble.interactionWeight || 0,
          sourceSkillId: bubble.sourceSkillId || '',
          createdAt: bubble.createdAt,
          updatedAt: bubble.updatedAt,
        })),
        snapshots: workspace.snapshots.map((snapshot) => ({
          id: snapshot.id,
          name: snapshot.name,
          createdAt: snapshot.createdAt,
          bubbleIds: snapshot.canvasState.bubbles.map((bubble) => bubble.id),
          statusSnapshot: snapshot.cognition?.statusSnapshot || '',
          semanticAnchors: Array.isArray(snapshot.cognition?.semanticAnchors)
            ? snapshot.cognition.semanticAnchors.map((anchor) => (typeof anchor === 'object' && anchor !== null ? String((anchor as { label?: string }).label || '') : ''))
            : [],
        })),
      }
    }))
    res.json({ success: true, records })
  } catch (error: unknown) {
    console.error('Admin records error:', error)
    res.status(500).json({ success: false, error: (error as Error).message || 'Admin records error' })
  }
})

// GET /api/admin/usage — 每用户模型/功能用量
router.get('/usage', (_req: Request, res: Response) => {
  try {
    res.json({ success: true, usage: getUsage() })
  } catch (error: unknown) {
    console.error('Admin usage error:', error)
    res.status(500).json({ success: false, error: (error as Error).message || 'Admin usage error' })
  }
})

export default router
