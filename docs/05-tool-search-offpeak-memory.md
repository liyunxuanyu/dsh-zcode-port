# 05 · Tool Search / OffPeak / Memory 规格

> 三个 P1/P2 插件。共同点：都不新增 seam，只用 dsh 已有的 `tools.register({ when })`、`ctx.schedule`、`ctx.agents`、`ctx.fs`。

---

## 1. Tool Search 与延迟加载

### 1.1 目标

- 把工具 schema 从每步常驻上下文里移走，只保留"核心工具 + 搜索工具"。
- 模型按需加载，加载后**下一步**即可直接调用真实工具（不引入转发层）。
- 加载状态随 session 持久化/恢复。

### 1.2 为什么不用 `deferred_tool_call`

ZCode 有 `DeferredToolCall`，因为它把 deferred 工具从 schema 里完全移除，模型只能通过转发工具调用。dsh 的 `tools.register(definition, { when })` 允许"工具始终注册、按 step 择入"（`packages/core/tools/src/index.ts:128-151`、`resolve()` `:264-300`），所以：

- 加载 = 让 `when` 返回 true；
- 下一步 `tools.resolve()` 自动把完整 schema 放进请求；
- 模型直接调用真实工具名，权限/审批/日志全部走原管线。

少一层转发，少一份权限歧义。

### 1.3 服务

```ts
export interface DeferredToolCatalogEntry {
  name: string
  group: string                     // browser | office | workflow | cua | memory | ...
  description: string
  keywords: readonly string[]
  schemaTokens: number              // 启动时估算
  deferred: boolean
}

export interface DeferredToolService {
  /** 插件注册一个可延迟工具；内部用 when 控制 admission。 */
  registerDeferred<T extends ToolDefinition>(
    definition: T,
    meta: { group: string; keywords?: readonly string[]; alwaysVisible?: boolean },
  ): () => void

  /** 模型搜索；命中后把 name 写入本会话 loaded 集合并返回条目。 */
  search(query: string, opts: { limit: number; agent: Agent }): Promise<DeferredToolCatalogEntry[]>

  /** 本会话已加载集合（投影）。 */
  loaded(agent: Agent): Promise<ReadonlySet<string>>

  /** 目录快照（UI/调试）。 */
  catalog(): readonly DeferredToolCatalogEntry[]
}
```

### 1.4 持久化

- 新事件：

```ts
'deferred-tool/loaded': { name: string; query?: string; at: number }
```

- 投影 `deferredToolSet`：fold 事件 → `Set<string>`；fork 时继承（fork 的 seed 含事件）。
- 压缩不影响：它是工具 admission，不是消息；`tools.resolve` 读投影，不读摘要。
- 恢复：session resume 时投影重建 → `when` 生效。

### 1.5 注册与 admission

```ts
const off = ctx.deferredTools.registerDeferred(
  browserNavigateTool,
  { group: 'browser', keywords: ['page', 'url', 'click', 'snapshot'] },
)

// 内部等价于：
ctx.tools.register(definition, {
  when: async ({ agent }) => {
    if (meta.alwaysVisible) return true
    const loaded = await ctx.deferredTools.loaded(agent)
    return loaded.has(definition.name)
  },
})
```

注意：

- `when` 每 step 对所有注册工具求值；缓存 `loaded` 投影，避免 N 次 IO。
- 同一 agent 的加载集合互不影响（scope）。
- 工具被 `restrict()` 禁用时，`when` 不应再让它可见；`resolve()` 的 `view` 已经先做 restriction，`when` 只做二段过滤。

### 1.6 搜索算法

1. 归一化 query（小写、分词、去停用词）。
2. 评分：名称精确匹配 100；名称包含 60；keywords 命中 30/个；description 命中 10/个；group 匹配 20。
3. 同分按 group 顺序 + 名称排序。
4. 返回 top N（默认 8），每条含 name/group/description/是否已加载。
5. 不返回 schema；下一步自然出现。

### 1.7 工具描述（模型可见）

```
Search the deferred tool catalog and load a tool for the next step.
Call this when you need a capability that is not in your current tool list.
After loading, call the tool by its exact name in your next step; it is not
callable in the same step.
```

### 1.8 默认延迟清单

| group | 工具 | 理由 |
|---|---|---|
| browser | `js`（若按 WP-10 实现） | 大 schema + 高权限 |
| cua | `computer_*` | 大 schema + 平台限制 |
| office | `office_*` / `document_*` | 低频 |
| workflow | `workflow_*` 除 `workflow_run` | 12 个工具，常驻成本高 |
| memory | `memory_*` | 低频 |
| misc | `image_search`、`site_*` | 低频 |

常驻：`read/write/edit/bash/glob/grep/web_fetch/web_search/todo_write/ask_user_question/tool_search`。

### 1.9 指标与验收

