import { create } from 'zustand'
import { apiFetch } from '@/lib/apiClient'

export interface PluginManifest {
  id: string
  name: string
  version: string
  description: string
  author: string
  entrypoints?: {
    skill?: string
  }
}

export interface PluginConfig {
  baseUrl?: string
  pollIntervalMs?: number
  pollTimeoutMs?: number
  envPath?: string
}

export interface PluginState {
  id: string
  installed: boolean
  enabled: boolean
  config: PluginConfig
  installedAt?: string
  updatedAt: string
}

export interface PluginEntry {
  manifest: PluginManifest
  state: PluginState | null
}

interface PluginStoreState {
  plugins: PluginEntry[]
  loading: boolean
  error: string
  loadPlugins: () => Promise<void>
  installPlugin: (id: string) => Promise<void>
  uninstallPlugin: (id: string) => Promise<void>
  updatePlugin: (id: string, updates: { enabled?: boolean; config?: PluginConfig }) => Promise<void>
  isReady: (id: string) => boolean
}

export const usePluginStore = create<PluginStoreState>((set, get) => ({
  plugins: [],
  loading: false,
  error: '',

  loadPlugins: async () => {
    set({ loading: true, error: '' })
    try {
      const response = await apiFetch('/api/plugins')
      const payload = await response.json()
      set({ plugins: payload.plugins || [] })
    } catch {
      set({ error: '插件列表加载失败' })
    } finally {
      set({ loading: false })
    }
  },

  installPlugin: async (id) => {
    const response = await apiFetch(`/api/plugins/${id}/install`, { method: 'POST' })
    const payload = await response.json()
    if (!response.ok || !payload.success) {
      set({ error: payload.error || '插件安装失败' })
      return
    }
    await get().loadPlugins()
  },

  uninstallPlugin: async (id) => {
    const response = await apiFetch(`/api/plugins/${id}/uninstall`, { method: 'POST' })
    const payload = await response.json()
    if (!response.ok || !payload.success) {
      set({ error: payload.error || '插件卸载失败' })
      return
    }
    await get().loadPlugins()
  },

  updatePlugin: async (id, updates) => {
    const response = await apiFetch(`/api/plugins/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    const payload = await response.json()
    if (!response.ok || !payload.success) {
      set({ error: payload.error || '插件配置保存失败' })
      return
    }
    await get().loadPlugins()
  },

  isReady: (id) => {
    const entry = get().plugins.find((item) => item.manifest.id === id)
    return Boolean(entry?.state?.installed && entry.state.enabled)
  },
}))
