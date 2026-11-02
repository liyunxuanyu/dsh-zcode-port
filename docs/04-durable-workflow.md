# 04 · Durable Workflow（新 seam 规格）

> **实现状态（2026-11-03）**：MVP 已落地于 `@zcd/durable-workflow` + `@zcd/workflow-store` + `@zcd/tool-workflow`。当前支持 `agent()`、`parallel()`、`pipeline()`、`hole()`、节点缓存、resume、cancel、7 个工具、完成/留白通知、amend successor；run 面板仍按本文后续章节实现。

> 这是本项目**唯一新增的 seam**。目标：把 ZCode 动态工作流的 journal/resume/留白/amend/live-retune 带到 dsh，同时不改 dsh 的 `workflow`。
>
> 参考：`archive/zcode/docs/dynamic-workflow/*`、`archive/zcode/docs/dynamic-workflow.md`、`archive/dsh/docs/subsystems/workflow.md`、`archive/dsh/packages/workflow/workflow/README.md`。

---

## 1. 目标与非目标

### 1.1 目标

- 脚本可**持久化执行**：进程重启后从最后完成的 node 继续。
- **确定性 replay**：已完成的 `agent()` 不重复调用模型。
- **留白**：脚本可以 `hole()` 暂停，等待模型补代码后继续。
- **可修订**：运行中只改并发就地生效；改脚本则创建 successor run。
- **可观察**：run/node/hole 状态可查询；UI 有面板；完成/失败/提问有通知。
- **可取消**：取消传播到所有子代理与工具调用。
- **不阻塞父 turn**（默认）：`workflow_run` 立即返回 `run_id`。

### 1.2 非目标

- 不做跨机器分布式执行（单进程/单 Host）。
- 不做任意脚本的完美确定性（网络/时间/随机由 facade 约束，见 §5）。
- 不复用 dsh 的 session 迁移链；自有 store 自己管版本。
- 不替代 dsh 的 `workflow`（一次性脚本仍用它）。
- 不做可视化图编辑器（v1 只读面板）。

---

## 2. 服务契约

```ts
// @zcd/workflow-durable/src/types.ts

export type RunId = Branded<'WorkflowRunId'>
export type NodeId = Branded<'WorkflowNodeId'>
export type HoleId = Branded<'WorkflowHoleId'>
export type QuestionId = Branded<'WorkflowQuestionId'>

export type RunStatus =
  | 'queued'
  | 'running'
  | 'waiting-hole'
  | 'waiting-question'
  | 'waiting-approval'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'budget-limited'
  | 'interrupted'

export interface WorkflowStartRequest {
  name?: string
  script?: string                 // inline
  saved?: { name: string; args?: Record<string, unknown> }
  path?: string                   // 磁盘脚本
  args?: Record<string, unknown>
  maxConcurrency?: number         // 默认 D = max(4, min(16, cores-2))
  subagentModel?: string
  maxTotalNodes?: number          // 默认 1000
  parent: Agent
  signal?: AbortSignal
  wait?: boolean                  // true = 阻塞到结束（兼容 dsh workflow）
}

export interface WorkflowHandle {
  readonly id: RunId
  readonly status: RunStatus
  readonly result: Promise<WorkflowResult>
  cancel(reason?: string): Promise<void>
  dispose(): Promise<void>
}

export interface WorkflowResult {
  status: 'succeeded' | 'failed' | 'cancelled' | 'budget-limited'
  value?: unknown
  error?: { code: string; message: string; nodeId?: NodeId }
  nodesStarted: number
  nodesCompleted: number
  startedAt: number
  endedAt: number
}

export interface WorkflowAmendment {
  maxConcurrency?: number
  subagentModel?: string
  script?: string                 // 提供则创建 successor run
}

export interface DurableWorkflowService {
  start(req: WorkflowStartRequest): Promise<WorkflowHandle>
  resume(runId: RunId, opts?: { parent: Agent; signal?: AbortSignal }): Promise<WorkflowHandle>
  amend(runId: RunId, patch: WorkflowAmendment, opts: { parent: Agent }): Promise<{ runId: RunId; superseded?: boolean }>
  answerHole(runId: RunId, holeId: HoleId, answer: string, opts: { parent: Agent }): Promise<void>
  resolveQuestion(runId: RunId, questionId: QuestionId, answer: string): Promise<void>
  cancel(runId: RunId, reason?: string): Promise<void>
  get(runId: RunId): Promise<RunSnapshot>
  list(filter?: RunFilter): Promise<RunSummary[]>
  saved: {
    save(input: { name: string; script: string; meta?: WorkflowMeta; scope?: 'user' | 'workspace' }): Promise<SavedWorkflow>
    list(scope?: 'user' | 'workspace'): Promise<SavedWorkflow[]>
    get(name: string, scope?: 'user' | 'workspace'): Promise<SavedWorkflow | undefined>
  }
}
```

