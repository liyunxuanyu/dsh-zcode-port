# 02 · 迁移主矩阵

> 这是二开的**主清单**：每个 ZCode 能力一行，给出 dsh 现状、分类、落点、工作包、量级与风险。
>
> 分类：
> - **S1** 已有同等能力：配置/改名/直接使用
> - **S2** 有 seam，缺 provider/consumer：写插件
> - **S3** seam 缺失：先造 seam（尽量上游化）
> - **S4** 产品级能力：独立工程，本版本不做
>
> 量级：XS < 1 人日；S 1–3；M 1–2 周；L 3–5 周；XL 6–10 周。

---

## 1. 工具面

| # | ZCode 能力 | ZCode 证据 | dsh 现状 | 类 | 落点 | WP | 量级 | 风险 |
|---|---|---|---|---|---|---|---|---|
| 1 | `Read`（文本/图片/视频/PDF 一体化） | `handlers/read.ts:187-196` | `read` + `read_image`（图片独立） | S1 | 直接用；技能里把 `Read` 映射为 `read`/`read_image` | WP-02 | XS | 低 |
| 2 | `Write` / `Edit` | `handlers/write.ts:216`、`edit.ts:258` | `write` / `edit` / `apply_patch` / `str_replace_editor` | S1 | 直接用；`apply_patch` 出厂关闭，需在 bundle 打开 | WP-02 | XS | 低 |
| 3 | `Bash`（只读策略/后台/图片输出） | `handlers/bash.ts:488` | `bash`（一次性）+ `bash`（持久 PTY） | S1 + S2 | 用 dsh `bash`；只读免打扰另做 `policy-bash-readonly` | WP-02 | S | 中 |
| 4 | `Glob` / `Grep` | `handlers/glob.ts:87`、`grep.ts:143` | `glob` / `grep`（打包 ripgrep） | S1 | 直接用 | WP-02 | XS | 低 |
| 5 | `WebFetch` / `WebSearch` | `handlers/webfetch.ts:202`、`websearch.ts:29` | `web_fetch` / `web_search` | S1 | 直接用 | WP-02 | XS | 低 |
| 6 | `TodoRead` / `TodoWrite` | `handlers/todo.ts:78,136` | `todo_write`（无读工具，状态在日志/UI） | S1 + S2 | 直接用；如需模型读回，加 `todo_read`（读投影） | WP-02 | XS | 低 |
| 7 | `AskUserQuestion` | `handlers/ask-user-question.ts:76` | `ask_user_question`（支持 timed） | S1 | 直接用 | WP-02 | XS | 低 |
| 8 | `EnterPlanMode` / `ExitPlanMode` | `handlers/plan-mode.ts:141,62-110` | 只有 `exit_plan_mode`；进入靠 `/plan` 命令，`PlanModeController` 未暴露 enter API | S2/S3 | 优先程序化执行 `/plan`；不行则上游加 `enter()`，不直接改私有状态 | WP-02 | S–M | 中（状态所有权） |
| 9 | `Agent` / `Task` | `handlers/agent.ts:236,302` | `subagent` / `subagent_fork` | S1 | 直接用；技能名映射 | WP-02 | XS | 低 |
| 10 | `SendMessage` / `RespondToCoordinator` | `send-message.ts:81`、`respond-to-coordinator.ts:56` | `send_message` / `list_agents` / `interrupt_agent` | S1 | 直接用；coordinator 语义=发给 parent | WP-02 | XS | 低 |
| 11 | `TaskOutput` / `TaskStop` | `task-output.ts:92`、`task-stop.ts:105` | `job_output` / `job_kill`；子代理用 `list_agents` / `interrupt_agent` / `send_message` | S1 | 直接映射；不新增 `subagent_output` | WP-02 | S | 低 |
| 12 | `submit_result` / `escalate` | `submit-result.ts:82`、`escalate.ts:38-60` | 无（dsh workflow 无 actor 终态/升级协议） | S2 | 作为 durable workflow 的 actor 工具实现 | WP-07 | M | 中 |
| 13 | `Skill` | `handlers/skill.ts:101` | `skill`（provider 分层） | S1 | 直接用 | WP-14 | XS | 低 |
| 14 | `js`（持久 REPL + `agent.browsers`/CUA） | `handlers/node-repl.ts:297-340` | `run_code`（PTC，fresh/REPL 模式）+ browser/CUA provider | S2 | 新增 `js` 工具：PTC REPL 模式 + browser/CUA bindings | WP-09/10 | L | 高（安全/状态） |
| 15 | `ToolSearch` / `DeferredToolCall` | `tool-search.ts:20-52`、`deferred-tool-call.ts:11-45` | 无；但 `tools.register` 支持 `when` | S2 | `tool_search` + `ctx.deferredTools` + `when` 条件（ADR-04） | WP-03 | M | 中 |
| 16 | `CronCreate/List/Update/Delete/PauseSelf` | `handlers/cron.ts:227-435` | `schedule_create/edit/list/view`；`edit` 支持 `action: delete` 与 `active: false` | S1 | 直接映射；不新增工具 | WP-06 | S | 低 |
| 17 | `OffPeakCreate` / `OffPeakList` | `handlers/off-peak.ts:187,239` | 无 | S2 | 新 `ctx.offpeak` + `offpeak_create/list/cancel` | WP-06 | M | 中 |
| 18 | `ReadSessionContext` | `read-session-context.ts:160-190` | `session_*` 五件套（experimental） | S2 | 新增 `session_handoff` 工具；topic 附件不移植 | WP-05 | M | 中（授权） |
| 19 | `ListModels` | `handlers/list-models.ts` | `list_subagent_models` | S1 | 技能里映射；不新增工具 | WP-02 | XS | 低 |
| 20 | `GoalRead` | `handlers/target.ts:26`（未注册） | `get_goal` / `create_goal` / `update_goal` | S1 | 用 dsh goal 三件套；不移植 GoalRead | WP-02 | XS | 低 |
| 21 | 动态工作流 11 工具 | `handlers/index.ts:81-127` | `workflow`（单工具，无恢复） | S3 | 新 `durableWorkflow` seam + 11 工具（`workflow_*`） | WP-07/08 | XL | 高 |

