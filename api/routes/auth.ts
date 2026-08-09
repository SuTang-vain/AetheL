import { Router, type Request, type Response } from 'express'
import {
  createSession,
  createUser,
  deleteSession,
  verifyCredentials,
} from '../db/usersDb.js'
import { getAuthToken, requireAuth } from '../middleware/auth.js'

// 用户认证：注册 / 登录 / 登出 / 当前用户。
// 数据库以邮箱为主键，密码 scrypt 哈希，会话 token 30 天有效。

const router = Router()

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body || {}

    if (typeof email !== 'string' || !EMAIL_PATTERN.test(email.trim())) {
      res.status(400).json({ success: false, error: '请输入有效邮箱', code: 'INVALID_EMAIL' })
      return
    }
    if (typeof password !== 'string' || password.length < 8) {
      res.status(400).json({ success: false, error: '密码至少 8 位', code: 'WEAK_PASSWORD' })
      return
    }

    let user
    try {
      user = createUser(email, password)
    } catch {
      res.status(409).json({ success: false, error: '该邮箱已注册', code: 'EMAIL_EXISTS' })
      return
    }

    const token = createSession(user.email)
    res.json({ success: true, token, user })
  } catch (error: unknown) {
    console.error('Register error:', error)
    res.status(500).json({ success: false, error: (error as Error).message || 'Register error' })
  }
})

router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body || {}

    if (typeof email !== 'string' || typeof password !== 'string') {
      res.status(400).json({ success: false, error: '邮箱和密码必填', code: 'INVALID_INPUT' })
      return
    }

    const user = verifyCredentials(email, password)
    if (!user) {
      res.status(401).json({ success: false, error: '邮箱或密码错误', code: 'INVALID_CREDENTIALS' })
      return
    }

    const token = createSession(user.email)
    res.json({ success: true, token, user })
  } catch (error: unknown) {
    console.error('Login error:', error)
    res.status(500).json({ success: false, error: (error as Error).message || 'Login error' })
  }
})

router.post('/logout', (req: Request, res: Response) => {
  deleteSession(getAuthToken(req))
  res.json({ success: true })
})

router.get('/me', requireAuth, (req: Request, res: Response) => {
  res.json({ success: true, user: req.user })
})

export default router
