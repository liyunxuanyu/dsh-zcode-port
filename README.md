# ZCD · ZCode-on-dsh 二开项目

> 目标：在 **DeepSeek Harness（dsh）** 之上，用 **overlay 插件** 的方式，复刻 ZCode 最好用的产品能力与技能，同时保留 dsh 的插件化内核。
>
> 状态：**P0 已验收，P1/P2 核心能力与 P4 部分 UI 已落地**（42 个工具、33 个技能、108 个单测；product profile 可启动，设置页用户记忆增删与 workflow 面板已通过真实浏览器视觉验收）。进度见 [`docs/13-implementation-status.md`](docs/13-implementation-status.md)，阶段汇总见 [`docs/14-status-report.md`](docs/14-status-report.md)。日期：2026-11-03。
> 参考基线：`archive/`（ZCode 60 个文件 + dsh 38 个文件）。

---

## 1. 一句话结论

**dsh 做地基，ZCode 做需求规格；overlay 二开，seam-first 移植；只新增一个 seam（durable workflow），其余全部是插件。**

不 fork 任何一边：

- 不 fork dsh：上游是 pre-stable，fork 后每次同步都是手工合并；overlay 能用 patch 表达产品差异，升级只改 bundle。
- 不 fork ZCode：它的内核不可换（`ToolRegistryImpl` 单例、`AgentRuntime` 单体），把它插件化等于重写。

---

## 2. 已确认的产品决策

| 决策 | 选择 | 影响 |
|---|---|---|
| 二开形态 | **Overlay**（dsh 只读 + 自有 bundle/插件） | 仓库结构、CI、发布方式 |
| 第一版范围 | **Agent 能力 + ZCode 式 UI**（不做 bots/分享/手机/计费） | 工作量集中在工具、工作流、UI |
| 首批能力 | 动态工作流（可恢复）、工具搜索/延迟加载、闲时任务/Cron、Gen UI、Office 文档工具、设置页、浏览器/CUA 技能全集 | 见 `docs/02-migration-matrix.md`（76 行能力矩阵） |
| 技能策略 | **全部 ZCode 技能逐条评估**：原样 / 改工具名 / 重写 / 丢弃 | 见 `docs/08-skills-catalog.md` |

---

## 3. 架构总览（先看这张图）

```
┌─ L3 产品组合层（zcd-product）──────────────────────────────────────┐
│ profiles/product/  ·  bundles/zcd-base  ·  bundles/zcd-web-app      │
│ presets/*.yml      ·  skills/*          ·  locale/*                 │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ patch rows（数据，不改上游代码）
┌─ L2 能力插件层（@zcd/*）───────────────────────────────────────────┐
│ tools: workflow_* · tool_search · offpeak_* · memory_* · cron_*     │
│        js(code-act) · visualize · todo_read · enter_plan_mode       │
│ svc:   durableWorkflow · offpeak · memory · browserAutomation       │
│ policy:bash-readonly · skill-gate · deferred-tools                  │
│ ui:    genui · workflow-pane · office-viewer · settings-zcd         │
│ data:  workflow-store（SQLite）· memory-store（files）              │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ ctx.effect / ctx.tools.register / ctx.on
┌─ L1 dsh 内核（pin 版本，只读）─────────────────────────────────────┐
│ core/{session,tools,agent,agent-loop,system-prompt} · llm · shell   │
│ terminal · sandbox · fs · subagent · workflow · skill · client      │
└─────────────────────────────────────────────────────────────────────┘
```

**唯一新增 seam**：`durableWorkflow`（见 `docs/04-durable-workflow.md`）。dsh 的 `workflow` 保持不动，两个引擎并存，模型按工具名选择。

---

## 4. 文档地图

