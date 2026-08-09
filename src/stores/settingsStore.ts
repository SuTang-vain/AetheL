import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// BabeL-O 是唯一 AI 引擎（2026-08 产品决策）：AetheL 不再维护任何
// 托管服务商密钥/模型配置；模型与密钥全部由 BabeL-O 管理（ADR-B2）。
export type AIProvider = 'babel'
export type AIProviderSelection = AIProvider

interface SettingsState {
  aiProvider: AIProvider
  currentModel: string
  lastSavedAt: string | null
  lastTestedAt: string | null
  lowPerformanceMode: boolean
  reduceMotion: boolean
  reduceColorLayer: boolean
  setAiProvider: (provider: AIProvider) => void
  setCurrentModel: (model: string) => void
  markSaved: () => void
  markTested: () => void
  setLowPerformanceMode: (enabled: boolean) => void
  setReduceMotion: (enabled: boolean) => void
  setReduceColorLayer: (enabled: boolean) => void
}

const defaultModels: Record<AIProviderSelection, string> = {
  // 模型选择权在 BabeL-O（ADR-B2），AetheL 不维护模型名
  babel: '由 BabeL-O 配置决定',
}

const defaultBaseUrls: Record<AIProvider, string> = {
  // 实际地址来自服务端 BABEL_NEXUS_URL，前端不持有
  babel: 'BABEL_NEXUS_URL（服务端环境变量）',
}

export { defaultBaseUrls }

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      aiProvider: 'babel',
      currentModel: defaultModels.babel,
      lastSavedAt: null,
      lastTestedAt: null,
      lowPerformanceMode: false,
      reduceMotion: false,
      reduceColorLayer: false,

      setAiProvider: (provider) =>
        set({
          aiProvider: provider,
          currentModel: defaultModels[provider],
        }),

      setCurrentModel: (model) => set({ currentModel: model }),
      markSaved: () => set({ lastSavedAt: new Date().toISOString() }),
      markTested: () => set({ lastTestedAt: new Date().toISOString() }),
      setLowPerformanceMode: (enabled) => set({ lowPerformanceMode: enabled }),
      setReduceMotion: (enabled) => set({ reduceMotion: enabled }),
      setReduceColorLayer: (enabled) => set({ reduceColorLayer: enabled }),
    }),
    {
      name: 'aethel-settings',
      // 移除托管服务商后版本 +1，丢弃旧 localStorage 中的密钥与 provider 状态
      version: 2,
      migrate: (persistedState) => {
        const state = (persistedState || {}) as Record<string, unknown>
        return {
          aiProvider: 'babel',
          currentModel: defaultModels.babel,
          lastSavedAt: null,
          lastTestedAt: null,
          lowPerformanceMode: Boolean(state.lowPerformanceMode),
          reduceMotion: Boolean(state.reduceMotion),
          reduceColorLayer: Boolean(state.reduceColorLayer),
        }
      },
    }
  )
)