**工具面统计**：S1 13 项、S2 6 项、S3 1 项、S4 0。

---

## 2. 上下文 / 压缩 / 记忆

| # | ZCode 能力 | ZCode 证据 | dsh 现状 | 类 | 落点 | WP | 量级 | 风险 |
|---|---|---|---|---|---|---|---|---|
| 22 | auto-compact（阈值 100%、buffer 13k、熔断 3） | `compact/policy.ts:6-15` | `compaction-basic`（0.8W / 64k headroom / 16% retain） | S1 | 直接调 `Config`；不复制算法 | WP-01 | XS | 低 |
| 23 | microcompact（清旧工具结果，保留 5 条） | `compact/microcompact.ts:12-19` | `tool-result-pruner`（8192/4096/1024） | S1 | 直接用 pruner；参数可调 | WP-01 | XS | 低 |
| 24 | 工具定义延迟加载 | `tool-search.ts` | 无 | S2 | 见 #15 | WP-03 | M | 中 |
| 25 | 大结果 artifact / 图片预算 | `result-persistence-format.ts`、`docs/mcp-tool-output-budget.md` | `spill-policy`（12500 tokens）+ attachment | S1 | 直接用；MCP 图片预算若缺，补 provider 侧裁剪 | WP-03 | S | 低 |
| 26 | 记忆目录 / 提取 / dream | `memory/directory.ts`、`dream.ts:8-33` | 无内建 memory | S2 | 新 `ctx.memory` + `memory_*` 工具 + dream 定时 | WP-05 | L | 中（隐私） |
| 27 | 项目记忆召回 | `memory/recall/`、`project-memory-retrieval-branch.ts` | 无 | S2 | `memory_search` + system prompt section | WP-05 | M | 中 |
| 28 | 会话标题 | `session-title` | `session-title` + `session-title-first-prompt-llm` | S1 | 直接用 | WP-01 | XS | 低 |
| 29 | 用量统计（SQLite 30 天） | `docs/product-capability-map.md:211-235` | `token-meter` + OTel；无 usage 表 | S2 | 可选：新 `usage-store`；v1 不做 | WP-14 | M | 低（非核心） |

---

## 3. 多代理