- 基础 schema token：用 dsh `token-meter` 在启动时测；目标 ≤ 8k。
- 加载后下一步可见率 100%（集成测试）。
- session resume/fork 后加载集合一致。
- 未加载调用返回 `UNKNOWN_TOOL`，不弹审批。
- 两个并发 agent 的加载集合不串。

### 1.10 风险

- `when` 的异常会 `ToolActivationError` 并 fail loud；`loaded()` 必须永不 throw（读投影失败 → 返回空集 + 日志）。
- 模型可能在同一个 step 里搜完立刻调用 → 失败一次；描述里必须写清"next step"。
- PTC `run_code` 的 SDK 只包含可见工具；延迟工具加载后才会进入下一 step 的 SDK。文档要写。

---

## 2. OffPeak（闲时任务）

### 2.1 目标

- 用户离开后，在空闲时段执行指定任务（整理、巡检、生成报告）。
- 用户回来立即让路（takeover）。
- 重启后 pending 恢复、running 标记 interrupted。

### 2.2 服务

```ts
export interface OffPeakTaskInput {
  prompt: string
  title?: string
  workspace?: string              // 默认当前 workspace
  preset?: string                 // 默认 'offpeak'
  model?: ModelSelection
  idleMinutes?: number            // 默认 Config.idleMinutes
  maxRounds?: number              // 默认 32
  conditions?: {
    requireCleanGit?: boolean
    allowedHours?: { from: number; to: number }   // 0-23
  }
}

export interface OffPeakTask {
  id: Branded<'OffPeakTaskId'>
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'taken-over' | 'interrupted'
  input: OffPeakTaskInput
  sessionId?: string
  createdAt: number
  startedAt?: number
  endedAt?: number
  error?: { code: string; message: string }
}

export interface OffPeakService {
  create(input: OffPeakTaskInput, opts: { agent: Agent }): Promise<OffPeakTask>
  list(filter?: { status?: OffPeakTask['status'] }): Promise<OffPeakTask[]>
  cancel(id: string, reason?: string): Promise<void>
  /** 由调度器调用；测试可注入时钟。 */
  tick(now: number): Promise<void>
}
```

### 2.3 空闲判定

每 30s（`ctx.timer`）+ 事件驱动（turn end / job settle / input）：

```
idle =
  no live agent has an active turn
  AND no session has pending input
  AND no background job running
  AND last user activity >= idleMinutes
  AND (conditions.allowedHours)
  AND (conditions.requireCleanGit -> git status --porcelain empty)
```

- 只考虑**同一 workspace** 的活跃度；其它 workspace 不阻塞。
- `taken-over`：同一 workspace 出现 `user/message` → abort 当前 run，状态 `taken-over`。
- 并发上限：`maxConcurrentTasks`（默认 2）。

### 2.4 执行

- 新 Session（同 workspace），preset `offpeak`（工具限制：禁 `ask_user_question`、禁 `workflow_run`、禁 `offpeak_create`；保留 read/write/bash/memory）。
- 系统提示加"你在闲时执行，用户可能随时回来；不要做不可逆操作"。
- 每轮写 `offpeak/progress` 事件（只记轮次/工具数，不记内容）。
- 结束写 `offpeak/finished`（状态 + 摘要）。

### 2.5 事件

```ts
'offpeak/enqueued': { taskId, title }
'offpeak/started': { taskId, sessionId }
'offpeak/progress': { taskId, round, toolCalls }
'offpeak/finished': { taskId, status, summary? }
'offpeak/taken-over': { taskId, reason }
```

### 2.6 重启恢复

- 启动时：`running` → `interrupted`；`pending` 保持。
- `interrupted` 不自动重跑（避免重复副作用）；UI 提供"重试"。
- `pending` 在下次 tick 重新评估空闲。

### 2.7 配置

```yaml
- id: zcd-offpeak
  config:
    idleMinutes: 10
    minIdleRounds: 1
    maxConcurrentTasks: 2
    pollIntervalMs: 30000
    maxRounds: 32
    allowedPresets: [offpeak]
```

### 2.8 验收

1. 空闲 10 分钟后创建 session 并运行；用户输入 1s 内取消。
2. 重启后 pending 恢复、running → interrupted。
3. 子代理/离线会话不能 create（权限）。
4. `requireCleanGit` 时脏工作区不启动。
5. 同一 workspace 同时最多 2 个 task。

### 2.9 风险

- "空闲"是多服务状态的聚合，竞态多；用单一 `IdleGate` 串行化 tick。
- 用户回来但输入落在另一个 session → 仍应视为 takeover（按 workspace 判定）。
- 不可逆操作：preset 限制 + 系统提示 + 默认 `workspace-write`。

---

## 3. Memory 与 Dream

### 3.1 目标

- 项目级/用户级长期记忆，跨会话可召回。
- 写入受控（只在 memory 目录），读入上下文只放索引。
- 空闲时"做梦"整理（合并、去重、过期）。

### 3.2 目录

