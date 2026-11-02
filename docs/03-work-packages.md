# 03 · 工作包

> 每个工作包给出：目标、范围、交付物、依赖、验收、估算、风险。
> 估算是**单人**投入（人周），不含评审/等待；并行时按依赖排。
> 阶段：P0 地基 / P1 基础能力 / P2 工作流 / P3 浏览器·CUA / P4 UI / P5 技能。

---

## WP-01 · Overlay 骨架与 CI（P0）

**目标**：证明"不改上游也能跑起一个产品 profile"，并把同步成本变成流水线。

**范围**

- `upstream/dsh` pin 到 `0.2.2-alpha.2`（submodule 或 tarball）。
- `pnpm-workspace.yaml`、`tsconfig.base.json`、oxlint/oxfmt、vitest。
- `@zcd/shared`、`@zcd/bundle-base`、`@zcd/bundle-web-app` 三个空壳包。
- `profiles/product/package.json` + `cordis.patch.yml`，能 `dsh --profile product` 启动。
- `scripts/sync-upstream.mjs`：拉取、应用 overlay、跑冒烟。
- `scripts/verify-naming.mjs`：工具/事件命名规范。
- `NOTICE` + `LICENSE`（MIT）+ ZCode 技能来源清单。

**交付物**

- 可启动的 product profile（只有 dsh 原生能力）。
- CI：typecheck、lint、单测、`dsh --profile product --dump-config` 快照。
- 文档：`docs/01-target-architecture.md` 的仓库布局落地。

**验收**

1. `dsh --profile product` 启动 Web，能完成一次对话。
2. `--dump-config` 输出包含 `zcd-base` 的所有行，且不含任何上游文件改动。
3. CI 在干净 clone 上 10 分钟内通过。
4. `git diff upstream/` 为空。

**估算**：2–3 人周。

**风险**：dsh 的 `dsh.client` 构建格式（lazy-CJS factory）在仓库外没有现成 preset（`docs/cookbook/adding-a-settings-card.md:64-80`）。需要在 WP-01 里复刻 `clientBundle` 构建。

---

## WP-02 · ZCode 兼容工具包（P1）

**目标**：把 ZCode 技能依赖的"小工具/小语义"补齐，让技能文本只需改名字。

**范围**

| 工具 | 来源 | 实现 |
|---|---|---|
| `todo_read` | ZCode `TodoRead` | 读 `todo/write` 投影 |
| `list_models` | ZCode `ListModels` | 包 `list_subagent_models`（或 `ctx.llm` 目录） |
| `enter_plan_mode` | ZCode `EnterPlanMode` | 优先程序化执行 `/plan`；`PlanModeController` 目前没有公开 enter API，若 commands 不能程序化执行则需上游加 `enter()` |
| `schedule_delete` / `schedule_pause` | ZCode `CronDelete` / `CronPauseSelf` | 包 `ctx.schedule` |
| `subagent_output` / `subagent_stop` | ZCode `TaskOutput` / `TaskStop` | 读 child session 摘要 / cancel |
| `session_handoff` | ZCode `ReadSessionContext` | 包 `ctx.sessionQuery` |
| `tool_catalog`（可选） | 无 | 给 UI/调试用，不暴露给模型 |

**不做**：`Task` 别名、PascalCase 别名、`GoalRead`、`ReplyToChannel`。

**依赖**：WP-01。

**验收**

1. 每个工具都有 schema、output renderer、审批声明、单测。
2. `dsh --profile product --dump-config` 中能看到全部工具行。
3. 技能迁移文档里的名称映射表 100% 覆盖。
4. `schedule_delete` 删除后 `schedule_list` 不再返回；重启后仍不返回。

**估算**：2–3 人周。

**风险**：`enter_plan_mode` 的状态所有权在 dsh 的 plan 服务里，工具不能自己存状态（否则 replay 不一致）；`PlanModeController` 的 `pendingIntents` 是私有的，不能从外部改。先确认 commands 能否程序化触发 `/plan`，否则提上游 PR 暴露 `enter()`。