| # | ZCode 能力 | ZCode 证据 | dsh 现状 | 类 | 落点 | WP | 量级 | 风险 |
|---|---|---|---|---|---|---|---|---|
| 30 | 内置 `general-purpose` / `Explore` | `subagent/profile.ts:28-96` | `subagent`/`subagent_fork` + presets | S1 + S2 | 用 preset 复刻两个 agent；`Explore` 用工具限制 | WP-06 | S | 低 |
| 31 | Markdown agent profile | `profile.ts`（`parseAgentProfileFromMarkdown`） | preset 是 `cordis.yml`，无 Markdown | S3 | 新 `agent-profile-md` provider：解析 md → 动态 preset；或 v1 只做静态 preset | WP-06 | L | 中 |
| 32 | 后台子代理 + 输出文件 | `handlers/agent.ts:198-232` | `subagent` continuable；无输出文件 | S2 | 新增 `subagent_output`（读 child session 摘要）；文件可选 | WP-06 | S | 低 |
| 33 | 协调者协议 | `respond-to-coordinator.ts` | `send_message` 到 parent | S1 | 直接用 | WP-06 | XS | 低 |
| 34 | 持久记忆子代理 | `persistent-memory.ts` | 无 | S2 | 用 `ctx.memory` 注入子代理 prompt | WP-05 | S | 低 |
| 35 | fork / rewind | `agent-runtime.ts:777-800` | `subagent_fork`；会话无 rewind | S1 + S3 | fork 直接用；rewind 用 fork-at-turn 替代，不做原地截断 | WP-06 | M | 高（语义） |
| 36 | Agent Teams | 无（ZCode 无对应） | `agent-team`（experimental） | — | 不移植；保留 dsh 能力 | — | — | — |

---

## 4. 工作流 / 自动化

| # | ZCode 能力 | ZCode 证据 | dsh 现状 | 类 | 落点 | WP | 量级 | 风险 |
|---|---|---|---|---|---|---|---|---|
| 37 | TS 脚本 + facade + 类型检查 | `docs/dynamic-workflow/authoring.md:58-80` | `workflow` 是纯 JS，无类型检查 | S3 | durable engine 内做 TS→JS 转译 + `tsc` 诊断；facade 以 `.d.ts` 注入 | WP-07 | L | 高 |
| 38 | skill gate | `authoring.md:36-46` | 无 | S2 | `policy-skill-gate`：检查历史里的 `skill` 调用 | WP-07 | S | 低 |
| 39 | 用户确认窗口 | `launch.md:14-30` | `ask_user_question` 可做确认 | S1 | 工具内调 `ask_user_question`（approve/keep planning） | WP-08 | S | 低 |
| 40 | journal / resume | `launch.md`、`concurrency.md` | 明确无 | S3 | run store + 确定性 replay（`04`） | WP-07 | XL | 高 |
| 41 | 留白 `hole()` / `FillWorkflowHole` | `authoring.md` facade | 无 | S3 | 引擎 hole 状态 + `workflow_answer_hole` | WP-07 | M | 中 |
| 42 | `AmendWorkflow`（含 live retune） | `launch.md:16-20` | 无 | S3 | 引擎 `amend` + 并发热更新 | WP-07 | M | 高 |
| 43 | `SaveWorkflow` / `ListSavedWorkflows` | `handlers/save-workflow.ts` | 无 | S2 | 自有 store（脚本 + meta + 版本） | WP-08 | S | 低 |
| 44 | `EvalWorkflowSnippet` | `handlers/eval-workflow-snippet.ts` | 无 | S2 | 同步只读 sandbox 执行 | WP-08 | S | 中 |
| 45 | 双层并发 + governor | `docs/dynamic-workflow/concurrency.md:8-40` | `maxConcurrentAgents`/`maxTotalAgents` | S1 + S3 | run 级上限复用；provider governor 用 dsh 的 retry/限流，不自建 | WP-07 | M | 中 |
| 46 | run 面板 / 通知 | `docs/dynamic-workflow/presentation.md` | `workflow/*` 事件 | S2 | `client-ui-workflow` + 事件投影 | WP-08 | L | 中 |
| 47 | Cron / OffPeak | 见 #16/#17 | 见 #16/#17 | S1/S2 | 见 #16/#17 | WP-06 | M | 中 |

---

## 5. 扩展 / 技能 / 互操作

