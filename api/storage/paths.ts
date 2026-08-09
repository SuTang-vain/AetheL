import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const projectRoot = path.resolve(__dirname, '../..')
export const dataDir = process.env.AETHEL_DATA_DIR
  ? path.resolve(process.env.AETHEL_DATA_DIR)
  : path.join(projectRoot, 'data')
export const bubblesDir = path.join(dataDir, 'bubbles')
export const snapshotsDir = path.join(dataDir, 'snapshots')
export const trashDir = path.join(dataDir, '.trash')
export const workspaceFilePath = path.join(dataDir, 'workspace.json')

export interface StoragePaths {
  bubblesDir: string
  snapshotsDir: string
  trashDir: string
  workspaceFilePath: string
}

/** 未登录/遗留模式的默认路径（兼容既有测试与旧数据） */
export const legacyPaths: StoragePaths = {
  bubblesDir,
  snapshotsDir,
  trashDir,
  workspaceFilePath,
}

/** 用户数据隔离：data/users/<email>/ 下的独立工作区（用户管理系统） */
export function userDataPaths(email: string): StoragePaths {
  const root = path.join(dataDir, 'users', safeId(email).toLowerCase())
  return {
    bubblesDir: path.join(root, 'bubbles'),
    snapshotsDir: path.join(root, 'snapshots'),
    trashDir: path.join(root, '.trash'),
    workspaceFilePath: path.join(root, 'workspace.json'),
  }
}

export function safeId(id: string) {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_')
}