`RunSnapshot`：

```ts
export interface RunSnapshot {
  id: RunId
  name: string
  status: RunStatus
  scriptHash: string
  meta: WorkflowMeta
  args: unknown
  maxConcurrency: number
  subagentModel?: string
  createdAt: number
  updatedAt: number
  revision: number               // CAS / amend
  nodes: NodeSnapshot[]
  holes: HoleSnapshot[]
  questions: QuestionSnapshot[]
  result?: WorkflowResult
  stopReason?: string
  error?: { code: string; message: string }
}
```

---

## 3. 状态机

```
                 start
                   │
                   ▼
                queued ──admission──▶ running
                   │                    │
                   │        ┌───────────┼────────────┬─────────────┐
                   │        ▼           ▼            ▼             ▼
                   │   waiting-hole  waiting-question  waiting-approval
                   │        │           │            │
                   │        └───────────┴────────────┘
                   │                    │
                   │                    ▼
                   │                 running
                   │                    │
                   └──────────────▶ succeeded / failed / cancelled / budget-limited
                                        │
                              restart ──▶ interrupted ──resume──▶ running
```

规则：

- `queued`：已持久化、未调度；重启后可自动进入 running（幂等）。
- `waiting-*`：不计入 active，但保留资源；用户取消 → cancelled。
- `interrupted`：进程崩溃/重启时由恢复扫描写入；`resume` 只接受 interrupted/queued/failed（可配置）。
- 终态不可变；要改脚本 → `amend` 创建 successor（新 runId，`parentRunId` 指向旧 run）。
- 每个状态变更写 `runs.status` + `events`（append-only），事务内完成。

---

## 4. 数据模型（SQLite）

> 使用 Node 24 内置 `node:sqlite`（与 dsh 的 `session-query-sqlite` 同源），避免原生依赖。
> 路径：`$DSH_HOME/storages/zcd-workflow/workflow.db`（0700）。

