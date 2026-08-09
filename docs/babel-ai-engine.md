# BabeL-O AI 引擎接入方案

> 状态：执行中（2026-08 产品策略调整后重写；原《本地 Agent CLI 驱动方案》废弃）
> 策略变更：Dev B 工作线目标从"调用本地 agent CLI（Claude Code / Codex / ZCode）"调整为**以 BabeL-O 项目作为 AetheL 的 AI 驱动引擎**，提供更稳定、可靠、丰富的 AI 服务支持。
> 关联仓库：`/Users/tangyaoyue/DEV/BABEL/BabeL-O`（壳中客同品牌终端 agent，v0.4.2）
> 决策来源：2026-08-02 启动会（模型选择权归 BabeL-O、第一期含记忆与模型列表、分支更名 feature/babel-ai-engine）

## 1. 背景与目标

- **现状**：AetheL 直接通过 OpenAI SDK 调三家托管服务商（ModelScope/DeepSeek/Moonshot），自己管理 API key、taskProfiles、fallback 链与 JSON 容错。
- **问题**：服务商各自为政，模型选择受限；key 分散在 AetheL 配置；稳定性（重试/失败诊断）依赖 AetheL 自建。
- **目标**：把 LLM 调用统一收敛到 BabeL-O（同品牌项目）——复用其 provider 注册表（9 内置 + 自定义）、适配器、重试与流式能力，AetheL 只关心业务语义。

## 2. BabeL-O 能力盘点

### 2.1 引擎价值（复用点）

| 能力 | 位置 | 说明 |
| --- | --- | --- |
| provider 注册表 | `src/providers/registry.ts` | 9 内置（anthropic/openai/moonshot/ollama/deepseek/zhipu/minimax/ark-codingplan/local）+ 自定义 openai-compatible |
| 模型注册表 | 同上（modelRegistry） | 规范 ID `provider/model` + capabilities + contextWindow + defaultMaxTokens |
| 统一适配器 | `src/providers/adapters/ModelAdapter.ts` | `queryStream(params, {signal, apiKey, baseUrl}): AsyncIterable<StreamDelta>` |
| 重试 | `src/providers/retry.ts` | 2 次重试、指数退避 1s→15s、可重试 [429,500,502,503,504,529] |
| 流式 | `OpenAIAdapter.ts` + `sse.ts` | SSE 出站 + abort 传播（防半开挂死） |
| 配置中心 | `~/.babel-o/config.json` | defaultModel / providers / profiles / activeProfile；key 进 macOS keychain |
| 记忆服务 | `/v1/runtime/memory/*` | MemoryOS 记忆搜索/保存 |
| 诊断 | `/v1/runtime/provider-smoke`、`/v1/runtime/provider-fallback/plan`、`/v1/runtime/models` | 模型冒烟、降级预案、模型列表 |

### 2.2 现状缺口（需在 BabeL-O 侧补）

1. **无 OpenAI-compatible 端点**——daemon 是 agent 执行器（`/v1/execute` 带完整 agent 循环、`/v1/stream` 仅 WS），需新增纯 LLM 语义端点；
2. **无 `response_format` 透传**——AetheL 的 `fast-json`/`snapshot-large` profile 依赖 JSON 模式；
3. **无 HTTP SSE 出站流**——需在端点内回写 OpenAI chunk 格式；
4. **无 embedding 端点**（第一期不做，见 §7）；
5. **刻意不做静默模型 fallback**——AetheL 侧 fallback 链保留。

## 3. 总体架构

```
AetheL (runProfileCompletion / taskProfiles / fallback / JSON 容错)
   │  OpenAI SDK 请求（messages + stream + response_format）
   ▼
POST /v1/chat/completions（BabeL-O 新增，~150-250 行 + 测试）
   │  映射 ModelQueryParams → getAdapter().queryStream()（绕过 LLMCodingRuntime）
   ▼
provider 注册表 / withRetry / SSE 解析 → 上游服务商
```

模型选择：**归 BabeL-O**——AetheL 不传 model，使用 BabeL-O activeProfile/defaultModel；模型切换在 BabeL-O 侧（`bbl config` 或设置页）。

## 4. BabeL-O 侧设计

### 4.1 端点契约：`POST /v1/chat/completions`

请求（OpenAI 兼容子集）：

```json
{
  "model": "deepseek/deepseek-v4-pro",
  "messages": [{ "role": "system|user|assistant", "content": "..." }],
  "stream": true,
  "temperature": 0.7,
  "max_tokens": 6000,
  "response_format": { "type": "json_object" }
}
```

| OpenAI 字段 | ModelQueryParams 映射 |
| --- | --- |
| `model`（缺省 → activeProfile/defaultModel） | `model`；未知 → `400 MODEL_NOT_FOUND` |
| messages 中 role=system | `systemPrompt`（AetheL 的 system 在 messages[0]，天然兼容） |
| 其余 messages | `messages`（user/assistant） |
| `temperature` / `max_tokens` | 同名；max_tokens 缺省 → 注册表 defaultMaxTokens |
| `response_format` | **新增 `ModelQueryParams.responseFormat?`** |
| `stream` | true → SSE；false → 收集完整返回 |

SSE 出站（OpenAI chunk 格式）：`StreamDelta` text → `delta.content`；thinking → `delta.reasoning_content`；usage → 收尾块；终帧 `data: [DONE]`。

