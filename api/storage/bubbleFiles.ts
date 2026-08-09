import { mkdir, readFile, readdir, rename } from 'fs/promises'
import path from 'path'
import { legacyPaths, safeId, type StoragePaths } from './paths.js'
import { extractJsonBlock, parseMarkdown, stripFirstHeading, stringifyMarkdown } from './markdown.js'
import { atomicWriteFile } from './atomicWrite.js'
import { enqueueWrite } from './writeQueue.js'
import type { StoredBubble, StoredBubbleExtension } from './types.js'
import type { FrontMatterValue } from './markdown.js'

const DEFAULT_BUBBLE_COLOR = '#94a3b8'

function asString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function asNumber(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function bubblePath(id: string, dirs: StoragePaths) {
  return path.join(dirs.bubblesDir, `${safeId(id)}.md`)
}

export async function ensureBubbleDir(dirs: StoragePaths = legacyPaths) {
  await mkdir(dirs.bubblesDir, { recursive: true })
}

export function bubbleToMarkdown(bubble: StoredBubble, extensions: StoredBubbleExtension[] = []) {
  const body = [
    '# Bubble',
    '',
    bubble.content,
    '',
    '## Follow-up Extensions',
    '',
    extensions.length > 0
      ? extensions.map((extension) => `- ${extension.source}: ${extension.content}`).join('\n')
      : 'No extensions yet.',
    '',
    '## AetheL Bubble Payload',
    '',
    '```json aethel-bubble',
    JSON.stringify({ bubble, extensions }, null, 2),
    '```',
  ].join('\n')

  return stringifyMarkdown({
    id: bubble.id,
    title: bubble.content.slice(0, 48),
    tag: bubble.tag || '',
    categoryId: bubble.categoryId || '',
    color: bubble.color || DEFAULT_BUBBLE_COLOR,
    interactionWeight: bubble.interactionWeight || 0,
    sourceSkillId: bubble.sourceSkillId || '',
    sourceGroupId: bubble.sourceGroupId || '',
    sourceLabel: bubble.sourceLabel || '',
    sourceFileName: bubble.sourceFileName || '',
    createdAt: bubble.createdAt,
    updatedAt: bubble.updatedAt,
    extensions: JSON.parse(JSON.stringify(extensions)) as FrontMatterValue,
  }, body)
}

export function markdownToBubble(markdown: string): { bubble: StoredBubble; extensions: StoredBubbleExtension[] } | null {
  const { frontMatter, body } = parseMarkdown(markdown)
  const payload = extractJsonBlock<{ bubble: StoredBubble; extensions: StoredBubbleExtension[] }>(body, 'aethel-bubble')
  if (payload?.bubble?.id) {
    return {
      bubble: payload.bubble,
      extensions: Array.isArray(payload.extensions) ? payload.extensions : [],
    }
  }

  const id = asString(frontMatter.id)
  if (!id) return null

  const rawExtensions = Array.isArray(frontMatter.extensions) ? frontMatter.extensions as unknown[] : []
  const extensions = rawExtensions.length > 0
    ? rawExtensions.filter((item): item is StoredBubbleExtension => (
      typeof item === 'object' && item !== null && typeof (item as StoredBubbleExtension).id === 'string'
    ))
    : []

  return {
    bubble: {
      id,
      content: stripFirstHeading(body)
        .replace(/\n## Follow-up Extensions[\s\S]*$/, '')
        .replace(/\n## AetheL Bubble Payload[\s\S]*$/, '')
        .replace(/\n## Aethe[lL] Bubble Payload[\s\S]*$/, '')
        .trim(),
      tag: asString(frontMatter.tag),
      color: asString(frontMatter.color, DEFAULT_BUBBLE_COLOR),
      categoryId: asString(frontMatter.categoryId),
      x: asNumber(frontMatter.x),
      y: asNumber(frontMatter.y),
      interactionWeight: asNumber(frontMatter.interactionWeight),
      sourceSkillId: asString(frontMatter.sourceSkillId),
      sourceGroupId: asString(frontMatter.sourceGroupId),
      sourceLabel: asString(frontMatter.sourceLabel),
      sourceFileName: asString(frontMatter.sourceFileName),
      createdAt: asString(frontMatter.createdAt, new Date().toISOString()),
      updatedAt: asString(frontMatter.updatedAt, new Date().toISOString()),
    },
    extensions,
  }
}

export async function readBubbles(dirs: StoragePaths = legacyPaths) {
  await ensureBubbleDir(dirs)
  const files = (await readdir(dirs.bubblesDir)).filter((file) => file.endsWith('.md')).sort()
  const results = await Promise.all(files.map(async (file) => {
    const markdown = await readFile(path.join(dirs.bubblesDir, file), 'utf8')
    return markdownToBubble(markdown)
  }))

  return results.filter((result): result is NonNullable<typeof result> => Boolean(result))
}

export async function writeBubble(bubble: StoredBubble, extensions: StoredBubbleExtension[] = [], dirs: StoragePaths = legacyPaths) {
  await ensureBubbleDir(dirs)
  await enqueueWrite(`bubble:${safeId(bubble.id)}`, () => (
    atomicWriteFile(bubblePath(bubble.id, dirs), bubbleToMarkdown(bubble, extensions))
  ))
}

export async function moveBubbleToTrash(id: string, dirs: StoragePaths = legacyPaths) {
  await ensureBubbleDir(dirs)
  await mkdir(path.join(dirs.trashDir, 'bubbles'), { recursive: true })
  const from = bubblePath(id, dirs)
  const to = path.join(dirs.trashDir, 'bubbles', `${safeId(id)}-${Date.now()}.md`)
  await enqueueWrite(`bubble:${safeId(id)}`, async () => {
    try {
      await rename(from, to)
    } catch {
      // Already absent.
    }
  })
}

export async function syncBubbleFiles(bubbles: StoredBubble[], extensions: StoredBubbleExtension[], dirs: StoragePaths = legacyPaths) {
  await ensureBubbleDir(dirs)
  const activeIds = new Set(bubbles.map((bubble) => safeId(bubble.id)))
  const files = (await readdir(dirs.bubblesDir)).filter((file) => file.endsWith('.md'))

  await Promise.all(bubbles.map((bubble) => (
    writeBubble(
      bubble,
      extensions.filter((extension) => extension.bubbleId === bubble.id),
      dirs,
    )
  )))

  await Promise.all(files.map(async (file) => {
    const id = file.replace(/\.md$/, '')
    if (activeIds.has(id)) return
    await mkdir(path.join(dirs.trashDir, 'bubbles'), { recursive: true })
    await enqueueWrite(`bubble:${id}`, () => (
      rename(path.join(dirs.bubblesDir, file), path.join(dirs.trashDir, 'bubbles', `${id}-${Date.now()}.md`))
    ))
  }))
}
