import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  Activity,
  AlertCircle,
  Archive,
  CheckCircle2,
  ExternalLink,
  FileText,
  Globe2,
  HelpCircle,
  Loader2,
  LogOut,
  MessageSquare,
  MoreHorizontal,
  Puzzle,
  Settings2,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { usePersistenceStore } from '@/stores/persistenceStore'
import { useAuthStore } from '@/stores/authStore'

const navItems = [
  { to: '/', icon: Sparkles, label: '灵感气泡' },
  { to: '/context', icon: Archive, label: '快照库' },
  { to: '/prd', icon: FileText, label: 'PRD' },
  { to: '/workshop', icon: Puzzle, label: '工坊' },
]

const SUBSCRIPTION_LABELS: Record<string, string> = {
  free: '免费版',
  pro: 'Pro 个人版',
  team: 'Team 团队版',
}

export default function MainNavigation() {
  const location = useLocation()
  const navigate = useNavigate()
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const { status, error, lastSavedAt } = usePersistenceStore()
  const user = useAuthStore((state) => state.user)
  const logout = useAuthStore((state) => state.logout)
  const isBusy = status === 'loading' || status === 'saving'
  const StatusIcon = status === 'error' ? AlertCircle : isBusy ? Loader2 : CheckCircle2
  const statusLabel = status === 'error'
    ? error || '保存失败'
    : status === 'loading'
      ? '正在加载文件层'
      : status === 'saving'
        ? '正在保存'
        : lastSavedAt
          ? `已保存 ${new Date(lastSavedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
          : '已连接文件层'
  const currentSettingsSection = new URLSearchParams(location.search).get('section') || 'ai'
  const internalMenuItems = [
    { to: '/settings?section=activity', icon: Activity, label: '活动记录', section: 'activity' },
    { to: '/settings?section=ai', icon: Settings2, label: '设置', section: 'ai' },
  ]
  const supportMenuItems = [
    { href: 'https://kezhongke.cn/', icon: HelpCircle, label: '帮助' },
    { href: 'https://kezhongke.cn/', icon: MessageSquare, label: '反馈' },
    { href: 'https://kezhongke.cn/', icon: Globe2, label: '论坛' },
  ]

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [])

  return (
    <nav className="fixed left-6 top-5 z-50 floating-window rounded-full p-1 flex items-center gap-0.5">
      <Link to="/" className="mr-1 flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-white/75 ring-1 ring-white/75 shadow-glass hover:opacity-80 transition-opacity cursor-pointer" title="回到灵感气泡">
        <img src="/aethel-logo-icon.png" alt="AetheL logo" className="h-[88%] w-[88%] object-contain" />
      </Link>
      {navItems.map(({ to, icon: Icon, label }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            `h-8 rounded-full px-2.5 flex items-center gap-1.5 transition-all ${
              isActive
                ? 'bg-primary text-on-primary shadow-glow-primary'
                : 'text-on-surface hover:text-primary hover:bg-primary-fixed/35'
            }`
          }
        >
          <Icon size={14} />
          <span className="text-[11px] font-semibold">{label}</span>
        </NavLink>
      ))}
      <span className="mx-1 h-4 w-px bg-white/45" />

      <div ref={menuRef} className="relative">
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          className={`relative flex h-8 w-8 items-center justify-center rounded-full transition-all ${
            menuOpen || location.pathname === '/settings'
              ? 'bg-primary text-on-primary shadow-glow-primary'
              : 'text-on-surface hover:bg-primary-fixed/35 hover:text-primary'
          }`}
          aria-label="更多"
          aria-expanded={menuOpen}
          title="更多"
        >
          <MoreHorizontal size={15} />
          <span
            className={`absolute right-1 top-1 h-1.5 w-1.5 rounded-full ring-1 ring-white/70 ${
              status === 'error'
                ? 'bg-error'
                : isBusy
                  ? 'bg-primary'
                  : 'bg-secondary'
            }`}
          />
        </button>

        {menuOpen && (
          <div className="absolute left-1/2 top-full z-[60] mt-3 w-[232px] -translate-x-1/2">
            <div className="support-menu-panel rounded-[26px] p-2">
              <div
                className="mb-1.5 flex items-start gap-2 rounded-[20px] bg-white/72 px-3 py-2 ring-1 ring-white/70"
                title={statusLabel}
              >
                <span
                  className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                    status === 'error'
                      ? 'bg-error-container/40 text-error'
                      : isBusy
                        ? 'bg-primary-fixed/35 text-primary'
                        : 'bg-secondary-container/55 text-secondary'
                  }`}
                >
                  <StatusIcon size={14} className={isBusy ? 'animate-spin' : ''} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[12px] font-semibold text-on-surface">状态</span>
                  <span className="block truncate text-[11px] text-outline">{statusLabel}</span>
                </span>
              </div>

              <div className="space-y-1">
                {internalMenuItems.map(({ to, icon: Icon, label, section }) => {
                  const active = location.pathname === '/settings' && currentSettingsSection === section
                  return (
                    <Link
                      key={to}
                      to={to}
                      onClick={() => setMenuOpen(false)}
                      className={`flex h-9 items-center gap-2 rounded-full px-3 text-[12px] font-semibold transition-all ${
                        active
                          ? 'bg-primary text-on-primary shadow-glow-primary'
                          : 'text-on-surface hover:bg-primary-fixed/30 hover:text-primary'
                      }`}
                    >
                      <Icon size={14} />
                      <span>{label}</span>
                    </Link>
                  )
                })}
                {user?.role === 'admin' && (
                  <Link
                    to="/admin"
                    onClick={() => setMenuOpen(false)}
                    className={`flex h-9 items-center gap-2 rounded-full px-3 text-[12px] font-semibold transition-all ${
                      location.pathname === '/admin'
                        ? 'bg-primary text-on-primary shadow-glow-primary'
                        : 'text-on-surface hover:bg-primary-fixed/30 hover:text-primary'
                    }`}
                  >
                    <ShieldCheck size={14} />
                    <span>管理员控制台</span>
                  </Link>
                )}
              </div>

              <div className="my-1.5 h-px bg-on-surface/8" />

              <div className="space-y-1">
                {supportMenuItems.map(({ href, icon: Icon, label }) => (
                  <a
                    key={label}
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => setMenuOpen(false)}
                    className="flex h-9 items-center gap-2 rounded-full px-3 text-[12px] font-semibold text-on-surface transition-all hover:bg-primary-fixed/30 hover:text-primary"
                  >
                    <Icon size={14} />
                    <span className="min-w-0 flex-1">{label}</span>
                    <ExternalLink size={12} className="text-outline" />
                  </a>
                ))}
              </div>

              {user && (
                <div className="mt-1.5 rounded-[20px] bg-white/58 px-3 py-2.5 ring-1 ring-white/60">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-on-surface" title={user.email}>
                      {user.email}
                    </span>
                    <span className="shrink-0 rounded-full bg-secondary-container/55 px-2 py-0.5 text-[10px] font-semibold text-secondary">
                      {SUBSCRIPTION_LABELS[user.subscription] || user.subscription}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false)
                      void logout().then(() => navigate('/login'))
                    }}
                    className="mt-2 flex h-8 w-full items-center justify-center gap-1.5 rounded-full bg-white/62 text-[11px] font-semibold text-on-surface transition-colors hover:bg-error-container/40 hover:text-error"
                  >
                    <LogOut size={12} />
                    退出登录
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </nav>
  )
}
