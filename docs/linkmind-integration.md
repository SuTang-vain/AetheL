# LinkMind 集成方案

> 状态：草案（feature/linkmind-integration 分支）
> 关联仓库：`/Users/tangyaoyue/DEV/workflow`（LinkMind / 链藏，`main` 分支，commit `b268278`）
> 集成方向：API 级集成。AetheL 作为 LinkMind 的客户端，不合并代码、不引入 PostgreSQL。

## 1. 背景

- **LinkMind（链藏）**：把"收藏了却一直没看"的内容转化为 Obsidian 知识的主动 Agent。成熟能力：链接清洗、平台识别、字幕/转录读取、三层 AI 管线（证据蒸馏 → 知识文章 → 认知行动）、Agent 决策策略、Obsidian 增量同步。
- **AetheL**：面向产品构思的 AI 认知工作区。成熟能力：气泡画布、AI 归类、认知快照（语义锚点/唤醒指令/渐进披露）、创意工坊、PRD 输出、多 AI 服务商 fallback。
- **核心缺口互补**：
  - AetheL 最缺"外部证据层"——`docs/todo/backend-ai.md` 规划的"联网产品研究 Skill"和 `docs/todo/data-storage.md` 规划的 `ExternalEvidenceSource` 均未实现，且无任何链接获取能力。
  - LinkMind 缺产品思考场景落地——它的产出是 Obsidian 知识笔记，没有"把知识转化为产品决策"的认知工作区。

结合目标：**让用户粘贴外部链接，LinkMind 负责采集与证据蒸馏，AetheL 负责把证据转化为产品气泡与认知快照，形成"外部证据 → 产品思考 → PRD"的完整闭环。**

## 2. 能力对照

| 维度 | LinkMind | AetheL | 结合方式 |
| --- | --- | --- | --- |
| 外部内容获取 | ✅ 链接清洗/平台识别/转录 | ❌ 无 | AetheL 调 LinkMind `/imports` |
| 证据蒸馏 | ✅ evidenceUnits/inferences/uncertainties | ❌ 无 | 字段映射为三类气泡 |
| 结构化 AI 输出 | Zod + JSON-Schema strict + 重试 | 多 provider fallback + 缓存 + 指标 | 各自保留，不互通（可后对齐） |
| 认知压缩 | ❌（只有知识文章） | ✅ 认知快照 5 层架构 | 证据 → 快照输入 |
| 主动 Agent | ✅ 决策策略/反馈闭环 | ❌ 仅用户触发 | 远期：Agent 主动服务 |
| Obsidian | ✅ 增量同步协议 + 插件 | ⚠️ 规划"导出 Markdown Vault" | 复用笔记格式/同步协议 |
| 存储 | PostgreSQL | Markdown 文件 + workspace.json | 不变，仅 AetheL 侧加来源元数据 |

## 3. 集成总原则

1. **API 级集成**：AetheL 只通过 LinkMind 的 HTTP API（`contracts/openapi.yaml`）交互，不引入 Prisma/PostgreSQL，不改 LinkMind 数据模型。
2. **AetheL 后端代理**：所有 LinkMind 调用走 AetheL Express 代理（新增 `api/routes/linkmind.ts`），前端不直接访问 LinkMind 地址，密钥/地址只存在于服务端 env。
3. **数据映射在 AetheL 侧完成**：LinkMind 返回结构化 JSON，AetheL 负责转换为气泡/快照/来源元数据；LinkMind 侧零改动（P0/P1）。
4. **失败不阻塞**：沿用双方原则——LinkMind 失败时保留原始链接；AetheL 导入失败时保留用户输入并提示，不生成半成品气泡。
5. **来源可追溯**：所有由 LinkMind 导入生成的气泡必须携带来源 URL 与证据类型，AI 推断与事实证据在 UI 上可区分。

## 4. 结合点与优先级

