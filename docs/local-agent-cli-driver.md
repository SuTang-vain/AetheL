# 本地 Agent CLI 驱动方案

> 状态：草案（feature/linkmind-integration 分支）
> 目标：AetheL 的 LLM 驱动层支持通过本地 CLI 调用本地 agent（Claude Code / Codex / ZCode 等），作为与 ModelScope/DeepSeek/Moonshot 并列的一等 provider。
> 关联：`docs/linkmind-integration.md`（外部证据层集成）；本方案是 AetheL 自身 AI 引擎的扩展，两者可并行推进。

## 1. 背景与目标

现状：`api/aiProfiles.ts` 只支持三个托管服务商（OpenAI-compatible chat completions），所有任务走 `runProfileCompletion` 单点管线。

预期：AetheL 的 LLM 驱动能直接调用本机安装的 agent CLI——

- **Claude Code**：`claude -p <prompt>`（print 模式，非交互）
- **Codex**：`codex exec <prompt>`（非交互执行）
- **ZCode**：headless/run 模式（以实际 `--help` 为准，本机未安装时自动跳过）

价值：

1. **本地隐私**：想法/PRD 数据不出本机，交给本地 agent 处理；
2. **无需 API Key**：没有三家服务商 key 也能使用 AI 能力；
3. **agent 化能力**：本地 agent 可读工作区文件（`data/bubbles`、`data/snapshots`），长任务（快照、长文 PRD）不必把全部内容塞进 prompt；
4. **作为 fallback 链成员**：本地 agent 失败/超时自动回退托管服务商（沿用现有机制）。

## 2. 现状接入点分析

所有 AI 调用收敛到 `api/routes/ai.ts`：

```text
runProfileCompletion(payload, profile, options)          // 单点管线
  ├─ resolveAutoCandidates(profile, configs)             // 候选 provider
  ├─ buildProfilePayload(config, payload, profile)       // 按 provider 组包
  ├─ createChatCompletion(payload, {cache, config, validate})  // OpenAI SDK 传输
  ├─ options.parse(content)                              // 运行时 schema 校验
  └─ 失败 → isFallbackError → 下一个候选                   // fallback 闭环
```

流式契约（`/api/ai/chat` SSE）：`for await (const chunk of response)`，取 `chunk.choices[0].delta.content`，写 `data: {content, done:false}`。

**结论：只需把 `createChatCompletion` 改为按 provider 分发——`local-cli` 走子进程适配层，返回与 OpenAI SDK 相同形状的响应信封，管线其余部分（候选、缓存、fallback、parse、指标）零改动。**

## 3. 设计

### 3.1 Provider 模型扩展（`api/aiProfiles.ts`）

```ts
export type AIProvider = 'modelscope' | 'deepseek' | 'moonshot' | 'local-cli'
export type LocalAgentId = 'claude' | 'codex' | 'zcode'
```

- `local-cli` 无 `apiKey`；"已配置"判定改为：托管服务商 = 有 key；`local-cli` = 二进制可探测（`which` + `--version`）。
- 需要新增 `isAIProviderConfigured()`，替换 `api/routes/ai.ts` 中多处 `!aiConfig.apiKey` 的 412 守卫（chat/categorize/snapshot 等）。
- `resolveAutoCandidates` / `providerOrder`：`local-cli` **不进入默认 auto 候选**（避免每个画布归类都拉起一个 agent 子进程）；仅以下情况参与：
  1. `AI_PROVIDER=local-cli`（显式选择）；
  2. 或 `LOCAL_AGENT_ENABLED_PROFILES` 列出的 profile（见 3.6）。

### 3.2 传输适配层（新增 `api/localAgent/`）

```ts
// api/localAgent/types.ts
export interface LocalAgentOptions {
  model?: string
  timeoutMs: number
  maxOutputChars: number
  cwd?: string
  maxTurns: number          // 纯文本任务 = 1
}

export interface LocalAgentAdapter {
  id: LocalAgentId
  detect(): boolean
  complete(prompt: string, opts: LocalAgentOptions): Promise<string>
  stream(prompt: string, opts: LocalAgentOptions): AsyncIterable<string> // 文本增量
}
```

每个 CLI 一个 adapter（`claude.ts` / `codex.ts` / `zcode.ts`），命令以参数数组 spawn（**禁止 `shell: true`**）：

