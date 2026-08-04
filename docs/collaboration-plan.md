# 双线并行开发协作方案

> 状态：执行中（人员与沟通渠道已按 2026-08-02 项目启动会确定，见 §1、§7）
> 背景：两条功能线（A：LinkMind 外部证据层集成；B：本地 Agent CLI 驱动）分别由不同开发者开发。
> 依据：`docs/linkmind-integration.md`、`docs/babel-ai-engine.md`（契约事实源）。
> 来源：2026-08-02 启动会纪要（含原始转录）：https://dcnk566ts94k.feishu.cn/docx/K9TadjJCVobhnRxvSKUcGoqXnpc
> 参考：LinkMind 仓库自身的 `docs/development-workflow.md`（四人并行工作流，本方案沿用其"契约冻结 + 短分支 + 小 PR"原则）。

## 1. 分工总览

| 开发者 | 工作线 | 交付物 |
| --- | --- | --- |
| 苏棠（Dev A） | 链路 A：LinkMind 集成 | `linkmind-integration.md` 的 P0/P1（外部证据层、快照互通） |
| 苏和（Dev B） | 链路 B：BabeL-O AI 引擎接入 | `babel-ai-engine.md` 的 M1/M2（chat completions 端点、AetheL provider 接入、memory 与模型列表） |
| 越天野（学长） | 体验测试 / 用户引导自动化 / 记忆预测调研 / live2D 桌宠 | 验收清单、引导方案、记忆方案调研 |
| 苏棠主导、苏和评审 | 共享基础 | `isAIProviderConfigured` 重构 + AIProvider 扩展 + CI 设施 |

> 角色以 Dev A / Dev B 标识保持通用性，人员变动时仅需更新本表映射。

核心原则：

1. **契约先行**：两份方案文档是事实源，先合入 `main` 作为冻结契约；
2. **边界清晰**：按文件所有权划分（§3），共享改动集中在一个前置基础 PR（§4）；
3. **小 PR 高频合入**：PR < 400 行、寿命 ≤ 2 天、CI 全绿才合；
4. **接缝处设联合验收**：两条线唯一的业务交汇点是"转换层可走本地 agent"（§6）。

## 2. 依赖与冲突面分析（为什么可以并行）

### 2.1 依赖矩阵

| | 链路 A（LinkMind） | 链路 B（本地 agent） |
| --- | --- | --- |
| 链路 A 依赖 B？ | 否（P0 核心不依赖本地 agent） | — |
| 链路 B 依赖 A？ | 否（M1/M2 不依赖 LinkMind） | — |
| 共同依赖 | `aiProfiles.ts` 的 provider 判定、`routes/ai.ts` 的 412 守卫、`pages/Settings.tsx` | 同左 |

结论：**两条线业务正交**（一个管外部输入，一个管本地算力），真正的冲突面只有 4 处共享文件，且全部可以通过"前置基础 PR + 页面分区"隔离。

### 2.2 共享触点清单

| 文件 | 冲突原因 | 隔离策略 |
| --- | --- | --- |
| `api/aiProfiles.ts` | B 要扩展 `AIProvider` 联合类型与 configured 判定；A 的 412 守卫调整依赖同一判定 | 基础 PR 先落地 `isAIProviderConfigured()`，此后 B 独占该文件 |
| `api/routes/ai.ts` | B 改 `createChatCompletion` 分发 + 412；A 不改此文件 | A 只新增 `routes/linkmind.ts`，不动 `ai.ts` |
| `pages/Settings.tsx` | B 加"本地 Agent"配置区；A 要加 LinkMind 服务地址配置 | 按 tab 分区：AI 引擎区归 B，集成/数据区归 A，基础 PR 先建好分区骨架 |
| `.env.example` | 双方都加 env | 分区块追加，低风险 |

## 3. 文件所有权表