| 优先级 | 结合点 | 内容 | LinkMind 改动 |
| --- | --- | --- | --- |
| P0 | 外部证据层（工坊"从链接导入"） | 用 LinkMind 导入管线点亮 AetheL 联网研究能力 | 无 |
| P1 | 认知产物互通 | 证据/认知行动 ↔ 快照语义锚点/唤醒指令 | 无 |
| P1 | Obsidian 出口 | AetheL 气泡/快照导出为 Obsidian Vault | 无（或复用协议） |
| P2 | 反馈闭环 | AetheL 使用行为 → AgentFeedback | 小改动（暴露 decisionId） |
| P2 | Agent 主动服务 | LinkMind Agent 对工作区做主动提醒 | 中改动 |

## 5. P0 详细设计：从链接导入研究材料

### 5.1 用户流程

```text
创意工坊
  → 输入粘贴外部链接（可多个）或"链接 + 一句话说明"
  → 选择"从链接导入" skill（新增 WorkshopSkillId: 'link-to-evidence'）
  → AetheL 后端代理 POST LinkMind /api/v1/imports（幂等）
  → 202 受理则轮询 /imports/{importId}
  → 完成后 GET /knowledge-items/{id} 取三层产出
  → 前端转换为候选气泡（证据/推断/不确定/摘要）
  → 用户确认 → 生成气泡进入画布（带来源元数据）
```

### 5.2 AetheL 侧新增/修改

| 文件 | 改动 |
| --- | --- |
| `api/routes/linkmind.ts`（新增） | 代理三个端点：`POST /imports`（带幂等键）、`GET /imports/:importId`、`GET /knowledge-items/:id`；统一错误码与超时 |
| `api/app.ts` | 挂载 `/api/linkmind` |
| `api/prompts/workshop.ts` | `WorkshopSkillId` 增加 `'link-to-evidence'`；该 skill 的 system prompt 仅用于"把蒸馏结果整理为候选气泡"（不负责采集） |
| `src/stores/workshopStore.ts` | 注册新 skill；输入检测 URL → 走 LinkMind 链路 |
| `src/lib/linkmindImport.ts`（新增） | 前端编排：幂等导入 → 轮询 → 拉取知识项 → 转换为候选气泡 |
| `api/storage/types.ts` | `StoredBubble` 扩展来源元数据（见 5.4） |
| `.env.example` | 新增 `LINKMIND_BASE_URL` 等 |

### 5.3 接口映射（LinkMind OpenAPI → AetheL）

| LinkMind | 方法/路径 | AetheL 调用 | 说明 |
| --- | --- | --- | --- |
| 创建导入 | `POST /api/v1/imports` | `POST /api/linkmind/imports` | 透传 `{url, goalId?}`，透传 `Idempotency-Key`；201 完成 / 202 受理 |
| 轮询状态 | `GET /api/v1/imports/{importId}` | `GET /api/linkmind/imports/:id` | 8 态状态机；`AUTH_REQUIRED`/`SOURCE_TRANSCRIPT_UNAVAILABLE` 等降级码透传 |
| 知识项 | `GET /api/v1/knowledge-items/{id}` | `GET /api/linkmind/knowledge-items/:id` | 取 `source`/`distillation`/`article`/`cognitiveAction` |

### 5.4 字段映射（蒸馏结果 → 气泡）

| LinkMind 字段 | AetheL 产出 | 备注 |
| --- | --- | --- |
| `distillation.sourceSummary` | 摘要气泡（tag=来源摘要） | content=压缩摘要 |
| `distillation.evidenceUnits[]`（evidenceType: TITLE/DESCRIPTION/TRANSCRIPT/METADATA） | 证据气泡（tag=外部证据） | content=证据内容；extension 记录 `evidenceType` 与 `url` |
| `distillation.inferences[]` | 推断气泡（tag=推断） | UI 标记为 AI 推断，非事实 |
| `distillation.uncertainties[]` | 开放问题气泡（tag=问题） | 对应画布"开放问题"语义 |
| `article.keyPoints[]` | 要点气泡（tag=要点） | 可选，默认只取前 3 |
| `cognitiveAction.reflectionQuestion` | 注入 `FollowUpDialog` 追问 | P1 落地 |
| `cognitiveAction.actionSuggestion` | 快照 `wakeTrigger` 素材 | P1 落地 |

