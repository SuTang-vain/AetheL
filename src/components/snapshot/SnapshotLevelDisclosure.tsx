import { AlertCircle, Eye, KeyRound, Layers3, RotateCcw } from 'lucide-react'
import { createFallbackCognition, type Snapshot } from '@/stores/snapshotStore'

interface SnapshotLevelDisclosureProps {
  snapshot: Snapshot
  expanded: boolean
  deep: boolean
  onToggleExpand: () => void
  onToggleDeep: () => void
  formatTime: (iso: string) => string
  compact?: boolean
}

const relationLabel = {
  related: '关联',
  contradictory: '矛盾',
  duplicate: '重复',
}

export default function SnapshotLevelDisclosure({
  snapshot,
  expanded,
  deep,
  onToggleExpand,
  onToggleDeep,
  compact = false,
}: SnapshotLevelDisclosureProps) {
  const cognition = snapshot.cognition || createFallbackCognition(snapshot.canvasState.bubbles)
  const weightedBubbles = [...snapshot.canvasState.bubbles]
    .sort((a, b) => (b.interactionWeight || 0) - (a.interactionWeight || 0))
  const extensions = snapshot.canvasState.extensions || []
  const relations = snapshot.canvasState.relations || []
  const metricItems = [
    { value: snapshot.canvasState.bubbles.length, label: '气泡' },
    { value: snapshot.tagState.categories.length, label: '分类' },
    { value: snapshot.tagState.tags.length, label: '标签' },
  ]

  return (
    <>
      <button onClick={onToggleExpand} className={`block w-full text-left ${compact ? 'mt-3' : ''}`}>
        <p className={`${compact ? 'line-clamp-4 text-[13px] leading-6' : 'text-[13px] leading-relaxed'} text-on-surface`}>
          {cognition.statusSnapshot}
        </p>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {cognition.semanticAnchors.slice(0, compact ? 4 : 5).map((anchor) => (
            <span
              key={anchor.label}
              className={`${compact ? 'rounded-full bg-primary-fixed/34 px-2.5 py-1' : 'rounded-full bg-surface-container/70 px-2 py-1'} text-[11px] font-medium text-on-surface-variant`}
              title={anchor.reason}
            >
              {anchor.label}
            </span>
          ))}
        </div>

        <div className={`mt-3 ${compact ? 'grid grid-cols-3 gap-1.5' : 'flex gap-3'} text-on-surface-variant`}>
          {metricItems.map((item) => (
            <div
              key={item.label}
              className={compact ? 'rounded-[16px] bg-white/38 px-2 py-1.5 text-center ring-1 ring-white/50' : 'text-[11px]'}
            >
              <span className={compact ? 'block text-[13px] font-semibold leading-4 text-on-surface' : ''}>{item.value}</span>
              <span className={compact ? 'mt-0.5 block text-[10px] leading-3 text-outline' : 'ml-1'}>{item.label}</span>
            </div>
          ))}
        </div>
      </button>

      {expanded && (
        <div className={`${compact ? 'mt-3 space-y-3 border-t border-outline-variant/20 pt-3' : 'mt-4 border-t border-outline-variant/20 pt-4 space-y-4'}`}>
          <div className={`${compact ? 'rounded-[20px]' : 'rounded-xl'} bg-white/34 p-3 ring-1 ring-white/55`}>
            <div className="mb-2 flex items-center gap-1.5 text-primary">
              <Layers3 size={compact ? 12 : 13} />
              <span className="text-[11px] font-semibold">Level 2 逻辑脉络</span>
            </div>
            <p className={`${compact ? 'text-[12px] leading-5' : 'text-[13px] leading-relaxed'} text-on-surface-variant`}>
              {cognition.logicFlow}
            </p>
          </div>

          <div className={compact ? 'space-y-3' : 'grid grid-cols-1 gap-3 md:grid-cols-2'}>
            <div className={`${compact ? 'rounded-[20px]' : 'rounded-xl'} bg-white/30 p-3 ring-1 ring-white/50`}>
              <div className="mb-2 flex items-center gap-1.5 text-on-surface">
                <KeyRound size={compact ? 12 : 13} className="text-primary" />
                <span className="text-[11px] font-semibold">语义锚点说明</span>
              </div>
              <div className="space-y-2">
                {cognition.level2.slice(0, compact ? 4 : 5).map((item) => (
                  <div key={item.anchor} className="text-[12px] leading-5 text-on-surface-variant">
                    <span className="font-medium text-primary">{item.anchor}</span>
                    <span>：{item.summary}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className={`${compact ? 'rounded-[20px]' : 'rounded-xl'} bg-white/30 p-3 ring-1 ring-white/50`}>
              <div className="mb-2 flex items-center gap-1.5 text-on-surface">
                <AlertCircle size={compact ? 12 : 13} className="text-tertiary" />
                <span className="text-[11px] font-semibold">认知待办/缺口</span>
              </div>
              <div className="space-y-1.5">
                {cognition.cognitiveGaps.map((gap) => (
                  <div key={gap} className="text-[12px] leading-5 text-on-surface-variant">{gap}</div>
                ))}
              </div>
            </div>
          </div>

          <blockquote className={`${compact ? 'rounded-[20px]' : 'rounded-xl'} border-l-2 border-primary bg-primary-container/10 px-3 py-2 text-[12px] leading-relaxed text-on-surface-variant`}>
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-primary">
              <RotateCcw size={12} />
              唤醒指令
            </div>
            {cognition.wakeTrigger}
          </blockquote>

          <button
            onClick={onToggleDeep}
            className={`${compact ? 'flex h-8 rounded-full px-3 text-[12px]' : 'btn-ghost text-[13px] !px-3'} items-center gap-1.5 font-semibold text-primary transition-all hover:bg-primary-fixed/35`}
          >
            <Eye size={compact ? 12 : 13} />
            {deep ? '收起溯源层' : '深入探查 Level 3'}
          </button>

          {deep && (
            <div className={`${compact ? 'rounded-[20px]' : 'rounded-xl'} bg-surface-container/50 p-3 ring-1 ring-white/45`}>
              <div className="mb-3 text-[11px] font-semibold text-on-surface">原始气泡、补充与关系依据</div>
              <div className="space-y-3">
                {weightedBubbles.slice(0, compact ? 4 : 6).map((bubble) => {
                  const deepLayer = cognition.level3.find((item) => item.bubbleId === bubble.id)
                  const bubbleExtensions = extensions.filter((extension) => extension.bubbleId === bubble.id)
                  const bubbleRelations = relations.filter((relation) => relation.sourceId === bubble.id || relation.targetId === bubble.id)
                  return (
                    <div key={bubble.id} className="border-t border-outline-variant/20 pt-3 first:border-t-0 first:pt-0">
                      <div className="mb-1 flex items-center gap-2 text-[10px] text-outline">
                        <span>高频线索</span>
                        {bubble.tag && <span>{bubble.tag}</span>}
                      </div>
                      <div className="text-[12px] leading-5 text-on-surface">{bubble.content}</div>
                      {bubbleExtensions.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {bubbleExtensions.slice(0, 3).map((extension) => (
                            <div key={extension.id} className="text-[11px] leading-5 text-on-surface-variant">
                              <span className="text-outline">补充：</span>{extension.content}
                            </div>
                          ))}
                        </div>
                      )}
                      {bubbleRelations.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {bubbleRelations.slice(0, 3).map((relation) => (
                            <div key={relation.id} className="text-[11px] leading-5 text-on-surface-variant">
                              <span className="text-outline">{relationLabel[relation.type]}：</span>{relation.reason}
                            </div>
                          ))}
                        </div>
                      )}
                      {deepLayer?.deepLogic && (
                        <div className="mt-2 rounded-2xl bg-white/34 px-3 py-2 text-[11px] leading-5 text-on-surface-variant ring-1 ring-white/45">
                          {deepLayer.deepLogic}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}