```sql
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE schema_meta (version INTEGER NOT NULL);

CREATE TABLE runs (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  status            TEXT NOT NULL,
  script_hash       TEXT NOT NULL,
  script            TEXT NOT NULL,
  meta_json         TEXT NOT NULL,
  args_json         TEXT NOT NULL,
  max_concurrency   INTEGER NOT NULL,
  subagent_model    TEXT,
  max_total_nodes   INTEGER NOT NULL,
  parent_session_id TEXT NOT NULL,
  parent_agent_id   TEXT NOT NULL,
  parent_run_id     TEXT,             -- successor 链
  revision          INTEGER NOT NULL DEFAULT 0,
  result_json       TEXT,
  stop_reason       TEXT,
  error_json        TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE TABLE nodes (
  run_id           TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  node_id          TEXT NOT NULL,
  path             TEXT NOT NULL,      -- root/agent[3]/...
  kind             TEXT NOT NULL,      -- agent | world | artifact | hole
  status           TEXT NOT NULL,      -- pending | running | succeeded | failed | skipped
  input_hash       TEXT NOT NULL,
  input_json       TEXT NOT NULL,
  output_json      TEXT,
  child_session_id TEXT,
  error_json       TEXT,
  started_at       INTEGER,
  ended_at         INTEGER,
  PRIMARY KEY (run_id, node_id)
);
CREATE INDEX nodes_run_status ON nodes(run_id, status);

CREATE TABLE events (
  run_id   TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  seq      INTEGER NOT NULL,
  type     TEXT NOT NULL,
  payload  TEXT NOT NULL,
  at       INTEGER NOT NULL,
  PRIMARY KEY (run_id, seq)
);

CREATE TABLE holes (
  run_id     TEXT NOT NULL,
  hole_id    TEXT NOT NULL,
  node_id    TEXT NOT NULL,
  prompt     TEXT NOT NULL,
  status     TEXT NOT NULL,           -- open | filled | cancelled
  answer     TEXT,
  created_at INTEGER NOT NULL,
  filled_at  INTEGER,
  PRIMARY KEY (run_id, hole_id)
);

CREATE TABLE questions (
  run_id      TEXT NOT NULL,
  question_id TEXT NOT NULL,
  node_id     TEXT NOT NULL,
  question    TEXT NOT NULL,
  status      TEXT NOT NULL,          -- open | answered | expired
  answer      TEXT,
  created_at  INTEGER NOT NULL,
  answered_at INTEGER,
  PRIMARY KEY (run_id, question_id)
);

CREATE TABLE saved_workflows (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  scope      TEXT NOT NULL,           -- user | workspace
  script     TEXT NOT NULL,
  meta_json  TEXT NOT NULL,
  version    INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(scope, name)
);

CREATE TABLE artifacts (
  run_id     TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  path       TEXT NOT NULL,
  sha256     TEXT NOT NULL,
  bytes      INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (run_id, artifact_id)
);

CREATE TABLE schema_migrations (
  version    INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
```

约束：

- `runs.script` 存原文（便于 replay/审计），但日志/遥测不打印。
- `events` 只追加；`seq` 从 1 连续；写入与 `runs.updated_at` 同事务。
- 删除 run 只允许终态且显式 `purge`，默认不删（审计）。
- 迁移：`schema_meta.version` + 每步一个 `migrations/NNN.ts`；启动时 fail-closed（未知更高版本拒绝打开）。

---

## 5. 确定性 replay

### 5.1 node id

```
nodeId = sha256(scriptHash || "\0" || path || "\0" || canonicalJson(input))[0:20]
```

- `path` 是执行路径，不是随机 id：`root.agent[0]`、`root.parallel[1].agent[2]`。
- `parallel/pipeline` 的分支必须有稳定 key（脚本传入的 `key` 或数组下标）；否则拒绝执行。
- `canonicalJson` 用 dsh 的 lossless JSON 规则（排序 key，拒绝 undefined/function/Date/Map/Set）。

### 5.2 replay 算法

```
load run(runId)
  → status = interrupted/queued/failed
  → mark running
  → create sandbox with a ReplayContext { nodes: Map<nodeId, output>, writes: Set<path> }
  → execute script from the top
      agent(...)：
        id = nodeId(...)
        if nodes[id].status == succeeded: return cached output   // 不 spawn
        if nodes[id].status == running: 重新执行（上次崩溃的 node）
        else: spawn child, await, persist node
      world.run(...): 同上（缓存输出）
      artifact.write(...): 若 sha256 已存在则复用；否则写
      hole(...): 若 hole 已 filled，返回 answer；否则暂停
      log/report: 追加 events（重复的 log 在 replay 时跳过，避免噪音）
  → 完成：写 result
```

### 5.3 副作用约束

脚本运行在 worker 中，默认没有 `fs`/`net`，只能通过 facade：

| facade | 语义 | 可 replay |
|---|---|---|
| `agent(prompt, opts)` | spawn 子代理，返回文本/结构化值 | 是（缓存） |
| `parallel(items, fn)` | 并发；稳定 key | 是 |
| `pipeline(items, ...stages)` | 顺序阶段 | 是 |
| `phase(name)` | 标记阶段 | 是（只记事件） |
| `log(msg)` | 进度日志 | 是（replay 跳过） |
| `report(value)` | 结构化报告 | 是 |
| `artifact.write(name, bytes)` | 写 artifact | 是（content hash） |
| `world.run(cmd, opts)` | 受限 shell（只读/workspace-write） | 是（缓存输出 + hash） |
| `channel()/future()` | 进程内消息 | **否**（resume 丢 in-flight 状态） |
| `hole(prompt)` | 留白 | 是（answer） |
| `clock()/random(seed)` | 确定性时间/随机 | 是（seed 记录） |

