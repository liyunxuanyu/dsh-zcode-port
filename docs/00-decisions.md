# 00 · 架构决策记录（ADR）

> 每条决策包含：背景、选项、决定、后果、复核条件。
> 编号规则：ADR-01…；被推翻时保留原文并追加 "Superseded by"。

---

## ADR-01 · 以 dsh 为底座，不 fork

**背景**：需求是把 ZCode 的好用特性搬到 dsh。两条路线：(a) 在 dsh 上加插件；(b) 把 dsh 的插件化搬进 ZCode。

**选项**：

| 选项 | 优点 | 缺点 |
|---|---|---|
| A. dsh 底座 + overlay | 保留 Cordis 内核；上游可升级；扩展点是显式契约 | dsh pre-stable；产品面要自建 |
| B. ZCode 底座 + 插件化改造 | 保留成品 UI/产品面 | 要重写 agent runtime 与 services；41 万行 UI 之下的耦合难拆 |
| C. fork dsh | 想改哪改哪 | 每次上游同步手工合并；失去 patch 表达产品差异的能力 |

**决定**：A。dsh 只读（pinned），产品差异全部在自有 bundle / 插件 / patch。

**后果**：

- 需要维护 upstream sync（`docs/09-compat-security-release.md`）。
- 每加一个能力都要先确认"能否用现有 seam 表达"。
- 不允许直接改 `packages/**`；例外见 ADR-02。

**复核条件**：若连续 3 个能力都必须改上游 core，重新评估是否 fork（或把改动上游 PR）。

---

## ADR-02 · 上游只读；必须改时先造 seam

**背景**：overlay 的边界在哪里。

**决定**：改动顺序固定：

1. 用现有 seam（service 定义 / 事件 / 工具注册 / provider）表达。
2. 表达不了 → 新增 seam（Service Definition + Provider + Consumer），在新包内实现。
3. 仍不行 → `overlay/` 目录下按"一 patch 一文件"覆盖上游文件，必须附 `REASON.md`、同步脚本、回归测试。
4. 能上游 → 提 PR 回 dsh。

**后果**：`overlay/` 目录是技术债台账；每次 sync 必须先跑 `overlay` 的 patch 应用与测试。

**复核条件**：`overlay/` 文件数 > 10 或单文件 patch > 200 行时，重新评估 fork。

---

## ADR-03 · 唯一新增 seam：`durableWorkflow`

**背景**：ZCode 的动态工作流有 journal/resume/留白/amend/live-retune；dsh 的 `workflow` 明示无 journaling/resume，且 holder-owned。

**选项**：

| 选项 | 问题 |
|---|---|
| 改 `dsh-workflow` | 破坏其"最小语义"设计；上游 README 明确把这些列为不做 |
| 在工具层做假 resume | 无法恢复中间值；重启必丢 |
| 新增 `durableWorkflow` seam | 多一套概念，但与原引擎并存且互不影响 |

**决定**：新增 `durableWorkflow`（`ctx.durableWorkflow`），独立 run store（SQLite），独立工具族（`workflow_*` 前缀），独立 UI 面板。原 `workflow` 工具保留，用于一次性脚本。

**后果**：

- 模型会看到两套工作流工具，必须在描述里写清选择规则（`docs/04-durable-workflow.md` §2）。
- 存储要自己管格式版本与迁移（不能复用 dsh 的 session 迁移链）。
- 不进入 session 日志的"model-visible"部分必须通过 `agent.inject()` 落为 `user/message`，否则 replay 不一致。

**复核条件**：若 dsh 上游实现了 journal/resume，切换为适配层，删除自有引擎。

---

## ADR-04 · 延迟工具用 `when` + 工具级目录，不新造注册表

**背景**：ZCode 的 `ToolSearch`/`DeferredToolCall` 依赖 `shouldDefer` 与独立 catalog。

**事实**：dsh 的 `tools.register(definition, { when })` 支持每 step 求值（`packages/core/tools/src/index.ts:128-151`、`resolve()` `:264-300`）；`schemas()` 只输出已承认集合。

**决定**：

- 新增 `ctx.deferredTools`（小服务，非 seam）：维护"可加载工具目录"与"本会话已加载集合"（session projection）。
- 延迟工具注册时带 `when: ctx => loaded.has(name) || !deferred(name)`。
- `tool_search` 返回**工具引用**并把名字写入 loaded 集合（持久化为 `tool/loaded` session 事件，`ignorable: true` 仅用于 UI 展示，实际 admission 由投影决定）。
- 不实现 `deferred_tool_call`：加载后直接调用真实工具名，避免多一层转发与权限歧义。

**后果**：与 ZCode 的"DeferredToolCall 单独工具"不同；更符合 dsh 的"工具即真实定义"。

**复核条件**：若 `when` 的求值开销影响 step 延迟（>5ms/百工具），改为在 `agent/pre-step` 一次性 resolve。

---