| adapter | 非交互命令（以本机实际版本为准） | 说明 |
| --- | --- | --- |
| claude | `claude -p <prompt> --output-format text \| stream-json [-m model] [--max-turns 1] [--disallowedTools "*"]` | print 模式；`stream-json` 事件流映射为文本增量；MVP 禁用工具只取文本 |
| codex | `codex exec <prompt> [--json] [-m model] [--sandbox read-only]` | `--json` 输出事件行，解析 `exec_update`/`result` 等事件白名单 |
| zcode | `zcode <headless 模式> --json`（以 `zcode --help` 为准） | 未安装时 `detect()` 返回 false，自动跳过 |

### 3.3 插入管线（`api/routes/ai.ts`）

`createChatCompletion` 内按 `config.provider` 分发：

```ts
if (config.provider === 'local-cli') {
  return createLocalCLICompletion(candidatePayload, config, options)
}
// 其余走 OpenAI SDK（现状不变）
```

`createLocalCLICompletion` 输出**归一化信封**，与 OpenAI SDK 形状一致：

- 非流式：`{ choices: [{ message: { content } }], usage }`（usage 尽量从 agent 输出解析 token 统计，解析不到则 0）；
- 流式：`AsyncIterable<{ choices: [{ delta: { content } }] }>` → 现有 SSE 循环直接工作。

prompt 组装：`buildProfilePayload` 对 `local-cli` 只做轻量变体（system prompt 前置 + 要求"只返回 JSON"），`responseFormatJson` 时复用现有 `stripFencedJson` / `extractBalancedJsonObject` / `parseJsonObject` 容错链。

### 3.4 并发与队列

本地 agent 是重子进程，**同时只跑一个**：

- 模块级互斥队列（复用 `api/storage/writeQueue.ts` 的 `Map<key, Promise>` 串行化模式）：`enqueueLocalAgent(task)`；
- 队列等待超时（默认 60s 排队上限）直接失败并计入 fallback；
- 前端已有 `GlobalAIActivity`，排队的任务可显示"等待本地 Agent"。

### 3.5 安全与资源控制

| 风险 | 控制 |
| --- | --- |
| 子进程挂起 | `AbortController` + `timeoutMs`（默认 180s）后 `SIGKILL`，不留孤儿进程 |
| 输出失控 | `maxOutputChars`（默认 64_000）截断，超出报 `LOCAL_AGENT_OUTPUT_TOO_LARGE` |
| 命令注入 | spawn 参数数组，`shell: false`；prompt 只作为参数透传 |
| agent 有文件系统权限 | MVP 阶段：claude `--disallowedTools "*"`、codex 只读沙箱；`cwd` 限定为 `AETHEL_DATA_DIR`（只读用途） |
| 并发叠加 | 全局单并发队列（3.4） |
| 版本漂移 | adapter 解析 stdout 用事件白名单 + 宽容降级；解析失败归入 `isFallbackError` → 自动回退托管服务商 |

### 3.6 任务适配表

| profile | 默认启用本地 agent | 理由 |
| --- | --- | --- |
| `fast-json`（归类） | ❌ | 画布交互要求低延迟；本地 agent 秒级起 |
| `section-draft` | ⚠️ 可选 | 并行分节与本地串行矛盾，仅显式选择时用 |
| `workshop-transform` | ✅ | 重任务、JSON 输出、可等待 |
| `snapshot-large` | ✅ | 认知压缩重任务，且可直读工作区文件（3.7） |
| `long-document`（PRD/chat 流式） | ✅ | 长文档生成，本地 agent 质量与隐私优势明显 |

开关：`LOCAL_AGENT_ENABLED_PROFILES=workshop-transform,snapshot-large,long-document`（默认空 = 仅 `AI_PROVIDER=local-cli` 显式生效）。

### 3.7 工作区直读（增强，M3）

快照/PRD 任务 prompt 增加指令："`AETHEL_DATA_DIR` 下 `bubbles/`、`snapshots/` 是工作区 Markdown 文件，可自行读取，不要要求用户粘贴全部内容"。本地 agent 自己读文件 → 大幅压缩上下文、提升长任务质量。托管服务商场景保持现状（内容由服务端拼入 prompt）。

## 4. 配置

```env
# .env（新增，均为可选）
AI_PROVIDER=local-cli                # 显式使用本地 agent 作为主 provider
LOCAL_AGENT_CLI=auto                 # auto | claude | codex | zcode；auto 按 PATH 探测
LOCAL_AGENT_MODEL=                   # 可选，透传 -m（如 claude-sonnet-4）
LOCAL_AGENT_TIMEOUT_MS=180000
LOCAL_AGENT_MAX_OUTPUT_CHARS=64000
LOCAL_AGENT_ENABLED_PROFILES=workshop-transform,snapshot-large,long-document
# LOCAL_AGENT_CWD 默认取 AETHEL_DATA_DIR；不设置则不直读工作区
```