---

## WP-03 · 工具搜索与延迟加载（P1）

**目标**：把工具 schema 从常驻上下文里挪走，同时不破坏 dsh 的 scope/admission。

**范围**

- `ctx.deferredTools`：目录 + 每会话已加载集合（projection）。
- `tool_search`：按名/描述/关键词搜索；返回 `tool_reference` 风格内容。
- 延迟工具注册：`when: ctx => loaded.has(name)`。
- `tool/loaded` session 事件（`ignorable: true` 仅用于 UI）。
- 配置：`alwaysVisible`、`deferred`、`maxResults`、`catalogRefresh`。
- 指标：基础 schema token、加载延迟、误召回。

**依赖**：WP-01/02。

**验收**

1. 基础工具集 schema ≤ 8k tokens（用 dsh 的 token-meter 测）。
2. `tool_search("browser")` 能在 2 个 step 内让浏览器工具可调用。
3. session resume/fork 后已加载集合正确恢复。
4. 未加载时直接调用返回 `UNKNOWN_TOOL`，且不触发审批。
5. 并发两个 agent 的加载集合互不影响（scope 隔离）。

**估算**：3–4 人周。

**风险**：`when` 每 step 对全部注册工具求值；工具数 > 100 时需缓存。若 `tools.resolve` 的回调异常会 fail loud（`ToolActivationError`），要有降级测试。

---

## WP-04 · 策略插件：Bash 只读 + Skill Gate（P1）

**目标**：ZCode 的"只读不弹窗"与"工作流必须先读技能"，以不破坏 dsh 安全模型的方式实现。

**范围**

- `@zcd/policy-bash-readonly`：
  - 解析 `bash` 的 `command`（复用/移植 ZCode 的只读规则表，**重实现**）。
  - 注册 `approval/request` **answerer**：命中只读规则返回 `allowed-once`；不确定/不匹配则 `next()`，走正常审批。
  - 不绕过 monotonic guard；`approval=never` 时服务层直接拒绝，answerer 不会被调用。
  - 规则覆盖：`ls/find/cat/head/tail/wc/stat/git status|log|diff|show|branch --list/gh pr view` 等。
  - 明确拒绝：重定向、heredoc、`rm`、`git add/commit`、管道到写命令。
- `@zcd/policy-skill-gate`：
  - 读 session 历史中的 `skill` 调用（成功且非错误）。
  - `workflow_run`/`workflow_amend`/`workflow_save` 在未加载 `dynamic-workflows` 时拒绝。
  - 豁免：只运行已保存工作流、只改并发。

**依赖**：WP-01。

**验收**

1. 只读命令命中时，审批弹窗数为 0；写命令仍弹窗。
2. 规则表 100% 有正反用例；误放行 = 0（安全测试）。
3. 技能未加载时 `workflow_run` 返回 428 业务错误，且不进入审批。
4. 加载技能后同一会话可调用；压缩后 gate 重新关闭（与 ZCode 语义一致）。

**估算**：2–3 人周。

**风险**：Bash 语法解析的边角（子 shell、变量展开、管道）容易误判；必须 fail-closed：解析不确定就返回"无意见"，走正常审批。

---

## WP-05 · OffPeak + Cron/Schedule 对齐（P1）

**目标**：闲时执行与定时任务，语义对齐 ZCode 但落在 dsh 的 session/schedule 上。

**范围**

- `ctx.offpeak`：
  - `create({ prompt, cwd, model, preset, idleMinutes, maxRounds })`
  - 空闲判定：无 active turn、无 pending input、无 background job。
  - 执行：新 Session（同 workspace）+ `offpeak` preset；记录 `offpeak/*` 事件。
  - 用户接管：同 workspace 的新用户输入 → abort + 标记 `taken-over`。
  - 重启恢复：pending 任务重新排队；running 任务标记 `interrupted`。