| 文件/目录 | 拥有者 | 类型 |
| --- | --- | --- |
| `docs/linkmind-integration.md` | A | 独占 |
| `docs/local-agent-cli-driver.md` | B | 独占 |
| `docs/collaboration-plan.md` | 双方 | 共享（变更需双方同意） |
| `api/routes/linkmind.ts`（新增） | A | 独占 |
| `api/app.ts`（挂载 linkmind 路由） | A | 独占（B 不在此文件加东西） |
| `api/prompts/workshop.ts`（link-to-evidence） | A | 独占 |
| `src/lib/linkmindImport.ts`（新增） | A | 独占 |
| `src/stores/workshopStore.ts` | A | 独占（B 不改） |
| `tests/integration/linkmind-import.test.ts`（新增） | A | 独占 |
| `api/localAgent/`（新增） | B | 独占 |
| `api/aiProfiles.ts` | B | 基础 PR 后独占 |
| `api/routes/ai.ts` | B | 独占（A 只读） |
| `api/aiMetrics.ts` | B | 独占 |
| `pages/Settings.tsx` | 分区 | 共享：AI 引擎区 = B，集成区 = A |
| `tests/integration/local-agent.test.ts`（新增） | B | 独占 |
| `.github/workflows/ci.yml`（新增） | 基础 PR | 共享 |
| 接缝测试 `tests/integration/seam-transform.test.ts`（新增） | A 写用例，B 提供 mock adapter | 联合 |

规则：**独占文件不做他人重构**；非自己的文件只读，改动必须通过对方 review。

## 4. 契约冻结：共享基础 PR（第 1 天完成）

内容（一个 PR，≤ 400 行，A 主导、B 评审，或反之）：

1. 两份方案文档合入 `main`（先单独一个 docs-only PR，或与基础 PR 同批）；
2. `api/aiProfiles.ts`：`AIProvider` 联合类型增加 `'local-cli'` + `isAIProviderConfigured()`（托管查 key、local-cli 查二进制探测）——**只建判定函数与注册壳，adapter 空实现**；
3. `api/routes/ai.ts`：412 守卫从 `!aiConfig.apiKey` 切换到 `isAIProviderConfigured()`；
4. `pages/Settings.tsx`：建好"AI 引擎 / 集成与数据"分区骨架；
5. **CI 设施**：`.github/workflows/ci.yml` 跑 `npm run check` + `npm run lint` + `npm run test:integration`（当前仓库无 CI，两人协作前必须补，否则回归无人兜底）；
6. 冻结的接口签名登记表（见下）。

冻结签名（后续变更必须同 PR 更新对应方案文档）：

```ts
isAIProviderConfigured(configs: Record<AIProvider, AIConfig>): boolean
// LocalAgentAdapter / createLocalCLICompletion / /api/linkmind/* / link-to-evidence
// 见 docs/local-agent-cli-driver.md §3.2 与 docs/linkmind-integration.md §5.2
```

## 5. 分支与合入策略

```text
main（保护）
 ├── 基础 PR：docs + isAIProviderConfigured + CI        （双方评审）
 ├── feature/linkmind-integration   ← 苏棠（Dev A）工作线（已存在）
 └── feature/babel-ai-engine         ← 苏和（Dev B）工作线（原 local-agent-cli-driver，已更名）
```

- 双方从 `main`（基础 PR 合入后）拉各自分支，**不再从彼此的 feature 分支拉**；
- PR 规范：< 400 行；寿命 ≤ 2 天；CI 全绿；评审人为对方开发者；
- 合入节奏：每完成一个里程碑切片（§8）即合入 `main`，**不让分支长寿化**；
- 冲突处理：共享文件冲突由基础 PR 已隔离，若仍发生 → 双方先对齐契约再改代码，不硬解 merge；
- LinkMind 侧（workflow 仓库）：P0/P1 零改动；Dev A 在需要 P2 改动时，在 workflow 仓库另开分支（沿用其 `module/*` 约定），AetheL 侧用 pin 的 commit 版本联调。

## 6. 测试所有权与接缝验收

- 各自独占测试（§3）自己写、自己维护；
- 接缝联合用例（唯一业务交汇点）：

```text
场景：LOCAL_AGENT_ENABLED_PROFILES 含 workshop-transform 时，
      链路 A 的"蒸馏结果 → 候选气泡"转换由本地 agent 执行。
用例：A 提供转换编排 + mock adapter 桩；B 提供 LocalAgentAdapter 接口实现；
      测试在本地 agent 不可用时自动 skip（沿用 ai-routing.test.ts 的 mock 风格）。
```

- 联合验收清单（每条合入 main 时双方各过一遍）：

- [ ] `npm run check` / `lint` / `test:integration` 全绿
- [ ] 契约签名未漂移（对照两份方案文档）
- [ ] Settings 分区互不覆盖
- [ ] 端到端手动冒烟（粘贴链接 → 证据气泡；本地 agent 生成快照）

