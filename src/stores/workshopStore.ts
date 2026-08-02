import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type WorkshopSkillId = 'idea-to-bubbles' | 'prd-to-bubbles' | 'link-to-evidence'

export interface WorkshopSkill {
  id: WorkshopSkillId
  name: string
  type: 'bubble-generator' | 'prd-parser' | 'link-importer'
  description: string
  enabled: boolean
  installedAt: string
}

interface WorkshopState {
  skills: WorkshopSkill[]
  activeSkillId: WorkshopSkillId
  setActiveSkill: (id: WorkshopSkillId) => void
  toggleSkill: (id: WorkshopSkillId) => void
}

const now = new Date().toISOString()

const defaultSkills: WorkshopSkill[] = [
  {
    id: 'idea-to-bubbles',
    name: '一句话生成模块气泡',
    type: 'bubble-generator',
    description: '从初步设想中拆出用户、场景、价值、风险、验证和下一步。',
    enabled: true,
    installedAt: now,
  },
  {
    id: 'prd-to-bubbles',
    name: 'PRD 拆解 / 文档气泡化',
    type: 'prd-parser',
    description: '把 PRD 草稿反向结构化为模块、约束、风险和验证气泡。',
    enabled: true,
    installedAt: now,
  },
  {
    id: 'link-to-evidence',
    name: '从链接导入研究材料',
    type: 'link-importer',
    description: '粘贴外部链接，由 LinkMind 采集证据，转换为证据/推断/不确定气泡。',
    enabled: true,
    installedAt: now,
  },
]

export const useWorkshopStore = create<WorkshopState>()(persist((set) => ({
  skills: defaultSkills,
  activeSkillId: 'idea-to-bubbles',

  setActiveSkill: (id) => set({ activeSkillId: id }),

  toggleSkill: (id) => set((state) => ({
    skills: state.skills.map((skill) =>
      skill.id === id ? { ...skill, enabled: !skill.enabled } : skill
    ),
    activeSkillId: state.activeSkillId === id && state.skills.find((skill) => skill.id === id)?.enabled
      ? state.skills.find((skill) => skill.id !== id && skill.enabled)?.id || state.activeSkillId
      : state.activeSkillId,
  })),
}), {
  name: 'aethel-workshop-store',
  storage: createJSONStorage(() => localStorage),
  merge: (persisted, current) => {
    const persistedState = persisted as Partial<WorkshopState> | undefined
    const persistedSkills = persistedState?.skills || []
    return {
      ...current,
      ...persistedState,
      skills: defaultSkills.map((skill) => ({
        ...skill,
        ...(persistedSkills.find((item) => item.id === skill.id) || {}),
      })),
    }
  },
}))
