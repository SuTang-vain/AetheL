import { Router, type Request, type Response } from 'express'
import {
  loadManifests,
  readPluginState,
  writePluginState,
  type PluginState,
} from '../plugins/registry.js'

const router = Router()

router.get('/', async (_req: Request, res: Response) => {
  try {
    const manifests = await loadManifests()
    const states = await Promise.all(
      manifests.map(async (manifest) => (await readPluginState(manifest.id)) || null),
    )
    res.json({
      success: true,
      plugins: manifests.map((manifest, index) => ({
        manifest,
        state: states[index],
      })),
    })
  } catch (error: unknown) {
    console.error('Plugin list error:', error)
    res.status(500).json({ success: false, error: (error as Error).message || 'Plugin list error' })
  }
})

router.post('/:id/install', async (req: Request, res: Response) => {
  try {
    const manifest = (await loadManifests()).find((item) => item.id === req.params.id)
    if (!manifest) {
      res.status(404).json({ success: false, error: 'Plugin not found' })
      return
    }
    const now = new Date().toISOString()
    const existing = await readPluginState(manifest.id)
    const state: PluginState = existing
      ? { ...existing, installed: true, updatedAt: now }
      : {
        id: manifest.id,
        installed: true,
        enabled: true,
        config: {},
        installedAt: now,
        updatedAt: now,
      }
    await writePluginState(state)
    res.json({ success: true, plugin: { manifest, state } })
  } catch (error: unknown) {
    console.error('Plugin install error:', error)
    res.status(500).json({ success: false, error: (error as Error).message || 'Plugin install error' })
  }
})

router.post('/:id/uninstall', async (req: Request, res: Response) => {
  try {
    const state = await readPluginState(req.params.id)
    if (!state) {
      res.status(404).json({ success: false, error: 'Plugin not installed' })
      return
    }
    // 只标记未安装并停用，保留配置（重新安装可恢复）
    const next: PluginState = {
      ...state,
      installed: false,
      enabled: false,
      updatedAt: new Date().toISOString(),
    }
    await writePluginState(next)
    res.json({ success: true, plugin: { state: next } })
  } catch (error: unknown) {
    console.error('Plugin uninstall error:', error)
    res.status(500).json({ success: false, error: (error as Error).message || 'Plugin uninstall error' })
  }
})

router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const manifest = (await loadManifests()).find((item) => item.id === req.params.id)
    if (!manifest) {
      res.status(404).json({ success: false, error: 'Plugin not found' })
      return
    }
    const existing = (await readPluginState(manifest.id)) || {
      id: manifest.id,
      installed: false,
      enabled: false,
      config: {},
      updatedAt: new Date().toISOString(),
    }

    const rawConfig = req.body?.config
    const nextConfig = {
      ...existing.config,
      ...(rawConfig && typeof rawConfig === 'object'
        ? {
          baseUrl: typeof rawConfig.baseUrl === 'string' && rawConfig.baseUrl.trim()
            ? rawConfig.baseUrl.trim()
            : undefined,
          pollIntervalMs: typeof rawConfig.pollIntervalMs === 'number' && rawConfig.pollIntervalMs > 0
            ? Math.round(rawConfig.pollIntervalMs)
            : undefined,
          pollTimeoutMs: typeof rawConfig.pollTimeoutMs === 'number' && rawConfig.pollTimeoutMs > 0
            ? Math.round(rawConfig.pollTimeoutMs)
            : undefined,
          envPath: typeof rawConfig.envPath === 'string' && rawConfig.envPath.trim()
            ? rawConfig.envPath.trim()
            : undefined,
        }
        : {}),
    }

    const next: PluginState = {
      ...existing,
      enabled: typeof req.body?.enabled === 'boolean' ? req.body.enabled : existing.enabled,
      config: nextConfig,
      updatedAt: new Date().toISOString(),
    }
    await writePluginState(next)
    res.json({ success: true, plugin: { manifest, state: next } })
  } catch (error: unknown) {
    console.error('Plugin update error:', error)
    res.status(500).json({ success: false, error: (error as Error).message || 'Plugin update error' })
  }
})

export default router