```
<workspace>/.zcd/memory/           # project scope
  MEMORY.md                        # 索引（人可读）
  entries/<slug>.md                # 单条记忆
  .dream.lock
~/.zcd/memory/                     # user scope
  ...
```

- 文件格式：frontmatter（name/description/type/updated）+ 正文。
- 索引：`MEMORY.md` 每行 `- [title](entries/x.md) — hook`。
- 上限：单文件 64KB；项目 500 条；用户 500 条；超出拒绝写入并提示整理。

### 3.3 服务

```ts
export interface MemoryEntry {
  id: string
  scope: 'project' | 'user'
  name: string
  description: string
  type: 'fact' | 'preference' | 'decision' | 'reference'
  body: string
  updatedAt: number
}

export interface MemoryService {
  search(query: string, opts: { scope?: 'project' | 'user' | 'both'; limit?: number; agent: Agent }): Promise<MemoryEntry[]>
  read(id: string, opts: { agent: Agent }): Promise<MemoryEntry | undefined>
  write(input: { scope; name; description; type; body }, opts: { agent: Agent }): Promise<MemoryEntry>
  remove(id: string, opts: { agent: Agent }): Promise<void>
  index(opts: { scope; limit?: number }): Promise<string>       // 注入 prompt 的索引
  dream(opts: { scope; agent: Agent }): Promise<DreamReport>
}
```

### 3.4 工具

| 工具 | 说明 |
|---|---|
| `memory_search` | 关键词/语义（v1 关键词 + 文件名） |
| `memory_read` | 读单条 |
| `memory_write` | 写单条；只允许 memory 目录；写入前 secret 扫描 |
| `memory_remove` | 删除；需确认（`ask_user_question` 或审批） |

### 3.4.1 设置页入口（已实现）

- `@zcd/memory-ui-host` 注册 `/zcd/memory`：`GET` 列表、`POST {name, description, type, body}`、`DELETE /<id>`、`POST /dream`（确定性整理并返回 scanned/removed/kept）。
- 只开放 **user scope**（`~/.zcd/memory`）：全局设置页没有 workspace，伪造 cwd 会让条目落错位置；项目记忆继续由会话内的 `memory_*` 工具处理。
- `ZCD_USER_MEMORY_HOME` 覆盖用户记忆根目录；smoke 指向一次性目录，避免污染真实用户目录。
- 写入仍走 `MemoryService.write`，因此 slug、secret 扫描、大小/条数上限与文件布局完全一致；设置页不是第二条写入路径。
- 前端在 `@zcd/client-ui-settings-zcd` 的 `ZCD` section 内，保存/删除/Tidy memory 后立即重新拉取列表。

### 3.5 上下文注入

- system prompt section `zcd:memory:index`：项目索引前 20 条 + 用户索引前 10 条（可配）。
- 不注入全文；模型需要时 `memory_search`/`memory_read`。
- 压缩不影响（静态 section）。
- 召回：在 `agent/pre-step` 根据用户输入做一次轻量检索，把 top 3 作为 runtime context（可选，默认关）。

### 3.6 Dream

- 触发：OffPeak 或 schedule（默认每天 03:00，且空闲）。
- 执行：受限 agent（只读 Bash + memory 目录写 + 删除 `.md`）。
- 任务：
  1. 合并重复条目；
  2. 更新过期事实；
  3. 重建 `MEMORY.md`；
  4. 删除空/无效条目（需记录）；
  5. 输出 `DreamReport`（变更列表）。
- 锁：`.dream.lock`（pid + mtime），最小间隔 24h，扫描节流 10min（对齐 ZCode 的数值，见 `archive/zcode/apps/.../memory/dream.ts:8-10`）。
- 失败：不阻塞主流程；记录 `memory/dream-failed`。

### 3.7 安全

- 路径：`resolveContainedMemoryFilePath` 等价逻辑；拒绝 `..`、绝对路径、符号链接逃逸。
- secret 扫描：写入前检测 `sk-`、`AKIA`、私钥块、长 base64；命中则拒绝或要求确认。
- 日志：只记 id/scope/大小；不记正文。
- 删除：软删除（移到 `.trash/`）保留 7 天。

### 3.8 事件

```ts
'memory/written': { id, scope, name, bytes }
'memory/removed': { id, scope }
'memory/dream-started': { scope }
'memory/dream-finished': { scope, changed, removed, merged }
```

### 3.9 验收

1. 写入目录外（含 `..`、符号链接）被拒绝。
2. `memory_search` 在 500 条内 P95 < 100ms。
3. 压缩后索引 section 仍存在。
4. dream 有锁、24h 间隔、失败不影响主流程。
5. secret 样本被拦截（测试集）。

### 3.10 风险

- 记忆污染（错误事实长期保留）：写入需 `type` + 来源；dream 只合并不推断。
- 隐私：项目记忆可能被提交到 git；默认 `.zcd/` 加 `.gitignore` 提示，用户可显式提交。
- 召回质量：v1 关键词足够；语义检索 v2（需 embedding provider，dsh 无内建）。