| # | ZCode 能力 | ZCode 证据 | dsh 现状 | 类 | 落点 | WP | 量级 | 风险 |
|---|---|---|---|---|---|---|---|---|
| 48 | Plugin（User/Workspace scope） | `docs/plugins/workspace-level-plugin-architecture.md:20-56` | profile/bundle 是 home 级；无 workspace scope | S3 | v1 用 profile/preset 替代；workspace scope 延后 | WP-14 | L | 中 |
| 49 | MCP（dual-era、OAuth、resources） | `docs/mcp-dual-era-version-negotiation.md` | `mcp` + `mcp-resources` | S1 + S2 | 直接用；若 dsh 不支持 legacy SSE/dual-era，补 adapter | WP-02 | M | 中 |
| 50 | MCP Apps / UI Plugin | `UI_PLUGIN.md` | client 可注册 slot/tab；无 MCP Apps 宿主 | S3 | v2 再做；v1 只做 Gen UI | WP-11 | XL | 高 |
| 51 | Hooks 7 事件 | `docs/hooks-runtime-contract.md:7-20` | `hook-protocol` + `hooks-claude-code`/`hooks-codex` | S1 + S2 | 直接用；`PermissionRequest` 映射到 approval 事件 | WP-02 | S | 中 |
| 52 | Skill（User/Workspace、插件贡献） | `docs/skills-product.md:43-56` | `skill` + `skill-filesystem` + 分层 registry | S1 | 直接用；技能内容移植 | WP-14 | S | 低 |
| 53 | Commands | `docs/settings-command-list.md` | `commands` | S1 | 直接用 | WP-02 | XS | 低 |
| 54 | 外部 Agent 资源导入（commands/MCP/plugins/skills） | `docs/external-agent-*-import.md` | `claude-code-mods` 部分覆盖 | S2 | 新 `importer` 插件；v1 只做 skills/MCP | WP-14 | M | 中 |
| 55 | 插件市场 | `docs/plugins/*`、`plugin_store` | `plugin_market` + indexes | S1 + S2 | 直接用；ZCode 式商店 UI 可选 | WP-14 | M | 低 |
| 56 | 运行时自修改 | ZCode 无 | `plugin_manager` + `cordis_inspect` | — | 保留 dsh 能力；产品默认关闭 | WP-14 | XS | 低 |

---

## 6. UI / 产品面

| # | ZCode 能力 | ZCode 证据 | dsh 现状 | 类 | 落点 | WP | 量级 | 风险 |
|---|---|---|---|---|---|---|---|---|
| 57 | Gen UI（`::visualize`） | `packages/ui/src/gen-ui/CONTRACT.md` | client slots/conversation nodes；无 inline 页面宿主 | S2 | `visualize` 工具 + `client-ui-genui`（沙箱 iframe） | WP-11 | L | 中（CSP） |
| 58 | Office 查看器（docx/pdf/pptx/xlsx） | `office-runtime`、各 plugin viewer | **已内置**：`ui-sidebar-documentpreview`（Word/PPT 转 PDF、表格浏览器打开） | S1 + S2 | 复用查看器；新增 `@zcd/tool-documents` 的 5 个模型工具 | WP-13 | M | 中 |
| 59 | Office 生成技能 | 8 个 SKILL.md | `skill-office` 已有 8 个资产 | S1 | 移植/对齐技能文本 | WP-14 | S | 低 |
| 60 | 设置页 IA（Memory→Subagents→Plugins→MCP→Skills→Commands→Hooks） | `docs/settings-*.md` | `ui-settings-*` + `configForms` + `settings.section` | S2 | `client-ui-settings-zcd`：4 个 section；其余复用 dsh | WP-14 | M | 中 |
| 61 | 内置浏览器（用户可见面板） | `browser-use-plugin/docs/*` | `ui-sidebar-browser`（浏览 HTTP 页面） | S2 + S3 | `browser-provider-desktop` + 复用 sidebar-browser 展示受控页面 | WP-09 | L | 高 |
| 62 | 浏览器控制技能 | `control-browser/SKILL.md` | Stagehand/Playwright/CDP providers | S2 | code-act `js` + `browserAutomation` 服务 | WP-09 | L | 高 |
| 63 | CUA 技能 | `computer-use/SKILL.md` | `cua` + `cua-macos` + Cua Driver | S2 | `cua-bridge` + `js` binding；技能近原样 | WP-10 | L | 高（平台） |
| 64 | Android/iOS 模拟器技能 | 两个 plugin | 无 | S4 | 通过 MCP 桥接；本版本不做 | — | XL | 高 |
| 65 | 会话分享 | `docs/conversation-share-v1.md` | 无 | S4 | 不做 | — | XL | — |
| 66 | Bots（飞书/Telegram/微信） | `docs/bots.md` | 无 | S4 | 不做 | — | XXL | — |
| 67 | 手机远控 | `packages/android`、`web-remote` | 无 | S4 | 不做 | — | XXL | — |
| 68 | 计费/套餐/用量 | `docs/product-capability-map.md:211-235` | 无 | S4 | 不做 | — | XL | — |
| 69 | 图片搜索 | `image-search-plugin` | 无 | S2 | 接 MCP server；低优先级 | WP-14 | S | 低 |
| 70 | ZCode Sites 发布 | `zcode-site-plugin` | 无 | S4 | 不做 | — | — | — |
| 71 | 旧会话恢复 | `restore-legacy-sessions-plugin` | 无 | S4 | 不做 | — | — | — |

