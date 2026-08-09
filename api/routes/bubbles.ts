import { Router, type Request, type Response } from 'express'
import { moveBubbleToTrash, writeBubble } from '../storage/bubbleFiles.js'
import { readWorkspace, writeWorkspace } from '../storage/workspaceFile.js'
import { userDataPaths } from '../storage/paths.js'
import { incrementUsage } from '../db/usersDb.js'
import type { StoredBubble } from '../storage/types.js'

const router = Router()

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 11)
}

router.get('/', async (req: Request, res: Response) => {
  try {
    const workspace = await readWorkspace(userDataPaths(req.user!.email))
    res.json({ success: true, bubbles: workspace.bubbles })
  } catch (error: unknown) {
    console.error('Bubble list error:', error)
    res.status(500).json({ success: false, error: (error as Error).message || 'Bubble list error' })
  }
})

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const workspace = await readWorkspace(userDataPaths(req.user!.email))
    const bubble = workspace.bubbles.find((item) => item.id === req.params.id)
    if (!bubble) {
      res.status(404).json({ success: false, error: 'Bubble not found' })
      return
    }
    res.json({ success: true, bubble })
  } catch (error: unknown) {
    console.error('Bubble read error:', error)
    res.status(500).json({ success: false, error: (error as Error).message || 'Bubble read error' })
  }
})

router.post('/', async (req: Request, res: Response) => {
  try {
    const now = new Date().toISOString()
    const bubble: StoredBubble = {
      id: req.body?.id || generateId(),
      content: String(req.body?.content || '').trim(),
      tag: req.body?.tag || '',
      color: req.body?.color || '#94a3b8',
      categoryId: req.body?.categoryId || '',
      x: Number(req.body?.x || 0),
      y: Number(req.body?.y || 0),
      interactionWeight: Number(req.body?.interactionWeight || 0),
      sourceSkillId: req.body?.sourceSkillId ? String(req.body.sourceSkillId).trim() : undefined,
      sourceGroupId: req.body?.sourceGroupId ? String(req.body.sourceGroupId).trim() : undefined,
      sourceLabel: req.body?.sourceLabel ? String(req.body.sourceLabel).trim() : undefined,
      sourceFileName: req.body?.sourceFileName ? String(req.body.sourceFileName).trim() : undefined,
      createdAt: req.body?.createdAt || now,
      updatedAt: req.body?.updatedAt || now,
    }

    if (!bubble.content) {
      res.status(400).json({ success: false, error: 'content is required' })
      return
    }

    const workspace = await readWorkspace(userDataPaths(req.user!.email))
    const nextWorkspace = await writeWorkspace({
      ...workspace,
      bubbles: [...workspace.bubbles.filter((item) => item.id !== bubble.id), bubble],
    }, userDataPaths(req.user!.email))
    incrementUsage(req.user!.email, 'bubbles')

    res.status(201).json({ success: true, bubble, workspace: nextWorkspace })
  } catch (error: unknown) {
    console.error('Bubble create error:', error)
    res.status(500).json({ success: false, error: (error as Error).message || 'Bubble create error' })
  }
})

router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const workspace = await readWorkspace(userDataPaths(req.user!.email))
    const bubble = workspace.bubbles.find((item) => item.id === req.params.id)
    if (!bubble) {
      res.status(404).json({ success: false, error: 'Bubble not found' })
      return
    }

    const updatedBubble: StoredBubble = {
      ...bubble,
      ...req.body,
      id: bubble.id,
      updatedAt: new Date().toISOString(),
    }

    await writeBubble(updatedBubble, workspace.extensions.filter((extension) => extension.bubbleId === bubble.id), userDataPaths(req.user!.email))
    const nextWorkspace = await writeWorkspace({
      ...workspace,
      bubbles: workspace.bubbles.map((item) => item.id === bubble.id ? updatedBubble : item),
    }, userDataPaths(req.user!.email))

    res.json({ success: true, bubble: updatedBubble, workspace: nextWorkspace })
  } catch (error: unknown) {
    console.error('Bubble update error:', error)
    res.status(500).json({ success: false, error: (error as Error).message || 'Bubble update error' })
  }
})

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const workspace = await readWorkspace(userDataPaths(req.user!.email))
    await moveBubbleToTrash(req.params.id, userDataPaths(req.user!.email))
    const nextWorkspace = await writeWorkspace({
      ...workspace,
      bubbles: workspace.bubbles.filter((bubble) => bubble.id !== req.params.id),
      relations: workspace.relations.filter((relation) => relation.sourceId !== req.params.id && relation.targetId !== req.params.id),
      extensions: workspace.extensions.filter((extension) => extension.bubbleId !== req.params.id),
    }, userDataPaths(req.user!.email))

    res.json({ success: true, workspace: nextWorkspace })
  } catch (error: unknown) {
    console.error('Bubble delete error:', error)
    res.status(500).json({ success: false, error: (error as Error).message || 'Bubble delete error' })
  }
})

export default router
