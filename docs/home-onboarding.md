# 产品首页与多工作区扩展设计

> 状态：已实施（2026-08-03，feature/linkmind-integration 分支）
> 决策：C2 空状态引导（画布空状态 = 产品首页）；多工作区仅预留扩展点，不引入数据模型改动。

## 1. 背景与决策

- **问题**：AetheL 打开 `/` 直接是空画布，新用户不知道从哪开始（启动会越天野反馈"用户主观能动性过高"）。
- **决策**：`/` 路由不动，把画布**空状态**（`bubbles.length === 0`）升级为全屏产品首页 `WelcomeHome`；有数据后自动回到正常画布。
- **多工作区**：近期有并行多项目需求，但多工作区涉及数据层重构（bubbles/snapshots/workspace 按 workspaceId 隔离），**本次只预留扩展点**，不做半成品字段。

## 2. 首页构成（`src/components/onboarding/WelcomeHome.tsx`）

```
品牌与定位（logo + 一句话描述）
  → 智能输入框：识别输入类型自动路由
      URL        → /workshop?skill=link-to-evidence&input=…&autoRun=1
      长文本/PRD → /workshop?skill=prd-to-bubbles&input=…&autoRun=1
      其他想法    → /workshop?skill=idea-to-bubbles&input=…&autoRun=1
  → 三个入口卡：灵感画布 / 创意工坊 / PRD 输出
  → 最近认知快照（有快照时显示，跳 /context 恢复）
```

- 分类逻辑：`src/lib/workshopInput.ts` 的 `classifyWorkshopInput`（纯函数，单测覆盖）；
- 工坊侧：`CreativeWorkshop` 支持 `input` 预填 + `autoRun=1` 自动运行一次（URL 参数，用 ref 守卫避免重复触发）；
- 触发条件：`/` 且 `bubbles.length === 0`（快照存在不影响——快照区显示在首页底部作为恢复入口）。

## 3. 多工作区扩展预留（不实施，仅设计）

### 3.1 预留原则

1. **不加半成品字段**：不在 `StoredBubble`/`StoredSnapshot` 上新增未使用的 `workspaceId`；
2. **组件抽象**：首页的"入口卡 + 快照区"已是独立组件，未来多工作区时首页直接升级为"工作区列表"；
3. **存储分层**：将来按 `data/workspaces/<id>/` 隔离（bubbles/snapshots/workspace.json 全部下沉），`api/storage/paths.ts` 的 `dataDir` 改为按工作区解析。

### 3.2 未来数据层改造点（roadmap 立项时参考）

| 层 | 现状 | 多工作区改造 |
| --- | --- | --- |
| `api/storage/paths.ts` | 全局 `dataDir` | 引入 `workspaceDir(id)`，bubbles/snapshots/workspace.json 全部按工作区 |
| `api/storage/types.ts` | `StoredWorkspaceState` 单份 | 增加 `workspaceId`；列表/索引文件 |
| `api/routes/workspace.ts` | 读写单工作区 | `/api/workspaces` 集合 + `/api/workspaces/:id` |
| `src/stores/*` | 单工作区 zustand | 工作区切换时整体加载/保存对应数据（可复用现有 snapshot restore 的整组替换模式） |
| 前端持久化 | `useWorkspacePersistence` 单例 | 按当前工作区绑定 |
| 首页 | WelcomeHome 空状态 | 升级为工作区列表 + 新建工作区（此时"新建工作区"按钮才有真实语义） |

### 3.3 里程碑建议

- M1（本次）：首页引导（已实施）；
- M2：数据层按 `data/workspaces/<id>/` 重构 + 工作区切换（依赖 3.2 的表）；
- M3：首页升级为工作区仪表盘（列表/新建/最近）。

## 4. 与 roadmap 的衔接

- 首次使用引导（`data/onboarding/` 种子数据导入）可与首页引导互补：首页解决"怎么开始"，onboarding 解决"样例数据从哪来"；
- 首页输入框识别复用 LinkMind 插件的 URL 检测（`linkmindImport.extractUrls`），插件未安装时 `link-to-evidence` 自动降级（工坊侧已有门控提示）。
