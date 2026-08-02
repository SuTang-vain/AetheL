import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { ImportedSourceMeta } from '../../api/storage/types.js'

export interface Bubble {
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
  prdUsageCount?: number
  createdAt: string
  updatedAt: string
}

export interface Category {
  id: string
  name: string
  description: string
  color: string
  confidence: number
}

export interface BubbleRelation {
  id: string
  sourceId: string
  targetId: string
  type: 'related' | 'contradictory' | 'duplicate'
  reason: string
}

export interface BubbleExtension {
  id: string
  bubbleId: string
  content: string
  source: 'ai_followup' | 'manual'
  createdAt: string
}

export interface BubbleRevision {
  id: string
  bubbleId: string
  type: 'content' | 'tag' | 'color' | 'category'
  before: string
  after: string
  createdAt: string
}

const TAG_COLORS = [
  '#4f46e5', '#0891b2', '#7c3aed', '#e11d48',
  '#d97706', '#0f766e', '#64748b', '#db2777',
  '#2563eb', '#ea580c', '#65a30d', '#9333ea',
]

const BUBBLE_STORE_VERSION = 1
const DEFAULT_BUBBLE_COLOR = '#94a3b8'

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9)
}

function normalizeColor(color?: string) {
  return color?.trim().toLowerCase() || ''
}

function componentToHex(value: number) {
  return value.toString(16).padStart(2, '0')
}

function colorFromIndex(index: number) {
  const hue = (index * 137.508) % 360
  const saturation = 68 / 100
  const lightness = 46 / 100
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1))
  const match = lightness - chroma / 2
  let r = 0
  let g = 0
  let b = 0

  if (hue < 60) [r, g, b] = [chroma, x, 0]
  else if (hue < 120) [r, g, b] = [x, chroma, 0]
  else if (hue < 180) [r, g, b] = [0, chroma, x]
  else if (hue < 240) [r, g, b] = [0, x, chroma]
  else if (hue < 300) [r, g, b] = [x, 0, chroma]
  else [r, g, b] = [chroma, 0, x]

  return `#${componentToHex(Math.round((r + match) * 255))}${componentToHex(Math.round((g + match) * 255))}${componentToHex(Math.round((b + match) * 255))}`
}

function pickDistinctCategoryColor(index: number, usedColors: Set<string>, preferredColor?: string) {
  const candidates = [
    preferredColor,
    TAG_COLORS[index % TAG_COLORS.length],
    ...TAG_COLORS,
    colorFromIndex(index + TAG_COLORS.length),
  ].filter(Boolean) as string[]

  for (const color of candidates) {
    const normalized = normalizeColor(color)
    if (!usedColors.has(normalized)) {
      usedColors.add(normalized)
      return color
    }
  }

  let offset = 1
  while (true) {
    const color = colorFromIndex(index + TAG_COLORS.length + offset)
    const normalized = normalizeColor(color)
    if (!usedColors.has(normalized)) {
      usedColors.add(normalized)
      return color
    }
    offset += 1
  }
}

function getClusteredBubblePosition(categoryIndex: number, categoryCount: number, itemIndex: number, itemCount: number) {
  const safeCategoryCount = Math.max(categoryCount, 1)
  const columns = Math.min(3, Math.ceil(Math.sqrt(safeCategoryCount)))
  const rows = Math.ceil(safeCategoryCount / columns)
  const column = categoryIndex % columns
  const row = Math.floor(categoryIndex / columns)
  const categoryGapX = 430
  const categoryGapY = 310
  const categoryCenterX = (column - (columns - 1) / 2) * categoryGapX
  const categoryCenterY = (row - (rows - 1) / 2) * categoryGapY

  if (itemCount <= 1) {
    return { x: categoryCenterX, y: categoryCenterY }
  }

  const itemColumns = itemCount <= 3 ? 1 : 2
  const itemRows = Math.ceil(itemCount / itemColumns)
  const itemColumn = itemIndex % itemColumns
  const itemRow = Math.floor(itemIndex / itemColumns)
  const localGapX = 230
  const localGapY = 86

  return {
    x: categoryCenterX + (itemColumn - (itemColumns - 1) / 2) * localGapX,
    y: categoryCenterY + (itemRow - (itemRows - 1) / 2) * localGapY,
  }
}