## 5. 前端改动

- **设置中心（`pages/Settings.tsx`）**：provider 下拉增加"本地 Agent (Claude Code / Codex)"；选择时隐藏 API Key 输入，显示 CLI 探测结果；"测试连接"改为 `detect()` + `--version`。
- **活动记录**：`aiMetrics` 已记录 `provider/model/latency`，本地 agent 任务自动出现在现有记录中，`model` 显示实际 CLI 模型。
- **GlobalAIActivity**：排队状态文案（"等待本地 Agent 空闲"）。

## 6. 测试与验收

沿用 `tests/integration/*.test.ts` 风格（mock/桩脚本模式参考 `ai-routing.test.ts`）：

| 用例 | 内容 |
| --- | --- |
| detect 探测 | mock `which`/PATH，验证 claude/codex/zcode 可用性判定 |
| adapter 解析 | 桩脚本模拟 stdout（含流式事件行、fenced JSON、截断输出） |
| 归一化信封 | 非流式/流式输出与 OpenAI SDK 形状一致 |
| 队列串行 | 并发 3 个任务只产生 1 个子进程，其余排队 |
| fallback 链 | 本地 agent 超时/解析失败 → 自动回退托管服务商（复用现有机制） |
| 412 守卫 | `AI_PROVIDER=local-cli` 且 CLI 存在时不误报 NO_API_KEY |

验收标准：

- [ ] 本机装有 claude 或 codex 时，`AI_PROVIDER=local-cli` 可完成快照生成与 PRD 长文，不消耗三家 API key
- [ ] 流式 chat 与现有 SSE 格式完全一致（前端无感知）
- [ ] 本地 agent 超时/无二进制时，行为等于"未配置该 provider"（fallback 或明确报错，不挂起）
- [ ] 同一时刻至多一个本地 agent 子进程

## 7. 风险与边界

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| CLI 版本参数漂移 | 任务失败 | 事件白名单宽容解析 + 归入 fallback；adapter 内注释标注版本 |
| 本地 agent 耗时长 | 用户体验 | 超时 + 队列 + 前端排队状态；`fast-json` 默认排除 |
| 文件系统权限 | 数据被改 | MVP 禁用工具/只读沙箱；cwd 限定 data 目录；后续再放开"只读工具"白名单 |
| 与托管服务商结果不一致 | 快照 schema 校验失败 | 复用 `options.parse` 校验；失败走 fallback 或前端兜底（`createFallbackCognition`） |
| ZCode 无公开 headless 契约 | 不可用 | detect 失败即隐藏，不阻塞其余 CLI |

## 8. 里程碑

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| M1 | provider 注册 + claude/codex adapter（非流式 JSON 任务）+ 队列 + 安全 + 测试 | §6 验收标准（除流式） |
| M2 | 流式 chat 桥接（SSE）+ Settings UI + 活动记录展示 | 流式 chat 与现有格式一致 |
| M3 | 工作区直读增强 + zcode adapter + Agent 对话面板 | 本地 agent 直读 data/ 完成快照 |

## 9. 决策记录（ADR）

- **ADR-L1**：本地 agent 作为 provider 插入 `runProfileCompletion` 管线，而非另起一套调用链。原因：fallback/cache/metrics/parse 全部复用，改动面最小。
- **ADR-L2**：`local-cli` 不进默认 auto 候选。原因：子进程开销大，画布交互任务（归类）不应静默走本地 agent。
- **ADR-L3**：MVP 禁用本地 agent 工具执行（claude `--disallowedTools`、codex 只读沙箱）。原因：AetheL 需要的是文本产出；工具权限后续按场景放开。
- **ADR-L4**：输出归一化为 OpenAI SDK 信封形状。原因：SSE 循环与前端协议零改动。
- **ADR-L5**：全局单并发队列。原因：本地 agent 是重进程，多实例并发会拖垮开发机。

## 10. 与 LinkMind 集成的协同

- 两条线互不阻塞：LinkMind 走远程管线，本地 agent 是 AetheL 自己的 LLM 引擎。
- 协同点 1：P0 的"蒸馏结果 → 候选气泡"转换属轻量任务，若用户配置了本地 agent，可本地执行（省 API 配额）；
- 协同点 2：本地 agent 可用作"LinkMind 不可达"时的降级证据整理器（仅整理已有材料，不替代 LinkMind 的采集管线）；
- 协同点 3：二者共用 `isAIProviderConfigured` 判定重构，落地顺序建议 M1（本地 agent）优先于 LinkMind P0 的 412 守卫调整。
