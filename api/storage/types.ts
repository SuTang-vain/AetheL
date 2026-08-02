/**
 * LinkMind 导入生成的气泡来源元数据。
 * 对齐 docs/linkmind-integration.md §5.4 的 ExternalEvidenceSource 草案。
 */
export interface ImportedSourceMeta {
  importId: string
  knowledgeItemId: string
  url: string
  platform: string
  accessedAt: string
  sourceType: 'market' | 'creative' | 'regulation'
  snippet?: string
  evidenceType?: string
}

export interface StoredBubble {
  id: string
  content: string
  tag: string
  color: string
  categoryId: string
  x: number
  y: number
  interactionWeight?: number
  sourceSkillId?: string
  sourceGroupId?: string
  sourceLabel?: string
  sourceFileName?: string
  source?: ImportedSourceMeta
  createdAt: string
  updatedAt: string
}

export interface StoredCategory {
  id: string
  name: string
  description: string
  color: string
  confidence: number
}

export interface StoredBubbleRelation {
  id: string
  sourceId: string
  targetId: string
  type: 'related' | 'contradictory' | 'duplicate'
  reason: string
}

export interface StoredBubbleExtension {
  id: string
  bubbleId: string
  content: string
  source: 'ai_followup' | 'manual'
  createdAt: string
}

export interface StoredBubbleRevision {
  id: string
  bubbleId: string
  type: 'content' | 'tag' | 'color' | 'category'
  before: string
  after: string
  createdAt: string
}

export interface StoredSnapshot {
  id: string
  name: string
  thumbnail: string
  createdAt: string
  cognition: Record<string, unknown>
  canvasState: {
    bubbles: StoredBubble[]
    viewport: StoredWorkspaceState['viewport']
    relations?: StoredBubbleRelation[]
    extensions?: StoredBubbleExtension[]
  }
  tagState: {
    tags: string[]
    categories: StoredCategory[]
  }
}

export interface StoredWorkspaceState {
  bubbles: StoredBubble[]
  categories: StoredCategory[]
  relations: StoredBubbleRelation[]
  extensions: StoredBubbleExtension[]
  revisions: StoredBubbleRevision[]
  snapshots: StoredSnapshot[]
  viewport: { x: number; y: number; zoom: number }
  filterTag: string | null
  canvasMode: 'pan' | 'edit' | 'select'
  updatedAt?: string
}

export interface StoredWorkspaceFile {
  categories: StoredCategory[]
  relations: StoredBubbleRelation[]
  extensions: StoredBubbleExtension[]
  revisions: StoredBubbleRevision[]
  viewport: StoredWorkspaceState['viewport']
  filterTag: string | null
  canvasMode: StoredWorkspaceState['canvasMode']
  bubbleLayout: Record<string, Pick<StoredBubble, 'x' | 'y' | 'color' | 'categoryId' | 'tag' | 'interactionWeight' | 'updatedAt'>>
  updatedAt: string
}
