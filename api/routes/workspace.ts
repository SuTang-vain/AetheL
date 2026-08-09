import { Router, type Request, type Response } from 'express'
import { readWorkspace, writeWorkspace } from '../storage/workspaceFile.js'
import { userDataPaths } from '../storage/paths.js'
import type { StoredWorkspaceState } from '../storage/types.js'

const router = Router()

router.get('/', async (req: Request, res: Response) => {
  try {
    const workspace = await readWorkspace(userDataPaths(req.user!.email))
    res.json({ success: true, workspace })
  } catch (error: unknown) {
    console.error('Workspace read error:', error)
    res.status(500).json({ success: false, error: (error as Error).message || 'Workspace read error' })
  }
})

router.patch('/', async (req: Request, res: Response) => {
  try {
    const workspace = req.body?.workspace as StoredWorkspaceState | undefined
    if (!workspace || !Array.isArray(workspace.bubbles) || !Array.isArray(workspace.snapshots)) {
      res.status(400).json({ success: false, error: 'workspace with bubbles and snapshots is required' })
      return
    }

    const nextWorkspace = await writeWorkspace(workspace, userDataPaths(req.user!.email))
    res.json({ success: true, workspace: nextWorkspace })
  } catch (error: unknown) {
    console.error('Workspace write error:', error)
    res.status(500).json({ success: false, error: (error as Error).message || 'Workspace write error' })
  }
})

export default router