- 工具：`offpeak_create`、`offpeak_list`、`offpeak_cancel`。
- Cron 对齐：`cron_create/list/update/delete/pause` → `ctx.schedule`（RFC 5545）。
- 配置：`idleMinutes`、`minIdleRounds`、`maxConcurrentTasks`、`allowedPresets`。

**依赖**：WP-01/02。

**验收**

1. 空闲 10 分钟后自动跑一次指定 prompt；期间用户输入能 1 秒内取消。
2. 重启后 pending 任务恢复；running 任务显示 interrupted 且不重复执行。
3. Cron 表达式（`0 9 * * 1-5`）转成 RRULE 后在下个工作日触发。
4. 子代理/离线会话不能创建 OffPeak 任务（权限）。

**估算**：3–4 人周。

**风险**：dsh 的 schedule 是 Host-owned，跨 Session；OffPeak 的"空闲"判定需要读多个服务的状态，容易出现竞态。用单一 `IdleGate` 服务串行化。

---

## WP-06 · 记忆与 Dream（P2）

**目标**：ZCode 的 project/global memory + 离线整理。

**范围**

- 目录：`<workspace>/.zcd/memory/` 与 `~/.zcd/memory/`（可配置）。
- 工具：`memory_search`、`memory_read`、`memory_write`（写只允许 memory 目录）。
- system prompt section：注入索引（不是全文）。
- `dream`：定时/空闲触发的整理任务（用 OffPeak 或 schedule）；只读 shell + 目录内写。
- 权限：memory 目录外的写一律拒绝；`rm` 只允许 `.md` 且路径在目录内。

**依赖**：WP-05（调度）、WP-01。

**验收**

1. `memory_write` 不能写到目录外（含 `..`、符号链接）。
2. `memory_search` 在 10k 文件内 P95 < 200ms。
3. dream 运行有锁、最小间隔 24h、失败不阻塞主流程。
4. 压缩后 memory section 仍存在（它是静态 section，不进摘要）。

**估算**：4–5 人周。

**风险**：隐私（记忆可能含密钥）。写入前做 secret 扫描；日志只记路径与大小。

---

## WP-07 · 多代理增强（P2）

**目标**：ZCode 的 Markdown profile、子代理输出、两个内置 agent 的等价物。

**范围**

- `general-purpose` / `Explore` 两个 preset（dsh preset 格式）。
- `Explore` 的工具限制用 `tools.restrict({ allow: [...] })` 在 agent scope 实现。
- Markdown profile：解析 `---` frontmatter（name/description/tools/model）+ 正文 → 动态生成 preset；若 dsh 的 preset registry 不支持运行时注册，则降级为"生成文件 + 重启生效"。
- `subagent_output` / `subagent_stop`（见 WP-02）。
- 持久记忆子代理：把 memory 索引注入子代理 prompt。

**依赖**：WP-01/02/06。

**验收**

1. 用户放一个 `.zcd/agents/reviewer.md`，`subagent` 能按名字选择它。
2. Explore 子代理看不到 `write/edit`，尝试调用返回 `UNKNOWN_TOOL`。
3. 后台子代理完成后，父会话收到 completion notice；`subagent_output` 能读摘要。
4. 子代理的 system prompt 包含 memory 索引（若启用）。

**估算**：3–4 人周。

**风险**：dsh preset 是组合层，Markdown profile 的动态注册可能触碰"composition 不可变"的边界；先做静态生成。

---

## WP-08 · Durable Workflow · 核心（P2，XL）

**目标**：新增 `ctx.durableWorkflow` seam + SQLite run store + 确定性 replay。

**范围**