## 7. 沟通与决策机制

- **主沟通渠道**：飞书群（苏棠飞书常看）；技术问题、开发周期紧张、人力缺乏随时群内提出，人力不足可再拉人；
- **会议纪要**：2026-08-02 启动会纪要（含原始转录）：https://dcnk566ts94k.feishu.cn/docx/K9TadjJCVobhnRxvSKUcGoqXnpc；
- **开发记录表**（飞书多维表格，进度事实源）：https://dcnk566ts94k.feishu.cn/base/LqZEb22h4aJHhOsn7pec8tATnhd ；仓库不双写进度，状态以表为准，合入 main 时与周复盘时更新；
- **每日 15 分钟同步**（异步亦可）：昨天合入、今天计划、阻塞点；
- **决策记录**：继续沿用方案文档的 ADR 编号（ADR-7 起），新决策必须写入对应方案文档，不留口头决定；
- **契约变更登记**：任何冻结签名（§4）改动 = 修改方案文档 + 通知对方，禁止单方面改；
- **演示节奏**：每条线 M 里程碑完成时给对方跑一次冒烟演示，暴露集成问题早于合入。
- **资源支持**：苏和本地开发使用 QCoder（会员由苏棠支持，预算约 140 以内）；参赛投 Q-Coder 赛道，相关素材需换 Q-Coder 标。

## 8. 里程碑与验收（两周节奏示例）

| 时间 | 里程碑 | Dev A（链路 A） | Dev B（链路 B） | 验收 |
| --- | --- | --- | --- | --- |
| Day 1 | 契约冻结 | 评审基础 PR | 评审基础 PR | 基础 PR 合入 main，CI 绿 |
| Day 2-6 | 第一切片 | P0：代理 + link-to-evidence skill + 转换层 | M1：BabeL-O chat completions 端点 + AetheL provider 接入 | 各自 PR 合入 main；越天野开始体验 demo |
| Day 7 | 联合集成 | 接缝用例（mock adapter） | 端点契约联调（local provider 冒烟） | 接缝测试绿；越天野输出首轮体验反馈 |
| Day 8-9 | 第二切片 | P1：快照互通、追问注入 | M2：memory 改接 MemoryOS + 设置页模型列表/选择器 | Settings 分区无覆盖 |
| Day 10 | 复盘 | 联合冒烟：链接→证据气泡→本地 agent 快照 | 同左 | 双线闭环 demo；越天野验收通过 |

> 说明：时间为相对节奏示例，具体以实际开发速度调整；里程碑切片可互换顺序（两条线互不阻塞）。

## 9. 风险与缓解

| 风险 | 概率/影响 | 缓解 |
| --- | --- | --- |
| 共享文件冲突（aiProfiles/Settings） | 中/高 | 基础 PR 先隔离 + 文件所有权表 + Settings 分区 |
| 无 CI 导致回归 | 高/高 | 基础 PR 强制带 CI workflow |
| 契约漂移（如 `extensions.source` 字段改动） | 中/中 | 冻结签名登记 + 变更必须更新方案文档 |
| LinkMind 远程 API 变更 | 低/中 | AetheL 侧 pin workflow commit；联调用固定版本 |
| 本地 agent 依赖机器环境（测试不可复现） | 中/中 | 接缝测试用 mock adapter；真实 CLI 只做手动冒烟 |
| 分支长寿化 → 合并地狱 | 中/高 | 里程碑切片即合入 main（§5、§8） |
| 单机端口冲突（3000） | 中/低 | 约定 LinkMind 跑 3100（方案文档 ADR-3） |

## 10. 决策记录（2026-08-02 启动会已定项）

- 分支：`feature/linkmind-integration`（苏棠）+ `feature/babel-ai-engine`（苏和），已创建并推送；
- 策略变更（2026-08）：Dev B 工作线目标由"本地 Agent CLI 驱动"调整为"BabeL-O AI 引擎接入"，分支更名，方案文档 `docs/local-agent-cli-driver.md` → `docs/babel-ai-engine.md`；
- 契约：三份方案文档已合入 `main`（`a3a9a12`、`7ad8ebe`）；
- CI：GitHub Actions 已配置（check + lint + test:integration），既有 lint 阻塞项已修复（`37dbce4`）；
- 人员与渠道：见 §1、§7。
- 待定：开发节奏按两周切片（§8）还是按周迭代，首轮合入后由团队复盘决定。
