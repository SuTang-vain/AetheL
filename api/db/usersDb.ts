import { DatabaseSync } from 'node:sqlite'
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import path from 'path'
import { dataDir } from '../storage/paths.js'

// 用户管理系统数据库（node:sqlite，零依赖）：
// - users：email 主键 + scrypt 密码哈希（salt:hash）
// - sessions：token 会话（sha256 存储，含过期）
// - usage：每用户用量计数（bubbles/snapshots/ai_calls/prd_exports）
// 管理员由 env ADMIN_EMAILS 指定（逗号分隔邮箱列表）。

export type SubscriptionTier = 'free' | 'pro' | 'team'
export type UserRole = 'user' | 'admin'

export interface UserRecord {
  email: string
  role: UserRole
  subscription: SubscriptionTier
  createdAt: string
  updatedAt: string
}

const DB_PATH = process.env.AETHEL_USERS_DB || path.join(dataDir, 'users.db')
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 天

function adminEmails(): Set<string> {
  return new Set((process.env.ADMIN_EMAILS || '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean))
}

let db: DatabaseSync | null = null

function getDb(): DatabaseSync {
  if (!db) {
    mkdirSync(path.dirname(DB_PATH), { recursive: true })
    db = new DatabaseSync(DB_PATH)
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        email TEXT PRIMARY KEY,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        subscription TEXT NOT NULL DEFAULT 'free',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS usage (
        email TEXT NOT NULL,
        metric TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (email, metric)
      );
    `)
  }
  return db
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, expectedHex] = stored.split(':')
  if (!salt || !expectedHex) return false
  const hash = scryptSync(password, salt, 64)
  const expected = Buffer.from(expectedHex, 'hex')
  return hash.length === expected.length && timingSafeEqual(hash, expected)
}

function roleFor(email: string): UserRole {
  return adminEmails().has(email.toLowerCase()) ? 'admin' : 'user'
}

export function createUser(email: string, password: string): UserRecord {
  const normalized = email.trim().toLowerCase()
  const now = new Date().toISOString()
  const dbHandle = getDb()
  dbHandle.prepare(`
    INSERT INTO users (email, password_hash, role, subscription, created_at, updated_at)
    VALUES (?, ?, ?, 'free', ?, ?)
  `).run(normalized, hashPassword(password), roleFor(normalized), now, now)
  return getUser(normalized)!
}

export function getUser(email: string): UserRecord | null {
  const row = getDb().prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase()) as Record<string, string> | undefined
  if (!row) return null
  // 管理员名单变化时实时同步 role
  const role = roleFor(row.email)
  if (role !== row.role) {
    getDb().prepare('UPDATE users SET role = ?, updated_at = ? WHERE email = ?').run(role, new Date().toISOString(), row.email)
  }
  return {
    email: row.email,
    role: role as UserRole,
    subscription: row.subscription as SubscriptionTier,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function verifyCredentials(email: string, password: string): UserRecord | null {
  const normalized = email.trim().toLowerCase()
  const row = getDb().prepare('SELECT * FROM users WHERE email = ?').get(normalized) as Record<string, string> | undefined
  if (!row || !verifyPassword(password, row.password_hash)) return null
  return getUser(normalized)
}

export function createSession(email: string): string {
  const token = randomBytes(32).toString('hex')
  const now = new Date().toISOString()
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString()
  getDb().prepare(`
    INSERT INTO sessions (token_hash, email, created_at, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(sha256(token), email.trim().toLowerCase(), now, expiresAt)
  return token
}

export function getUserByToken(token: string): UserRecord | null {
  if (!token) return null
  const dbHandle = getDb()
  const row = dbHandle.prepare(`
    SELECT email, expires_at FROM sessions WHERE token_hash = ?
  `).get(sha256(token)) as Record<string, string> | undefined
  if (!row) return null
  if (new Date(row.expires_at).getTime() < Date.now()) {
    dbHandle.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token))
    return null
  }
  return getUser(row.email)
}

export function deleteSession(token: string): void {
  if (!token) return
  getDb().prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token))
}

export function listUsers(): Array<UserRecord & { usage: Record<string, number> }> {
  const dbHandle = getDb()
  const users = dbHandle.prepare('SELECT * FROM users ORDER BY created_at ASC').all() as Array<Record<string, string>>
  const usageRows = dbHandle.prepare('SELECT email, metric, count FROM usage').all() as Array<Record<string, string | number>>
  const usageByEmail = new Map<string, Record<string, number>>()
  for (const row of usageRows) {
    const email = String(row.email)
    const metric = String(row.metric)
    const map = usageByEmail.get(email) || {}
    map[metric] = Number(row.count)
    usageByEmail.set(email, map)
  }
  return users.map((row) => ({
    email: row.email,
    role: roleFor(row.email) as UserRole,
    subscription: row.subscription as SubscriptionTier,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    usage: usageByEmail.get(row.email) || {},
  }))
}

export function setUserSubscription(email: string, subscription: SubscriptionTier): boolean {
  const result = getDb().prepare(`
    UPDATE users SET subscription = ?, updated_at = ? WHERE email = ?
  `).run(subscription, new Date().toISOString(), email.trim().toLowerCase())
  return result.changes > 0
}

export function incrementUsage(email: string, metric: string, by = 1): void {
  const dbHandle = getDb()
  const row = dbHandle.prepare('SELECT count FROM usage WHERE email = ? AND metric = ?').get(email, metric) as { count: number } | undefined
  const next = (row?.count || 0) + by
  if (row) {
    dbHandle.prepare('UPDATE usage SET count = ?, updated_at = ? WHERE email = ? AND metric = ?')
      .run(next, new Date().toISOString(), email, metric)
  } else {
    dbHandle.prepare('INSERT INTO usage (email, metric, count, updated_at) VALUES (?, ?, ?, ?)')
      .run(email, metric, next, new Date().toISOString())
  }
}

export function getUsage(email?: string): Record<string, Record<string, number>> {
  const dbHandle = getDb()
  const rows = email
    ? dbHandle.prepare('SELECT email, metric, count FROM usage WHERE email = ?').all(email) as Array<Record<string, string | number>>
    : dbHandle.prepare('SELECT email, metric, count FROM usage').all() as Array<Record<string, string | number>>
  const result: Record<string, Record<string, number>> = {}
  for (const row of rows) {
    result[row.email] = result[row.email] || {}
    result[row.email][row.metric] = Number(row.count)
  }
  return result
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function closeDbForTests(): void {
  if (db) {
    db.close()
    db = null
  }
}
