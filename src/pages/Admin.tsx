import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, Loader2, ShieldCheck, Users, Database, Gauge } from 'lucide-react'
import { apiFetch } from '@/lib/apiClient'
import { useAuthStore } from '@/stores/authStore'

// 管理员控制台：用户列表与订阅配置 / 全量结构体记录 / 用量统计。

interface AdminUser {
  email: string
  role: 'user' | 'admin'
  subscription: 'free' | 'pro' | 'team'
  createdAt: string
  usage: Record<string, number>
}

interface AdminRecord {
  email: string
  bubbles: Array<{ id: string; content: string; tag: string; categoryId: string; interactionWeight: number; createdAt: string }>
  snapshots: Array<{ id: string; name: string; createdAt: string; statusSnapshot: string; semanticAnchors: string[] }>
}

type SectionKey = 'users' | 'records' | 'usage'

const SUBSCRIPTIONS: Array<{ id: 'free' | 'pro' | 'team'; label: string }> = [
  { id: 'free', label: '免费版' },
  { id: 'pro', label: 'Pro 个人版' },
  { id: 'team', label: 'Team 团队版' },
]

const USAGE_METRIC_LABELS: Record<string, string> = {
  bubbles: '气泡',
  snapshots: '快照',
  ai_calls: 'AI 调用',
  prd_exports: 'PRD 导出',
}