所有由导入生成的气泡在 `extensions` 写入来源元数据，对齐 `docs/todo/data-storage.md` 的 `ExternalEvidenceSource` 草案：

```ts
// extensions.source 结构（新）
interface ImportedSourceMeta {
  importId: string        // LinkMind 幂等导入 id
  knowledgeItemId: string
  url: string             // 原文链接
  platform: string        // LinkMind source.platform
  accessedAt: string      // ISO
  sourceType: 'market' | 'creative' | 'regulation'  // 映射自目标/标签，默认 market
  snippet?: string        // sourceSummary 摘要
}
```

同时保留现有 `sourceSkillId: 'link-to-evidence'`、`sourceGroupId`、`sourceLabel` 约定（`docs/todo/data-storage.md` 已有 `sourceSkillId`/`sourceGroupId`/`sourceLabel`/`sourceFileName`）。

### 5.5 错误处理与降级

- 幂等：AetheL 为每次导入生成 `Idempotency-Key`（`linkmind-import-<sha1(url)>`），重复点击不重复创建。
- 轮询：间隔 2s，上限 120s；超时返回"处理中"状态让用户稍后重试，不销毁已创建气泡。
- `AUTH_REQUIRED`：提示"该平台需要登录授权"，保留链接为文本输入，不生成半成品。
- `SOURCE_TRANSCRIPT_UNAVAILABLE` / AI 失败：保存原始链接为"来源链接"气泡，标注证据不可用。
- LinkMind 不可达（`LINKMIND_BASE_URL` 未配置或连接失败）：入口隐藏并提示未连接。

### 5.6 配置

```env
# .env（AetheL 侧新增）
# LinkMind 默认端口是 3000，与 AetheL Express 冲突，约定 LinkMind 用 3100 启动：
#   cd workflow && npm run dev -- -p 3100
LINKMIND_BASE_URL=http://localhost:3100
LINKMIND_IMPORT_POLL_INTERVAL_MS=2000
LINKMIND_IMPORT_POLL_TIMEOUT_MS=120000
```

> `.env` 仅为开发/测试回退。正式形态是插件配置（见 5.7）：`LINKMIND_BASE_URL` 可由插件配置替代。

### 5.7 插件形态（实现落地，2026-08-02）

LinkMind 以**可安装插件**的形式存在于 AetheL，而非硬编码 env 配置：

- **插件清单**：`api/plugins/linkmind.manifest.json`（id/name/version/description/entrypoints.skill）；内置插件随仓库分发，`api/plugins/*.manifest.json` 自动发现；
- **安装状态**：`data/plugins/<id>.json`（`installed`/`enabled`/`config`），`AETHEL_DATA_DIR` 感知；卸载仅标记并停用，配置保留可恢复；
- **注册表**：`api/plugins/registry.ts`；API：`/api/plugins`（列表 / POST install / POST uninstall / PATCH 配置）；
- **配置解析顺序**：插件配置（已安装且启用且填了 baseUrl）→ env 回退（开发/测试）→ 未配置（503 `LINKMIND_NOT_CONFIGURED`）；
- **skill 门控**：`link-to-evidence` 仅在插件已安装且启用时出现在创意工坊（`usePluginStore.isReady('linkmind')`），未就绪时运行按钮给出引导提示；
- **设置中心"插件"分区**：安装/启用/卸载 + LinkMind 服务地址 + 轮询间隔/超时 + "测试连接"（`GET /api/linkmind/health` 直连 LinkMind `/health`）；
- **测试**：`tests/integration/plugins.test.ts` 覆盖列表/安装/配置来源切换/停用回落/卸载保留/health 代理。