- `@zcd/workflow-durable`：Service Definition、状态机、调度、取消、amend、resume。
- `@zcd/workflow-store-sqlite`：runs / nodes / events / holes / artifacts 表；schema 版本与迁移。
- 脚本执行：TS → JS（`tsc` 诊断），在 `node:vm`/子进程中运行；facade 注入（`agent/parallel/pipeline/phase/log/report/artifact/world/channel/hole`）。
- 确定性：`agent()` 的 node id = hash(scriptHash + callIndex + args)；replay 命中缓存直接返回。
- 并发：run 级 `maxConcurrency`；全局 provider 上限用 dsh 的 retry/限流，不自建 governor。
- 事件：`workflow/run-started|finished|failed|stalled|hole-opened|question` 摘要；journal 只在 store。

**依赖**：WP-01/02/04。

**验收**

1. `kill -9` 后 `workflow_resume` 从最后 completed node 继续；已完成的 `agent()` 不重跑（用计数器断言）。
2. 同一脚本两次运行，node id 稳定；不同参数产生不同 id。
3. 并发 8 个子代理时，run 级上限生效；amend 只改并发不重启。
4. hole 打开时 run 状态为 `waiting-hole`；补全后继续。
5. store 写入失败时 run 失败且不产生"半完成"状态（事务）。

**估算**：8–10 人周。

**风险**：确定性 replay 是最大难点（脚本副作用、时间、随机数）。必须限制：脚本内禁止 `Date.now`/`Math.random`/网络；提供 `clock()`/`random(seed)` facade。若做不到，降级为"只 resume 未开始的 node"，并在文档里写清。

---

## WP-09 · Durable Workflow · 工具与 UI（P2）

**目标**：11 个工具 + run 面板 + 通知。

**范围**

- 工具：`workflow_run`、`workflow_amend`、`workflow_save`、`workflow_eval`、`workflow_list_runs`、`workflow_get_run`、`workflow_resume`、`workflow_answer_hole`、`workflow_resolve_question`、`workflow_list_saved`、`workflow_submit_result`、`workflow_escalate`。
- 确认窗口：`workflow_run` 调 `ask_user_question`（approve / keep planning with feedback）。
- UI：`client-ui-workflow` 注册右侧栏 tab + 对话内 run 卡片；订阅 `workflow/*` 事件与 store。
- 通知：完成/失败/提问 → `agent.inject()` user/message。
- 技能：`dynamic-workflows` 重写为 `workflow_*` 工具与 facade。

**依赖**：WP-08。

**验收**

1. 模型调 `workflow_run` 后立即拿到 `run_id`；面板 1 秒内出现 running。
2. 完成通知在父会话可见，包含 run_id/结果摘要。
3. `workflow_get_run` 在 run 结束后仍可读（store）。
4. 取消后子代理全部停止（无孤儿）；重启后 cancelled 不自动复活。

**估算**：5–6 人周。

**风险**：工具数量多（12 个），上下文成本高；用 `tool_search` 延迟加载工作流工具（WP-03），只保留 `workflow_run` 常驻。

---

## WP-10 · 浏览器与 Code-Act（P3，L）

**目标**：ZCode 的"一个 `js` 面驱动浏览器"体验，落在 dsh 的 PTC + provider 上。

**范围**

- `ctx.browserAutomation`：会话级 Chromium（Playwright/CDP），对象模型 `browsers/browser/tabs/tab.playwright`。
- `js` 工具：用 `ctx.ptcRuntime` 的 REPL 模式（或自管 worker），注入 `agent.browsers`、`nodeRepl.write`。
- 会话所有权：一个 Agent/Session 一个浏览器；跨 turn 复用；Session 结束关闭。
- 安全：导航/下载/上传/跨域 → 审批；页面内容视为不可信；`evaluate()` 提示风险。
- UI：复用 `ui-sidebar-browser` 展示受控页面（或新增 `client-ui-browser` 面板）。
- 技能：`control-browser`、`web-gui-tester` 近原样移植（只改 `Read`→`read` 等）。

**依赖**：WP-01/03/04。

**验收**

1. 一次 `js` 调用能打开页面、抓 snapshot、点击、截图；跨 turn 保留 tab。
2. 浏览器进程在 Session dispose 后 2 秒内退出（无孤儿）。
3. 页面里注入的指令不会被模型执行（安全测试用例）。
4. 下载/上传触发审批；拒绝时动作不发生。
5. 技能在无浏览器环境（headless CI）给 structured error，不崩。

