import type { NextFunction, Request, Response } from 'express'
import { getUserByToken } from '../db/usersDb.js'
import type { SubscriptionTier, UserRole } from '../db/usersDb.js'

// 认证中间件：Bearer token → req.user；管理员由 env ADMIN_EMAILS 指定。

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: {
        email: string
        role: UserRole
        subscription: SubscriptionTier
      }
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token) {
    res.status(401).json({ success: false, error: '未登录', code: 'UNAUTHORIZED' })
    return
  }
  const user = getUserByToken(token)
  if (!user) {
    res.status(401).json({ success: false, error: '登录已失效，请重新登录', code: 'UNAUTHORIZED' })
    return
  }
  req.user = {
    email: user.email,
    role: user.role,
    subscription: user.subscription,
  }
  next()
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ success: false, error: '需要管理员权限', code: 'FORBIDDEN' })
    return
  }
  next()
}

export function getAuthToken(req: Request): string {
  const header = req.headers.authorization || ''
  return header.startsWith('Bearer ') ? header.slice(7).trim() : ''
}
