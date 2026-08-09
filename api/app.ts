import express, {
  type Request,
  type Response,
  type NextFunction,
} from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import aiRoutes from './routes/ai.js'
import modelsRoutes from './routes/models.js'
import memoryRoutes from './routes/memory.js'
import bubbleRoutes from './routes/bubbles.js'
import snapshotRoutes from './routes/snapshots.js'
import workspaceRoutes from './routes/workspace.js'
import authRoutes from './routes/auth.js'
import adminRoutes from './routes/admin.js'
import { requireAuth } from './middleware/auth.js'
import { incrementUsage } from './db/usersDb.js'

import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

dotenv.config()

const app: express.Application = express()

app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// 托管前端静态文件
const distPath = path.join(__dirname, '../dist')
app.use(express.static(distPath))

// 用户认证与管理员
app.use('/api/auth', authRoutes)
app.use('/api/admin', adminRoutes)

// 用户数据路由全部要求登录（按用户隔离）
app.use('/api/ai', requireAuth)
app.use('/api/ai', (req: Request, res: Response, next: NextFunction) => {
  // AI 调用用量统计（成功响应计数）
  res.on('finish', () => {
    if (res.statusCode < 400 && req.user) {
      incrementUsage(req.user.email, 'ai_calls')
    }
  })
  next()
})
app.use('/api/memory', requireAuth)
app.use('/api/bubbles', requireAuth)
app.use('/api/snapshots', requireAuth)
app.use('/api/workspace', requireAuth)

app.use('/api/ai', aiRoutes)
app.use('/api/ai', modelsRoutes)
app.use('/api/memory', memoryRoutes)
app.use('/api/bubbles', bubbleRoutes)
app.use('/api/snapshots', snapshotRoutes)
app.use('/api/workspace', workspaceRoutes)

app.use(
  '/api/health',
  (req: Request, res: Response): void => {
    res.status(200).json({
      success: true,
      message: 'ok',
    })
  },
)

// 处理 SPA 路由：所有非 API 请求都返回 index.html
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) {
    return next()
  }
  res.sendFile(path.join(distPath, 'index.html'))
})

app.use((error: Error, req: Request, res: Response, _next: NextFunction) => {
  console.error('SERVER ERROR:', error);
  res.status(500).json({
    success: false,
    error: error.message || 'Server internal error',
  })
})

app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'API not found',
  })
})

export default app
