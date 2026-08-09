import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type AIProvider = 'modelscope' | 'deepseek' | 'moonshot' | 'babel'
export type AIProviderSelection = AIProvider | 'auto'

interface SettingsState {
  aiProvider: AIProviderSelection
  modelScopeApiKey: string
  deepSeekApiKey: string
  moonshotApiKey: string
  currentModel: string
  lastSavedAt: string | null
  lastTestedAt: string | null
  lowPerformanceMode: boolean
  reduceMotion: boolean
  reduceColorLayer: boolean
  setAiProvider: (provider: AIProviderSelection) => void
  setModelScopeApiKey: (key: string) => void
  setDeepSeekApiKey: (key: string) => void
  setMoonshotApiKey: (key: string) => void
  setCurrentModel: (model: string) => void
  markSaved: () => void
  markTested: () => void
  setLowPerformanceMode: (enabled: boolean) => void
  setReduceMotion: (enabled: boolean) => void
  setReduceColorLayer: (enabled: boolean) => void
}

const defaultModels: Record<AIProviderSelection, string> = {
  auto: '自动选择',
  modelscope: 'moonshotai/Kimi-K2.5',
  deepseek: 'deepseek-v4-pro',
  moonshot: 'kimi-k2.6',
  // 模型选择权在 BabeL-O（ADR-B2），AetheL 不维护模型名
  babel: '由 BabeL-O 配置决定',
}

const defaultBaseUrls: Record<AIProvider, string> = {
  modelscope: 'https://api-inference.modelscope.cn/v1',
  deepseek: 'https://api.deepseek.com',
  moonshot: 'https://api.moonshot.cn/v1',
  // 实际地址来自服务端 BABEL_NEXUS_URL，前端不持有
  babel: 'BABEL_NEXUS_URL（服务端环境变量）',
}

export { defaultBaseUrls }

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      aiProvider: 'auto',
      modelScopeApiKey: '',
      deepSeekApiKey: '',
      moonshotApiKey: '',
      currentModel: defaultModels.auto,
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

      setModelScopeApiKey: (key) => set({ modelScopeApiKey: key }),
      setDeepSeekApiKey: (key) => set({ deepSeekApiKey: key }),
      setMoonshotApiKey: (key) => set({ moonshotApiKey: key }),
      setCurrentModel: (model) => set({ currentModel: model }),
      markSaved: () => set({ lastSavedAt: new Date().toISOString() }),
      markTested: () => set({ lastTestedAt: new Date().toISOString() }),
      setLowPerformanceMode: (enabled) => set({ lowPerformanceMode: enabled }),
      setReduceMotion: (enabled) => set({ reduceMotion: enabled }),
      setReduceColorLayer: (enabled) => set({ reduceColorLayer: enabled }),
    }),
    {
      name: 'aethel-settings',
    }
  )
)