**估算**：5–7 人周。

**风险**：Electron/Chromium 打包体积；CDP 版本兼容；`js` 的持久状态与 dsh 的"model-visible ⟺ logged"冲突（脚本内的中间值不可 replay）。缓解：`js` 每次调用记录代码与输出，不承诺跨调用 replay 语义。

---

## WP-11 · CUA 桥（P3，L）

**目标**：ZCode 的 `agent.computer` 技能可用；底层用 dsh 的 CUA provider 或 ZCode CUA SDK。

**范围**

- 方案 A（推荐）：`ctx.computerUse` 已有 provider（Cua Driver/macOS）→ 写 `cua-bridge` 把其工具/操作包装成 `agent.computer` JS API，注入 `js`。
- 方案 B：移植 ZCode CUA SDK（649 行）+ Windows helper（1,330 行脚本）作为新 provider。
- 权限：复用 dsh 的 `cuaAccess`（系统权限、应用授权）；每次首次操作应用 → 审批。
- 技能：`computer-use` 近原样；平台差异写进提示。

**依赖**：WP-10（共享 `js` 宿主）。

**验收**

1. macOS：能枚举窗口、点击、输入、截图；权限拒绝时 structured error。
2. Windows：至少支持截图 + 键鼠（若选方案 B）。
3. 应用授权弹窗只出现一次；拒绝后不再重试。
4. 取消调用不能"撤回"已发生的输入（文档写清）。

**估算**：6–8 人周（方案 A 4–5）。

**风险**：平台差异大；dsh 的 CUA 是 macOS-only experimental。若首版只支持 macOS，需在 UI 明确标注。

---

## WP-12 · Gen UI（P4，L）

**目标**：模型生成 inline 可交互页面，安全沙箱，可复制/展开。

**范围**

- `visualize` 工具：写 HTML 到会话 artifacts 目录，返回 `{ title, path, mode }`。
- `client-ui-genui`：工具卡片渲染 iframe（`sandbox="allow-scripts"`，无 same-origin），高度 240–10000px，支持 wide。
- 宿主路由：`/genui/<session>/<id>` 严格 CSP；禁止外链导航/弹窗/下载。
- 外链：`window.zcode.openExternal` 等价 → 平台 opener（需用户手势）。
- 状态：不做 tweak v1；模型上下文只带标题/摘要。

**依赖**：WP-01。

**验收**

1. 助手消息里出现可交互页面；脚本不能读父页面 DOM/cookie。
2. 外链点击需用户手势；否则被阻止。
3. 页面高度自适应，超出滚动；移动端全宽。
4. 删除会话/重开后页面仍可渲染（artifact 持久化）。

**估算**：4–5 人周。

**风险**：CSP 与 Electron/Web 差异；XSS 面。必须做安全评审。

---

## WP-13 · Office 文档工具与查看器（P4，M）

**目标**：让模型能"打开、读、搜、定位"文档，并驱动 dsh **已有**的查看器。

> 关键前提：dsh 的 `ui-sidebar-documentpreview` **已内置** Word/PowerPoint 转 PDF、表格浏览器打开、Markdown/代码/图片/PDF/HTML 渲染与右侧栏 tab 注册。ZCode 的"查看器面板"在本项目里是 **S1（复用）**，不是重写。

**范围**

- `@zcd/tool-documents`（S2）：5 个模型工具
  - `open_document({ path })` → 通过 remote API 让 client 打开对应 tab
  - `read_document({ path, range })` → 提取文本 + 位置锚点（`#p:n` / `#t:r/c` / `#s:Sheet!A1` / PDF 页）
  - `search_document({ path, query, limit })` → 命中锚点列表
  - `show_in_viewer({ path, anchor })` → 滚动到锚点
  - `get_view({ path? })` → 当前打开的文档与视图状态
