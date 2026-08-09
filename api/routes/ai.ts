import { Router, type Request, type Response } from 'express'
import OpenAI from 'openai'
import type { ChatCompletion, ChatCompletionChunk } from 'openai/resources/chat/completions'
import type { Stream } from 'openai/streaming'
import crypto from 'node:crypto'
import dotenv from 'dotenv'
import {
  normalizeCategorizeResponse,
  normalizeFollowupResponse,
  normalizeSnapshotResponse,
} from '../aiResponseSchemas.js'
import {
  buildAIConfigsFromEnv,
  defaultModels,
  getAIConfigFromEnv,
  isProviderConfigured,
  providerBaseURLs,
  resolveAIProviderFromEnv,
  resolveAutoCandidates,
  resolveAISelectionFromEnv,
  taskProfiles,
  type AIConfig,
  type AIProvider,
  type AIProviderSelection,
  type AITaskProfile,
} from '../aiProfiles.js'
import {
  clearAIMetricsForTests,
  getAIMetrics,
  recordAIMetric,
} from '../aiMetrics.js'
import {
  buildCategorizeSystemPrompt,
  buildCategorizeUserPrompt,
} from '../prompts/categorize.js'
import {
  buildFollowupSystemPrompt,
  buildFollowupUserPrompt,
} from '../prompts/followup.js'
import {
  buildGeneratePrdSystemPrompt,
  buildGeneratePrdUserPrompt,
  buildPrdSectionUserPrompt,
  buildPrdSectionsSystemPrompt,
  buildPrdSectionsUserPrompt,
} from '../prompts/prd.js'
import {
  buildSnapshotSystemPrompt,
  buildSnapshotUserPrompt,
} from '../prompts/snapshot.js'
import {
  buildWorkshopSystemPrompt,
  buildWorkshopUserPrompt,
  type WorkshopSkillId,
} from '../prompts/workshop.js'

dotenv.config()

const router = Router()

let aiConfig = getAIConfigFromEnv()
let aiSelection: AIProviderSelection = resolveAISelectionFromEnv()
let client = new OpenAI({
  baseURL: aiConfig.baseURL,
  apiKey: aiConfig.apiKey,
})
let defaultModel = aiConfig.model
type CompletionPayload = {
  model: string
  messages: Array<{ role: string; content: string }>
  stream?: boolean
  max_tokens?: number
  max_completion_tokens?: number
  extra_body?: Record<string, unknown>
  response_format?: { type: 'json_object' }
}
type CompletionOverride = (payload: CompletionPayload) => Promise<unknown> | unknown
type CompletionResponse = ChatCompletion | Stream<ChatCompletionChunk>

