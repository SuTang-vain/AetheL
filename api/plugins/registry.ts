import { mkdir, readFile, readdir } from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { dataDir, safeId } from '../storage/paths.js'
import { atomicWriteFile } from '../storage/atomicWrite.js'

/**
 * AetheL 插件注册表。
 * - 插件清单（manifest）随仓库分发，位于 api/plugins/*.manifest.json；
 * - 安装状态（installed/enabled/config）落盘到 data/plugins/<id>.json（AETHEL_DATA_DIR 感知）；
 * - LinkMind 代理的配置解析顺序：插件配置（已安装且启用）→ env 回退（开发/测试）→ 未配置。
 */

export interface PluginManifest {
  id: string
  name: string
  version: string
  description: string
  author: string
  entrypoints?: {
    skill?: string
  }
}

export interface PluginConfig {
  baseUrl?: string
  pollIntervalMs?: number
  pollTimeoutMs?: number
  envPath?: string
}

export interface PluginState {
  id: string
  installed: boolean
  enabled: boolean
  config: PluginConfig
  installedAt?: string
  updatedAt: string
}

export interface LinkMindEffectiveConfig {
  baseUrl: string
  source: 'plugin' | 'env'
  pollIntervalMs: number
  pollTimeoutMs: number
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const pluginsDir = path.join(dataDir, 'plugins')

let manifestsCache: PluginManifest[] | null = null

export async function loadManifests(): Promise<PluginManifest[]> {
  if (manifestsCache) return manifestsCache
  const manifestFiles = (await readdir(__dirname)).filter((name) => name.endsWith('.manifest.json'))
  manifestsCache = await Promise.all(manifestFiles.map(async (name) => {
    const raw = await readFile(path.join(__dirname, name), 'utf8')
    return JSON.parse(raw) as PluginManifest
  }))
  return manifestsCache
}

function pluginStatePath(id: string) {
  return path.join(pluginsDir, `${safeId(id)}.json`)
}

export async function readPluginState(id: string): Promise<PluginState | null> {
  try {
    const raw = await readFile(pluginStatePath(id), 'utf8')
    return JSON.parse(raw) as PluginState
  } catch {
    return null
  }
}

export async function writePluginState(state: PluginState) {
  await mkdir(pluginsDir, { recursive: true })
  await atomicWriteFile(pluginStatePath(state.id), JSON.stringify(state, null, 2))
}

export async function listPluginStates(): Promise<PluginState[]> {
  try {
    const files = await readdir(pluginsDir)
    const states = await Promise.all(
      files
        .filter((name) => name.endsWith('.json'))
        .map(async (name) => readPluginState(name.replace(/\.json$/, ''))),
    )
    return states.filter((state): state is PluginState => state !== null)
  } catch {
    return []
  }
}

function envPollInterval() {
  return Number(process.env.LINKMIND_IMPORT_POLL_INTERVAL_MS || 2_000)
}

function envPollTimeout() {
  return Number(process.env.LINKMIND_IMPORT_POLL_TIMEOUT_MS || 120_000)
}

/** 解析 LinkMind 服务有效配置：插件（已安装且启用）优先，env 回退，均无则未配置。 */
export async function getEffectiveLinkMindConfig(): Promise<LinkMindEffectiveConfig | null> {
  const state = await readPluginState('linkmind')
  const pluginBaseUrl = state?.installed && state.enabled ? state.config.baseUrl?.trim() : ''
  if (pluginBaseUrl) {
    return {
      baseUrl: pluginBaseUrl,
      source: 'plugin',
      pollIntervalMs: state.config.pollIntervalMs ?? envPollInterval(),
      pollTimeoutMs: state.config.pollTimeoutMs ?? envPollTimeout(),
    }
  }

  const envBaseUrl = process.env.LINKMIND_BASE_URL?.trim() || ''
  if (envBaseUrl) {
    return {
      baseUrl: envBaseUrl,
      source: 'env',
      pollIntervalMs: envPollInterval(),
      pollTimeoutMs: envPollTimeout(),
    }
  }

  return null
}
