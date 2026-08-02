import { useEffect, useState } from 'react'
import { Brain, History, Tags } from 'lucide-react'
import BubbleCanvas from '@/components/BubbleCanvas'
import TagSidebar from '@/components/TagSidebar'
import AICategorizePanel from '@/components/AICategorizePanel'
import BubbleDetail from '@/components/BubbleDetail'
import SnapshotPanel from '@/components/snapshot/SnapshotPanel'
import BubbleAIAssistant from '@/components/BubbleAIAssistant'
import WelcomeHome from '@/components/onboarding/WelcomeHome'
import { useBubbleStore } from '@/stores/bubbleStore'
import { useSnapshotStore } from '@/stores/snapshotStore'

export default function BubbleSpace() {
  const [activePanel, setActivePanel] = useState<'tags' | 'ai' | 'snapshot' | null>(null)
  const bubbles = useBubbleStore((s) => s.bubbles)
  const activeBubbleId = useBubbleStore((s) => s.activeBubbleId)
  const selectedBubbleIds = useBubbleStore((s) => s.selectedBubbleIds)
  const canvasMode = useBubbleStore((s) => s.canvasMode)
  const removeSelectedBubble = useBubbleStore((s) => s.removeSelectedBubble)
  const clearSelectedBubbles = useBubbleStore((s) => s.clearSelectedBubbles)
  const categoryColorSignature = useBubbleStore((s) => s.categories.map((category) => `${category.id}:${category.color}`).join('|'))
  const ensureDistinctCategoryColors = useBubbleStore((s) => s.ensureDistinctCategoryColors)
  const latestSnapshot = useSnapshotStore((s) => s.snapshots[0])

  const panelButtons = [
    { id: 'tags' as const, icon: Tags, label: '标签' },
    { id: 'ai' as const, icon: Brain, label: 'AI 归类' },
    { id: 'snapshot' as const, icon: History, label: '快照' },
  ]

  useEffect(() => {
    ensureDistinctCategoryColors()
  }, [categoryColorSignature, ensureDistinctCategoryColors])

  useEffect(() => {
    if (selectedBubbleIds.length > 0 && canvasMode === 'select') {
      setActivePanel('snapshot')
    }
  }, [canvasMode, selectedBubbleIds.length])

  // 空工作区：以产品首页（智能输入框引导）替代画布
  if (bubbles.length === 0) {
    return <WelcomeHome />
  }

  return (
    <div className="h-screen flex flex-col bg-background dot-grid-bg relative overflow-hidden">
      <div className="blob-bg w-[520px] h-[520px] bg-primary-fixed/55 top-[-180px] left-[12%] animate-blob-drift" />
      <div className="blob-bg w-[430px] h-[430px] bg-secondary-container/50 bottom-[-140px] left-[-120px] animate-blob-drift" style={{ animationDelay: '-7s' }} />
      <div className="blob-bg w-[380px] h-[380px] bg-tertiary-fixed/40 top-[24%] right-[-90px] animate-blob-drift" style={{ animationDelay: '-13s' }} />

      <div className="relative z-10 h-full">
        <div className="absolute inset-0 overflow-hidden">
          <BubbleCanvas />

          <div className="absolute right-6 top-5 z-30 glass-panel floating-window !rounded-full flex items-center gap-0.5 p-1">
            {panelButtons.map(({ id, icon: Icon, label }) => (
              <button
                key={id}
                onClick={() => setActivePanel(activePanel === id ? null : id)}
                className={`h-8 px-2.5 rounded-full flex items-center gap-1.5 transition-all ${
                  activePanel === id
                    ? 'bg-primary text-on-primary shadow-glow-primary'
                    : 'text-on-surface hover:text-primary hover:bg-primary-fixed/35'
                }`}
                title={label}
              >
                <Icon size={14} />
                <span className="text-[11px] font-semibold">{label}</span>
                {id === 'snapshot' && latestSnapshot && (
                  <span className={`max-w-16 truncate text-[9px] ${activePanel === id ? 'text-on-primary/80' : 'text-outline'}`}>
                    {latestSnapshot.name}
                  </span>
                )}
              </button>
            ))}
          </div>

          {activePanel && (
            <div className="absolute right-6 top-20 bottom-48 z-40 w-[280px] max-w-[calc(100%-3rem)]">
              {activePanel === 'tags' && <TagSidebar onClose={() => setActivePanel(null)} />}
              {activePanel === 'ai' && <AICategorizePanel onClose={() => setActivePanel(null)} />}
              {activePanel === 'snapshot' && (
                <SnapshotPanel
                  embedded
                  contained
                  selectedBubbleIds={selectedBubbleIds}
                  onClose={() => setActivePanel(null)}
                />
              )}
            </div>
          )}
          {activeBubbleId && <BubbleDetail />}
          <BubbleAIAssistant
            onRemoveSelectedBubble={removeSelectedBubble}
            onClearSelectedBubbles={clearSelectedBubbles}
          />
        </div>
      </div>
    </div>
  )
}
