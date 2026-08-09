import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Activity,
  AlertCircle,
  Bot,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Database,
  ExternalLink,
  FileJson,
  FileText,
  Gauge,
  Info,
  Key,
  Loader2,
  Palette,
  Save,
  ServerCog,
  Settings2,
  ShieldCheck,
  Sparkles,
  TestTube2,
  type LucideIcon,
} from 'lucide-react'
import { apiFetch } from '@/lib/apiClient'
import { usePersistenceStore } from '@/stores/persistenceStore'
import { useSettingsStore, type AIProvider, type AIProviderSelection, defaultBaseUrls } from '@/stores/settingsStore'

interface ProviderMeta {
  id: AIProviderSelection
  name: string
  shortName: string
  description: string
  defaultModel: string
  accent: string
}

interface BackendConfig {
  selection?: AIProviderSelection
  provider: AIProvider
  model: string
  hasApiKey: boolean
  metrics?: AIMetric[]
}

interface AIMetric {
  id: string
  provider: AIProvider
  model: string
  profile: string
  latencyMs: number
  cacheHit: boolean
  pendingReuse: boolean
  fallbackReason?: string
  success: boolean
  createdAt: string
}

type SettingsSectionKey = 'ai' | 'storage' | 'appearance' | 'activity' | 'about'

interface StatusMessage {
  type: 'success' | 'error' | 'info'
  text: string
  actionLabel?: string
  actionTo?: string
}

const providers: ProviderMeta[] = [
  {
    id: 'babel',
    name: 'BabeL-O（本地引擎）',
    shortName: 'BabeL-O',
    description: '由 BabeL-O 网关统一管理模型与密钥，AetheL 只消费其 OpenAI 兼容端点。',
    defaultModel: '由 BabeL-O 配置决定',
    accent: '#2e7d6b',
  },
]

const settingsSections: Array<{
  id: SettingsSectionKey
  label: string
  description: string
  icon: LucideIcon
}> = [
  { id: 'ai', label: 'AI 引擎', description: '服务商、模型与连接状态', icon: ServerCog },
  { id: 'storage', label: '数据与存储', description: 'Markdown 原子与工作区文件', icon: Database },
  { id: 'appearance', label: '外观与性能', description: '动效、色彩和低性能偏好', icon: Palette },
  { id: 'activity', label: '活动记录', description: '保存、测试和运行状态', icon: Activity },
  { id: 'about', label: '关于', description: '版本、许可证与仓库信息', icon: Info },
]

const storageRows = [
  { icon: FileText, title: '气泡 Markdown 原子', path: 'data/bubbles/*.md', detail: '保存气泡内容、标签、追问补充和低频语义元数据。' },
  { icon: FileText, title: '认知快照 Markdown', path: 'data/snapshots/*.md', detail: '保存快照摘要、语义锚点、唤醒指令和关联气泡。' },
  { icon: FileJson, title: '工作区运行态', path: 'data/workspace.json', detail: '保存位置、缩放、筛选、选中集合和面板状态。' },
  { icon: Database, title: '浏览器偏好', path: 'localStorage / aethel-settings', detail: '保存 AI 密钥、模型名、外观性能偏好和最近测试记录。' },
]

