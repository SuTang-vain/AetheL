import { extractUrls } from './linkmindImport'

/**
 * 首页智能输入框的输入分类（纯函数，可单测）。
 * - 包含 URL → 链接导入（link-to-evidence）
 * - 长文本或文档结构标记 → PRD 拆解（prd-to-bubbles）
 * - 其余 → 一句话想法（idea-to-bubbles）
 */
export type WorkshopInputKind = 'idea' | 'link' | 'prd'

const PRD_MARKERS = ['##', '###', '需求背景', '用户故事', '验收标准', '功能列表', '版本记录', 'prd']

export function classifyWorkshopInput(input: string): WorkshopInputKind {
  const trimmed = input.trim()
  if (!trimmed) return 'idea'
  if (extractUrls(trimmed).length > 0) return 'link'
  const lower = trimmed.toLowerCase()
  if (trimmed.length > 400 || PRD_MARKERS.some((marker) => lower.includes(marker.toLowerCase()))) return 'prd'
  return 'idea'
}

export function workshopSkillForKind(kind: WorkshopInputKind) {
  if (kind === 'link') return 'link-to-evidence' as const
  if (kind === 'prd') return 'prd-to-bubbles' as const
  return 'idea-to-bubbles' as const
}