**禁止**：`Date.now`、`Math.random`、`fetch`、`require`、`process`、`import()`（静态扫描 + worker 全局屏蔽）。若脚本需要时间，用 `clock()`；需要随机，用 `random(seed)`。

### 5.4 不能 replay 的边界

- `channel/future` 的 in-flight 值不持久化；resume 后重置。文档与 UI 必须提示。
- 子代理内部状态不 replay：已完成的 `agent()` 直接返回结果，不恢复子会话；需要继续对话的用 `send_message`（不保证跨 resume）。
- 工具调用的外部副作用（写文件、发请求）不在引擎控制内；`world.run` 只保证输出缓存，不保证幂等。

---

## 6. 脚本执行

### 6.1 TypeScript

- 接受 `.ts`；用 `typescript` 的 `transpileModule` 转 JS + `createProgram` 做诊断（不 emit 文件）。
- facade 以 `workflow-facade.d.ts` 注入虚拟文件系统；诊断只报 facade 文件的错误。
- 诊断失败：返回结构化错误（行/列/消息），不创建 run。
- 运行：Worker（`node:worker_threads`）或子进程；v1 用子进程（崩溃隔离更好），通过 `process.send` RPC。

### 6.2 Worker RPC

```
Host (durableWorkflow)  ⇄  Worker (script)
  agent.request   → { nodeId, prompt, opts }
  agent.result    ← { text | json }
  world.request   → { nodeId, cmd, opts }
  world.result    ← { stdout, stderr, code }
  artifact.write  → { name, base64 }
  hole.open       → { holeId, prompt }
  hole.answer     ← { code }
  log/report      → 单向
  cancel          ← 单向
```

- Worker 内没有 dsh 的 `ctx`；所有能力经 RPC。
- 每个 RPC 有超时（默认 agent 无超时，受 run 取消；world 默认 10 分钟）。
- Worker 崩溃：当前 node 标记 failed；run 状态 failed（可 resume 重试该 node）。
- 子进程环境：`NODE_OPTIONS` 清空、无 `DSH_*` 密钥、cwd=workspace、stdio 仅 RPC。

### 6.3 沙箱

- 脚本进程受 dsh 的 `ctx.sandbox` 约束（file policy + 进程限制）。
- `workspace-write` 下只能写 workspace；`read-only` 下 `world.run` 拒绝写命令。
- `danger-full-access` 仅当 profile 显式开启，且每次 `workflow_run` 走审批。

---

## 7. 并发

| 层 | 机制 | 默认 |
|---|---|---|
| run 级 | 同时 in-flight 的 `agent()` 数 | `D = max(4, min(16, cores-2))` |
| 全局 | 子代理池（`ctx.subagents` 的容量） | dsh 的 `maxActiveSubagents=8`（继承） |
| 模型 provider | dsh 的 retry/限流；不自建 governor | — |
| 节点数 | `maxTotalNodes` | 1000 |

- run 级调度器在 Host：维护 `inFlight`、队列；`amend({maxConcurrency})` 立即调整（不打断已发出）。
- 子代理池满：node 状态 `queued`（不是 failed），UI 显示"等待子代理槽位"。
- 死锁检测：若所有 in-flight 都在等子代理槽位且无进展 30s → `run-stalled` 事件（不自动失败）。

---

## 8. 留白与提问

### 8.1 hole

- 脚本 `await hole("需要什么")` → 引擎写 `holes`（open）+ `workflow/hole-opened` 事件 + `agent.inject()` 通知父会话。
- run 状态 `waiting-hole`；已 in-flight 的其它 node 继续跑完。
- 模型调 `workflow_answer_hole({run_id, hole_id, code})` → 写 answer → 重新调度（replay 到 hole 返回 answer）。
- 超时（配置，默认 24h）→ hole cancelled，run failed（`HOLE_TIMEOUT`）。