function formatDateTime(value: string | null) {
  if (!value) return '尚未记录'
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function providerLabel(provider: AIProviderSelection) {
  return providers.find((item) => item.id === provider)?.shortName || provider
}

function configStateLabel(state: 'synced' | 'pending') {
  if (state === 'synced') return '已应用到后端'
  return '等待保存'
}

function SettingToggle({
  title,
  description,
  checked,
  onChange,
  badge = '偏好已保存',
}: {
  title: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
  badge?: string
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="surface-list-card flex w-full items-center justify-between gap-4 rounded-[22px] p-3 text-left transition-all"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-on-surface">{title}</span>
          <span className="rounded-full bg-white/45 px-2 py-0.5 text-[10px] font-semibold text-outline ring-1 ring-white/45">
            {checked ? '已开启' : badge}
          </span>
        </div>
        <p className="mt-1 text-[11px] leading-4 text-outline">{description}</p>
      </div>
      <span
        className={`relative h-6 w-11 shrink-0 rounded-full p-0.5 transition-all ${
          checked ? 'bg-primary text-on-primary' : 'bg-white/48 text-outline ring-1 ring-white/60'
        }`}
      >
        <span className={`block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-5' : ''}`} />
      </span>
    </button>
  )
}

export default function Settings() {
  const [searchParams, setSearchParams] = useSearchParams()
  const persistence = usePersistenceStore()
  const {
    aiProvider,
    currentModel,
    lastTestedAt,
    lowPerformanceMode,
    reduceMotion,
    reduceColorLayer,
    setAiProvider,
    setCurrentModel,
    markTested,
    setLowPerformanceMode,
    setReduceMotion,
    setReduceColorLayer,
  } = useSettingsStore()

  const [backendConfig, setBackendConfig] = useState<BackendConfig | null>(null)
  const [isLoadingConfig, setIsLoadingConfig] = useState(true)
  const [isTesting, setIsTesting] = useState(false)
  const [statusMessage, setStatusMessage] = useState<StatusMessage | null>(null)
  // BabeL-O 模型选择器（M2）
  const [babelModels, setBabelModels] = useState<Array<{
    id: string
    displayName: string
    authConfigured: boolean
    active: boolean
    defaultModel: string
    models: Array<{ id: string; name: string; contextWindow?: number }>
  }>>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [selectingModel, setSelectingModel] = useState<string | null>(null)

  const sectionParam = searchParams.get('section') as SettingsSectionKey | null
  const activeSection = settingsSections.some((section) => section.id === sectionParam) ? sectionParam! : 'ai'
  const activeSectionMeta = settingsSections.find((section) => section.id === activeSection) || settingsSections[0]

  const activeProvider = providers.find((provider) => provider.id === aiProvider) || providers[0]
  // BabeL-O 是唯一引擎：无服务商切换、无密钥/模型表单
  const configState = backendConfig?.hasApiKey ? 'synced' : 'pending'

  // BabeL-O 模型选择器：读 /api/ai/models（代理 /v1/runtime/models），写 /api/ai/models/select
  const loadBabelModels = useCallback(async () => {
    setModelsLoading(true)
    try {
      const response = await apiFetch('/api/ai/models')
      const data = await response.json()
      if (response.ok && data.success) {
        setBabelModels(data.providers || [])
      }
    } catch {
      // 网络错误保持空列表，UI 显示未获取到模型列表
    } finally {
      setModelsLoading(false)
    }
  }, [])

  const selectBabelModel = async (modelId: string) => {
    setSelectingModel(modelId)
    try {
      const response = await apiFetch('/api/ai/models/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelId }),
      })
      const data = await response.json()
      if (response.ok && data.success) {
        setStatusMessage({ type: 'success', text: `已切换到 ${modelId}` })
        void loadBabelModels()
      } else {
        setStatusMessage({ type: 'error', text: data.error || '模型切换失败' })
      }
    } catch {
      setStatusMessage({ type: 'error', text: '模型切换失败（BabeL-O 不可达）' })
    } finally {
      setSelectingModel(null)
    }
  }

  useEffect(() => {
    void loadBabelModels()
  }, [loadBabelModels])

  const activityRows = useMemo(() => {
    const persistenceLabel = persistence.status === 'error'
      ? persistence.error || '文件层保存失败'
      : persistence.status === 'saving'
        ? '正在保存 workspace 与 Markdown 原子'
        : persistence.status === 'loading'
          ? '正在读取本地文件层'
          : persistence.lastSavedAt
            ? '工作区文件层最近一次保存成功'
            : '等待工作区文件层首次保存'

    return [
      {
        id: 'runtime',
        icon: ServerCog,
        title: '后端 AI 运行态',
        detail: backendConfig
          ? `${providerLabel(backendConfig.provider)} / ${backendConfig.model} / ${backendConfig.hasApiKey ? '已配置' : '未配置'}`
          : isLoadingConfig
            ? '正在读取后端配置'
            : '尚未读取到后端配置',
        time: isLoadingConfig ? '读取中' : '当前',
      },
      {
        id: 'ai-save',
        icon: Save,
        title: 'AI 引擎配置',
        detail: '由 BabeL-O 管理（BABEL_NEXUS_URL）',
        time: '—',
      },
      {
        id: 'ai-test',
        icon: TestTube2,
        title: 'AI 连接测试',
        detail: lastTestedAt ? `${providerLabel(aiProvider)} 最近一次连接测试通过` : '尚未测试当前连接',
        time: formatDateTime(lastTestedAt),
      },
      {
        id: 'workspace',
        icon: Database,
        title: '工作区文件层',
        detail: persistenceLabel,
        time: formatDateTime(persistence.lastSavedAt),
      },
      ...(backendConfig?.metrics?.slice(0, 4).map((metric) => ({
        id: metric.id,
        icon: Gauge,
        title: `AI 调用 · ${metric.profile}`,
        detail: `${providerLabel(metric.provider)} / ${metric.model} / ${metric.latencyMs}ms${metric.cacheHit ? ' / cache' : ''}${metric.pendingReuse ? ' / pending reuse' : ''}${metric.fallbackReason ? ` / fallback: ${metric.fallbackReason}` : ''}`,
        time: formatDateTime(metric.createdAt),
      })) || []),
    ]
  }, [aiProvider, backendConfig, isLoadingConfig, lastTestedAt, persistence.error, persistence.lastSavedAt, persistence.status])

  const setSection = (section: SettingsSectionKey) => {
    setSearchParams({ section })
  }

  useEffect(() => {
    let cancelled = false

    const loadBackendConfig = async () => {
      setIsLoadingConfig(true)
      try {
        const response = await apiFetch('/api/ai/config')
        const data = await response.json()
        if (cancelled) return

        if (data.success && data.provider && data.model) {
          const nextProvider = data.provider as AIProvider
          setBackendConfig({
            selection: 'babel',
            provider: nextProvider,
            model: String(data.model),
            hasApiKey: Boolean(data.hasApiKey),
            metrics: Array.isArray(data.metrics) ? data.metrics : [],
          })
          setAiProvider('babel')
          setCurrentModel(String(data.model))
        } else {
          setStatusMessage({
            type: 'error',
            text: '没有读取到后端 AI 配置。',
            actionLabel: '前往 AI 引擎',
            actionTo: '/settings?section=ai',
          })
        }
      } catch {
        if (!cancelled) {
          setStatusMessage({
            type: 'error',
            text: '读取后端 AI 配置失败，请确认 API 服务正在运行。',
            actionLabel: '前往 AI 引擎',
            actionTo: '/settings?section=ai',
          })
        }
      } finally {
        if (!cancelled) setIsLoadingConfig(false)
      }
    }

    loadBackendConfig()

    return () => {
      cancelled = true
    }
    // 只在页面进入时同步后端运行态，避免用户编辑中被覆盖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const testConnection = async () => {
    setIsTesting(true)
    setStatusMessage(null)

    try {
      const response = await apiFetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: '请只回复：连接成功' }],
          stream: false,
        }),
      })
      const data = await response.json()

      if (!response.ok || !data.success) {
        throw new Error(data.error || '连接测试失败')
      }

      markTested()
      setStatusMessage({ type: 'success', text: `${providerLabel(aiProvider)} 连接测试通过。` })
    } catch (error) {
      setStatusMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '连接测试失败。',
        actionLabel: '前往设置中心 / AI 引擎',
        actionTo: '/settings?section=ai',
      })
    } finally {
      setIsTesting(false)
    }
  }

  const renderAiEngine = () => (
    <div className="grid gap-4 xl:grid-cols-[270px_minmax(0,1fr)]">
      <div className="space-y-4">
        <section className="surface-list-card rounded-[24px] p-4">
          <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-on-surface">
            <Sparkles size={15} className="text-primary" />
            当前运行态
          </div>

          <div className="space-y-2 text-[12px]">
            <div className="flex items-center justify-between gap-3 rounded-[16px] bg-white/36 px-3 py-2 ring-1 ring-white/50">
              <span className="text-outline">服务商</span>
              <span className="font-semibold text-on-surface">
                {isLoadingConfig ? '读取中...' : backendConfig ? providerLabel(backendConfig.provider) : '未知'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-[16px] bg-white/36 px-3 py-2 ring-1 ring-white/50">
              <span className="text-outline">模型</span>
              <span className="max-w-[150px] truncate font-semibold text-on-surface" title={backendConfig?.model}>
                {isLoadingConfig ? '读取中...' : backendConfig?.model || '未知'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-[16px] bg-white/36 px-3 py-2 ring-1 ring-white/50">
              <span className="text-outline">密钥状态</span>
              <span className={`font-semibold ${backendConfig?.hasApiKey ? 'text-secondary' : 'text-error'}`}>
                {backendConfig?.hasApiKey ? '已配置' : '未配置'}
              </span>
            </div>
          </div>
        </section>

        <section className="surface-list-card rounded-[24px] p-4">
          <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-on-surface">
            <ShieldCheck size={15} className="text-secondary" />
            引擎配置
          </div>
          <p className="text-[12px] leading-5 text-on-surface-variant">
            BabeL-O 是唯一 AI 引擎：服务地址（BABEL_NEXUS_URL）与密钥在服务端 .env 配置，
            模型与密钥由 BabeL-O 统一管理；AetheL 不保存任何 AI 密钥。
          </p>
          <div className="mt-3 rounded-[16px] bg-white/30 px-3 py-2 text-[11px] leading-4 text-outline ring-1 ring-white/45">
            <div>最近测试：{formatDateTime(lastTestedAt)}</div>
          </div>
        </section>
      </div>

      <div className="space-y-4">
        <section className="surface-list-card rounded-[24px] p-4">
          <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-on-surface">
            <Bot size={15} className="text-primary" />
            选择 AI 调用模式
          </div>
          <div className="grid gap-2 md:grid-cols-4">
            {providers.map((provider) => {
              const active = aiProvider === provider.id
              return (
                <button
                  key={provider.id}
                  onClick={() => {
                    setAiProvider(provider.id)
                    setStatusMessage(null)
                  }}
                  className={`selectable-bubble-card rounded-[20px] p-3 text-left transition-all ${active ? 'is-selected text-on-surface' : 'text-on-surface-variant'}`}
                  style={{
                    '--bubble-border': `${provider.accent}32`,
                    '--bubble-border-strong': `${provider.accent}52`,
                    '--bubble-border-selected': `${provider.accent}86`,
                    '--bubble-focus': `${provider.accent}12`,
                    '--bubble-tint': `${provider.accent}0a`,
                    '--bubble-tint-selected': `${provider.accent}18`,
                  } as CSSProperties}
                >
                  <div className="mb-1 flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: provider.accent }} />
                    <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">{provider.name}</span>
                    {active && <CheckCircle2 size={14} style={{ color: provider.accent }} />}
                  </div>
                  <p className="line-clamp-2 text-[11px] leading-4">{provider.description}</p>
                </button>
              )
            })}
          </div>
        </section>

        <section className="surface-list-card rounded-[24px] p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-on-surface">
              <Key size={15} className="text-primary" />
              {activeProvider.name} 配置
            </div>
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
              configState === 'synced'
                ? 'bg-secondary-container/50 text-secondary'
                : 'bg-white/42 text-outline'
            }`}>
              {configStateLabel(configState)}
            </span>
          </div>

          <div className="rounded-[18px] bg-white/34 px-3 py-3 text-[12px] leading-5 text-on-surface-variant ring-1 ring-white/50">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-semibold text-on-surface">模型选择（由 BabeL-O 管理）</span>
              {modelsLoading && <span className="text-[11px] text-outline">加载中…</span>}
            </div>
            {!modelsLoading && babelModels.length === 0 && (
              <p>未获取到模型列表（BABEL_NEXUS_URL 未配置或 BabeL-O 未启动）。</p>
            )}
            {babelModels
              .filter((provider) => provider.authConfigured)
              .map((provider) => (
                <div key={provider.id} className="mb-2 last:mb-0">
                  <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-outline">
                    <span>{provider.displayName}</span>
                    {provider.active && <span className="text-primary">· 当前</span>}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {provider.models.map((model) => {
                      const isCurrent = provider.active && model.id === provider.defaultModel
                      return (
                        <button
                          key={model.id}
                          type="button"
                          disabled={selectingModel !== null}
                          onClick={() => selectBabelModel(model.id)}
                          className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-all ${
                            isCurrent
                              ? 'bg-primary-fixed/60 text-on-surface ring-1 ring-primary/40'
                              : 'bg-white/40 ring-1 ring-white/50 hover:bg-primary-fixed/35'
                          } ${selectingModel === model.id ? 'opacity-60' : ''}`}
                          title={model.contextWindow ? `context: ${model.contextWindow}` : undefined}
                        >
                          {model.name}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
          </div>

          <details className="mt-3 rounded-[18px] bg-white/32 px-3 py-2 text-[12px] text-on-surface-variant ring-1 ring-white/45">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-[12px] font-semibold text-on-surface">
              <ChevronDown size={13} className="text-outline" />
              高级信息
            </summary>
            <div className="mt-2 grid gap-2 text-[11px] leading-4 md:grid-cols-2">
              <div>
                <div className="text-outline">Base URL</div>
                <div className="truncate font-mono text-on-surface" title={defaultBaseUrls.babel}>
                  {defaultBaseUrls.babel}
                </div>
              </div>
              <div>
                <div className="text-outline">推荐模型</div>
                <div className="font-mono text-on-surface">{activeProvider.defaultModel}</div>
              </div>
            </div>
          </details>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={testConnection}
              disabled={isTesting || !backendConfig?.hasApiKey}
              className="btn-glass flex h-10 items-center justify-center gap-2 !px-5 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {isTesting ? <Loader2 size={14} className="animate-spin" /> : <TestTube2 size={14} />}
              测试当前连接
            </button>
          </div>

          {statusMessage && (
            <div
              className={`mt-4 flex flex-wrap items-center gap-2 rounded-[18px] px-3 py-2 text-[12px] leading-5 ring-1 ${
                statusMessage.type === 'success'
                  ? 'bg-secondary-container/42 text-secondary ring-secondary/15'
                  : statusMessage.type === 'error'
                    ? 'bg-error-container/58 text-on-error-container ring-error/15'
                    : 'bg-white/44 text-on-surface-variant ring-white/55'
              }`}
            >
              {statusMessage.type === 'success' ? <CheckCircle2 size={14} className="shrink-0" /> : <AlertCircle size={14} className="shrink-0" />}
              <span className="min-w-0 flex-1">{statusMessage.text}</span>
              {statusMessage.actionTo && statusMessage.actionLabel && (
                <Link
                  to={statusMessage.actionTo}
                  className="rounded-full bg-white/55 px-2.5 py-1 text-[11px] font-semibold text-on-surface transition-colors hover:bg-white/80"
                >
                  {statusMessage.actionLabel}
                </Link>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  )

  const renderStorage = () => (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(260px,0.9fr)]">
      <section className="surface-list-card rounded-[24px] p-4">
        <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-on-surface">
          <Database size={15} className="text-primary" />
          本地数据层
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          {storageRows.map(({ icon: Icon, title, path, detail }) => (
            <div key={title} className="rounded-[18px] bg-white/34 p-3 ring-1 ring-white/45">
              <div className="mb-1 flex items-center gap-2 text-[12px] font-semibold text-on-surface">
                <Icon size={14} className="text-primary" />
                {title}
              </div>
              <div className="mb-1 truncate font-mono text-[11px] text-on-surface" title={path}>{path}</div>
              <p className="text-[11px] leading-4 text-outline">{detail}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="surface-list-card rounded-[24px] p-4">
        <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-on-surface">
          <ShieldCheck size={15} className="text-secondary" />
          数据策略
        </div>
        <div className="space-y-2 text-[12px] leading-5 text-on-surface-variant">
          <p>气泡内容进入 Markdown 原子，画布坐标和视口等高频状态进入 workspace JSON。</p>
          <p>当前更改先进入前端 Zustand，再通过防抖同步到文件层；写入失败时仍保留浏览器缓存。</p>
          <p className="rounded-[16px] bg-white/32 px-3 py-2 text-[11px] text-outline ring-1 ring-white/45">
            后续导入 / 导出会放在这里，而不是挤进主工作区工具栏。
          </p>
        </div>
      </section>
    </div>
  )

  const renderAppearance = () => (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
      <section className="space-y-2">
        <SettingToggle
          title="低性能模式"
          description="保存偏好：后续用于关闭大面积 blur、常驻彩色层和非关键动画。"
          checked={lowPerformanceMode}
          onChange={setLowPerformanceMode}
        />
        <SettingToggle
          title="减少动效"
          description="保存偏好：后续用于降低页面切换、气泡反馈和装饰动画强度。"
          checked={reduceMotion}
          onChange={setReduceMotion}
        />
        <SettingToggle
          title="降低彩色渲染"
          description="保存偏好：后续用于进一步压低窗口色彩图层，让内容区更安静。"
          checked={reduceColorLayer}
          onChange={setReduceColorLayer}
        />
      </section>

      <section className="surface-list-card rounded-[24px] p-4">
        <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-on-surface">
          <Gauge size={15} className="text-primary" />
          当前偏好
        </div>
        <div className="space-y-2 text-[12px]">
          <div className="flex justify-between rounded-[16px] bg-white/34 px-3 py-2 ring-1 ring-white/45">
            <span className="text-outline">性能模式</span>
            <span className="font-semibold text-on-surface">{lowPerformanceMode ? '低性能优先' : '视觉完整'}</span>
          </div>
          <div className="flex justify-between rounded-[16px] bg-white/34 px-3 py-2 ring-1 ring-white/45">
            <span className="text-outline">动效</span>
            <span className="font-semibold text-on-surface">{reduceMotion ? '减少' : '标准'}</span>
          </div>
          <div className="flex justify-between rounded-[16px] bg-white/34 px-3 py-2 ring-1 ring-white/45">
            <span className="text-outline">色彩层</span>
            <span className="font-semibold text-on-surface">{reduceColorLayer ? '更弱' : '标准'}</span>
          </div>
        </div>
      </section>
    </div>
  )

  const renderActivity = () => (
    <section className="surface-list-card rounded-[24px] p-4">
      <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-on-surface">
        <Activity size={15} className="text-primary" />
        最近系统事件
      </div>
      <div className="space-y-2">
        {activityRows.map(({ id, icon: Icon, title, detail, time }) => (
          <div key={id} className="flex items-center gap-3 rounded-[18px] bg-white/34 px-3 py-2.5 ring-1 ring-white/45">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/50 text-primary ring-1 ring-white/60">
              <Icon size={14} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-semibold text-on-surface">{title}</div>
              <div className="truncate text-[11px] text-outline" title={detail}>{detail}</div>
            </div>
            <span className="shrink-0 text-[11px] font-semibold text-outline">{time}</span>
          </div>
        ))}
      </div>
    </section>
  )

  const renderAbout = () => (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
      <section className="surface-list-card rounded-[24px] p-4">
        <div className="mb-3 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-white/60 ring-1 ring-white/70">
            <img src="/aethel-logo-icon.png" alt="AetheL logo" className="h-[88%] w-[88%] object-contain" />
          </div>
          <div>
            <div className="text-[16px] font-semibold text-on-surface">AetheL</div>
            <div className="text-[12px] text-outline">面向产品思考的 AI 认知工作区</div>
          </div>
        </div>
        <p className="text-[12px] leading-5 text-on-surface-variant">
          当前主链路是：想法 / 文档到气泡，再到追问与快照、分束 PRD 和导出。设置中心负责承载系统配置和辅助入口，不替代主工作区。
        </p>
      </section>

      <section className="surface-list-card rounded-[24px] p-4">
        <div className="mb-3 text-[13px] font-semibold text-on-surface">项目信息</div>
        <div className="space-y-2 text-[12px]">
          <div className="flex justify-between rounded-[16px] bg-white/34 px-3 py-2 ring-1 ring-white/45">
            <span className="text-outline">版本</span>
            <span className="font-semibold text-on-surface">0.0.0</span>
          </div>
          <div className="flex justify-between rounded-[16px] bg-white/34 px-3 py-2 ring-1 ring-white/45">
            <span className="text-outline">许可证</span>
            <span className="font-semibold text-on-surface">MIT</span>
          </div>
          <a
            href="https://github.com/SuTang-vain/AetheL"
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between rounded-[16px] bg-white/34 px-3 py-2 text-on-surface ring-1 ring-white/45 transition-colors hover:bg-white/50"
          >
            <span className="text-outline">仓库</span>
            <ExternalLink size={14} />
          </a>
        </div>
      </section>
    </div>
  )

  const renderActiveSection = () => {
    if (activeSection === 'storage') return renderStorage()
    if (activeSection === 'appearance') return renderAppearance()
    if (activeSection === 'activity') return renderActivity()
    if (activeSection === 'about') return renderAbout()
    return renderAiEngine()
  }

  return (
    <div className="h-screen bg-background dot-grid-bg relative overflow-hidden">
      <div className="relative z-10 h-full">
        <section className="absolute left-6 right-6 top-20 bottom-6 floating-window liquid-vessel rounded-[32px] p-5 overflow-hidden flex flex-col">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/48 text-primary ring-1 ring-white/60">
                <Settings2 size={19} />
              </div>
              <div>
                <h1 className="text-[18px] font-semibold text-on-surface">设置中心</h1>
                <p className="text-[12px] text-outline">AI 引擎、数据层、外观性能和系统信息</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="rounded-full bg-white/38 px-3 py-1.5 font-semibold text-on-surface ring-1 ring-white/50">
                {providerLabel(aiProvider)} / {currentModel || '未选择模型'}
              </span>
              <span className={`rounded-full px-3 py-1.5 font-semibold ring-1 ${
                configState === 'synced'
                  ? 'bg-secondary-container/45 text-secondary ring-secondary/15'
                  : 'bg-white/38 text-outline ring-white/50'
              }`}>
                {configStateLabel(configState)}
              </span>
            </div>
          </div>

          <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[248px_minmax(0,1fr)]">
            <aside className="surface-list-card flex min-h-0 flex-col overflow-hidden rounded-[28px] p-3">
              <nav className="space-y-1 overflow-y-auto pr-1">
                {settingsSections.map(({ id, label, description, icon: Icon }) => {
                  const active = activeSection === id
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setSection(id)}
                      className={`flex w-full items-center gap-3 rounded-[20px] px-3 py-2.5 text-left transition-all ${
                        active
                          ? 'bg-primary text-on-primary shadow-glow-primary'
                          : 'text-on-surface-variant hover:bg-primary-fixed/32 hover:text-primary'
                      }`}
                    >
                      <Icon size={15} className="shrink-0" />
                      <span className="min-w-0">
                        <span className="block text-[12px] font-semibold">{label}</span>
                        <span className={`block truncate text-[10px] ${active ? 'text-on-primary/75' : 'text-outline'}`}>{description}</span>
                      </span>
                    </button>
                  )
                })}
              </nav>

              <div className="mt-auto rounded-[22px] bg-white/34 p-3 text-[11px] leading-4 text-outline ring-1 ring-white/45">
                <div className="mb-1 flex items-center gap-1.5 font-semibold text-on-surface">
                  <Clock3 size={13} className="text-primary" />
                  系统状态
                </div>
                <div>{persistence.status === 'error' ? persistence.error || '文件层异常' : persistence.status === 'saving' ? '正在保存工作区' : '文件层就绪'}</div>
                <div className="mt-1">最近保存：{formatDateTime(persistence.lastSavedAt)}</div>
              </div>
            </aside>

            <main className="min-h-0 overflow-hidden">
              <div className="edge-fade-scroll h-full overflow-y-auto pr-1 pb-10">
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/44 text-primary ring-1 ring-white/55">
                    <activeSectionMeta.icon size={17} />
                  </div>
                  <div>
                    <div className="text-[15px] font-semibold text-on-surface">{activeSectionMeta.label}</div>
                    <div className="text-[12px] text-outline">{activeSectionMeta.description}</div>
                  </div>
                </div>

                {renderActiveSection()}
              </div>
            </main>
          </div>
        </section>
      </div>
    </div>
  )
}
