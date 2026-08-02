import { useEffect, useMemo, useState } from 'react'
import { X, Trash2, Tag, Palette, History, Activity, MessageCircle, GitBranch, Clock3 } from 'lucide-react'
import { useBubbleStore } from '@/stores/bubbleStore'
import { useSnapshotStore } from '@/stores/snapshotStore'

const TAG_COLORS = [
  '#4f46e5', '#0891b2', '#7c3aed', '#e11d48',
  '#d97706', '#0f766e', '#64748b', '#db2777',
  '#2563eb', '#ea580c', '#65a30d', '#9333ea',
]

export default function BubbleDetail() {
  const {
    bubbles,
    extensions,
    relations,
    revisions,
    activeBubbleId,
    setActiveBubble,
    updateBubble,
    deleteBubble,
    deleteExtension,
  } = useBubbleStore()
  const snapshots = useSnapshotStore((s) => s.snapshots)
  const bubble = bubbles.find((b) => b.id === activeBubbleId)
  const [contentDraft, setContentDraft] = useState('')
  const [tagDraft, setTagDraft] = useState('')
  const snapshotCount = bubble
    ? snapshots.filter((snapshot) =>
      snapshot.canvasState.bubbles.some((snapshotBubble) => snapshotBubble.id === bubble.id)
    ).length
    : 0
  const bubbleExtensions = bubble
    ? extensions.filter((extension) => extension.bubbleId === bubble.id)
    : []
  const bubbleRevisions = useMemo(() => (
    bubble
      ? revisions
        .filter((revision) => revision.bubbleId === bubble.id)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      : []
  ), [bubble, revisions])
  const relatedRelations = bubble
    ? relations.filter((relation) => relation.sourceId === bubble.id || relation.targetId === bubble.id)
    : []

  useEffect(() => {
    if (!bubble) return
    setContentDraft(bubble.content)
    setTagDraft(bubble.tag)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 按字段值同步草稿而非对象身份：编辑提交通常产生新的 bubble 对象（content/tag 值不变），依赖整个 bubble 会重置用户正在编辑的草稿
  }, [bubble?.id, bubble?.content, bubble?.tag])

  if (!bubble) return null

  const commitContent = () => {
    const nextContent = contentDraft.trim()
    if (nextContent && nextContent !== bubble.content) {
      updateBubble(bubble.id, { content: nextContent })
    } else {
      setContentDraft(bubble.content)
    }
  }

  const commitTag = () => {
    const nextTag = tagDraft.trim()
    if (nextTag !== bubble.tag) {
      updateBubble(bubble.id, { tag: nextTag })
    }
  }

  return (
    <div className="absolute top-20 bottom-48 left-6 z-40 w-[280px] max-w-[calc(100%-3rem)] glass-panel floating-window p-4 space-y-4 overflow-y-auto animate-bubble-in">
      <div className="flex items-center justify-between">
        <span className="text-[15px] text-on-surface font-semibold">气泡详情</span>
        <button onClick={() => setActiveBubble(null)} className="h-8 w-8 rounded-full flex items-center justify-center text-outline hover:bg-surface-container/70 hover:text-on-surface transition-colors">
          <X size={14} />
        </button>
      </div>

      <div>
        <label className="text-[12px] text-on-surface-variant font-semibold block mb-1">内容</label>
        <textarea
          value={contentDraft}
          onChange={(e) => setContentDraft(e.target.value)}
          onBlur={commitContent}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              commitContent()
            }
          }}
          className="w-full input-field text-[14px] min-h-[120px] max-h-48 resize-y leading-relaxed"
          rows={5}
        />
      </div>

      <div>
        <label className="text-[11px] text-on-surface-variant font-semibold tracking-wider block mb-1.5">
          <Tag size={10} className="inline mr-1" />
          标签
        </label>
        <input
          type="text"
          value={tagDraft}
          onChange={(e) => setTagDraft(e.target.value)}
          onBlur={commitTag}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              commitTag()
              event.currentTarget.blur()
            }
          }}
          placeholder="添加标签..."
          className="w-full input-field text-[13px]"
        />
      </div>

      <div>
        <label className="text-[11px] text-on-surface-variant font-semibold tracking-wider block mb-1.5">
          <Palette size={10} className="inline mr-1" />
          颜色
        </label>
        <div className="flex gap-1.5 flex-wrap">
          {TAG_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => updateBubble(bubble.id, { color: c })}
              className={`w-6 h-6 rounded-full border-2 transition-all hover:scale-110 ${
                bubble.color === c ? 'border-on-surface' : 'border-transparent'
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>

      <div className="text-[11px] text-outline font-mono">
        创建: {new Date(bubble.createdAt).toLocaleString('zh-CN')}
      </div>

      <div className="text-[11px] text-outline font-mono">
        更新: {new Date(bubble.updatedAt).toLocaleString('zh-CN')}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-[20px] bg-white/45 border border-white/60 p-3">
          <div className="flex items-center gap-1.5 text-[12px] text-on-surface-variant font-semibold">
            <Activity size={11} className="text-primary" />
            交互权重
          </div>
          <div className="text-lg font-semibold text-primary mt-1">{bubble.interactionWeight || 0}</div>
        </div>
        <div className="rounded-[20px] bg-white/45 border border-white/60 p-3">
          <div className="flex items-center gap-1.5 text-[12px] text-on-surface-variant font-semibold">
            <History size={11} className="text-primary" />
            参与快照
          </div>
          <div className="text-lg font-semibold text-primary mt-1">{snapshotCount}</div>
        </div>
      </div>

      <section className="rounded-[22px] bg-white/40 p-3 ring-1 ring-white/55">
        <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-on-surface">
          <MessageCircle size={12} className="text-primary" />
          追问补充
          <span className="ml-auto text-[11px] text-outline">{bubbleExtensions.length}</span>
        </div>
        {bubbleExtensions.length === 0 ? (
          <div className="text-[12px] leading-5 text-outline">暂无追问补充，底部 AI 输入框追加的内容会沉淀在这里。</div>
        ) : (
          <div className="space-y-2">
            {bubbleExtensions.map((extension) => (
              <div key={extension.id} className="rounded-[18px] bg-white/44 p-2.5 ring-1 ring-white/55">
                <div className="mb-1 flex items-center gap-2 text-[10px] text-outline">
                  <span>{extension.source === 'ai_followup' ? 'AI 追问' : '手动补充'}</span>
                  <span>{new Date(extension.createdAt).toLocaleString('zh-CN')}</span>
                  <button
                    onClick={() => deleteExtension(extension.id)}
                    className="ml-auto text-error/55 hover:text-error"
                    title="删除补充"
                  >
                    <X size={11} />
                  </button>
                </div>
                <div className="text-[12px] leading-5 text-on-surface-variant">{extension.content}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-[22px] bg-white/38 p-3 ring-1 ring-white/55">
        <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-on-surface">
          <GitBranch size={12} className="text-primary" />
          关系线索
          <span className="ml-auto text-[11px] text-outline">{relatedRelations.length}</span>
        </div>
        {relatedRelations.length === 0 ? (
          <div className="text-[12px] leading-5 text-outline">暂无显式关系，AI 归类或关系追问后会显示关联、重复或矛盾判断。</div>
        ) : (
          <div className="space-y-2">
            {relatedRelations.map((relation) => {
              const peerId = relation.sourceId === bubble.id ? relation.targetId : relation.sourceId
              const peer = bubbles.find((item) => item.id === peerId)
              return (
                <div key={relation.id} className="rounded-[18px] bg-white/40 p-2.5 ring-1 ring-white/50">
                  <div className="mb-1 text-[10px] font-semibold text-primary">{relation.type}</div>
                  <div className="line-clamp-2 text-[12px] leading-5 text-on-surface">{peer?.content || peerId}</div>
                  <div className="mt-1 text-[11px] leading-5 text-on-surface-variant">{relation.reason}</div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <section className="rounded-[22px] bg-white/36 p-3 ring-1 ring-white/55">
        <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-on-surface">
          <Clock3 size={12} className="text-primary" />
          修改记录
          <span className="ml-auto text-[11px] text-outline">{bubbleRevisions.length}</span>
        </div>
        {bubbleRevisions.length === 0 ? (
          <div className="text-[12px] leading-5 text-outline">暂无修改记录。内容、标签、颜色或分类发生变化后会自动记录。</div>
        ) : (
          <div className="space-y-2">
            {bubbleRevisions.slice(0, 8).map((revision) => (
              <div key={revision.id} className="rounded-[18px] bg-white/40 p-2.5 ring-1 ring-white/50">
                <div className="mb-1 flex items-center justify-between gap-2 text-[10px] text-outline">
                  <span>{revision.type}</span>
                  <span>{new Date(revision.createdAt).toLocaleString('zh-CN')}</span>
                </div>
                <div className="text-[11px] leading-5 text-on-surface-variant">
                  <span className="text-outline">从 </span>
                  <span className="line-clamp-2 inline text-on-surface">{revision.before || '空'}</span>
                </div>
                <div className="text-[11px] leading-5 text-on-surface-variant">
                  <span className="text-outline">到 </span>
                  <span className="line-clamp-2 inline text-on-surface">{revision.after || '空'}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <button
        onClick={() => deleteBubble(bubble.id)}
        className="w-full flex items-center justify-center gap-1.5 text-[13px] text-error/70 hover:text-error py-2 rounded-full hover:bg-error-container/30 transition-all"
      >
        <Trash2 size={12} />
        删除气泡
      </button>
    </div>
  )
}