## ADR-05 · 工具命名：snake_case，不做 PascalCase 别名

**背景**：ZCode 用 PascalCase（`Read`/`Agent`/`CreateWorkflow`），dsh 用 snake_case。

**决定**：新产品统一 snake_case；不为 ZCode 名做别名。

**例外**：仅当需要读旧会话/旧技能文本时，在**技能正文**里做名称映射表，不注册别名工具。

**理由**：dsh 的工具名是模型可见契约，别名会让工具目录翻倍、审批规则歧义、日志难对齐。

**后果**：移植技能时必须逐条改工具名（`docs/08-skills-catalog.md` 有映射表）。

---

## ADR-06 · 新会话事件一次设计到位

**背景**：`SessionEventMap` 可扩展，但日志 append-only，`SESSION_FORMAT_VERSION` 由 dsh 拥有。

**决定**：

- 新增事件（`offpeak/*`、`tool/loaded`、`memory/*`、`workflow/*` 摘要）必须满足：lossless JSON、只追加、语义不可变。
- 变更语义时**新增事件类型**，不改旧类型。
- 大块数据（run journal、memory 全文）不进 session 日志，进自有 store；日志只存 id + 摘要 + 指针。
- 每个新事件必须有 consumer（投影/UI/测试），否则不加。

**后果**：session 体积可控；但跨 store 一致性需要 `docs/04-durable-workflow.md` §5 的写入顺序约束。

---

## ADR-07 · 安全不变量：不放宽 dsh 的 fail-closed

**背景**：ZCode 的"Bash 只读免打扰"体验好，但 dsh 的安全模型是默认收紧。

**决定**：

- 只读免打扰只对**可证明只读**的命令生效，实现为 `tools/pre-execute` 的**窄放行**：命中只读规则返回 `{kind:'allow'}`（仍会经过 monotonic guard），不确定时 `next()` 交回正常审批。
- 实现期修正：`PreToolDecision` 只有 `allow/deny/cancel/ask`，没有“建议允许”的表达；因此只读插件要么放行、要么交回，不能只给意见。
- 不放宽 sandbox 默认值；不改 `approval` 的 `never` 语义；不改 `read-before-write` 门。
- 新增工具若声明 `readOnly` 类语义，必须有测试证明其不会写文件/发网络请求。
- dsh 原生 plan mode 默认不限制工具；ZCode 式严格只读是**可选插件**（默认 `disabled`），不改变 dsh 默认行为。

**后果**：免打扰覆盖率低于 ZCode；换来不可绕的安全基线。

**复核条件**：若误报率 > 10%（本该放行却弹窗），扩充只读规则，而不是关闭 guard。

---

## ADR-08 · 许可与代码复用

**背景**：ZCode 是 Apache-2.0，dsh 是 MIT。

**决定**：

- **不复制 ZCode 的 TypeScript 源码**；只按文档重实现语义。理由：Apache-2.0 允许复制但需 NOTICE/专利条款，且 ZCode 代码与它的架构强耦合，复制反而增加维护负担。
- **可以复制技能文本/文档**（纯内容），但每个文件保留 Apache-2.0 头，并在产品 `NOTICE` 中列出来源文件清单。
- 依赖第三方库（如 d3、floating-ui、docx 生成器）按其许可引入。
- 自有代码用 MIT（与 dsh 一致），便于上游回馈。

**后果**：`NOTICE` 需要自动生成（`scripts/gen-notice.mjs`）。

---

## ADR-09 · UI 复用 dsh Web，不重建 ZCode UI

**背景**：ZCode 的"好用"很大一部分是 UI 打磨（41 万行）。

**决定**：

- 第一版复用 dsh Web（slot/conversation node/sidebar-right）。
- 只新增 4 类 UI：Gen UI 渲染、工作流面板、Office 查看器、设置页。
- 不移植 ZCode 的组件库；需要"ZCode 手感"时改 token 与交互规范，不搬组件。

**后果**：短期视觉差距存在；长期可维护性更好。

**复核条件**：若用户反馈"交互不可用"集中在某 2–3 个页面，再单独立项重做这些页面。

---

## ADR-10 · 版本策略：pin 上游 + 双周同步

**背景**：dsh 明示 pre-stable、会有破坏性变更。

**决定**：

- `upstream/dsh` 用 submodule 或精确版本（`0.2.2-alpha.2` 为基线）。
- 每两周一次 sync；sync PR 必须通过：typecheck、`verify-*`、快照回放、`overlay` patch 应用、自有测试。
- 兼容性风险分级：`breaking-now`（编译失败）/ `silent`（行为变化，靠快照发现）。
- 工具名、事件名、配置字段（`Config` 的公开字段）视为**对外契约**，变更需写 upgrade guide。

**后果**：需要 CI 里跑"上游 HEAD + 自己的 bundle"组合测试。

**复核条件**：若单次 sync 修复成本 > 3 人日，考虑锁更久或 fork。
