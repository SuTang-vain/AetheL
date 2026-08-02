import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  AlertCircle,
  ArrowRight,
  Boxes,
  Check,
  FileText,
  Loader2,
  PackageCheck,
  Paperclip,
  Plus,
  RefreshCw,
  Sparkles,
  SquareArrowOutUpRight,
  Upload,
  WandSparkles,
  X,
} from 'lucide-react'
import { useAiStore, type WorkshopCandidateBubble } from '@/stores/aiStore'
import { useBubbleStore } from '@/stores/bubbleStore'
import { useWorkshopStore, type WorkshopSkillId } from '@/stores/workshopStore'
import {
  parsePrdFile,
  PRD_UPLOAD_ACCEPT,
  PRD_UPLOAD_MAX_BYTES,
  isSupportedPrdFile,
  type ParsedPrdFile,
} from '@/lib/prdFileParser'
import { importLink, guessPlatformFromUrl, type LinkCandidateBubble } from '@/lib/linkmindImport'
import { usePluginStore } from '@/stores/pluginStore'
import type { ImportedSourceMeta } from '../../api/storage/types.js'

const SKILL_ACCENT: Record<WorkshopSkillId, string> = {
  'idea-to-bubbles': '#ad2c0d',
  'prd-to-bubbles': '#0f8a9d',
  'link-to-evidence': '#6d28d9',
}