**无状态语义**：绕过 `executionGate` 与会话存储——纯 LLM 调用，无工具循环/权限门/SQLite 写入；不受 execute 并发 8 限制；错误映射 `ProviderError` → OpenAI 风格 `{error:{message,type,code,status}}`；超时 `408`；鉴权复用现有 `x-nexus-api-key`/Bearer。

### 4.2 实现落点

| 文件 | 改动 |
| --- | --- |
| `src/nexus/chatCompletionsRoute.ts`（新增） | 仿 `executeHttpRoute.ts` deps 注入模式；deps 提供 settings 解析（复用 runtime resolveSettings 路径或 `src/shared/config.ts`） |
| `src/providers/adapters/ModelAdapter.ts` | `ModelQueryParams` 加 `responseFormat?`（~10 行） |
| `src/providers/adapters/OpenAIAdapter.ts` | body 透传 `response_format` |
| `src/nexus/app.ts` / `routerRegistrar.ts` | 注册新路由 |
| 测试 | 用注册表 `local` provider（确定性输出）端到端，无需真实 key |

## 5. AetheL 侧设计

| 文件 | 改动 |
| --- | --- |
| `api/aiProfiles.ts` | `AIProvider` 加 `'babel'`；baseURL = `${BABEL_NEXUS_URL}/v1/chat/completions`，apiKey = `BABEL_NEXUS_API_KEY`；"已配置"判定 = 两个 env 均存在；auto 时 babel 优先 |
| `api/routes/ai.ts` | 几乎零改动（OpenAI SDK 调新端点，SSE chunk 格式一致，前端零感知） |
| `api/routes/memory.ts` | **改接 BabeL-O** `/v1/runtime/memory/*`（MemoryOS），替代现未接线的 ModelScope OpenMemory 代理 |
| `pages/Settings.tsx` | provider 下拉加"BabeL-O（本地引擎）"；测试连接调 `/v1/health` + `/v1/runtime/models`；模型选择器从 `/v1/runtime/models` 拉取（写入 BabeL-O 配置而非 AetheL） |
| `.env.example` | `BABEL_NEXUS_URL`（约定 BabeL-O 跑 3100，避开 AetheL Express 3000）+ `BABEL_NEXUS_API_KEY` |
| 保留 | AetheL 侧 fallback 链、JSON 容错链（stripFencedJson 等）、AI metrics |

## 6. 测试与验收

- **BabeL-O 侧**：单测（请求映射/SSE 编码/错误映射）+ `local` provider 集成测试；
- **AetheL 侧**：mock BabeL-O 端点（沿用 `ai-routing.test.ts` 模式）+ 真实 BabeL-O 冒烟；
- **验收**：
  - [ ] `AI_PROVIDER=babel` 时快照/工坊/PRD/归类全部可用，SSE 聊天前端无感知
  - [ ] BabeL-O 未启动/未配置时入口隐藏或明确报错，不挂起
  - [ ] BabeL-O 上游失败（429/5xx）时 AetheL fallback 链生效
  - [ ] memory 接口走 BabeL-O MemoryOS
  - [ ] 设置页可拉取模型列表并选择

## 7. 里程碑

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| M1 | BabeL-O chat completions 端点 + AetheL `babel` provider 接入 | §6 验收 1-3 |
| M2 | memory.ts 改接 MemoryOS + 设置页模型列表/选择器 | §6 验收 4-5 |
| M3（可选） | `/v1/embeddings`、诊断面板（provider-smoke/fallback-plan）接入 | 评估后定 |

## 8. 决策记录（ADR）

- **ADR-B1**：以 BabeL-O chat completions 端点为主链路，而非 `/v1/execute` 或 CLI 子进程。原因：`/v1/execute` 是 agent 语义（系统提示词注入/工具循环/权限门），对纯净 JSON 任务不适用；CLI 无 headless JSON 模式。
- **ADR-B2**：模型选择权归 BabeL-O。原因：AetheL 零模型维护，切换在 BabeL-O 配置完成。
- **ADR-B3**：端点绕过 executionGate 与 SQLite。原因：保持纯 LLM 语义与低延迟；并发限制可单独设 in-flight 上限。
- **ADR-B4**：第一期含记忆与模型列表。原因：AetheL 的 memory.ts 本就未接线，BabeL-O MemoryOS 是现成替代；模型选择器是"引擎化"的关键体验。
- **ADR-B5**：BabeL-O 约定 3100 端口。原因：NEXUS_PORT 默认 3000 与 AetheL Express 冲突。
- **ADR-B6**：分支更名 `feature/babel-ai-engine`。原因：原 `feature/local-agent-cli-driver` 名称与目标不符。

## 9. 风险与边界

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 跨仓库协作（端点需 BabeL-O 仓库 PR） | 开发节奏依赖另一仓库 | 端点设计先行冻结（本文档 §4）；BabeL-O 侧小步快出 |
| `response_format` 在非 OpenAI 适配器（如 Anthropic）行为 | JSON 任务可能失败 | 第一期只承诺 OpenAI 兼容类 provider；Anthropic 侧转 prompt 指令或明确不支持 |
| BabeL-O 升级兼容 | 端点契约漂移 | 契约进入 BabeL-O 文档/OpenAPI；升级前 diff |
| BabeL-O 未运行时 AetheL 不可用 | 功能不可用 | 入口隐藏 + 明确报错；fallback 链保留三家托管 |
| 无 embedding 能力 | 向量检索不可用 | 第一期不做；M3 评估 EverCore 边车或 provider 能力扩展 |
