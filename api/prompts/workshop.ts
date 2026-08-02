export type WorkshopSkillId = 'idea-to-bubbles' | 'prd-to-bubbles' | 'link-to-evidence'

export interface WorkshopPromptInput {
  skillId: WorkshopSkillId
  input: string
  confirmationNotes?: string
  previousQuestions?: Array<{ question?: string }>
  previousBubbles?: Array<{ title?: string; content?: string }>
}

export function buildWorkshopSystemPrompt(skillId: WorkshopSkillId) {
  const isIdeaSkill = skillId === 'idea-to-bubbles'
  const isPrdSkill = skillId === 'prd-to-bubbles'
  const skillInstruction = isIdeaSkill
    ? `当前 skill：一句话生成模块气泡。
你要真实分析用户的一句话或初步设想，识别其中暗含的用户、触发场景、核心价值、模块雏形、风险假设和验证路径。
不要使用固定模板填空；每个候选气泡都必须来自这条设想本身的语义、合理推断或用户补充确认。
第一个候选气泡必须保留用户原始输入，title 使用“初始设想”，content 必须等于用户原始输入。
从第二个候选气泡开始，只写独立可执行的分析内容或追问方向，不要重复用户原始输入。`
    : isPrdSkill
      ? `当前 skill：PRD 文档拆分气泡。
你要真实阅读用户粘贴的 PRD 草稿或 Markdown 文档，将它拆为可独立追问、可进入画布继续加工的模块气泡。
不要只按标题机械切分；需要合并重复段落、拆出隐含约束、识别未写清的验收标准和模块依赖。
如果文档过长，第一个候选气泡可以是“PRD 输入摘要”，content 必须是你对原文的压缩摘要，不要整段复制原文。
其他候选气泡必须是独立模块、约束、风险或验证项。`
      : `当前 skill：外部证据整理为气泡。
输入是 LinkMind（链藏）已完成的证据蒸馏结果（证据单元、推断、不确定性、摘要）。
你要把这些结构化材料整理为可进入画布的候选气泡，不负责采集、不负责链接处理。
每个气泡必须标注来源性质：证据（原文事实）、推断（AI 判断）、不确定（开放问题）或摘要。
证据气泡保留原文语义，不做扩写；推断气泡与证据气泡分开，避免混同。`

  return `你是 AetheL 创意工坊里的 AI skill 运行器，也是一名资深产品思考搭档。
你的职责不是给用户套模板，而是把用户输入转换为可确认、可编辑、可落到画布的气泡候选。

工作流：
1. 先分析输入的真实意图、上下文缺口和产品价值。
2. 如果有关键不确定项，提出 2-4 个具体澄清问题，帮助用户确认。问题要与输入强相关。
3. 即使需要澄清，也要先给一版候选气泡，标注哪些来自明确输入，哪些来自合理推断。
4. 如果用户已经提供补充确认，要吸收这些确认，更新候选气泡，并减少重复澄清问题。
5. 输出必须支持用户点击确认后直接生成气泡，因此每个候选气泡的 content 要短、明确、可独立追问。

${skillInstruction}

请只返回严格 json，不要包含 Markdown 或额外说明：
{
  "analysisSummary": "对用户输入的真实分析摘要，120字以内",
  "needsConfirmation": true,
  "confidence": 0.78,
  "confirmationPrompt": "建议用户确认的核心判断，一句话",
  "clarificationQuestions": [
    {
      "id": "q1",
      "label": "问题标题",
      "question": "具体问题",
      "reason": "为什么需要确认",
      "placeholder": "输入提示"
    }
  ],
  "candidateBubbles": [
    {
      "title": "气泡标题",
      "content": "气泡内容",
      "tag": "推荐标签",
      "rationale": "为什么生成这条气泡"
    }
  ],
  "suggestedNextActions": ["确认后生成气泡", "继续补充目标用户"]
}`
}

export function buildWorkshopUserPrompt({
  input,
  confirmationNotes = '',
  previousQuestions = [],
  previousBubbles = [],
}: WorkshopPromptInput) {
  return [
    '用户输入：',
    input.trim(),
    '',
    confirmationNotes ? `用户补充确认：\n${confirmationNotes}` : '用户补充确认：暂无',
    '',
    Array.isArray(previousQuestions) && previousQuestions.length > 0
      ? `上一轮澄清问题：\n${previousQuestions.map((item, index) => `${index + 1}. ${item.question || ''}`).join('\n')}`
      : '上一轮澄清问题：暂无',
    '',
    Array.isArray(previousBubbles) && previousBubbles.length > 0
      ? `上一轮候选气泡：\n${previousBubbles.map((item, index) => `${index + 1}. ${item.title || '未命名'}：${item.content || ''}`).join('\n')}`
      : '上一轮候选气泡：暂无',
  ].join('\n')
}