export default function CreativeWorkshop() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const prdFileInputRef = useRef<HTMLInputElement>(null)
  const { addBubble, setSelectedBubbleIds, setActiveBubble } = useBubbleStore()
  const { skills, activeSkillId, setActiveSkill, toggleSkill } = useWorkshopStore()
  const { runWorkshopSkill, isLoading, error, clearError } = useAiStore()
  const { plugins: _pluginEntries, loadPlugins, isReady: isPluginReady } = usePluginStore()
  const [ideaInput, setIdeaInput] = useState('')
  const [prdInput, setPrdInput] = useState('')
  const [uploadedPrdFileName, setUploadedPrdFileName] = useState('')
  const [uploadedPrdFile, setUploadedPrdFile] = useState<ParsedPrdFile | null>(null)
  const [uploadError, setUploadError] = useState('')
  const [isReadingPrdFile, setIsReadingPrdFile] = useState(false)
  const [isDraggingPrdFile, setIsDraggingPrdFile] = useState(false)
  const [skillResult, setSkillResult] = useState<Awaited<ReturnType<typeof runWorkshopSkill>>>(null)
  const [confirmationAnswers, setConfirmationAnswers] = useState<Record<string, string>>({})
  const [confirmationNote, setConfirmationNote] = useState('')
  const [createdIds, setCreatedIds] = useState<string[]>([])
  const [isImportingLink, setIsImportingLink] = useState(false)
  const [linkImportError, setLinkImportError] = useState('')
  const [linkCandidates, setLinkCandidates] = useState<LinkCandidateBubble[]>([])
  const [linkImportMeta, setLinkImportMeta] = useState<{ importId: string; knowledgeItemId: string; url: string; sourceSummary?: string } | null>(null)
  const activeSkill = skills.find((skill) => skill.id === activeSkillId) || skills[0]
  const linkMindReady = isPluginReady('linkmind')
  const visibleSkills = skills.filter((skill) => skill.id !== 'link-to-evidence' || linkMindReady)
  const enabledSkills = visibleSkills.filter((skill) => skill.enabled)
  const activeInput = activeSkillId === 'idea-to-bubbles' || activeSkillId === 'link-to-evidence' ? ideaInput : prdInput
  const previewBubbles = skillResult?.candidateBubbles || []

  useEffect(() => {
    loadPlugins()
  }, [loadPlugins])

  useEffect(() => {
    const requestedSkillId = searchParams.get('skill') as WorkshopSkillId | null
    if (
      requestedSkillId
      && ['idea-to-bubbles', 'prd-to-bubbles', 'link-to-evidence'].includes(requestedSkillId)
      && requestedSkillId !== activeSkillId
    ) {
      setActiveSkill(requestedSkillId)
    }
  }, [activeSkillId, searchParams, setActiveSkill])

  useEffect(() => {
    setSkillResult(null)
    setConfirmationAnswers({})
    setConfirmationNote('')
    setCreatedIds([])
    setUploadedPrdFileName('')
    setUploadedPrdFile(null)
    setUploadError('')
    setIsReadingPrdFile(false)
    setIsDraggingPrdFile(false)
    setIsImportingLink(false)
    setLinkImportError('')
    setLinkCandidates([])
    setLinkImportMeta(null)
    clearError()
  }, [activeSkillId, clearError])

  const updateInput = (value: string) => {
    if (activeSkillId === 'idea-to-bubbles' || activeSkillId === 'link-to-evidence') {
      setIdeaInput(value)
    } else {
      setPrdInput(value)
    }
    setSkillResult(null)
    setConfirmationAnswers({})
    setConfirmationNote('')
    setCreatedIds([])
    setLinkImportError('')
    setLinkCandidates([])
    setLinkImportMeta(null)
    if (activeSkillId === 'prd-to-bubbles') {
      setUploadError('')
      if (uploadedPrdFileName) {
        setUploadedPrdFileName('')
        setUploadedPrdFile(null)
      }
    }
    clearError()
  }

  const handlePrdFileUpload = async (file: File | undefined) => {
    if (!file || activeSkillId !== 'prd-to-bubbles') return

    if (!isSupportedPrdFile(file)) {
      setUploadError('暂支持 Markdown、TXT、HTML、JSON、CSV、PDF、DOCX 文件。')
      if (prdFileInputRef.current) prdFileInputRef.current.value = ''
      return
    }

    if (file.size > PRD_UPLOAD_MAX_BYTES) {
      setUploadError('文件超过 8MB，请先精简后再上传。')
      if (prdFileInputRef.current) prdFileInputRef.current.value = ''
      return
    }

    setIsReadingPrdFile(true)
    setUploadError('')

    try {
      const parsedFile = await parsePrdFile(file)
      if (!parsedFile.text.trim()) {
        setUploadError('没有读取到可拆分的文本内容。')
        return
      }

      setPrdInput(parsedFile.text)
      setUploadedPrdFileName(file.name)
      setUploadedPrdFile(parsedFile)
      setSkillResult(null)
      setConfirmationAnswers({})
      setConfirmationNote('')
      setCreatedIds([])
      clearError()
    } catch {
      setUploadError('文件读取失败，请换一个可解析的 PDF、DOCX 或文本格式文件。')
    } finally {
      setIsReadingPrdFile(false)
      setIsDraggingPrdFile(false)
      if (prdFileInputRef.current) prdFileInputRef.current.value = ''
    }
  }

  const clearUploadedPrdFile = () => {
    setUploadedPrdFileName('')
    setUploadedPrdFile(null)
    setUploadError('')
  }

  const handlePrdDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDraggingPrdFile(false)
    handlePrdFileUpload(event.dataTransfer.files?.[0])
  }

  const runSkill = async (withConfirmation = false) => {
    if (!activeSkill?.enabled || activeInput.trim().length === 0) return

    if (activeSkillId === 'link-to-evidence') {
      if (!linkMindReady) {
        setSkillResult(null)
        setLinkImportError('LinkMind 插件未安装或未启用，请先在设置中心安装并启用。')
        return
      }
      setLinkImportError('')
      setIsImportingLink(true)
      try {
        const linkResult = await importLink(activeInput)
        if (linkResult.status === 'completed' && linkResult.candidates.length > 0) {
          setLinkCandidates(linkResult.candidates)
          setLinkImportMeta({
            importId: linkResult.importId || '',
            knowledgeItemId: linkResult.knowledgeItemId || '',
            url: linkResult.candidates[0]?.sourceUrl || activeInput.trim(),
            sourceSummary: linkResult.sourceSummary,
          })
          setSkillResult({
            analysisSummary: linkResult.sourceSummary || `已从 ${linkResult.candidates.length} 条证据生成候选气泡`,
            needsConfirmation: false,
            confidence: 1,
            confirmationPrompt: '',
            clarificationQuestions: [],
            candidateBubbles: linkResult.candidates.map((candidate) => ({
              title: candidate.title,
              content: candidate.content,
              tag: candidate.tag,
              rationale: candidate.rationale,
            })),
            suggestedNextActions: ['确认后生成气泡', '进入画布继续整理'],
          })
          setCreatedIds([])
        } else {
          setSkillResult(null)
          setLinkImportError(linkResult.message || '导入失败，请稍后重试。')
        }
      } catch {
        setSkillResult(null)
        setLinkImportError('导入过程出现异常，请稍后重试。')
      } finally {
        setIsImportingLink(false)
      }
      return
    }

    const answers = Object.entries(confirmationAnswers)
      .map(([id, answer]) => {
        const question = skillResult?.clarificationQuestions.find((item) => item.id === id)
        return answer.trim()
          ? `${question?.label || id}：${answer.trim()}`
          : ''
      })
      .filter(Boolean)

    const result = await runWorkshopSkill({
      skillId: activeSkillId,
      input: activeInput,
      confirmationNotes: withConfirmation
        ? [...answers, confirmationNote.trim()].filter(Boolean).join('\n')
        : '',
      previousQuestions: skillResult?.clarificationQuestions || [],
      previousBubbles: skillResult?.candidateBubbles || [],
    })

    if (result) {
      setSkillResult(result)
      setCreatedIds([])
    }
  }

  const createBubbles = () => {
    if (createdIds.length > 0) return createdIds
    if (!activeSkill?.enabled || previewBubbles.length === 0) return []
    const sourceGroupId = `${activeSkillId}-${Date.now().toString(36)}`
    const isLinkSkill = activeSkillId === 'link-to-evidence'
    const ids = previewBubbles.map((bubble: WorkshopCandidateBubble, index: number) => {
      const linkBubble = isLinkSkill ? linkCandidates[index] : undefined
      const sourceMeta: ImportedSourceMeta | undefined = isLinkSkill && linkImportMeta && linkBubble
        ? {
          importId: linkImportMeta.importId,
          knowledgeItemId: linkImportMeta.knowledgeItemId,
          url: linkBubble.sourceUrl || linkImportMeta.url,
          platform: guessPlatformFromUrl(linkImportMeta.url),
          accessedAt: new Date().toISOString(),
          sourceType: 'market',
          snippet: linkImportMeta.sourceSummary,
          evidenceType: linkBubble.evidenceType,
        }
        : undefined
      return addBubble(
        bubble.content,
        bubble.tag || (activeSkillId === 'idea-to-bubbles' ? '创意工坊' : activeSkillId === 'prd-to-bubbles' ? 'PRD拆解' : '外部证据'),
        (index % 3) * 240 - 240,
        Math.floor(index / 3) * 150 - 120,
        {
          sourceSkillId: activeSkillId,
          sourceGroupId,
          sourceLabel: isLinkSkill
            ? '从链接导入研究材料'
            : activeSkillId === 'idea-to-bubbles'
              ? '一句话生成模块气泡'
              : 'PRD 拆解 / 文档气泡化',
          sourceFileName: activeSkillId === 'prd-to-bubbles' ? uploadedPrdFileName || undefined : undefined,
          ...(sourceMeta ? { source: sourceMeta } : {}),
        },
      )
    })
    setCreatedIds(ids)
    setSelectedBubbleIds(ids)
    setActiveBubble(ids[0] || null, { includeInSelection: false })
    return ids
  }

  const goToCanvas = () => {
    const ids = createBubbles()
    if (ids.length === 0) return
    navigate('/')
  }

  const goToPrdOutput = () => {
    const ids = createBubbles()
    if (ids.length === 0) return
    navigate('/prd', {
      state: {
        preselectedBubbleIds: ids,
        from: 'workshop',
      },
    })
  }

  return (
    <div className="h-screen bg-background dot-grid-bg relative overflow-hidden">
      <div className="relative z-10 h-full p-6">
        <section className="absolute left-6 top-20 bottom-6 w-[320px] floating-window liquid-vessel rounded-[32px] p-5 overflow-hidden flex flex-col">
          <div className="mb-4 flex items-center gap-2">
            <Boxes size={17} className="text-secondary" />
            <div>
              <div className="text-[15px] font-semibold text-on-surface">创意工坊</div>
              <div className="text-[11px] text-outline">{enabledSkills.length} 个可用 skill</div>
            </div>
          </div>

          <div className="edge-fade-scroll-soft space-y-2 overflow-y-auto pr-1 pb-8">
            {visibleSkills.map((skill) => {
              const active = activeSkillId === skill.id
              return (
                <button
                  key={skill.id}
                  onClick={() => setActiveSkill(skill.id)}
                  className={`surface-list-card w-full rounded-[24px] p-3 text-left transition-all ${
                    active
                      ? 'text-on-surface'
                      : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                  style={active
                    ? {
                      backgroundColor: `${SKILL_ACCENT[skill.id]}10`,
                      borderColor: `${SKILL_ACCENT[skill.id]}3d`,
                      boxShadow: `inset 0 1px 1px rgba(255,255,255,.62), 0 0 0 2px ${SKILL_ACCENT[skill.id]}0f`,
                    }
                    : undefined}
                >
                  <div className="flex items-start gap-2">
                    <span
                      className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: SKILL_ACCENT[skill.id] }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold text-on-surface">{skill.name}</div>
                      <div className="mt-1 text-[11px] leading-5 text-on-surface-variant">{skill.description}</div>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className="rounded-full bg-white/42 px-2 py-0.5 text-[10px] text-outline">
                          {skill.type}
                        </span>
                        <span
                          onClick={(event) => {
                            event.stopPropagation()
                            toggleSkill(skill.id)
                          }}
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            skill.enabled ? 'bg-white/58' : 'bg-white/50 text-outline'
                          }`}
                          style={skill.enabled ? { color: SKILL_ACCENT[skill.id] } : undefined}
                        >
                          {skill.enabled ? '已启用' : '已停用'}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </section>

        <section className="absolute left-[370px] right-6 top-20 bottom-6 floating-window liquid-vessel rounded-[32px] overflow-hidden flex">
          <div className="edge-fade-scroll-soft w-[44%] min-w-[360px] border-r border-outline-variant/20 p-6 overflow-y-auto">
            <div className="mb-5 flex items-center gap-2">
              {activeSkillId === 'idea-to-bubbles'
                ? <WandSparkles size={18} style={{ color: SKILL_ACCENT[activeSkillId] }} />
                : <FileText size={18} style={{ color: SKILL_ACCENT[activeSkillId] }} />}
              <div>
                <div className="text-[16px] font-semibold text-on-surface">{activeSkill?.name}</div>
                <div className="text-[12px] text-outline">{activeSkill?.enabled ? 'AI 实时运行' : '当前已停用'}</div>
              </div>
            </div>

            {activeSkillId === 'idea-to-bubbles' || activeSkillId === 'link-to-evidence' ? (
              <textarea
                value={ideaInput}
                onChange={(event) => updateInput(event.target.value)}
                className="input-field min-h-[180px] w-full resize-none text-[14px] leading-7"
                placeholder={activeSkillId === 'link-to-evidence' ? '粘贴外部链接（视频/文章 URL）...' : '输入一句初步设想...'}
              />
            ) : (
              <div className="space-y-3">
                <input
                  ref={prdFileInputRef}
                  type="file"
                  accept={PRD_UPLOAD_ACCEPT}
                  className="hidden"
                  onChange={(event) => handlePrdFileUpload(event.target.files?.[0])}
                />
                <div
                  onDragEnter={(event) => {
                    event.preventDefault()
                    setIsDraggingPrdFile(true)
                  }}
                  onDragOver={(event) => {
                    event.preventDefault()
                    setIsDraggingPrdFile(true)
                  }}
                  onDragLeave={() => setIsDraggingPrdFile(false)}
                  onDrop={handlePrdDrop}
                  className={`rounded-[24px] p-2 transition-all ${
                    isDraggingPrdFile
                      ? 'bg-secondary-container/30 ring-1 ring-secondary/35'
                      : 'bg-white/18 ring-1 ring-white/35'
                  }`}
                  data-testid="prd-upload-dropzone"
                >
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => prdFileInputRef.current?.click()}
                      disabled={isReadingPrdFile || isLoading}
                      className="flex h-10 items-center justify-center gap-2 rounded-full bg-white/45 px-4 text-[12px] font-semibold text-secondary ring-1 ring-secondary/18 transition-all hover:bg-secondary-container/45 disabled:cursor-not-allowed disabled:opacity-45"
                      data-testid="prd-upload-button"
                    >
                      {isReadingPrdFile ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                      上传文档
                    </button>
                    {uploadedPrdFileName && (
                      <div className="min-w-0 flex flex-1 items-center gap-1.5 rounded-full bg-white/42 px-3 py-2 text-[11px] text-on-surface-variant ring-1 ring-white/55">
                        <Paperclip size={12} className="shrink-0 text-secondary" />
                        <span className="min-w-0 flex-1 truncate">{uploadedPrdFileName}</span>
                        <button
                          type="button"
                          onClick={clearUploadedPrdFile}
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-outline transition-all hover:bg-white/60 hover:text-on-surface"
                          title="移除文件标记"
                        >
                          <X size={11} />
                        </button>
                      </div>
                    )}
                  </div>
                  {uploadedPrdFile && (
                    <div className="mt-2 rounded-[18px] bg-white/40 px-3 py-2 text-[11px] leading-4 text-on-surface-variant ring-1 ring-white/55" data-testid="prd-file-preview">
                      <div className="mb-1 flex items-center justify-between gap-2 text-outline">
                        <span>{uploadedPrdFile.fileType.toUpperCase()} · {uploadedPrdFile.characterCount.toLocaleString()} 字符</span>
                        <span>{Math.max(1, Math.round(uploadedPrdFile.byteSize / 1024)).toLocaleString()} KB</span>
                      </div>
                      <div className="line-clamp-2">{uploadedPrdFile.summary || '已读取文件内容。'}</div>
                    </div>
                  )}
                </div>
                {uploadError && (
                  <div className="rounded-[18px] bg-error-container/55 px-3 py-2 text-[11px] leading-4 text-on-error-container ring-1 ring-error/15" data-testid="prd-upload-error">
                    {uploadError}
                  </div>
                )}
                <textarea
                  value={prdInput}
                  onChange={(event) => updateInput(event.target.value)}
                  className="input-field min-h-[240px] w-full resize-none text-[13px] leading-6"
                  placeholder="粘贴 PRD 草稿或 Markdown 文档..."
                  data-testid="prd-input"
                />
              </div>
            )}

            <button
              onClick={() => runSkill(false)}
              disabled={!activeSkill?.enabled || activeInput.trim().length === 0 || isLoading || isImportingLink}
              className="btn-liquid mt-4 flex w-full items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-40"
              data-testid="run-workshop-skill"
            >
              {(isLoading || isImportingLink) ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {activeSkillId === 'link-to-evidence'
                ? (isImportingLink ? '正在导入...' : '导入并分析')
                : '运行 AI Skill'}
            </button>

            {(error || linkImportError) && (
              <div className="mt-4 rounded-[22px] bg-error-container/60 p-3 text-[12px] leading-5 text-on-error-container ring-1 ring-error/15">
                <div className="mb-1 flex items-center gap-2 font-semibold">
                  <AlertCircle size={14} />
                  {activeSkillId === 'link-to-evidence' ? '导入失败' : 'AI skill 运行失败'}
                </div>
                {error || linkImportError}
              </div>
            )}

            {skillResult && (
              <div className="mt-4 space-y-3">
                <div className="rounded-[22px] bg-white/40 p-3 text-[12px] leading-5 text-on-surface-variant ring-1 ring-white/55">
                  <div className="mb-1 font-semibold text-on-surface">AI 分析</div>
                  <div>{skillResult.analysisSummary || 'AI 已生成候选气泡。'}</div>
                  <div className="mt-2 text-[11px] text-outline">
                    置信度 {Math.round((skillResult.confidence || 0) * 100)}%
                    {skillResult.needsConfirmation ? ' · 建议补充确认' : ' · 可直接生成'}
                  </div>
                </div>

                {(skillResult.confirmationPrompt || skillResult.clarificationQuestions.length > 0) && (
                  <div className="rounded-[22px] bg-white/40 p-3 ring-1 ring-white/55">
                    <div className="mb-2 text-[12px] font-semibold text-on-surface">确认与澄清</div>
                    {skillResult.confirmationPrompt && (
                      <div className="mb-3 text-[12px] leading-5 text-on-surface-variant">{skillResult.confirmationPrompt}</div>
                    )}
                    <div className="space-y-2">
                      {skillResult.clarificationQuestions.map((question) => (
                        <label key={question.id} className="block">
                          <span className="mb-1 block text-[11px] font-semibold" style={{ color: SKILL_ACCENT[activeSkillId] }}>{question.label}</span>
                          <span className="mb-1 block text-[12px] leading-5 text-on-surface">{question.question}</span>
                          {question.reason && (
                            <span className="mb-1 block text-[11px] leading-4 text-outline">{question.reason}</span>
                          )}
                          <input
                            value={confirmationAnswers[question.id] || ''}
                            onChange={(event) => setConfirmationAnswers((state) => ({ ...state, [question.id]: event.target.value }))}
                            className="input-field h-10 w-full text-[12px]"
                            placeholder={question.placeholder}
                          />
                        </label>
                      ))}
                    </div>
                    <textarea
                      value={confirmationNote}
                      onChange={(event) => setConfirmationNote(event.target.value)}
                      className="input-field mt-3 min-h-[76px] w-full resize-none text-[12px] leading-5"
                      placeholder="也可以直接写你的整体确认或修正..."
                    />
                    <button
                      onClick={() => runSkill(true)}
                      disabled={isLoading}
                      className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-full bg-secondary-container/45 text-[12px] font-semibold text-secondary transition-all hover:bg-secondary-container disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {isLoading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                      吸收确认并更新预览
                    </button>
                  </div>
                )}

                <button
                  onClick={createBubbles}
                  disabled={previewBubbles.length === 0}
                  className="btn-liquid flex w-full items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-40"
                  data-testid="create-workshop-bubbles"
                >
                  <Plus size={14} />
                  确认生成气泡
                </button>
              </div>
            )}

            {createdIds.length > 0 && (
              <div className="mt-4 rounded-[22px] bg-white/40 p-3 text-[12px] text-on-surface-variant ring-1 ring-white/55">
                <div className="flex items-center gap-2 font-semibold text-secondary">
                  <PackageCheck size={14} />
                  已生成 {createdIds.length} 个气泡
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    onClick={goToCanvas}
                    className="flex h-9 items-center justify-center gap-1.5 rounded-full bg-white/45 text-[11px] font-semibold text-on-surface transition-all hover:bg-secondary-container/45 hover:text-secondary"
                  >
                    <SquareArrowOutUpRight size={12} />
                    回到画布
                  </button>
                  <button
                    onClick={goToPrdOutput}
                    className="flex h-9 items-center justify-center gap-1.5 rounded-full bg-secondary-container/55 text-[11px] font-semibold text-secondary transition-all hover:bg-secondary-container"
                    data-testid="go-to-prd-output"
                  >
                    <ArrowRight size={12} />
                    进入 PRD
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="edge-fade-scroll-soft min-w-0 flex-1 p-6 overflow-y-auto">
            <div className="mb-4 flex items-center justify-between">
              <div className="text-[15px] font-semibold text-on-surface">输出预览</div>
              <div className="text-[11px] text-outline">{previewBubbles.length} 个候选气泡</div>
            </div>

            {previewBubbles.length === 0 ? (
              <div className="flex h-full items-center justify-center text-center">
                <div>
                  <Sparkles size={42} className="mx-auto mb-3 text-outline-variant" />
                  <div className="text-[13px] text-on-surface-variant">等待 AI skill 分析输入内容</div>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                {previewBubbles.map((bubble, index) => (
                  <div
                    key={`${bubble.title}-${bubble.content}-${index}`}
                    className="selectable-bubble-card rounded-[24px] p-4"
                    style={{
                      '--bubble-border': `${SKILL_ACCENT[activeSkillId]}38`,
                      '--bubble-border-strong': `${SKILL_ACCENT[activeSkillId]}58`,
                      '--bubble-tint': `${SKILL_ACCENT[activeSkillId]}0b`,
                    } as React.CSSProperties}
                  >
                    <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold text-secondary">
                      <Check size={12} />
                      气泡 {index + 1} · {bubble.title}
                    </div>
                    <div className="whitespace-pre-wrap text-[13px] leading-6 text-on-surface">{bubble.content}</div>
                    {bubble.rationale && (
                      <div className="mt-3 border-t border-outline-variant/25 pt-2 text-[11px] leading-5 text-outline">
                        {bubble.rationale}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
