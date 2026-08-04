export type AIProvider = 'modelscope' | 'deepseek' | 'moonshot' | 'babel'
export type AIProviderSelection = AIProvider | 'auto'
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

export const providerOrder: AIProvider[] = ['babel', 'modelscope', 'deepseek', 'moonshot']

export const defaultModels: Record<AIProvider, string> = {
  modelscope: 'moonshotai/Kimi-K2.5',
  deepseek: 'deepseek-v4-pro',
  moonshot: 'kimi-k2.6',
  // BabeL-O 引擎：模型选择权在 BabeL-O（ADR-B2），AetheL 传空 model，
  // BabeL-O 按 activeProfile/defaultModel 解析。
  babel: '',
}

export const providerBaseURLs: Record<AIProvider, string> = {
  modelscope: 'https://api-inference.modelscope.cn/v1',
  deepseek: 'https://api.deepseek.com',
  moonshot: 'https://api.moonshot.cn/v1',
  babel: '',
}

export const taskProfiles: Record<AITaskProfile, AITaskProfileConfig> = {
  'fast-json': {
    profile: 'fast-json',
    candidates: ['modelscope', 'deepseek', 'moonshot'],
    maxTokens: 1800,
    timeoutMs: 25_000,
    disableDeepSeekThinking: true,
    cache: true,
    stream: false,
    responseFormatJson: true,
  },
  'section-draft': {
    profile: 'section-draft',
    candidates: ['modelscope', 'deepseek', 'moonshot'],
    maxTokens: 2200,
    timeoutMs: 45_000,
    disableDeepSeekThinking: true,
    cache: true,
    stream: false,
  },
  'long-document': {
    profile: 'long-document',
    candidates: ['moonshot', 'modelscope', 'deepseek'],
    maxTokens: 8000,
    timeoutMs: 90_000,
    disableDeepSeekThinking: false,
    cache: false,
    stream: true,
  },
  'snapshot-large': {
    profile: 'snapshot-large',
    candidates: ['modelscope', 'deepseek', 'moonshot'],
    maxTokens: 6000,
    timeoutMs: 60_000,
    disableDeepSeekThinking: true,
    cache: false,
    stream: false,
    responseFormatJson: true,
  },
  'workshop-transform': {
    profile: 'workshop-transform',
    candidates: ['modelscope', 'deepseek', 'moonshot'],
    maxTokens: 2600,
    timeoutMs: 50_000,
    disableDeepSeekThinking: true,
    cache: false,
    stream: false,
    responseFormatJson: true,
  },
}

export function buildAIConfigsFromEnv(): Record<AIProvider, AIConfig> {
  return {
    modelscope: {
      provider: 'modelscope',
      baseURL: providerBaseURLs.modelscope,
      apiKey: process.env.MODELSCOPE_API_KEY || '',
      model: defaultModels.modelscope,
    },
    deepseek: {
      provider: 'deepseek',
      baseURL: providerBaseURLs.deepseek,
      apiKey: process.env.DEEPSEEK_API_KEY || '',
      model: defaultModels.deepseek,
    },
    moonshot: {
      provider: 'moonshot',
      baseURL: providerBaseURLs.moonshot,
      apiKey: process.env.MOONSHOT_API_KEY || '',
      model: defaultModels.moonshot,
    },
    babel: {
      provider: 'babel',
      baseURL: process.env.BABEL_NEXUS_URL ? `${process.env.BABEL_NEXUS_URL}/v1` : '',
      apiKey: process.env.BABEL_NEXUS_API_KEY || '',
      model: defaultModels.babel,
    },
  }
}

export function resolveAISelectionFromEnv(): AIProviderSelection {
  const requestedProvider = process.env.AI_PROVIDER as AIProviderSelection | undefined
  return requestedProvider && (requestedProvider === 'auto' || providerOrder.includes(requestedProvider as AIProvider))
    ? requestedProvider
    : 'auto'
}

export function resolveAIProviderFromEnv(configs: Record<AIProvider, AIConfig>): AIProvider {
  const selection = resolveAISelectionFromEnv()
  if (selection !== 'auto') {
    return selection
  }

  const providerWithKey = providerOrder.find((provider) => Boolean(configs[provider].apiKey))
  return providerWithKey || 'modelscope'
}

export function getAIConfigFromEnv(): AIConfig {
  const configs = buildAIConfigsFromEnv()
  return configs[resolveAIProviderFromEnv(configs)]
}

export function getConfiguredProviders(configs: Record<AIProvider, AIConfig>) {
  return providerOrder.filter((provider) => Boolean(configs[provider].apiKey))
}

export function resolveAutoCandidates(
  profile: AITaskProfile,
  configs: Record<AIProvider, AIConfig>,
) {
  const configured = new Set(getConfiguredProviders(configs))
  const candidates = taskProfiles[profile].candidates
    .filter((provider) => configured.has(provider))
    .map((provider) => configs[provider])

  return candidates.length > 0 ? candidates : [configs[resolveAIProviderFromEnv(configs)]]
}
