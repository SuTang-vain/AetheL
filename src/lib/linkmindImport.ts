import { apiFetch } from './apiClient'
import type { ImportedSourceMeta } from '../../api/storage/types.js'

/**
 * LinkMind（链藏）导入编排层。
 * 流程：提取链接 → 幂等创建导入 → 轮询 ImportJob → 拉取知识项 → 转换为候选气泡。
 * 契约对齐 docs/linkmind-integration.md §5.3/§5.4。
 */

export interface LinkCandidateBubble {
  title: string
  content: string
  tag: string
  rationale: string
  evidenceType?: string
  sourceUrl?: string
}

export type LinkImportStatus =
  | 'completed'
  | 'invalid'
  | 'not-configured'
  | 'unreachable'
  | 'auth-required'
  | 'failed'

export interface LinkImportResult {
  status: LinkImportStatus
  importId?: string
  knowledgeItemId?: string
  candidates?: LinkCandidateBubble[]
  sourceSummary?: string
  message?: string
}

interface LinkMindImportResponse {
  importId?: string
  status?: string
  knowledgeItemId?: string
  error?: string
}

interface LinkMindEvidenceUnit {
  content?: string
  evidenceType?: string
}

interface LinkMindTextItem {
  content?: string
}

interface LinkMindKnowledgeItem {
  source?: {
    platform?: string
    originalUrl?: string
  }
  // 嵌套形态（契约文档 v1 假设；部分端点可能返回）
  distillation?: {
    sourceSummary?: string
    evidenceUnits?: LinkMindEvidenceUnit[]
    inferences?: Array<LinkMindTextItem | string>
    uncertainties?: Array<LinkMindTextItem | string>
  }
  article?: {
    keyPoints?: Array<LinkMindTextItem | string>
  }
  // 扁平形态（GET /knowledge-items/:id 实际返回）
  summary?: string
  articleMarkdown?: string
  keyPoints?: Array<LinkMindTextItem | string>
  oneMinuteTakeaway?: string
  reflectionQuestion?: string
  actionSuggestion?: string
}

interface LinkMindConfig {
  configured?: boolean
  pollIntervalMs?: number
  pollTimeoutMs?: number
}

const DEFAULT_POLL_INTERVAL_MS = 2_000
const DEFAULT_POLL_TIMEOUT_MS = 120_000

const URL_PATTERN = /https?:\/\/[^\s'"<>，。；、）)】」》]+/gi

export function extractUrls(input: string): string[] {
  const matches = input.match(URL_PATTERN) || []
  return matches
    .map((url) => url.replace(/[.,;:!?，。；：！？]+$/, ''))
    .filter((url) => url.length > 0)
}

async function idempotencyKeyFor(url: string): Promise<string> {
  const data = new TextEncoder().encode(url)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function textOf(item: LinkMindTextItem | string | undefined): string {
  if (typeof item === 'string') return item
  return item?.content || ''
}

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, '')
}

/** 根据 URL host 推断平台名（用于气泡来源元数据的 platform 字段）。 */
export function guessPlatformFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname
    if (host.includes('douyin')) return 'douyin'
    if (host.includes('bilibili') || host.includes('b23.tv')) return 'bilibili'
    if (host.includes('xiaohongshu')) return 'xiaohongshu'
    if (host.includes('weibo')) return 'weibo'
    if (host.includes('youtube') || host.includes('youtu.be')) return 'youtube'
    return host.replace(/^www\./, '')
  } catch {
    return ''
  }
}

export async function fetchLinkMindConfig(): Promise<LinkMindConfig> {
  try {
    const response = await apiFetch('/api/linkmind/config')
    if (!response.ok) return {}
    const data = await response.json()
    return data as LinkMindConfig
  } catch {
    return {}
  }
}

/**
 * 把 LinkMind 三层产出转换为候选气泡（纯函数，可单测）。
 * 映射规则见 docs/linkmind-integration.md §5.4，兼容两种响应形态：
 * - 嵌套形态：distillation.evidenceUnits / inferences / uncertainties / article.keyPoints
 * - 扁平形态（实际 API）：summary / keyPoints / oneMinuteTakeaway / actionSuggestion
 */