| 文档 | 内容 | 读者 |
|---|---|---|
| [`docs/00-decisions.md`](docs/00-decisions.md) | 10 条 ADR：形态、命名、事件、安全、许可 | 所有人 |
| [`docs/01-target-architecture.md`](docs/01-target-architecture.md) | 分层、仓库布局、运行时序、包清单 | 架构/开发 |
| [`docs/02-migration-matrix.md`](docs/02-migration-matrix.md) | **主清单**：ZCode 能力 → dsh seam → S1–S4 → 工作包 | 产品/架构 |
| [`docs/03-work-packages.md`](docs/03-work-packages.md) | WP-01…WP-15：范围、依赖、验收、风险 | 项目管理 |
| [`docs/04-durable-workflow.md`](docs/04-durable-workflow.md) | 新 seam 完整规格：存储、引擎、工具、UI | 后端 |
| [`docs/05-tool-search-offpeak-memory.md`](docs/05-tool-search-offpeak-memory.md) | 三个高优插件的契约 | 后端 |
| [`docs/06-browser-cua.md`](docs/06-browser-cua.md) | 浏览器/CUA 的移植路线与代码执行面 | 后端/客户端 |
| [`docs/07-ui-genui-office-settings.md`](docs/07-ui-genui-office-settings.md) | Gen UI、Office 文档工具（查看器已内置）、设置页 IA | 前端 |
| [`docs/08-skills-catalog.md`](docs/08-skills-catalog.md) | 39 个产品技能逐条分类 | 内容/开发 |
| [`docs/09-compat-security-release.md`](docs/09-compat-security-release.md) | 上游同步、事件/工具命名、安全不变量、许可 | 架构/安全 |
| [`docs/10-roadmap.md`](docs/10-roadmap.md) | P0–P6 里程碑与人力估算 | 所有人 |
| [`docs/11-alternatives.md`](docs/11-alternatives.md) | 四个方案的首次/长期成本对比，何时改选 | 决策者 |
| [`docs/12-runtime-and-packaging.md`](docs/12-runtime-and-packaging.md) | 运行时清单、一键安装、打包、接入外部插件 | 开发/运维 |
| [`docs/13-implementation-status.md`](docs/13-implementation-status.md) | **实现状态**：已完成/进行中/缺口/设计修正 | 所有人 |
| [`docs/14-status-report.md`](docs/14-status-report.md) | **阶段报告**：当前阶段、交付清单、验证证据、缺口与下一步 | 所有人 |
| [`archive/INDEX.md`](archive/INDEX.md) | 参考文档归档与用途 | 所有人 |
| [`architecture.html`](architecture.html) | 一页可视化总览（分层、数字、路线图） | 所有人 |

---

## 5. 关键事实（为什么这样设计）

| 事实 | 证据 | 设计含义 |
|---|---|---|
| dsh 的 profile/bundle/patch 是数据层 | `packages/boot/app-boot/src/profile.ts:1-25` | 产品差异可以用 patch 表达，不必改上游 |
| dsh 工具注册支持 `when` 条件 | `packages/core/tools/src/index.ts:128-151`、`resolve()` `:264-300` | **ToolSearch 不需要新 seam**：延迟工具用 `when` 控制可见性 |
| dsh workflow 是 holder-owned、无 journal | `packages/workflow/workflow/README.md:126-130` | 可恢复工作流必须新建 seam，不能改原引擎 |
| dsh session 事件可扩展但日志不可变 | `packages/core/session/src/types.ts:281-287`、`docs/architecture.md:126` | 新事件一次设计好；内部 journal 放独立 store |
| dsh 审批 fail-closed | `docs/subsystems/approval.md:20-40` | 只读免打扰只能"自动允许只读"，不能放宽写 |
| dsh 浏览器 provider 只注册名字 | `docs/subsystems/browser-use.md:6-26` | 浏览器能力由 provider 自带工具/服务；我们可自带 code-act |
| dsh client 插件可注册 slot/tab | `packages/client/ui-slots/README.md`、`ui-sidebar-right/README.md` | Gen UI/Office/设置页都走 client 插件 |
| ZCode 内核不可替换 | `tool/registry.ts`、`core/src/runtime/agent-runtime.ts` | 不做"ZCode 插件化"的重写 |

---

## 6. 非目标（本版本明确不做）

- bots（飞书/Telegram/微信）、会话分享、手机远控、计费/套餐/用量——S4，单独立项。
- ZCode 的 Workspace 级插件 scope（dsh profile 是 home 级）——用 preset/profile 替代，不实现。
- ZCode 的 rewind（原地截断会话）——用 dsh 的 fork-at-turn 替代。
- ZCode 的 `GoalRead`、`ReplyToChannel`、legacy `Workflow`（`/expert`）——未挂载/已弃用，不移植。
- 复制 ZCode 源码——只重实现语义；技能文本按 Apache-2.0 带许可头移植。