### 8.2 question（actor escalate）

- `workflow_escalate({question, context})` 只在 run 创建的 actor 会话可用（scope 检查）。
- 写 `questions`（open）+ `workflow/question` 事件 + 通知。
- `workflow_resolve_question` 回答；actor 的 `escalate` 解除阻塞。
- 每 actor 最多 3 次（与 ZCode 一致），超出返回业务错误。

### 8.3 submit_result

- actor 用 `workflow_submit_result({result})` 提交结构化终态；引擎校验 schema（若声明）后写入 node output。
- 提交后 actor 的输入关闭；再发消息返回错误。

---

## 9. amend / successor

| 改动 | 行为 |
|---|---|
| 只改 `maxConcurrency`（live） | 就地生效；同 runId；写 `workflow/run-amended`；不打断 in-flight |
| 只改 `subagentModel`（live） | 仅影响后续 `agent()`；已 spawn 的不变 |
| 改 `script` / `args` / `name` | 创建 successor run（新 runId，`parent_run_id` 指向旧 run），旧 run 标记 `cancelled`（可配置为 `superseded`） |
| 改已保存工作流 | 新版本；运行中的 run 不受影响 |

CAS：`amend` 带 `expectedRevision`；不匹配返回 `STALE_REVISION`。

---

## 10. 事件与 session 日志

### 10.1 新事件（`@zcd/shared` 声明合并）

```ts
declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    'workflow/run-started': { runId: string; name: string; scriptHash: string }
    'workflow/run-finished': { runId: string; status: RunStatus; summary: string; artifactIds?: string[] }
    'workflow/run-stalled': { runId: string; reason: string }
    'workflow/hole-opened': { runId: string; holeId: string; prompt: string }
    'workflow/question': { runId: string; questionId: string; question: string }
    'workflow/run-amended': { runId: string; revision: number; changes: string[] }
  }
}
```

规则：

- 只存 id/摘要；不存脚本全文、子代理输出全文、artifact 内容。
- 每个事件必须 `ignorable: true`（旧客户端可跳过）——在 envelope 上声明，具体字段按 dsh 的约定。
- `workflow/run-finished` 是模型可见通知的来源；UI 也读它做卡片。

### 10.2 通知

- 完成/失败/hole/question → `agent.inject()` 一条 `user/message`（source 标 `workflow`），内容包含 `run_id`、状态、下一步建议。
- 不把 journal 写进 session；模型需要细节时调 `workflow_get_run`。

---

## 11. 工具

| 工具 | 输入 | 说明 |
|---|---|---|
| `workflow_run` | `{ name?, script?, saved?, path?, args?, max_concurrency?, subagent_model?, wait? }` | 创建 run；默认立即返回 `run_id` |
| `workflow_amend` | `{ run_id, expected_revision, script?, max_concurrency?, subagent_model? }` | 就地或 successor |
| `workflow_save` | `{ name, script, description? }` | 保存到 user/workspace |
| `workflow_eval` | `{ script, args? }` | 同步、只读、瞬态；禁止 `agent()`/写 |
| `workflow_list_runs` | `{ status?, limit? }` | 只读 |
| `workflow_get_run` | `{ run_id, include_nodes? }` | 只读；大结果截断 |
| `workflow_resume` | `{ run_id }` | 恢复 interrupted/failed |
| `workflow_answer_hole` | `{ run_id, hole_id, code }` | 补全 |
| `workflow_resolve_question` | `{ run_id, question_id, answer }` | 主代理回答 actor |
| `workflow_list_saved` | `{}` | 只读 |
| `workflow_submit_result` | `{ result }` | 仅 actor 会话 |
| `workflow_escalate` | `{ question, context }` | 仅 actor；最多 3 次 |

工具描述里必须写清：

- 何时用 durable vs dsh `workflow`（一次性脚本用后者）。
- 脚本限制（无 `Date.now`/`Math.random`/网络）。
- 恢复语义（channel 不恢复）。