## 6. P1 详细设计

### 6.1 认知产物互通（快照 ↔ 知识项）

目标：LinkMind 的三层产出直接增强 AetheL 快照，结构对齐：

| LinkMind | AetheL 快照 | 用途 |
| --- | --- | --- |
| `distillation.uncertainties` | `cognitiveGaps` | 认知缺口输入 |
| `distillation.evidenceUnits`（筛选事实类） | `semanticAnchors` 候选 | 语义锚点外部支撑 |
| `cognitiveAction.actionSuggestion` | `wakeTrigger` | 唤醒指令 |
| `cognitiveAction.reflectionQuestion` | `FollowUpDialog` 问题 | 快照恢复后追问 |

实现：`api/prompts/snapshot.ts` 的 user prompt 增加"外部证据"输入段（带 `[事实]`/`[推断]` 标记），快照 prompt 明确区分；不改快照输出 schema，仅扩展输入。风险提示：快照 AI 输出 schema 是冻结契约（`api/aiResponseSchemas.ts`），输入扩展不破坏输出兼容。

### 6.2 Obsidian 出口

两步走：

- **第一步（轻量，无 LinkMind 依赖）**：新增"导出 Obsidian Vault"——把 `data/bubbles/*.md`、`data/snapshots/*.md` 按 frontmatter + 正文格式直接拷贝/生成为 Vault 目录（AetheL 的 Markdown 原子文件格式与 Obsidian 天然兼容，frontmatter 已是 YAML）。
- **第二步（复用 LinkMind 同步协议）**：AetheL 作为设备接入 LinkMind `/obsidian/device-tokens` + `/obsidian/changes` + `/obsidian/sync/ack`（keyset cursor + 每设备 ack + 409 冲突副本机制），让气泡变更双向同步。此项依赖 P0 稳定后评估。

## 7. P2 详细设计（远期）

### 7.1 反馈闭环

AetheL 使用行为 → LinkMind `AgentFeedback`：

| AetheL 行为 | AgentFeedback |
| --- | --- |
| 快照被 restore | COMPLETED（这条知识被真正使用） |
| 导入气泡长期未编辑/未被选中进 PRD | TOO_LONG / ALREADY_KNOWN 方向 |
| 用户对导入气泡标记"不相关" | EXPLICIT_REJECTION |

**前置条件（需 LinkMind 小改动）**：`POST /api/v1/agent/actions` 的 `decisionId` 目前来自 Agent 决策事件；导入链路需要暴露其对应的 `decisionId`（或在 `/imports` 响应中附带），AetheL 才能记录反馈。本仓库侧先在 `docs/` 记录该需求，落地前与 LinkMind 分支协调。

### 7.2 Agent 主动服务

LinkMind `DemoAgentRuntime`（`nextDecision`/`chat`/`recordFeedback`）对 AetheL 工作区主动提醒：检测长期未回看的高权重快照 → 推送"一分钟回顾"建议。实现方式：AetheL 后端加 webhook 端点接收 LinkMind 决策推送，前端 `GlobalAIActivity` 展示。依赖 7.1 的反馈链路。

## 8. 测试与验收

沿用 AetheL 现有测试风格（`tests/integration/*.test.ts`，tsx 运行）：

| 用例 | 类型 | 内容 |
| --- | --- | --- |
| 代理转发 | 集成 | mock LinkMind 服务（如 `ai-routing.test.ts` 的 mock 方式），验证 `/api/linkmind/imports` 幂等键透传、超时、错误码归一化 |
| 转换映射 | 单测 | `distillation → 候选气泡` 纯函数：字段缺失、空数组、超长内容截断 |
| 来源元数据 | 单测 | 生成气泡的 extensions.source 字段完整性与 frontmatter 落盘 |
| UI 流程 | e2e（p1-ui.test.ts 风格） | 工坊粘贴链接 → 确认候选气泡 → 画布出现带来源标记的气泡 |

