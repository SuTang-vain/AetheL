import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  Boxes,
  FileText,
  History,
  Lightbulb,
  Link2,
  Sparkles,
  WandSparkles,
} from 'lucide-react'
import { useSnapshotStore } from '@/stores/snapshotStore'
import { classifyWorkshopInput, workshopSkillForKind } from '@/lib/workshopInput'

/**
 * AetheL 产品首页（画布空状态引导）。
 * 智能输入框自动识别输入类型并路由到对应工坊 skill；
 * 有快照时展示最近认知快照作为"继续工作"入口。
 * 工作区卡片与快照区组件保持独立，为未来多工作区扩展预留。
 */

const ENTRY_CARDS = [
  {
    id: 'canvas',
    title: '灵感画布',
    description: '捕捉、整理和关联产品思考气泡',
    icon: Boxes,
    path: '/',
  },
  {
    id: 'workshop',
    title: '创意工坊',
    description: '把想法、链接或文档变成候选气泡',
    icon: WandSparkles,
    path: '/workshop',
  },
  {
    id: 'prd',
    title: 'PRD 输出',
    description: '基于气泡束生成可编辑的 PRD 章节',
    icon: FileText,
    path: '/prd',
  },
]

export default function WelcomeHome() {
  const navigate = useNavigate()
  const [input, setInput] = useState('')
  const snapshots = useSnapshotStore((s) => s.snapshots)

  const submit = () => {
    const value = input.trim()
    if (!value) return
    const kind = classifyWorkshopInput(value)
    const skill = workshopSkillForKind(kind)
    navigate(`/workshop?skill=${skill}&input=${encodeURIComponent(value)}&autoRun=1`)
  }

  return (
    <div className="h-screen bg-background dot-grid-bg relative overflow-hidden">
      <div className="relative z-10 flex h-full flex-col items-center justify-center gap-8 px-6">
        {/* 品牌与定位 */}
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-[22px] bg-white/60 ring-1 ring-white/70 shadow-sm">
            <img src="/aethel-logo-icon.png" alt="AetheL" className="h-[72%] w-[72%] object-contain" />
          </div>
          <h1 className="text-[26px] font-semibold text-on-surface">AetheL · AI 认知工作区</h1>
          <p className="mt-2 text-[13px] text-on-surface-variant">把零碎想法变成产品 PRD —— 一个气泡、一个快照地推进</p>
        </div>

        {/* 智能输入框 */}
        <div className="w-full max-w-[560px]">
          <div className="floating-window liquid-vessel rounded-[28px] p-3">
            <div className="flex items-center gap-2 rounded-[20px] bg-white/42 px-4 ring-1 ring-white/55">
              <Sparkles size={15} className="shrink-0 text-secondary" />
              <input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') submit()
                }}
                className="h-12 min-w-0 flex-1 bg-transparent text-[14px] text-on-surface outline-none placeholder:text-outline"
                placeholder="输入一个想法、粘贴链接，或直接贴一份 PRD…"
                data-testid="welcome-input"
              />
              <button
                onClick={submit}
                disabled={!input.trim()}
                className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-secondary-container/55 px-4 text-[12px] font-semibold text-secondary transition-all hover:bg-secondary-container disabled:cursor-not-allowed disabled:opacity-40"
                data-testid="welcome-submit"
              >
                <ArrowRight size={13} />
                开始
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 px-1 pb-1">
              <span className="rounded-full bg-white/42 px-2.5 py-1 text-[10px] text-outline">
                <Lightbulb size={10} className="mr-1 inline" />
                想法 → 气泡
              </span>
              <span className="rounded-full bg-white/42 px-2.5 py-1 text-[10px] text-outline">
                <Link2 size={10} className="mr-1 inline" />
                链接 → 外部证据
              </span>
              <span className="rounded-full bg-white/42 px-2.5 py-1 text-[10px] text-outline">
                <FileText size={10} className="mr-1 inline" />
                PRD → 拆解
              </span>
            </div>
          </div>
        </div>

        {/* 三个入口 */}
        <div className="grid w-full max-w-[560px] grid-cols-3 gap-3">
          {ENTRY_CARDS.map((card) => (
            <button
              key={card.id}
              onClick={() => navigate(card.path)}
              className="surface-list-card rounded-[22px] p-4 text-left transition-all hover:bg-white/55"
            >
              <card.icon size={16} className="mb-2 text-primary" />
              <div className="text-[13px] font-semibold text-on-surface">{card.title}</div>
              <div className="mt-1 text-[11px] leading-4 text-on-surface-variant">{card.description}</div>
            </button>
          ))}
        </div>

        {/* 最近快照（继续工作入口，多工作区扩展预留位） */}
        {snapshots.length > 0 && (
          <div className="w-full max-w-[560px]">
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-outline">
              <History size={12} />
              最近认知快照
            </div>
            <div className="space-y-2">
              {snapshots.slice(0, 3).map((snapshot) => (
                <button
                  key={snapshot.id}
                  onClick={() => navigate('/context')}
                  className="flex w-full items-center gap-3 rounded-[18px] bg-white/34 px-3 py-2.5 text-left ring-1 ring-white/45 transition-all hover:bg-white/55"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-semibold text-on-surface">{snapshot.name}</div>
                    <div className="truncate text-[11px] text-outline">{snapshot.cognition?.statusSnapshot || '认知快照'}</div>
                  </div>
                  <span className="shrink-0 text-[10px] text-outline">{new Date(snapshot.createdAt).toLocaleDateString('zh-CN')}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