- 提取实现：`mammoth`（docx）、`exceljs`（xlsx）、`pdfjs-dist`（pdf）、pptx 用 `jszip` + XML 解析；都在 Node 侧，不进 client。
- 锚点契约：与 `ui-sidebar-documentpreview` 的 `sourceLines`/资源地址对齐；必要时扩展 navigation revision（不改上游则在 client 侧加一个 `zcd.anchor` 参数）。
- 生成技能：移植 8 个 SKILL.md；**先评估复用 dsh 的 `skill-office` 8 个资产**，避免重复。
- 无 LibreOffice：回退为"下载/系统打开"，工具返回结构化说明。

**依赖**：WP-01/02。不依赖 Gen UI。

**验收**

1. `open_document` 后右侧栏打开文件；同一路径不重复开 tab。
2. `read_document` 返回带锚点文本；`show_in_viewer` 能定位到段落/单元格/页。
3. docx/xlsx/pptx/pdf 各 1 个集成用例（fixture 文件）。
4. 50MB 文件不阻塞 UI；转换有超时与进度。
5. 无 LibreOffice 时给出明确错误与回退动作。

**估算**：3–4 人周（比原估少，因为查看器已存在）。

**风险**：文档解析质量（合并单元格/文本框）；锚点与现有导航契约的兼容；大文件内存。

---

## WP-14 · 设置页与插件市场打磨（P4，M）

**目标**：ZCode 式 IA + 插件/MCP/Skill/Command/Hook 管理。

**范围**

- `client-ui-settings-zcd`：一个设置页 + tabs（Memory / Agents / Tools / Workflow / Plugins / MCP / Skills / Commands / Hooks）。
- 复用 dsh 的 `configForms`、`plugins.detail.*`、`ctx.sidebarRight`。
- 插件市场：复用 `plugin_market`，加 ZCode 式卡片（可选）。
- 不移植 ZCode 的 Workspace scope；用 profile/preset 选择器。

**依赖**：WP-02/05/06/07。

**验收**

1. 每个 tab 能读/写对应配置，保存后下一个操作生效（volatile）。
2. 插件安装/启停/卸载与 dsh 的 plugin_manager 一致，不绕过审批。
3. 设置页在 390px 宽度无横向溢出。

**估算**：3–4 人周。

**风险**：dsh 的设置导航顺序可能不可扩展；若不可，退化为单页 tabs。

---

## WP-15 · 技能迁移（P5，可与 P2–P4 并行）

**目标**：39 个产品技能逐条落地。

**范围**

- 按 `08-skills-catalog.md` 的分类执行：原样 14、改工具名 14、重写 5、丢弃 6。
- 每个技能：`SKILL.md` + 资源 + 许可头 + 一条 smoke 用例。
- 建立技能回归：用录制的 prompt 跑"技能是否能被正确触发"。

**依赖**：对应工具 WP（浏览器/Office/工作流/Gen UI）。

**验收**

1. `skill` 列表包含全部目标技能；名称/描述唯一。
2. 每个技能至少有一个可执行示例（CI 中跳过需要外部服务的）。
3. 许可头/NOTICE 完整。

**估算**：3–4 人周（内容为主）。

**风险**：技能文本与工具名漂移；用 `verify-naming.mjs` 在 CI 检查技能里出现的工具名是否存在。

---

## 汇总

| 阶段 | WP | 人周 |
|---|---|---:|
| P0 | 01 | 2–3 |
| P1 | 02, 03, 04, 05 | 10–14 |
| P2 | 06, 07, 08, 09 | 20–25 |
| P3 | 10, 11 | 11–15 |
| P4 | 12, 13, 14 | 10–14 |
| P5 | 15 | 3–4 |
| **合计** | | **56–75 人周** |

> 这是"完整第一版"的估算，不是 MVP。若只做 P0 + P1 + WP-13（文档工具）+ superpowers，可压到 **15–20 人周**；工作流引擎（WP-08/09）单独立项。