---

## 7. 工程 / 其他

| # | ZCode 能力 | ZCode 证据 | dsh 现状 | 类 | 落点 | WP | 量级 |
|---|---|---|---|---|---|---|---|
| 72 | i18n 中英 | `packages/i18n` | locale-owned copy | S1 | 直接用 dsh locale | WP-01 | XS |
| 73 | 遥测（OTel/ARMS/usage） | `packages/telemetry` | `otel` + `session-telemetry-otel` | S1 | 直接用 OTel；ARMS 不做 | WP-01 | XS |
| 74 | 形式化验证 | `formal-proof`（状态枚举器） | 无 | — | 不移植；用快照回放替代 | WP-01 | — |
| 75 | 架构门禁 | `architecture-policy.yaml` | `verify-*` + doc-sync | S1 | 用 dsh 门禁 + 自有 lint | WP-01 | XS |
| 76 | 技能创作/插件创作 | 两个 plugin | `skill` 格式不同 | S2 | 重写技能文本；插件创作改为 Cordis 指南 | WP-14 | M |

---

## 8. 统计与结论

### 8.1 分类计数（按能力行）

| 类 | 数量 | 说明 |
|---|---:|---|
| S1 | 34 | 直接配置/映射，主要是工具与基础设施（含 Office 查看器） |
| S2 | 34 | 写插件，主战场 |
| S3 | 11 | 需要新 seam 或新宿主：durable workflow、Markdown profile、MCP Apps、workspace plugin scope、rewind、浏览器面板、CUA 宿主 |
| S4 | 7 | 产品面：bots/share/mobile/billing/site/restore/emulators |
| 保留 dsh | 3 | Agent Teams、运行时自修改、LSP 等（表中记为 `—`） |

> 计数按单元格里出现的类；跨类行（如 #16 为 `S1 + S2`）会计入两个类，因此合计大于 76 行。

### 8.2 三个真正的硬骨头

1. **durable workflow（#21/#37–46）**：唯一新增 seam，XL。存储、确定性 replay、并发、UI 四件事必须一起设计。
2. **code-act（#14/#62/#63）**：`js` + browser + CUA 的绑定层；安全边界与 dsh 的 guard/approval 必须对齐。
3. **MCP Apps（#50）**：ZCode 的 UI Plugin 契约；v2 再做，v1 用 Gen UI 覆盖 80% 场景。

### 8.3 dsh 需要补的小洞（不构成新 seam）

| 洞 | 补法 | 优先级 |
|---|---|---|
| `schedule_delete` / `schedule_pause` | 在 `@zcd/tool-cron` 里包一层 `ctx.schedule` | P1 |
| `todo_read` | 读 `todo/write` 投影 | P1 |
| `enter_plan_mode` | 程序化执行 `/plan`；若 commands 不支持，需上游加 `enter()`（S3） | P1 |
| `subagent_output` / `subagent_stop` | 包 `ctx.subagents` 的 child session 摘要 | P2 |
| `list_models`（模型目录） | 映射到 `list_subagent_models`；不新增 | P1 |
| `session_handoff` | 包 `ctx.sessionQuery` | P2 |
| 只读 Bash 自动放行 | `tools/pre-execute` 意见 + 规则表 | P1 |

### 8.4 明确不移植

- `GoalRead`（未注册）、`ReplyToChannel`（注释）、legacy `Workflow`（`/expert`）。
- 原地 rewind（用 fork 替代）。
- ZCode 的 Workspace 插件 scope（用 profile/preset 替代）。
- ZCode 的 Electron BrowserView/WebContentsView 实现（用 dsh 的 provider + 面板重写）。
