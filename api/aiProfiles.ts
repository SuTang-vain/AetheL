export type AIProvider = 'babel'
export type AITaskProfile =
  | 'fast-json'
  | 'section-draft'
  | 'long-document'
  | 'snapshot-large'
  | 'workshop-transform'

export interface AIConfig {
  provider: AIProvider
  baseURL: string
  apiKey: string
  model: string
}

export interface AITaskProfileConfig {
  profile: AITaskProfile
  candidates: AIProvider[]
  maxTokens: number
  timeoutMs: number
  disableDeepSeekThinking: boolean
  cache: boolean
  stream: boolean
  responseFormatJson?: boolean
}

export const taskProfiles: Record<AITaskProfile, AITaskProfileConfig> = {
  'fast-json': {
    profile: 'fast-json',
    candidates: ['babel'],
    maxTokens: 1800,
    timeoutMs: 25_000,
    disableDeepSeekThinking: true,
    cache: true,
    stream: false,
    responseFormatJson: true,
  },
  'section-draft': {
    profile: 'section-draft',
    candidates: ['babel'],
    maxTokens: 2200,
    timeoutMs: 45_000,
    disableDeepSeekThinking: true,
    cache: true,
    stream: false,
  },
  'long-document': {
    profile: 'long-document',
    candidates: ['babel'],
    maxTokens: 8000,
    timeoutMs: 90_000,
    disableDeepSeekThinking: false,
    cache: false,
    stream: true,
  },
  'snapshot-large': {
    profile: 'snapshot-large',
    candidates: ['babel'],
    maxTokens: 6000,
    timeoutMs: 60_000,
    disableDeepSeekThinking: true,
    cache: false,
    stream: false,
    responseFormatJson: true,
  },
  'workshop-transform': {
    profile: 'workshop-transform',
    candidates: ['babel'],
    maxTokens: 2600,
    timeoutMs: 50_000,
    disableDeepSeekThinking: true,
    cache: false,
    stream: false,
    responseFormatJson: true,
  },
}

/**
 * BabeL-O 是唯一 AI 引擎（2026-08 产品决策：移除托管服务商直连）。
 * 配置完全来自环境变量；模型选择权在 BabeL-O（ADR-B2）。
 */
export function buildAIConfigsFromEnv(): Record<AIProvider, AIConfig> {
  return {
    babel: {
      provider: 'babel',
      baseURL: process.env.BABEL_NEXUS_URL ? `${process.env.BABEL_NEXUS_URL}/v1` : '',
      apiKey: process.env.BABEL_NEXUS_API_KEY || '',
      model: '',
    },
  }
}

/**
 * 引擎可用性判定：BABEL_NEXUS_URL 已配置即视为可用
 * （本地 daemon 可无鉴权，不要求 BABEL_NEXUS_API_KEY）。
 */
export function isProviderConfigured(config: AIConfig): boolean {
  return Boolean(config.baseURL)
}