function getCategorizedViewport(categoryCount: number, bubbleCount: number) {
  const safeCategoryCount = Math.max(categoryCount, 1)
  const columns = Math.min(3, Math.ceil(Math.sqrt(safeCategoryCount)))
  const rows = Math.ceil(safeCategoryCount / columns)
  const spreadScore = Math.max(columns, rows) + Math.max(0, bubbleCount - 10) * 0.08
  const zoom = Math.max(0.58, Math.min(0.95, 1.08 - spreadScore * 0.12))

  return { x: 0, y: 0, zoom }
}

interface BubbleState {
  bubbles: Bubble[]
  categories: Category[]
  relations: BubbleRelation[]
  extensions: BubbleExtension[]
  revisions: BubbleRevision[]
  activeBubbleId: string | null
  selectedBubbleId: string | null
  selectedBubbleIds: string[]
  filterTag: string | null
  viewport: { x: number; y: number; zoom: number }
  canvasMode: 'pan' | 'edit' | 'select'

  addBubble: (
    content: string,
    tag?: string,
    x?: number,
    y?: number,
    metadata?: Pick<Bubble, 'sourceSkillId' | 'sourceGroupId' | 'sourceLabel' | 'sourceFileName' | 'source'>,
  ) => string
  updateBubble: (id: string, updates: Partial<Bubble>) => void
  deleteBubble: (id: string) => void
  moveBubble: (id: string, x: number, y: number) => void
  setActiveBubble: (id: string | null, options?: { includeInSelection?: boolean }) => void
  selectBubble: (id: string | null) => void
  setSelectedBubbleIds: (ids: string[]) => void
  toggleSelectedBubble: (id: string) => void
  removeSelectedBubble: (id: string) => void
  clearSelectedBubbles: () => void
  incrementBubbleWeight: (id: string) => void
  incrementPrdUsage: (ids: string[]) => void
  setFilterTag: (tag: string | null) => void
  setViewport: (viewport: Partial<BubbleState['viewport']>) => void
  setCanvasMode: (mode: BubbleState['canvasMode']) => void

  addExtension: (bubbleId: string, content: string, source: BubbleExtension['source']) => void
  getExtensionsForBubble: (bubbleId: string) => BubbleExtension[]
  deleteExtension: (id: string) => void

  addCategory: (category: Omit<Category, 'id'>) => Category
  updateCategory: (id: string, updates: Partial<Category>) => void
  deleteCategory: (id: string) => void
  assignBubbleToCategory: (bubbleId: string, categoryId: string) => void

  addRelation: (relation: Omit<BubbleRelation, 'id'>) => void
  removeRelation: (id: string) => void
  setRelations: (relations: BubbleRelation[]) => void

  setCategoriesFromAI: (categories: Array<Omit<Category, 'id'> & { bubbleIds: string[]; suggestedTag?: string }>) => void
  compactCategorizedLayout: () => void
  ensureDistinctCategoryColors: () => void

  getFilteredBubbles: () => Bubble[]
}

type PersistedBubbleState = Pick<
  BubbleState,
  'bubbles' | 'categories' | 'relations' | 'extensions' | 'revisions' | 'filterTag' | 'viewport' | 'canvasMode'
>

function migrateBubbleState(persistedState: unknown): PersistedBubbleState {
  const state = (persistedState || {}) as Partial<PersistedBubbleState>

  return {
    bubbles: (state.bubbles || []).map((bubble) => ({
      ...bubble,
      tag: bubble.tag || '',
      categoryId: bubble.categoryId || '',
      interactionWeight: typeof bubble.interactionWeight === 'number' ? bubble.interactionWeight : 0,
      prdUsageCount: typeof bubble.prdUsageCount === 'number' ? bubble.prdUsageCount : 0,
      createdAt: bubble.createdAt || new Date().toISOString(),
      updatedAt: bubble.updatedAt || bubble.createdAt || new Date().toISOString(),
    })),
    categories: state.categories || [],
    relations: state.relations || [],
    extensions: state.extensions || [],
    revisions: state.revisions || [],
    filterTag: state.filterTag || null,
    viewport: state.viewport || { x: 0, y: 0, zoom: 1 },
    canvasMode: state.canvasMode || 'pan',
  }
}