function isChatStream(response: CompletionResponse): response is Stream<ChatCompletionChunk> {
  return typeof (response as unknown as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function'
}

function getChatContent(response: CompletionResponse, fallback = ''): string {
  return isChatStream(response) ? fallback : (response.choices?.[0]?.message?.content ?? fallback)
}

type CompletionResult = {
  result: CompletionResponse
  cacheHit: boolean
  pendingReuse: boolean
}
let completionOverride: CompletionOverride | null = null
type CompletionCacheEntry = {
  expiresAt: number
  value: CompletionResponse | null
  promise?: Promise<CompletionResponse>
}

const AI_RESPONSE_CACHE_TTL_MS = 5 * 60 * 1000
const AI_RESPONSE_CACHE_MAX_SIZE = 160
const aiResponseCache = new Map<string, CompletionCacheEntry>()

export function setAICompletionOverrideForTests(override: CompletionOverride | null) {
  completionOverride = override
}

export function clearAIResponseCacheForTests() {
  aiResponseCache.clear()
}

export { clearAIMetricsForTests, getAIConfigFromEnv }

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
      .join(',')}}`
  }

  return JSON.stringify(value)
}

function getCompletionCacheKey(payload: CompletionPayload) {
  const signature = stableStringify({
    model: payload.model,
    stream: Boolean(payload.stream),
    messages: payload.messages,
    max_tokens: payload.max_tokens,
    max_completion_tokens: payload.max_completion_tokens,
    extra_body: payload.extra_body,
  })

  return crypto.createHash('sha256').update(signature).digest('hex')
}

function pruneAIResponseCache() {
  const now = Date.now()
  for (const [key, entry] of aiResponseCache) {
    if (entry.expiresAt <= now) {
      aiResponseCache.delete(key)
    }
  }

  while (aiResponseCache.size > AI_RESPONSE_CACHE_MAX_SIZE) {
    const oldestKey = aiResponseCache.keys().next().value
    if (!oldestKey) break
    aiResponseCache.delete(oldestKey)
  }
}

async function createChatCompletion(
  payload: CompletionPayload,
  options: { cache?: boolean; config?: AIConfig; clientInstance?: OpenAI; validate?: (result: CompletionResponse) => void } = {},
): Promise<CompletionResult & { cacheKey?: string }> {
  const shouldCache = options.cache === true && !payload.stream
  const activeConfig = options.config || aiConfig
  const activeClient = options.clientInstance || client

  if (shouldCache) {
    pruneAIResponseCache()
    const cacheKey = crypto.createHash('sha256').update(stableStringify({
      provider: activeConfig.provider,
      baseURL: activeConfig.baseURL,
      payloadKey: getCompletionCacheKey(payload),
    })).digest('hex')
    const cached = aiResponseCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      const cachedResult = cached.promise ? await cached.promise : (cached.value as CompletionResponse)
      if (options.validate) {
        try {
          options.validate(cachedResult)
        } catch (err) {
          aiResponseCache.delete(cacheKey)
          throw err
        }
      }
      return {
        result: cachedResult,
        cacheHit: true,
        pendingReuse: Boolean(cached.promise),
        cacheKey,
      }
    }

    const pending = (async () => {
      if (completionOverride) {
        return completionOverride(payload) as CompletionResponse
      }
      return activeClient.chat.completions.create(payload as Parameters<typeof activeClient.chat.completions.create>[0])
    })()

    aiResponseCache.set(cacheKey, {
      expiresAt: Date.now() + AI_RESPONSE_CACHE_TTL_MS,
      value: null,
      promise: pending,
    })

    try {
      const result = await pending
      if (options.validate) {
        try {
          options.validate(result)
        } catch (err) {
          aiResponseCache.delete(cacheKey)
          throw err
        }
      }
      aiResponseCache.set(cacheKey, {
        expiresAt: Date.now() + AI_RESPONSE_CACHE_TTL_MS,
        value: result,
      })
      pruneAIResponseCache()
      return { result, cacheHit: false, pendingReuse: false, cacheKey }
    } catch (error) {
      aiResponseCache.delete(cacheKey)
      throw error
    }
  }

  if (completionOverride) {
    const result = await completionOverride(payload) as CompletionResponse
    if (options.validate) options.validate(result)
    return { result, cacheHit: false, pendingReuse: false }
  }
  const result = await activeClient.chat.completions.create(payload as Parameters<typeof activeClient.chat.completions.create>[0])
  if (options.validate) options.validate(result)
  return {
    result,
    cacheHit: false,
    pendingReuse: false,
  }
}

function createClientForConfig(config: AIConfig) {
  if (config.provider === aiConfig.provider && config.baseURL === aiConfig.baseURL && config.apiKey === aiConfig.apiKey) {
    return client
  }

  return new OpenAI({
    baseURL: config.baseURL,
    apiKey: config.apiKey,
  })
}

function buildProfilePayload(
  config: AIConfig,
  payload: Omit<CompletionPayload, 'model'> & { model?: string },
  profile: AITaskProfile,
): CompletionPayload {
  const profileConfig = taskProfiles[profile]
  const nextPayload: CompletionPayload = {
    ...payload,
    model: payload.model || config.model,
  }

  if (config.provider === 'moonshot') {
    nextPayload.max_completion_tokens = profileConfig.maxTokens
  } else {
    nextPayload.max_tokens = profileConfig.maxTokens
  }

  if (config.provider === 'deepseek' && profileConfig.disableDeepSeekThinking) {
    nextPayload.extra_body = {
      ...(nextPayload.extra_body || {}),
      thinking: { type: 'disabled' },
    }
  }

  if (profileConfig.responseFormatJson && !nextPayload.stream) {
    // Some providers (like Moonshot/Kimi) might struggle with strict json_object mode
    // but we keep the instruction in the prompt via runProfileCompletion
    if (config.provider !== 'moonshot') {
      nextPayload.response_format = { type: 'json_object' }
    }
  }

  return nextPayload
}

function isFallbackError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '')
  return /timeout|429|rate|schema|parse|unauthorized|401|403|5\d\d/i.test(message)
}

async function runProfileCompletion(
  payload: Omit<CompletionPayload, 'model'> & { model?: string },
  profile: AITaskProfile,
  options: {
    cache?: boolean
    parse?: (content: string) => unknown
  } = {},
): Promise<{ response: CompletionResponse; meta: CompletionResult & { provider: AIProvider; model: string; profile: AITaskProfile; fallbackReason?: string } }> {
  const profileConfig = taskProfiles[profile]
  const configs = buildAIConfigsFromEnv()
  const candidates = aiSelection === 'auto'
    ? resolveAutoCandidates(profile, {
      ...configs,
      [aiConfig.provider]: aiConfig,
    })
    : [aiConfig]
  const cache = options.cache ?? profileConfig.cache
  let fallbackReason: string | undefined
  let lastError: unknown

  for (let index = 0; index < candidates.length; index += 1) {
    const config = candidates[index]
    const startedAt = Date.now()
    try {
      const candidatePayload = buildProfilePayload(config, payload, profile)

      // Ensure JSON mode compatibility for all providers (especially DeepSeek and Moonshot)
      if (profileConfig.responseFormatJson && !candidatePayload.stream) {
        const lastMessage = candidatePayload.messages[candidatePayload.messages.length - 1]
        if (lastMessage && !lastMessage.content.toLowerCase().includes('json')) {
          lastMessage.content += '\n(Return the response in json format)'
        }
      }

      const selectedClient = createClientForConfig(config)
      const completion = await createChatCompletion(candidatePayload, {
        cache,
        config,
        clientInstance: selectedClient,
        validate: options.parse
          ? (result: CompletionResponse) => {
            const content = getChatContent(result, '{}')
            options.parse!(content)
          }
          : undefined,
      })

      recordAIMetric({
        provider: config.provider,
        model: candidatePayload.model,
        profile,
        latencyMs: Date.now() - startedAt,
        cacheHit: completion.cacheHit,
        pendingReuse: completion.pendingReuse,
        fallbackReason,
        success: true,
      })

      return {
        response: completion.result,
        meta: {
          ...completion,
          provider: config.provider,
          model: candidatePayload.model,
          profile,
          fallbackReason,
        },
      }
    } catch (error) {
      lastError = error
      recordAIMetric({
        provider: config.provider,
        model: config.model,
        profile,
        latencyMs: Date.now() - startedAt,
        cacheHit: false,
        pendingReuse: false,
        fallbackReason,
        success: false,
      })

      if (aiSelection !== 'auto' || index === candidates.length - 1 || !isFallbackError(error)) {
        throw error
      }

      fallbackReason = error instanceof Error ? error.message : 'AI provider failed'
    }
  }

  throw lastError
}

// API endpoint to update AI config from frontend
router.post('/config', async (req: Request, res: Response) => {
  try {
    const { provider, apiKey, model } = req.body

    if (provider === 'auto') {
      aiSelection = 'auto'
      aiConfig = getAIConfigFromEnv()
      client = new OpenAI({
        baseURL: aiConfig.baseURL,
        apiKey: aiConfig.apiKey,
      })
      defaultModel = aiConfig.model
      aiResponseCache.clear()

      res.json({ success: true, message: 'AI 自动调用已启用' })
      return
    }

    if (provider === 'babel') {
      // BabeL-O 引擎：密钥与模型由 BabeL-O 侧管理（ADR-B2），AetheL 仅切换 provider。
      const babelConfig = buildAIConfigsFromEnv().babel
      if (!babelConfig.baseURL) {
        res.status(400).json({ success: false, error: 'BABEL_NEXUS_URL 未配置，无法使用 BabeL-O 引擎', code: 'BABEL_NOT_CONFIGURED' })
        return
      }
      client = new OpenAI({ baseURL: babelConfig.baseURL, apiKey: babelConfig.apiKey })
      defaultModel = babelConfig.model
      aiSelection = 'babel'
      aiConfig = babelConfig
      aiResponseCache.clear()

      res.json({ success: true, message: '已切换到 BabeL-O 引擎' })
      return
    }

    if (provider && apiKey && provider in providerBaseURLs) {
      const selectedProvider = provider as AIProvider
      const baseURL = providerBaseURLs[selectedProvider]
      if (baseURL) {
        client = new OpenAI({
          baseURL,
          apiKey: apiKey,
        })
        defaultModel = model || defaultModels[selectedProvider]
        aiSelection = selectedProvider
        aiConfig = { provider: selectedProvider, baseURL, apiKey, model: defaultModel }
        aiResponseCache.clear()

        res.json({ success: true, message: 'AI 配置已更新' })
        return
      }
    }

    res.status(400).json({ success: false, error: 'Invalid configuration' })
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message })
  }
})

// Get current AI config (without exposing API key)
router.get('/config', (req: Request, res: Response) => {
  const configs = buildAIConfigsFromEnv()
  const selected = configs[resolveAIProviderFromEnv(configs)]
  res.json({
    success: true,
    selection: aiSelection,
    provider: aiConfig.provider,
    model: defaultModel,
    hasApiKey: isProviderConfigured(selected),
    metrics: getAIMetrics().slice(0, 12),
  })
})

function stripFencedJson(content: string): string {
  const fence = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  return fence ? fence[1] : content
}

function extractBalancedJsonObject(content: string): string | null {
  const firstBrace = content.indexOf('{')
  if (firstBrace === -1) return null

  let depth = 0
  let inString = false
  let escape = false
  for (let i = firstBrace; i < content.length; i += 1) {
    const char = content[i]
    if (escape) {
      escape = false
      continue
    }
    if (char === '\\') {
      escape = true
      continue
    }
    if (char === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return content.slice(firstBrace, i + 1)
    }
  }
  return null
}

function parseJsonObject(content: string) {
  const stripped = stripFencedJson(content).trim()
  const candidate = extractBalancedJsonObject(stripped) ?? stripped
  try {
    return JSON.parse(candidate)
  } catch (err) {
    const preview = candidate.length > 200 ? `${candidate.slice(0, 200)}...` : candidate
    throw new Error(`AI JSON parse failed: ${(err as Error).message} | preview: ${preview}`)
  }
}

function toStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : []
}

router.post('/chat', async (req: Request, res: Response) => {
  try {
    const { messages, stream = true } = req.body

    if (!messages || !Array.isArray(messages)) {
      res.status(400).json({ success: false, error: 'messages is required' })
      return
    }

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')

      const { response } = await runProfileCompletion({
        messages,
        stream: true,
      }, 'long-document', { cache: false })

      if (!isChatStream(response)) {
        throw new Error('Expected streaming completion response')
      }

      for await (const chunk of response) {
        const content = chunk.choices?.[0]?.delta?.content
        if (content) {
          res.write(`data: ${JSON.stringify({ content, done: false })}\n\n`)
        }
      }

      res.write(`data: ${JSON.stringify({ content: '', done: true })}\n\n`)
      res.end()
    } else {
      const { response } = await runProfileCompletion({
        messages,
        stream: false,
      }, 'fast-json', { cache: false })

      res.json({
        success: true,
        content: getChatContent(response),
        usage: isChatStream(response) ? undefined : response.usage,
      })
    }
  } catch (error: unknown) {
    console.error('AI chat error:', error)
    res.status(500).json({ success: false, error: (error as Error).message || 'AI service error' })
  }
})

router.post('/categorize', async (req: Request, res: Response) => {
  try {
    const { bubbles, existingTags = [] } = req.body

    if (!bubbles || !Array.isArray(bubbles)) {
      res.status(400).json({ success: false, error: 'bubbles is required' })
      return
    }

    // 实时判定当前生效 provider 是否可用（避免模块级 aiConfig 在 env 变化后过期）
    const liveConfigs = buildAIConfigsFromEnv()
    const liveSelected = liveConfigs[resolveAIProviderFromEnv(liveConfigs)]
    if (!isProviderConfigured(liveSelected) && !completionOverride) {
      res.status(412).json({ success: false, error: 'AI provider not configured', code: 'NO_API_KEY' })
      return
    }

    const systemPrompt = buildCategorizeSystemPrompt()
    const userPrompt = buildCategorizeUserPrompt(bubbles, existingTags)

    const { response, meta } = await runProfileCompletion({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      stream: false,
    }, 'fast-json', { cache: false, parse: parseJsonObject })

    const content = getChatContent(response, '{}')
    console.log(`[AI Categorize] Provider: ${meta.provider}, Model: ${meta.model}, Content Preview: ${content.slice(0, 200)}`)
    let parsed: unknown
    try {
      parsed = parseJsonObject(content)
    } catch (err) {
      const preview = content.length > 200 ? `${content.slice(0, 200)}...` : content
      console.error('AI categorize parse failed:', (err as Error).message)
      res.status(502).json({
        success: false,
        error: 'AI categorize response parse failed',
        code: 'PARSE_FAILED',
        rawPreview: preview,
      })
      return
    }

    const normalized = normalizeCategorizeResponse(parsed)
    console.log(`[AI Categorize] Normalized: ${normalized.categories.length} categories, ${normalized.relations.length} relations`)
    res.json({ success: true, ...normalized })
  } catch (error: unknown) {
    console.error('AI categorize error:', error)
    res.status(500).json({ success: false, error: (error as Error).message || 'AI categorize error' })
  }
})

router.post('/workshop-skill', async (req: Request, res: Response) => {
  try {
    const {
      skillId,
      input,
      confirmationNotes = '',
      previousQuestions = [],
      previousBubbles = [],
    } = req.body

    if (!skillId || !['idea-to-bubbles', 'prd-to-bubbles'].includes(skillId)) {
      res.status(400).json({ success: false, error: 'valid skillId is required' })
      return
    }

    if (!input || typeof input !== 'string' || input.trim().length === 0) {
      res.status(400).json({ success: false, error: 'input is required' })
      return
    }

    const isIdeaSkill = skillId === 'idea-to-bubbles'
    const systemPrompt = buildWorkshopSystemPrompt(skillId as WorkshopSkillId)
    const userPrompt = buildWorkshopUserPrompt({
      skillId: skillId as WorkshopSkillId,
      input,
      confirmationNotes,
      previousQuestions,
      previousBubbles,
    })

    const { response } = await runProfileCompletion({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      stream: false,
    }, 'workshop-transform')

    const content = getChatContent(response, '{}')
    let parsed
    try {
      parsed = parseJsonObject(content)
    } catch {
      res.status(502).json({ success: false, error: 'AI workshop skill response parse failed' })
      return
    }

    const candidateBubbles = Array.isArray(parsed.candidateBubbles)
      ? parsed.candidateBubbles
        .map((bubble: { title?: string; content?: string; tag?: string; rationale?: string }) => ({
          title: String(bubble.title || '未命名气泡').trim(),
          content: String(bubble.content || '').trim(),
          tag: String(bubble.tag || (isIdeaSkill ? '创意工坊' : 'PRD拆解')).trim(),
          rationale: String(bubble.rationale || '').trim(),
        }))
        .filter((bubble: { content: string }) => bubble.content.length > 0)
      : []

    if (isIdeaSkill) {
      const first = candidateBubbles[0]
      if (!first || first.content !== input.trim()) {
        candidateBubbles.unshift({
          title: '初始设想',
          content: input.trim(),
          tag: '创意工坊',
          rationale: '保留用户的原始输入，作为后续拆解的源头。',
        })
      } else {
        first.title = first.title || '初始设想'
        first.tag = first.tag || '创意工坊'
      }
    }

    res.json({
      success: true,
      analysisSummary: String(parsed.analysisSummary || '').trim(),
      needsConfirmation: Boolean(parsed.needsConfirmation),
      confidence: Number(parsed.confidence || 0),
      confirmationPrompt: String(parsed.confirmationPrompt || '').trim(),
      clarificationQuestions: Array.isArray(parsed.clarificationQuestions)
        ? parsed.clarificationQuestions.map((question: {
          id?: string
          label?: string
          question?: string
          reason?: string
          placeholder?: string
        }, index: number) => ({
          id: String(question.id || `q${index + 1}`),
          label: String(question.label || `确认 ${index + 1}`).trim(),
          question: String(question.question || '').trim(),
          reason: String(question.reason || '').trim(),
          placeholder: String(question.placeholder || '补充你的判断...').trim(),
        })).filter((question: { question: string }) => question.question.length > 0)
        : [],
      candidateBubbles,
      suggestedNextActions: toStringArray(parsed.suggestedNextActions),
    })
  } catch (error: unknown) {
    console.error('AI workshop skill error:', error)
    res.status(500).json({ success: false, error: (error as Error).message || 'AI workshop skill error' })
  }
})

router.post('/generate-prd', async (req: Request, res: Response) => {
  try {
    const { bubbleIds, bubbles, template = 'standard', modules } = req.body

    if ((!bubbles || !Array.isArray(bubbles) || bubbles.length === 0) && (!bubbleIds || !Array.isArray(bubbleIds))) {
      res.status(400).json({ success: false, error: 'bubbles or bubbleIds is required' })
      return
    }

    const bubblesContent = Array.isArray(bubbles) && bubbles.length > 0
      ? bubbles.map((bubble: { id: string; content: string; tag?: string; extensions?: string[] }, index: number) => {
        const lines = [
          `气泡 ${index + 1}`,
          `ID: ${bubble.id}`,
          `内容: ${bubble.content}`,
        ]
        if (bubble.tag) {
          lines.push(`标签: ${bubble.tag}`)
        }
        if (bubble.extensions?.length) {
          lines.push(`追问补充: ${bubble.extensions.join('；')}`)
        }
        return lines.join('\n')
      }).join('\n\n')
      : bubbleIds.map((id: string) => `气泡ID: ${id}`).join('\n')

    const systemPrompt = buildGeneratePrdSystemPrompt(template, modules)

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')

    const { response } = await runProfileCompletion({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: buildGeneratePrdUserPrompt(bubblesContent) },
      ],
      stream: true,
    }, 'long-document', { cache: false })

    if (!isChatStream(response)) {
      throw new Error('Expected streaming completion response')
    }

    for await (const chunk of response) {
      const content = chunk.choices?.[0]?.delta?.content
      if (content) {
        res.write(`data: ${JSON.stringify({ module: '', content, done: false })}\n\n`)
      }
    }

    res.write(`data: ${JSON.stringify({ module: '', content: '', done: true })}\n\n`)
    res.end()
  } catch (error: unknown) {
    console.error('AI generate-prd error:', error)
    res.status(500).json({ success: false, error: (error as Error).message || 'AI generate PRD error' })
  }
})

router.post('/generate-prd-sections', async (req: Request, res: Response) => {
  try {
    const { groups, template = 'standard' } = req.body

    if (!Array.isArray(groups) || groups.length === 0) {
      res.status(400).json({ success: false, error: 'groups is required' })
      return
    }

    const groupLines = groups.map((group: {
      id: string
      title: string
      tag?: string
      bubbles?: Array<{ id: string; content: string; tag?: string; extensions?: string[] }>
    }, index: number) => {
      const bubbles = Array.isArray(group.bubbles) ? group.bubbles : []
      const bubbleLines = bubbles.map((bubble, bubbleIndex) => {
        const lines = [
          `气泡 ${bubbleIndex + 1}`,
          `ID: ${bubble.id}`,
          `内容: ${bubble.content}`,
        ]
        if (bubble.tag) lines.push(`标签: ${bubble.tag}`)
        if (bubble.extensions?.length) lines.push(`追问补充: ${bubble.extensions.join('；')}`)
        return lines.join('\n')
      }).join('\n\n')

      return [
        `分组 ${index + 1}`,
        `分组ID: ${group.id}`,
        `章节标题: ${group.title}`,
        group.tag ? `标签: ${group.tag}` : '',
        '气泡：',
        bubbleLines,
      ].filter(Boolean).join('\n')
    }).join('\n\n---\n\n')

    const systemPrompt = buildPrdSectionsSystemPrompt(template)

    const runSingleRequest = async (userPrompt: string) => {
      const { response } = await runProfileCompletion({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        stream: false,
      }, 'section-draft', { cache: true })

      const content = getChatContent(response, '{}')
      return parseJsonObject(content)
    }

    let sections: Array<{ groupId: string; title: string; content: string }>

    if (groups.length > 1 && process.env.AETHEL_PRD_SECTIONS_PARALLEL !== 'false') {
      const settled = await Promise.allSettled(groups.map((group: {
        id: string
        title: string
        tag?: string
        bubbles?: Array<{ id: string; content: string; tag?: string; extensions?: string[] }>
      }) => runSingleRequest(buildPrdSectionUserPrompt(group))))

      sections = settled.flatMap((result, index) => {
        if (result.status !== 'fulfilled') return []
        const parsed = result.value as { sections?: Array<{ groupId?: string; title?: string; content?: string }> }
        const group = groups[index] as { id: string; title: string }
        const rawSection = Array.isArray(parsed.sections)
          ? parsed.sections.find((section) => String(section.groupId || '').trim() === group.id) || parsed.sections[0]
          : null

        if (!rawSection) return []

        const groupId = String(rawSection.groupId || group.id).trim()
        const title = String(rawSection.title || group.title || '未命名章节').trim()
        const content = String(rawSection.content || '').trim()
        return groupId && content ? [{ groupId, title, content }] : []
      })
    } else {
      let parsed
      try {
        parsed = await runSingleRequest(buildPrdSectionsUserPrompt(groupLines))
      } catch {
        res.status(502).json({ success: false, error: 'AI PRD sections response parse failed' })
        return
      }

      sections = Array.isArray(parsed.sections)
        ? parsed.sections.map((section: { groupId?: string; title?: string; content?: string }) => ({
          groupId: String(section.groupId || '').trim(),
          title: String(section.title || '未命名章节').trim(),
          content: String(section.content || '').trim(),
        })).filter((section: { groupId: string; content: string }) => section.groupId && section.content)
        : []
    }

    res.json({ success: true, sections })
  } catch (error: unknown) {
    console.error('AI generate-prd-sections error:', error)
    res.status(500).json({ success: false, error: (error as Error).message || 'AI generate PRD sections error' })
  }
})

router.post('/snapshot', async (req: Request, res: Response) => {
  try {
    const { bubbles, categories = [] } = req.body

    if (!bubbles || !Array.isArray(bubbles)) {
      res.status(400).json({ success: false, error: 'bubbles is required' })
      return
    }

    const systemPrompt = buildSnapshotSystemPrompt()

    const bubbleLines = bubbles.map((bubble: {
      id: string
      content: string
      tag?: string
      interactionWeight?: number
      extensions?: string[]
    }, index: number) => {
      const lines = [
        `气泡 ${index + 1}`,
        `ID: ${bubble.id}`,
        `内容: ${bubble.content}`,
        `权重: ${bubble.interactionWeight || 0}`,
      ]
      if (bubble.tag) lines.push(`标签: ${bubble.tag}`)
      if (bubble.extensions?.length) lines.push(`追问补充: ${bubble.extensions.join('；')}`)
      return lines.join('\n')
    }).join('\n\n')

    const categoryLines = Array.isArray(categories) && categories.length > 0
      ? categories.map((category: { name: string; description?: string }) => `- ${category.name}${category.description ? `：${category.description}` : ''}`).join('\n')
      : '无'

    const bubbleIds = bubbles
      .map((bubble: { id?: unknown }) => String(bubble.id || '').trim())
      .filter(Boolean)
    const parseSnapshotCompletion = (rawContent: string) => {
      const parsedValue = parseJsonObject(rawContent)
      const normalizedValue = normalizeSnapshotResponse(parsedValue, { bubbleIds })
      if (!normalizedValue.statusSnapshot && !normalizedValue.logicFlow && normalizedValue.semanticAnchors.length === 0) {
        throw new Error('AI snapshot schema failed: missing cognition fields')
      }
      return parsedValue
    }

    const profile: AITaskProfile = 'snapshot-large'
    const { response } = await runProfileCompletion({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: buildSnapshotUserPrompt(categoryLines, bubbleLines) },
      ],
      stream: false,
    }, profile, { cache: false, parse: parseSnapshotCompletion })

    const content = getChatContent(response, '{}')
    let parsed
    try {
      parsed = parseJsonObject(content)
    } catch (err) {
      const preview = content.length > 200 ? `${content.slice(0, 200)}...` : content
      console.error('AI snapshot parse failed:', (err as Error).message)
      res.status(502).json({
        success: false,
        error: 'AI snapshot response parse failed',
        code: 'PARSE_FAILED',
        rawPreview: preview,
      })
      return
    }

    const normalized = normalizeSnapshotResponse(parsed, { bubbleIds })
    if (!normalized.statusSnapshot && !normalized.logicFlow && normalized.semanticAnchors.length === 0) {
      res.status(502).json({
        success: false,
        error: 'AI snapshot response missing cognition fields',
        code: 'SCHEMA_FAILED',
      })
      return
    }

    res.json({ success: true, ...normalized })
  } catch (error: unknown) {
    console.error('AI snapshot error:', error)
    res.status(500).json({ success: false, error: (error as Error).message || 'AI snapshot error' })
  }
})

router.post('/followup', async (req: Request, res: Response) => {
  try {
    const { bubbleContent, existingBubbles = [], mode = 'single', targetBubbleIds = [] } = req.body

    if (!bubbleContent) {
      res.status(400).json({ success: false, error: 'bubbleContent is required' })
      return
    }

    const isRelationshipMode = mode === 'relationship'
    const systemPrompt = buildFollowupSystemPrompt({ mode, targetBubbleIds })
    const userPrompt = buildFollowupUserPrompt({ bubbleContent, existingBubbles, mode, targetBubbleIds })

    const { response } = await runProfileCompletion({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      stream: false,
    }, 'fast-json')

    const content = getChatContent(response, '{}')

    let parsed: unknown
    try {
      parsed = parseJsonObject(content)
    } catch {
      parsed = null
    }

    res.json({ success: true, ...normalizeFollowupResponse(parsed, { isRelationshipMode, targetBubbleIds }) })
  } catch (error: unknown) {
    console.error('AI followup error:', error)
    res.status(500).json({ success: false, error: (error as Error).message || 'AI followup error' })
  }
})

export default router