---

## 7. 当前进度（2026-11-03）

| 能力 | 状态 | 证据 |
|---|---|---|
| overlay 骨架 + product profile | ✅ | `dsh --profile product --dump-config` 1243 行；smoke 启动 Web |
| 工具面 | ✅ 34 个 | `tool_search`、`todo_read`、`enter_plan_mode`、OffPeak 3、Memory 5、`list_models`、`session_handoff`、workflow 7、`visualize`、文档 5、浏览器 11 |
| deferred 工具加载 | ✅ | `@zcd/deferred-tools` + 服务级 admission 测试 |
| 提醒暂停 | ✅ | `@zcd/schedule-pause`：快照后删除、`schedule_resume` 按原规则重建（dsh 无 active 开关） |
| Workflow 技能门禁 | ✅ | `@zcd/policy-skill-gate`：未加载 `dynamic-workflows` 时 deny `workflow_run`/改脚本的 amend；compaction 后重新关闭 |
| OffPeak | ✅ | `tasks.json` 持久化、pending 恢复、running→interrupted |
| Memory | ✅ | 条目/索引/dream/路径约束/secret 拒绝；per-agent prompt section |
| Durable Workflow MVP | ✅ | 文件 store、`agent()`/`parallel()`/`pipeline()`/`hole()`、resume 重放、amend、通知 |
| 文档 | ✅ 5/5 + 生成 | read/search/open/show/get_view；docx/xlsx/pdf/text 锚点；create_document 基础生成 |
| Gen UI | ✅ 工具 + 路由 + 卡片 | `visualize` + `/zcd/genui` CSP 沙箱 + lazy-CJS iframe 卡片；路由渲染[截图](docs/assets/zcd-genui-render.png)，会话内卡片待模型会话验收 |
| Workflow 面板 | ✅ 视觉验收 | 右侧栏 run 列表 + 节点展开 + journal 事件 + 取消/恢复/改脚本（[截图](docs/assets/workflow-panel-amend.png)） |
| ZCD 设置页 | ✅ 视觉验收 | 运行环境 + 最近 runs + 用户记忆增删/整理（`/zcd/memory`，[截图](docs/assets/zcd-settings-memory.png)） |
| 技能 | ✅ 33 个（覆盖 34/39） | superpowers 14 + dsh-guide 6 + zcd 6（office-viewer/browser-use/visualize/dynamic-workflows/skill-creator/plugin-creator）+ dsh 原生 Office 7 |
| 浏览器 v2 | ✅ | `@zcd/browser` + 12 个 deferred 工具；headless 或经 CDP 接管你的 Chrome；`browser_act` 在 vm 沙箱跑 Node 级脚本；右侧栏实时可视面板 |
| 外部插件接入 | ✅ doctor + e2e | `pnpm doctor` 静态预检；`pnpm e2e:plugin` 用临时 profile 真装第三方插件并验证其路由 |
| MCP 运行时 | ✅ pinned + smoke | `runtime/mcp` + `pnpm mcp:install` + `pnpm mcp:check`（stdio initialize/tools/list） |

**下一步**（详见 `docs/13-implementation-status.md` §2）：

1. Gen UI 会话内卡片验收（需要一次 `visualize` 结果会话；路由渲染已验收）。
2. CUA：dsh 原生 provider 仅支持 macOS；Windows 需另找驱动。
3. 浏览器 v2：Node 级 `js` code-act、用户浏览器、可视面板；页面级 `browser_evaluate` 与多 tab 已落地。
4. 设置页其余写入（workflow 配置、只读策略开关）。
5. Workflow run 详情补耗时/模型列与失败重试；cancel/resume/amend 已完成。
6. 剩余 5 项（CUA 1 + 主动丢弃的站点/移动端/旧会话恢复 4）。

**接入外部 dsh 插件**：`pnpm doctor` → `dsh plugin --profile product add <pkg>`，见 `docs/12-runtime-and-packaging.md` §5。
