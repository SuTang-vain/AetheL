import { create } from 'zustand'
import { apiFetch, AUTH_TOKEN_KEY } from '@/lib/apiClient'

// 用户认证状态：token 存 localStorage，user 内存态 + 启动时 /me 恢复。

export interface AuthUser {
  email: string
  role: 'user' | 'admin'
  subscription: 'free' | 'pro' | 'team'
}

interface AuthState {
  user: AuthUser | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  fetchMe: () => Promise<void>
}

export const useAuthStore = create<AuthState>()((set) => ({
  user: null,
  loading: true,

  login: async (email, password) => {
    const response = await apiFetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const data = await response.json()
    if (!response.ok || !data.success) {
      throw new Error(data.error || '登录失败')
    }
    window.localStorage.setItem(AUTH_TOKEN_KEY, data.token)
    set({ user: data.user as AuthUser })
  },

  register: async (email, password) => {
    const response = await apiFetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const data = await response.json()
    if (!response.ok || !data.success) {
      throw new Error(data.error || '注册失败')
    }
    window.localStorage.setItem(AUTH_TOKEN_KEY, data.token)
    set({ user: data.user as AuthUser })
  },

  logout: async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' })
    } catch {
      // 忽略登出请求失败，本地态照常清理
    }
    window.localStorage.removeItem(AUTH_TOKEN_KEY)
    set({ user: null })
  },

  fetchMe: async () => {
    const token = window.localStorage.getItem(AUTH_TOKEN_KEY)
    if (!token) {
      set({ user: null, loading: false })
      return
    }
    try {
      const response = await apiFetch('/api/auth/me')
      const data = await response.json()
      if (response.ok && data.success) {
        set({ user: data.user as AuthUser })
      } else {
        window.localStorage.removeItem(AUTH_TOKEN_KEY)
        set({ user: null })
      }
    } catch {
      // 后端不可达时保持现状
    } finally {
      set({ loading: false })
    }
  },
}))