export function convertKnowledgeToCandidates(raw: unknown, sourceMeta?: Pick<ImportedSourceMeta, 'url' | 'platform' | 'accessedAt'>): LinkCandidateBubble[] {
  const item = raw as LinkMindKnowledgeItem | null | undefined
  const distillation = item?.distillation
  const article = item?.article
  const source = item?.source
  const sourceUrl = sourceMeta?.url || source?.originalUrl || ''
  const candidates: LinkCandidateBubble[] = []

  const push = (title: string, content: string, tag: string, rationale: string, evidenceType?: string) => {
    const trimmed = content.trim()
    if (!trimmed) return
    candidates.push({
      title,
      content: trimmed,
      tag,
      rationale,
      ...(evidenceType ? { evidenceType } : {}),
      ...(sourceUrl ? { sourceUrl } : {}),
    })
  }

  // 嵌套形态：证据蒸馏的细分产出
  if (distillation?.sourceSummary) {
    push('来源摘要', distillation.sourceSummary, '来源摘要', 'LinkMind 证据蒸馏的原文摘要')
  }
  for (const unit of distillation?.evidenceUnits || []) {
    push('证据', unit?.content || '', '外部证据', `证据类型：${unit?.evidenceType || 'TRANSCRIPT'}`, unit?.evidenceType)
  }
  for (const inference of distillation?.inferences || []) {
    push('推断', textOf(inference), '推断', 'AI 基于证据作出的推断（非原文事实）')
  }
  for (const uncertainty of distillation?.uncertainties || []) {
    push('不确定', textOf(uncertainty), '问题', '证据中的不确定性或待澄清的开放问题')
  }

  // 扁平形态：当前 GET /knowledge-items/:id 的实际返回
  if (item?.summary && !distillation?.sourceSummary) {
    push('来源摘要', item.summary, '来源摘要', 'LinkMind 对内容的语义摘要')
  }
  for (const keyPoint of (item?.keyPoints || article?.keyPoints || []).slice(0, 3)) {
    push('要点', textOf(keyPoint), '要点', '知识文章的关键点')
  }
  if (item?.oneMinuteTakeaway) {
    push('一分钟理解', item.oneMinuteTakeaway, '要点', 'AI 提炼的一分钟认知')
  }
  if (item?.actionSuggestion) {
    push('下一步行动', item.actionSuggestion, '行动', 'AI 建议的最小认知行动')
  }

  return candidates
}

/**
 * 完整导入编排：幂等创建 → 轮询（AUTH_REQUIRED 提前返回）→ 拉取知识项 → 转换。
 */
export async function importLink(input: string): Promise<LinkImportResult> {
  const urls = extractUrls(input)
  if (urls.length === 0) {
    return { status: 'invalid', message: '没有检测到链接，请粘贴视频或文章的完整 URL。' }
  }

  const config = await fetchLinkMindConfig()
  if (config.configured === false) {
    return { status: 'not-configured', message: 'LinkMind 服务未配置，请在后端设置 LINKMIND_BASE_URL。' }
  }

  const pollIntervalMs = config.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS
  const pollTimeoutMs = config.pollTimeoutMs || DEFAULT_POLL_TIMEOUT_MS
  const url = normalizeUrl(urls[0])

  const createResponse = await apiFetch('/api/linkmind/imports', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': await idempotencyKeyFor(url),
    },
    body: JSON.stringify({ url }),
  })

  if (createResponse.status === 503) {
    return { status: 'not-configured', message: 'LinkMind 服务未配置，请在后端设置 LINKMIND_BASE_URL。' }
  }
  if (createResponse.status === 502) {
    return { status: 'unreachable', message: '无法连接 LinkMind 服务，请确认它已在本地运行。' }
  }

  let createData: LinkMindImportResponse = {}
  try {
    createData = await createResponse.json() as LinkMindImportResponse
  } catch {
    return { status: 'failed', message: 'LinkMind 返回了无法解析的响应。' }
  }

  const importId = createData.importId
  if (!importId) {
    return { status: 'failed', message: createData.error || '导入创建失败。' }
  }

  let status = createData.status || 'PENDING'
  let knowledgeItemId = createData.knowledgeItemId
  const startedAt = Date.now()

  while (status !== 'COMPLETED' && Date.now() - startedAt < pollTimeoutMs) {
    if (status === 'FAILED') {
      return { status: 'failed', message: 'LinkMind 导入失败，请重试或检查链接。' }
    }
    if (status === 'AUTH_REQUIRED') {
      return { status: 'auth-required', message: '该平台需要登录授权，已保留你的链接，稍后可在 LinkMind 侧完成授权。' }
    }
    await sleep(pollIntervalMs)
    try {
      const pollResponse = await apiFetch(`/api/linkmind/imports/${encodeURIComponent(importId)}`)
      const pollData = await pollResponse.json() as LinkMindImportResponse
      status = pollData.status || status
      knowledgeItemId = pollData.knowledgeItemId || knowledgeItemId
    } catch {
      // 轮询失败不中断，继续等待下一次
    }
  }

  if (status !== 'COMPLETED' || !knowledgeItemId) {
    return { status: 'failed', message: '导入超时或未能完成，请稍后重试。' }
  }

  const itemResponse = await apiFetch(`/api/linkmind/knowledge-items/${encodeURIComponent(knowledgeItemId)}`)
  if (!itemResponse.ok) {
    return { status: 'failed', message: '拉取知识项失败，请稍后重试。' }
  }
  const item = await itemResponse.json()

  const candidates = convertKnowledgeToCandidates(item)
  if (candidates.length === 0) {
    return { status: 'failed', message: '导入完成但未提取到可用内容（可能缺少字幕/正文）。' }
  }

  const distillation = (item as LinkMindKnowledgeItem)?.distillation
  return {
    status: 'completed',
    importId,
    knowledgeItemId,
    candidates,
    sourceSummary: distillation?.sourceSummary,
  }
}