export const useBubbleStore = create<BubbleState>()(persist((set, get) => ({
  bubbles: [],
  categories: [],
  relations: [],
  extensions: [],
  revisions: [],
  activeBubbleId: null,
  selectedBubbleId: null,
  selectedBubbleIds: [],
  filterTag: null,
  viewport: { x: 0, y: 0, zoom: 1 },
  canvasMode: 'pan',

  addBubble: (content, tag = '', x, y, metadata) => {
    const existingTagColor = tag
      ? get().bubbles.find((bubble) => bubble.tag === tag && bubble.color)?.color
      : undefined
    const bubble: Bubble = {
      id: generateId(),
      content,
      tag,
      color: existingTagColor || (tag ? TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)] : DEFAULT_BUBBLE_COLOR),
      categoryId: '',
      x: x ?? (Math.random() - 0.5) * 200,
      y: y ?? (Math.random() - 0.5) * 200,
      interactionWeight: 0,
      prdUsageCount: 0,
      ...(metadata || {}),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    set((state) => ({ bubbles: [...state.bubbles, bubble], filterTag: null }))
    return bubble.id
  },

  updateBubble: (id, updates) => {
    set((state) => {
      const target = state.bubbles.find((bubble) => bubble.id === id)
      if (!target) return state

      const nextTag = updates.tag ?? target.tag
      const nextCategoryId = updates.categoryId ?? target.categoryId
      const inheritedTagColor = updates.tag && !updates.color
        ? state.bubbles.find((bubble) => bubble.tag === updates.tag && bubble.color)?.color
        : undefined
      const nextUpdates = inheritedTagColor ? { ...updates, color: inheritedTagColor } : updates
      const nextColor = nextUpdates.color
      const now = new Date().toISOString()
      const revisions: BubbleRevision[] = [
        updates.content !== undefined && updates.content !== target.content
          ? {
            id: generateId(),
            bubbleId: id,
            type: 'content',
            before: target.content,
            after: updates.content,
            createdAt: now,
          }
          : null,
        updates.tag !== undefined && updates.tag !== target.tag
          ? {
            id: generateId(),
            bubbleId: id,
            type: 'tag',
            before: target.tag,
            after: updates.tag,
            createdAt: now,
          }
          : null,
        updates.color !== undefined && updates.color !== target.color
          ? {
            id: generateId(),
            bubbleId: id,
            type: 'color',
            before: target.color,
            after: updates.color,
            createdAt: now,
          }
          : null,
        updates.categoryId !== undefined && updates.categoryId !== target.categoryId
          ? {
            id: generateId(),
            bubbleId: id,
            type: 'category',
            before: target.categoryId,
            after: updates.categoryId,
            createdAt: now,
          }
          : null,
      ].filter((revision): revision is BubbleRevision => Boolean(revision))

      const bubbles = state.bubbles.map((bubble) => {
        const isTarget = bubble.id === id
        const sharesCategory = Boolean(nextCategoryId && bubble.categoryId === nextCategoryId)
        const sharesTag = Boolean(nextTag && bubble.tag === nextTag)

        if (isTarget) {
          return { ...bubble, ...nextUpdates, updatedAt: now }
        }

        if (sharesCategory && (nextColor || nextUpdates.tag)) {
          return {
            ...bubble,
            ...(nextUpdates.tag ? { tag: nextUpdates.tag } : {}),
            ...(nextColor ? { color: nextColor } : {}),
            updatedAt: now,
          }
        }

        if (nextColor && sharesTag) {
          return { ...bubble, color: nextColor, updatedAt: now }
        }

        return bubble
      })

      const categories = nextColor && nextCategoryId
        ? state.categories.map((category) =>
          category.id === nextCategoryId ? { ...category, color: nextColor } : category
        )
        : state.categories

      return { bubbles, categories, revisions: [...state.revisions, ...revisions] }
    })
  },

  deleteBubble: (id) => {
    set((state) => ({
      bubbles: state.bubbles.filter((b) => b.id !== id),
      relations: state.relations.filter((r) => r.sourceId !== id && r.targetId !== id),
      extensions: state.extensions.filter((e) => e.bubbleId !== id),
      revisions: state.revisions.filter((revision) => revision.bubbleId !== id),
      activeBubbleId: state.activeBubbleId === id ? null : state.activeBubbleId,
      selectedBubbleId: state.selectedBubbleId === id ? null : state.selectedBubbleId,
      selectedBubbleIds: state.selectedBubbleIds.filter((selectedId) => selectedId !== id),
    }))
  },

  moveBubble: (id, x, y) => {
    set((state) => ({
      bubbles: state.bubbles.map((b) =>
        b.id === id ? { ...b, x, y, updatedAt: new Date().toISOString() } : b
      ),
    }))
  },

  setActiveBubble: (id, options = {}) => {
    if (!id) {
      set({ activeBubbleId: null, selectedBubbleId: null })
      return
    }
    set((state) => ({
      activeBubbleId: id,
      selectedBubbleId: id,
      selectedBubbleIds: options.includeInSelection === false
        ? state.selectedBubbleIds
        : state.selectedBubbleIds.includes(id)
          ? state.selectedBubbleIds
          : [id],
      bubbles: state.bubbles.map((b) =>
        b.id === id ? { ...b, interactionWeight: (b.interactionWeight || 0) + 1 } : b
      ),
    }))
  },

  selectBubble: (id) => {
    get().setActiveBubble(id)
  },

  setSelectedBubbleIds: (ids) => {
    const nextIds = Array.from(new Set(ids)).filter((id) => get().bubbles.some((bubble) => bubble.id === id))
    set((state) => {
      const activeBubbleId = state.activeBubbleId && nextIds.includes(state.activeBubbleId)
        ? state.activeBubbleId
        : nextIds[0] || null
      return {
        selectedBubbleIds: nextIds,
        activeBubbleId: activeBubbleId || null,
        selectedBubbleId: activeBubbleId || null,
      }
    })
  },

  toggleSelectedBubble: (id) => {
    set((state) => {
      const selected = new Set(state.selectedBubbleIds)
      if (selected.has(id)) selected.delete(id)
      else selected.add(id)
      const selectedBubbleIds = Array.from(selected)
      const activeBubbleId = selected.has(id)
        ? id
        : state.activeBubbleId && selected.has(state.activeBubbleId)
          ? state.activeBubbleId
          : selectedBubbleIds[0] || null

      return {
        selectedBubbleIds,
        activeBubbleId,
        selectedBubbleId: activeBubbleId,
        bubbles: selected.has(id)
          ? state.bubbles.map((bubble) =>
            bubble.id === id ? { ...bubble, interactionWeight: (bubble.interactionWeight || 0) + 1 } : bubble
          )
          : state.bubbles,
      }
    })
  },

  removeSelectedBubble: (id) => {
    set((state) => {
      const selectedBubbleIds = state.selectedBubbleIds.filter((selectedId) => selectedId !== id)
      const activeBubbleId = state.activeBubbleId === id
        ? selectedBubbleIds[0] || null
        : state.activeBubbleId

      return {
        selectedBubbleIds,
        activeBubbleId,
        selectedBubbleId: activeBubbleId,
      }
    })
  },

  clearSelectedBubbles: () => set({ selectedBubbleIds: [], activeBubbleId: null, selectedBubbleId: null }),

  incrementBubbleWeight: (id) => {
    set((state) => ({
      bubbles: state.bubbles.map((b) =>
        b.id === id ? { ...b, interactionWeight: (b.interactionWeight || 0) + 1 } : b
      ),
    }))
  },

  incrementPrdUsage: (ids) => {
    const idSet = new Set(ids)
    if (idSet.size === 0) return
    set((state) => ({
      bubbles: state.bubbles.map((bubble) =>
        idSet.has(bubble.id)
          ? {
            ...bubble,
            prdUsageCount: (bubble.prdUsageCount || 0) + 1,
            interactionWeight: (bubble.interactionWeight || 0) + 4,
            updatedAt: new Date().toISOString(),
          }
          : bubble
      ),
    }))
  },

  setFilterTag: (tag) => set({ filterTag: tag }),

  setViewport: (viewport) =>
    set((state) => ({ viewport: { ...state.viewport, ...viewport } })),

  setCanvasMode: (mode) => set({ canvasMode: mode }),

  addExtension: (bubbleId, content, source) => {
    const ext: BubbleExtension = {
      id: generateId(),
      bubbleId,
      content,
      source,
      createdAt: new Date().toISOString(),
    }
    set((state) => ({ extensions: [...state.extensions, ext] }))
  },

  getExtensionsForBubble: (bubbleId) => {
    return get().extensions.filter((e) => e.bubbleId === bubbleId)
  },

  deleteExtension: (id) => {
    set((state) => ({ extensions: state.extensions.filter((e) => e.id !== id) }))
  },

  addCategory: (category) => {
    const newCategory: Category = { ...category, id: generateId() }
    set((state) => ({ categories: [...state.categories, newCategory] }))
    return newCategory
  },

  updateCategory: (id, updates) => {
    set((state) => ({
      categories: state.categories.map((c) =>
        c.id === id ? { ...c, ...updates } : c
      ),
    }))
  },

  deleteCategory: (id) => {
    set((state) => ({
      categories: state.categories.filter((c) => c.id !== id),
      bubbles: state.bubbles.map((b) =>
        b.categoryId === id ? { ...b, categoryId: '' } : b
      ),
    }))
  },

  assignBubbleToCategory: (bubbleId, categoryId) => {
    set((state) => ({
      bubbles: state.bubbles.map((b) =>
        b.id === bubbleId ? { ...b, categoryId, updatedAt: new Date().toISOString() } : b
      ),
    }))
  },

  addRelation: (relation) => {
    const newRelation: BubbleRelation = { ...relation, id: generateId() }
    set((state) => ({ relations: [...state.relations, newRelation] }))
  },

  removeRelation: (id) => {
    set((state) => ({ relations: state.relations.filter((r) => r.id !== id) }))
  },

  setRelations: (relations) => set({ relations }),

  setCategoriesFromAI: (aiCategories) => {
    const usedColors = new Set<string>()
    const newCategories: Category[] = aiCategories.map((c, index) => {
      const color = pickDistinctCategoryColor(index, usedColors, c.color)
      return {
        id: generateId(),
        name: c.name,
        description: c.description,
        color,
        confidence: c.confidence,
      }
    })

    set((state) => {
      const now = new Date().toISOString()
      const categoryByBubbleId = new Map<string, { category: Category; tag: string }>()
      aiCategories.forEach((aiCat, index) => {
        const category = newCategories[index]
        const tag = aiCat.suggestedTag?.trim() || category.name
        aiCat.bubbleIds.forEach((bubbleId) => {
          categoryByBubbleId.set(bubbleId, { category, tag })
        })
      })
      const positionByBubbleId = new Map<string, { x: number; y: number }>()
      aiCategories.forEach((aiCat, categoryIndex) => {
        const bubbleIds = aiCat.bubbleIds.filter((bubbleId) => state.bubbles.some((bubble) => bubble.id === bubbleId))
        bubbleIds.forEach((bubbleId, itemIndex) => {
          positionByBubbleId.set(
            bubbleId,
            getClusteredBubblePosition(categoryIndex, aiCategories.length, itemIndex, bubbleIds.length),
          )
        })
      })
      const unassignedBubbles = state.bubbles.filter((bubble) => !positionByBubbleId.has(bubble.id))
      unassignedBubbles.forEach((bubble, index) => {
        const column = index % 4
        const row = Math.floor(index / 4)
        positionByBubbleId.set(bubble.id, {
          x: (column - 1.5) * 220,
          y: Math.max(360, aiCategories.length * 120) + row * 130,
        })
      })

      const updatedBubbles = state.bubbles.map((bubble) => {
        const assignment = categoryByBubbleId.get(bubble.id)
        const position = positionByBubbleId.get(bubble.id)
        if (!assignment) {
          const shouldUpdate = Boolean(position || bubble.categoryId)
          return {
            ...bubble,
            ...(bubble.categoryId ? { categoryId: '' } : {}),
            ...(position || {}),
            updatedAt: shouldUpdate ? now : bubble.updatedAt,
          }
        }

        return {
          ...bubble,
          categoryId: assignment.category.id,
          tag: assignment.tag,
          color: assignment.category.color,
          ...(position || {}),
          updatedAt: now,
        }
      })

      return {
        categories: newCategories,
        bubbles: updatedBubbles,
        viewport: getCategorizedViewport(newCategories.length, updatedBubbles.length),
        filterTag: null,
      }
    })
  },

  compactCategorizedLayout: () => {
    set((state) => {
      const categoryIds = state.categories.map((category) => category.id)
      const categoryCount = Math.max(categoryIds.length, 1)
      const positionByBubbleId = new Map<string, { x: number; y: number }>()

      categoryIds.forEach((categoryId, categoryIndex) => {
        const categoryBubbles = state.bubbles.filter((bubble) => bubble.categoryId === categoryId)
        categoryBubbles.forEach((bubble, itemIndex) => {
          positionByBubbleId.set(
            bubble.id,
            getClusteredBubblePosition(categoryIndex, categoryCount, itemIndex, categoryBubbles.length),
          )
        })
      })

      const unassignedBubbles = state.bubbles.filter((bubble) => !positionByBubbleId.has(bubble.id))
      unassignedBubbles.forEach((bubble, index) => {
        const column = index % 3
        const row = Math.floor(index / 3)
        positionByBubbleId.set(bubble.id, {
          x: (column - 1) * 230,
          y: Math.ceil(categoryCount / 3) * 310 + 180 + row * 86,
        })
      })

      const now = new Date().toISOString()
      return {
        bubbles: state.bubbles.map((bubble) => ({
          ...bubble,
          ...(positionByBubbleId.get(bubble.id) || {}),
          updatedAt: now,
        })),
        viewport: getCategorizedViewport(categoryCount, state.bubbles.length),
        filterTag: null,
      }
    })
  },

  ensureDistinctCategoryColors: () => {
    set((state) => {
      const usedColors = new Set<string>()
      let changed = false
      const colorByCategoryId = new Map<string, string>()
      const categories = state.categories.map((category, index) => {
        const normalized = normalizeColor(category.color)
        const needsNewColor = !normalized || usedColors.has(normalized)
        const color = needsNewColor
          ? pickDistinctCategoryColor(index, usedColors)
          : pickDistinctCategoryColor(index, usedColors, category.color)
        colorByCategoryId.set(category.id, color)

        if (color !== category.color) {
          changed = true
          return { ...category, color }
        }

        return category
      })

      const bubbles = state.bubbles.map((bubble) => {
        const categoryColor = bubble.categoryId ? colorByCategoryId.get(bubble.categoryId) : undefined
        if (!categoryColor || bubble.color === categoryColor) return bubble
        changed = true
        return { ...bubble, color: categoryColor }
      })

      return changed ? { categories, bubbles } : state
    })
  },

  getFilteredBubbles: () => {
    const { bubbles, filterTag } = get()
    if (!filterTag) return bubbles
    return bubbles.filter((b) => b.tag === filterTag)
  },
}), {
  name: 'aethel-bubble-store',
  version: BUBBLE_STORE_VERSION,
  storage: createJSONStorage(() => localStorage),
  partialize: (state): PersistedBubbleState => ({
    bubbles: state.bubbles,
    categories: state.categories,
    relations: state.relations,
    extensions: state.extensions,
    revisions: state.revisions,
    filterTag: state.filterTag,
    viewport: state.viewport,
    canvasMode: state.canvasMode,
  }),
  migrate: (persistedState) => migrateBubbleState(persistedState),
}))