---

## 12. UI

### 12.1 右侧栏 `workflow` tab

- 列表：run 名称、状态、进度（completed/total nodes）、耗时、模型。
- 详情：节点树（agent/world/hole）、每个节点的输入摘要/输出摘要/子会话链接、错误。
- 操作：cancel / resume / amend（仅并发滑杆）/ open child session。

### 12.2 对话内卡片

- run started：名称 + "查看"按钮。
- run finished：状态 + 结果摘要 + artifact 链接。
- hole/question：提示 + 输入框（或跳转到面板）。

### 12.3 数据通道

- client 插件通过 dsh 的 remote API（`docs/cookbook/adding-a-remote-api.md`）调 Host 的 `ctx.durableWorkflow.get/list`。
- 实时更新：`workflow/*` 事件经 `session/event` 推送；面板按 runId 订阅。
- 不把 store 直接暴露给 client；所有查询走授权 API。

---

## 13. 失败与恢复

| 场景 | 行为 |
|---|---|
| 进程崩溃 | 启动扫描 `running` → `interrupted`；`resume` 可继续 |
| Worker 崩溃 | 当前 node failed；run failed；可 resume 重试 |
| 子代理失败 | node failed；按脚本 `retry` 选项（默认 0）；run 可继续其它分支 |
| store 写失败 | 当前事务回滚；run failed（不进入半状态）；错误上报 |
| 用户取消 | abort 所有子代理/工具；worker 终止；状态 cancelled |
| 超时（node） | node failed（`NODE_TIMEOUT`）；可配置重试 |
| 重启后 hole 仍 open | 保持 waiting-hole；通知不重复（用 event seq 去重） |

---

## 14. 安全

- 脚本是不可信代码：worker + sandbox + 无网络/文件（除 facade）。
- `world.run` 只读/workspace-write 受 dsh sandbox；`danger-full-access` 需审批。
- artifact 写入限制在 run 目录；路径规范化，拒绝 `..`/符号链接。
- 子代理继承父的权限与 sandbox；不提升。
- `workflow_eval` 禁止 `agent()`/写/网络；只允许纯计算 + `log/report`。
- 日志/遥测：不记录脚本全文、prompt、文件内容；只记 hash/长度/状态。

---

## 15. 测试

| 层 | 用例 |
|---|---|
| 单元 | 状态机转移、node id 稳定性、canonical JSON、CAS、hole 状态 |
| 集成 | 正常 run；crash/resume；cancel；amend 并发；successor；hole；question |
| 故障注入 | Worker kill、store 写失败、子代理超时、子代理池满 |
| 回放 | 录制一次 run 的 events，重放断言输出一致 |
| 性能 | 1000 nodes、8 并发、store 写入 P95、面板查询 P95 |
| 安全 | 脚本读文件/网络/环境变量被拒绝；路径穿越；恶意 artifact |

---

## 16. 被否方案

| 方案 | 否决原因 |
|---|---|
| 改 `dsh-workflow` 加 journal | 破坏其"最小语义"设计；上游明确不做 |
| 工具层伪 resume（只重跑脚本） | 已完成的子代理会重复调用，成本不可接受 |
| 用 Temporal/DBOS | 引入重依赖与运维面；dsh 的部署模型是单机/单 Host |
| 把 journal 写进 session 日志 | 体积爆炸；违反 dsh 的日志职责 |
| 只做内存 run + 定期快照 | 崩溃丢中间值；无法满足 resume |

---

## 17. 落地顺序

1. 契约与 store（1 周）：类型、schema、迁移、单元测试。
2. 单 node 执行（1 周）：worker + RPC + `agent()`。
3. 状态机 + resume（2 周）：崩溃/恢复、node 缓存。
4. 并发 + amend（1.5 周）。
5. hole/question/submit（1.5 周）。
6. 工具 + 通知（1 周）。
7. UI（2 周）。
8. 压测/安全/文档（1 周）。

总计约 **8–10 人周**，与 WP-08 + WP-09 一致。