export default function Admin() {
  const user = useAuthStore((state) => state.user)
  const [section, setSection] = useState<SectionKey>('users')
  const [users, setUsers] = useState<AdminUser[]>([])
  const [records, setRecords] = useState<AdminRecord[]>([])
  const [usage, setUsage] = useState<Record<string, Record<string, number>>>({})
  const [loading, setLoading] = useState(false)
  const [expandedUser, setExpandedUser] = useState<string | null>(null)

  const loadUsers = useCallback(async () => {
    setLoading(true)
    try {
      const response = await apiFetch('/api/admin/users')
      const data = await response.json()
      if (response.ok && data.success) setUsers(data.users || [])
    } finally {
      setLoading(false)
    }
  }, [])

  const loadRecords = useCallback(async () => {
    setLoading(true)
    try {
      const response = await apiFetch('/api/admin/records')
      const data = await response.json()
      if (response.ok && data.success) setRecords(data.records || [])
    } finally {
      setLoading(false)
    }
  }, [])

  const loadUsage = useCallback(async () => {
    setLoading(true)
    try {
      const response = await apiFetch('/api/admin/usage')
      const data = await response.json()
      if (response.ok && data.success) setUsage(data.usage || {})
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (user?.role === 'admin') {
      void loadUsers()
    }
  }, [user?.role, loadUsers])

  const changeSection = (next: SectionKey) => {
    setSection(next)
    if (next === 'records') void loadRecords()
    if (next === 'usage') void loadUsage()
    if (next === 'users') void loadUsers()
  }

  const setSubscription = async (email: string, subscription: 'free' | 'pro' | 'team') => {
    const response = await apiFetch(`/api/admin/users/${encodeURIComponent(email)}/subscription`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription }),
    })
    const data = await response.json()
    if (response.ok && data.success) {
      void loadUsers()
    }
  }

  if (user?.role !== 'admin') {
    return (
      <div className="p-8 text-center text-[13px] text-on-surface-variant">
        需要管理员权限（ADMIN_EMAILS 配置）。
      </div>
    )
  }

  const sections: Array<{ id: SectionKey; label: string; icon: typeof Users }> = [
    { id: 'users', label: '用户与订阅', icon: Users },
    { id: 'records', label: '生成记录', icon: Database },
    { id: 'usage', label: '用量统计', icon: Gauge },
  ]

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-6 flex items-center gap-2">
        <ShieldCheck size={18} className="text-secondary" />
        <h1 className="text-lg font-bold text-on-surface">管理员控制台</h1>
      </div>

      <div className="mb-5 flex gap-2">
        {sections.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => changeSection(item.id)}
            className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-[12px] font-semibold transition-all ${
              section === item.id ? 'bg-primary-fixed/55 text-on-surface ring-1 ring-primary/35' : 'bg-white/36 text-on-surface-variant ring-1 ring-white/45 hover:bg-white/50'
            }`}
          >
            <item.icon size={13} />
            {item.label}
          </button>
        ))}
      </div>

      {loading && <div className="mb-3 flex items-center gap-2 text-[12px] text-outline"><Loader2 size={13} className="animate-spin" /> 加载中…</div>}

      {section === 'users' && (
        <div className="surface-list-card overflow-hidden rounded-[20px]">
          <table className="w-full text-left text-[12px]">
            <thead>
              <tr className="border-b border-outline-variant/20 bg-white/30 text-[11px] text-outline">
                <th className="px-4 py-3 font-semibold">邮箱</th>
                <th className="px-4 py-3 font-semibold">角色</th>
                <th className="px-4 py-3 font-semibold">订阅</th>
                <th className="px-4 py-3 font-semibold">用量</th>
                <th className="px-4 py-3 font-semibold">注册时间</th>
              </tr>
            </thead>
            <tbody>
              {users.map((item) => (
                <>
                  <tr key={item.email} className="border-b border-outline-variant/10 last:border-0">
                    <td className="px-4 py-3 font-medium text-on-surface">{item.email}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${item.role === 'admin' ? 'bg-secondary-container/50 text-secondary' : 'bg-white/42 text-on-surface-variant'}`}>
                        {item.role === 'admin' ? '管理员' : '用户'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={item.subscription}
                        onChange={(event) => setSubscription(item.email, event.target.value as 'free' | 'pro' | 'team')}
                        className="input-field h-8 rounded-full px-3 text-[11px] font-semibold"
                      >
                        {SUBSCRIPTIONS.map((option) => (
                          <option key={option.id} value={option.id}>{option.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-on-surface-variant">
                      {Object.entries(item.usage).map(([metric, count]) => (
                        <span key={metric} className="mr-2 inline-block">
                          {USAGE_METRIC_LABELS[metric] || metric}: <span className="font-semibold text-on-surface">{count}</span>
                        </span>
                      ))}
                      {Object.keys(item.usage).length === 0 && <span className="text-outline">—</span>}
                    </td>
                    <td className="px-4 py-3 text-outline">{new Date(item.createdAt).toLocaleDateString()}</td>
                  </tr>
                  {expandedUser === item.email && (
                    <tr>
                      <td colSpan={5} className="px-4 pb-3 pt-0">
                        <div className="rounded-[14px] bg-white/30 px-3 py-2 text-[11px] leading-5 text-on-surface-variant ring-1 ring-white/40">
                          完整用量：{JSON.stringify(item.usage)}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {section === 'records' && (
        <div className="space-y-3">
          {records.map((record) => (
            <div key={record.email} className="surface-list-card rounded-[20px] p-4">
              <button
                type="button"
                onClick={() => setExpandedUser(expandedUser === record.email ? null : record.email)}
                className="flex w-full items-center justify-between"
              >
                <span className="text-[13px] font-semibold text-on-surface">{record.email}</span>
                <span className="flex items-center gap-3 text-[11px] text-on-surface-variant">
                  <span>气泡 {record.bubbles.length}</span>
                  <span>快照 {record.snapshots.length}</span>
                  <ChevronDown size={14} className={`transition-transform ${expandedUser === record.email ? 'rotate-180' : ''}`} />
                </span>
              </button>

              {expandedUser === record.email && (
                <div className="mt-3 space-y-3">
                  {record.bubbles.length > 0 && (
                    <div>
                      <div className="mb-1.5 text-[11px] font-semibold text-outline">气泡（{record.bubbles.length}）</div>
                      <div className="space-y-1.5">
                        {record.bubbles.map((bubble) => (
                          <div key={bubble.id} className="rounded-[14px] bg-white/32 px-3 py-2 text-[12px] leading-5 ring-1 ring-white/40">
                            <span className="mr-2 text-outline">[{bubble.tag || '无标签'}]</span>
                            {bubble.content}
                            <div className="mt-1 text-[10px] text-outline">
                              {bubble.id} · 权重 {bubble.interactionWeight} · {new Date(bubble.createdAt).toLocaleString()}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {record.snapshots.length > 0 && (
                    <div>
                      <div className="mb-1.5 text-[11px] font-semibold text-outline">快照（{record.snapshots.length}）</div>
                      <div className="space-y-1.5">
                        {record.snapshots.map((snapshot) => (
                          <div key={snapshot.id} className="rounded-[14px] bg-white/32 px-3 py-2 text-[12px] leading-5 ring-1 ring-white/40">
                            <span className="font-semibold text-on-surface">{snapshot.name}</span>
                            <span className="ml-2 text-outline">{new Date(snapshot.createdAt).toLocaleString()}</span>
                            {snapshot.statusSnapshot && <p className="mt-1">{snapshot.statusSnapshot}</p>}
                            {snapshot.semanticAnchors.length > 0 && (
                              <p className="mt-1 text-[11px] text-outline">锚点：{snapshot.semanticAnchors.join(' / ')}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {record.bubbles.length === 0 && record.snapshots.length === 0 && (
                    <p className="text-[12px] text-outline">暂无生成记录</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {section === 'usage' && (
        <div className="surface-list-card overflow-hidden rounded-[20px]">
          <table className="w-full text-left text-[12px]">
            <thead>
              <tr className="border-b border-outline-variant/20 bg-white/30 text-[11px] text-outline">
                <th className="px-4 py-3 font-semibold">邮箱</th>
                {Object.keys(USAGE_METRIC_LABELS).map((metric) => (
                  <th key={metric} className="px-4 py-3 font-semibold">{USAGE_METRIC_LABELS[metric]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(usage).map(([email, metrics]) => (
                <tr key={email} className="border-b border-outline-variant/10 last:border-0">
                  <td className="px-4 py-3 font-medium text-on-surface">{email}</td>
                  {Object.keys(USAGE_METRIC_LABELS).map((metric) => (
                    <td key={metric} className="px-4 py-3 text-on-surface-variant">{metrics[metric] || 0}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
