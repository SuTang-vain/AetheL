import { mkdir, readFile, readdir, rename } from 'fs/promises'
import path from 'path'
import { legacyPaths, safeId, type StoragePaths } from './paths.js'
import { extractJsonBlock, parseMarkdown, stringifyMarkdown } from './markdown.js'
import { atomicWriteFile } from './atomicWrite.js'
import { enqueueWrite } from './writeQueue.js'
import type { StoredSnapshot } from './types.js'

function snapshotPath(id: string, dirs: StoragePaths) {
  return path.join(dirs.snapshotsDir, `${safeId(id)}.md`)
}

export async function ensureSnapshotDir(dirs: StoragePaths = legacyPaths) {
  await mkdir(dirs.snapshotsDir, { recursive: true })
}

export function snapshotToMarkdown(snapshot: StoredSnapshot) {
  const cognition = snapshot.cognition || {}
  const bubbleIds = snapshot.canvasState.bubbles.map((bubble) => bubble.id)
  const anchors = Array.isArray(cognition.semanticAnchors)
    ? cognition.semanticAnchors.map((anchor) => typeof anchor === 'object' && anchor !== null ? String((anchor as { label?: string }).label || '') : '').filter(Boolean)
    : []

  const body = [
    `# ${snapshot.name}`,
    '',
    '## Current State Snapshot',
    '',
    String(cognition.statusSnapshot || ''),
    '',
    '## Logic Flow',
    '',
    String(cognition.logicFlow || ''),
    '',
    '## Wake Trigger',
    '',
    String(cognition.wakeTrigger || ''),
    '',
    '## AetheL Snapshot Payload',
    '',
    '```json aethel-snapshot',
    JSON.stringify(snapshot, null, 2),
    '```',
  ].join('\n')

  return stringifyMarkdown({
    id: snapshot.id,
    name: snapshot.name,
    createdAt: snapshot.createdAt,
    bubbleIds,
    semanticAnchors: anchors,
  }, body)
}

export function markdownToSnapshot(markdown: string): StoredSnapshot | null {
  const { body } = parseMarkdown(markdown)
  return extractJsonBlock<StoredSnapshot>(body, 'aethel-snapshot')
}

export async function readSnapshots(dirs: StoragePaths = legacyPaths) {
  await ensureSnapshotDir(dirs)
  const files = (await readdir(dirs.snapshotsDir)).filter((file) => file.endsWith('.md')).sort()
  const snapshots = await Promise.all(files.map(async (file) => {
    const markdown = await readFile(path.join(dirs.snapshotsDir, file), 'utf8')
    return markdownToSnapshot(markdown)
  }))

  return snapshots
    .filter((snapshot): snapshot is StoredSnapshot => Boolean(snapshot))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

export async function writeSnapshot(snapshot: StoredSnapshot, dirs: StoragePaths = legacyPaths) {
  await ensureSnapshotDir(dirs)
  await enqueueWrite(`snapshot:${safeId(snapshot.id)}`, () => (
    atomicWriteFile(snapshotPath(snapshot.id, dirs), snapshotToMarkdown(snapshot))
  ))
}

export async function moveSnapshotToTrash(id: string, dirs: StoragePaths = legacyPaths) {
  await ensureSnapshotDir(dirs)
  await mkdir(path.join(dirs.trashDir, 'snapshots'), { recursive: true })
  const from = snapshotPath(id, dirs)
  const to = path.join(dirs.trashDir, 'snapshots', `${safeId(id)}-${Date.now()}.md`)
  await enqueueWrite(`snapshot:${safeId(id)}`, async () => {
    try {
      await rename(from, to)
    } catch {
      // Already absent.
    }
  })
}

export async function syncSnapshotFiles(snapshots: StoredSnapshot[], dirs: StoragePaths = legacyPaths) {
  await ensureSnapshotDir(dirs)
  const activeIds = new Set(snapshots.map((snapshot) => safeId(snapshot.id)))
  const files = (await readdir(dirs.snapshotsDir)).filter((file) => file.endsWith('.md'))

  await Promise.all(snapshots.map((snapshot) => writeSnapshot(snapshot, dirs)))
  await Promise.all(files.map(async (file) => {
    const id = file.replace(/\.md$/, '')
    if (activeIds.has(id)) return
    await mkdir(path.join(dirs.trashDir, 'snapshots'), { recursive: true })
    await enqueueWrite(`snapshot:${id}`, () => (
      rename(path.join(dirs.snapshotsDir, file), path.join(dirs.trashDir, 'snapshots', `${id}-${Date.now()}.md`))
    ))
  }))
}
