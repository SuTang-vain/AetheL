import { mkdir, readFile } from 'fs/promises'
import { dataDir, legacyPaths, type StoragePaths } from './paths.js'
import { readBubbles, syncBubbleFiles } from './bubbleFiles.js'
import { readSnapshots, syncSnapshotFiles } from './snapshotFiles.js'
import { atomicWriteFile } from './atomicWrite.js'
import { enqueueWrite } from './writeQueue.js'
import type {
  StoredBubble,
  StoredBubbleExtension,
  StoredWorkspaceFile,
  StoredWorkspaceState,
} from './types.js'

const emptyWorkspaceFile = (): StoredWorkspaceFile => ({
  categories: [],
  relations: [],
  extensions: [],
  revisions: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  filterTag: null,
  canvasMode: 'pan',
  bubbleLayout: {},
  updatedAt: new Date().toISOString(),
})

async function ensureDataDir(dirs: StoragePaths) {
  await mkdir(dataDir, { recursive: true })
  await mkdir(dirs.workspaceFilePath.replace(/workspace\.json$/, ''), { recursive: true })
}

export async function readWorkspaceFile(dirs: StoragePaths = legacyPaths): Promise<StoredWorkspaceFile> {
  await ensureDataDir(dirs)
  try {
    const raw = await readFile(dirs.workspaceFilePath, 'utf8')
    return { ...emptyWorkspaceFile(), ...JSON.parse(raw) }
  } catch {
    return emptyWorkspaceFile()
  }
}

export async function writeWorkspaceFile(workspace: StoredWorkspaceState, dirs: StoragePaths = legacyPaths) {
  await ensureDataDir(dirs)
  const bubbleLayout = workspace.bubbles.reduce<StoredWorkspaceFile['bubbleLayout']>((acc, bubble) => {
    acc[bubble.id] = {
      x: bubble.x,
      y: bubble.y,
      color: bubble.color,
      categoryId: bubble.categoryId,
      tag: bubble.tag,
      interactionWeight: bubble.interactionWeight || 0,
      updatedAt: bubble.updatedAt,
    }
    return acc
  }, {})

  const file: StoredWorkspaceFile = {
    categories: workspace.categories || [],
    relations: workspace.relations || [],
    extensions: workspace.extensions || [],
    revisions: workspace.revisions || [],
    viewport: workspace.viewport || { x: 0, y: 0, zoom: 1 },
    filterTag: workspace.filterTag || null,
    canvasMode: workspace.canvasMode || 'pan',
    bubbleLayout,
    updatedAt: new Date().toISOString(),
  }

  await enqueueWrite('workspace:file', () => (
    atomicWriteFile(dirs.workspaceFilePath, `${JSON.stringify(file, null, 2)}\n`)
  ))
}

function mergeBubbleLayout(bubble: StoredBubble, extensions: StoredBubbleExtension[], workspaceFile: StoredWorkspaceFile): StoredBubble {
  const layout = workspaceFile.bubbleLayout?.[bubble.id]
  const latestExtensionTime = extensions
    .filter((extension) => extension.bubbleId === bubble.id)
    .map((extension) => extension.createdAt)
    .sort()
    .at(-1)

  return {
    ...bubble,
    ...(layout || {}),
    tag: layout?.tag ?? bubble.tag,
    color: layout?.color ?? bubble.color,
    categoryId: layout?.categoryId ?? bubble.categoryId,
    interactionWeight: layout?.interactionWeight ?? bubble.interactionWeight ?? 0,
    updatedAt: layout?.updatedAt || latestExtensionTime || bubble.updatedAt,
  }
}

export async function readWorkspace(dirs: StoragePaths = legacyPaths): Promise<StoredWorkspaceState> {
  const [workspaceFile, bubbleRecords, snapshots] = await Promise.all([
    readWorkspaceFile(dirs),
    readBubbles(dirs),
    readSnapshots(dirs),
  ])

  const fileExtensions = bubbleRecords.flatMap((record) => record.extensions)
  const extensions = workspaceFile.extensions.length > 0 ? workspaceFile.extensions : fileExtensions
  const bubbles = bubbleRecords.map((record) => mergeBubbleLayout(record.bubble, extensions, workspaceFile))

  return {
    bubbles,
    categories: workspaceFile.categories,
    relations: workspaceFile.relations.filter((relation) => (
      bubbles.some((bubble) => bubble.id === relation.sourceId)
      && bubbles.some((bubble) => bubble.id === relation.targetId)
    )),
    extensions: extensions.filter((extension) => bubbles.some((bubble) => bubble.id === extension.bubbleId)),
    revisions: workspaceFile.revisions.filter((revision) => bubbles.some((bubble) => bubble.id === revision.bubbleId)),
    snapshots,
    viewport: workspaceFile.viewport,
    filterTag: workspaceFile.filterTag,
    canvasMode: workspaceFile.canvasMode,
    updatedAt: workspaceFile.updatedAt,
  }
}

export async function writeWorkspace(workspace: StoredWorkspaceState, dirs: StoragePaths = legacyPaths) {
  return enqueueWrite('workspace:all', async () => {
    await ensureDataDir(dirs)
    await Promise.all([
      writeWorkspaceFile(workspace, dirs),
      syncBubbleFiles(workspace.bubbles || [], workspace.extensions || [], dirs),
      syncSnapshotFiles(workspace.snapshots || [], dirs),
    ])
    return readWorkspace(dirs)
  })
}