验收标准：

- [ ] 未配置 `LINKMIND_BASE_URL` 时入口隐藏、不报错
- [ ] 同一链接重复导入只创建一个 LinkMind ImportJob（幂等）
- [ ] 证据/推断/不确定三类气泡均携带 `extensions.source`，可点击跳转原文
- [ ] AI 失败时仍保留"来源链接"气泡，符合"失败不丢原始输入"

## 9. 风险与边界

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| LinkMind 未运行/端口冲突（3000） | 功能不可用 | 约定 3100 端口；入口隐藏 + 提示 |
| LinkMind 无鉴权（DEMO_USER_ID） | 局域网内他人可调用 | 仅本地回环部署；AetheL 侧代理不透出 |
| 证据字段语义漂移（LinkMind schema 升级） | 转换层解析失败 | 转换函数对未知字段宽容；契约以 `contracts/openapi.yaml` 为准，升级前 diff |
| 用户区 vs AI 区边界 | AI 产出不得覆盖用户编辑 | 导入生成的气泡落画布后即视为用户所有，后续不自动改写 |
| 单机数据与远程服务耦合 | AetheL 离线不可用 | 导入是显式操作，非后台依赖；气泡落盘后即脱离 LinkMind |

## 10. 里程碑

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| M1（P0） | env 配置 + 后端代理 + 工坊新 skill + 转换层 + 气泡来源元数据 + 测试 | 5.5 验收标准全过 |
| M2（P1） | 快照输入扩展（外部证据段）+ 追问注入 | 快照生成带外部证据标记 |
| M3（P1） | Obsidian Vault 导出 | 导出目录可在 Obsidian 打开 |
| M4（P2） | 反馈闭环 + Agent 主动服务 | 需 LinkMind 配合改动 |

## 11. 决策记录（ADR）

- **ADR-1**：API 级集成而非代码合并。原因：技术栈差异（Next.js/Prisma vs Express/文件存储）、LinkMind 是大赛成品仓库不宜侵入、P0 目标零改动 LinkMind。
- **ADR-2**：AetheL 后端做代理。原因：前端不暴露服务地址、错误码可统一归一化、复用 AetheL 现有的 500/502/503/504 不回退策略（`src/lib/apiClient.ts`）。
- **ADR-3**：LinkMind 约定 3100 端口。原因：Next.js 默认 3000 与 AetheL Express 冲突。
- **ADR-4**：证据/推断/不确定 → 三类气泡 + `extensions.source`。原因：对齐画布既有语义（问题/风险/证据标签）与 `ExternalEvidenceSource` 草案，来源可追溯。
- **ADR-5**：导入链路"先落气泡、再进快照"。原因：气泡是主工作区，快照是记忆层；P0 只做气泡，快照增强（P1）在气泡稳定后做。
- **ADR-6**：AetheL 自身 LLM 引擎增加"本地 Agent CLI 驱动"能力（Claude Code / Codex / ZCode），独立设计见 `docs/local-agent-cli-driver.md`。与 LinkMind 集成并行推进，二者在 `isAIProviderConfigured` 判定重构处汇合。

## 12. 关联方案：本地 Agent CLI 驱动

AetheL 的 LLM 驱动层将支持通过本地 CLI 调用本地 agent（Claude Code / Codex / ZCode），作为与 ModelScope/DeepSeek/Moonshot 并列的 provider（详见 [local-agent-cli-driver.md](./local-agent-cli-driver.md)）。与本文档的协同点：

1. P0 的"蒸馏结果 → 候选气泡"转换是轻量任务，用户配置本地 agent 时可本地执行，省 API 配额；
2. 本地 agent 可作为 LinkMind 不可达时的降级证据整理器（仅整理已有材料，不替代 LinkMind 采集管线）；
3. 两方案共用 `isAIProviderConfigured` 判定重构，建议本地 agent M1 优先落地，再做 LinkMind P0 的 412 守卫调整。
