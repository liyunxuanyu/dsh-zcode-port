# 08 · 技能迁移目录

> **进度（2026-11-03）**：`skills/superpowers/` 14 个 + `skills/dsh-guide/` 6 个已移植（共 20/39），通过命名门禁；安装脚本 `scripts/install-skills.mjs`。其余按下方分类推进。

> ZCode 共 **39 个 SKILL.md**（38 个产品技能 + `dynamic-workflows`）。本文逐条给出：用途、依赖工具、dsh 对应能力、处理方式、改动点、优先级。
>
> 处理方式：
> - **原样**：语义与工具名都对得上，只改少量词
> - **改名**：工具名映射（PascalCase → snake_case / 换成 dsh 工具）
> - **重写**：依赖的工具或工作流在 dsh 不存在，需要重写正文
> - **丢弃**：产品面不做或无对应
>
> 格式：dsh 的 `SKILL.md` 用 frontmatter `name` + `description`（`packages/skill/skill-office/assets/office/SKILL.md:1-3`），ZCode 同格式，可直接沿用以外的正文需改写。

---

## 0. 工具名映射表（全局）

| ZCode | dsh | 备注 |
|---|---|---|
| `Read` | `read` / `read_image` | 图片用 `read_image` |
| `Write` | `write` | — |
| `Edit` | `edit` | 或 `apply_patch`（需在 bundle 打开） |
| `Bash` | `bash` | — |
| `Glob` / `Grep` | `glob` / `grep` | — |
| `WebFetch` / `WebSearch` | `web_fetch` / `web_search` | — |
| `TodoRead` / `TodoWrite` | `todo_read`（新）/ `todo_write` | — |
| `Agent` / `Task` | `subagent` / `subagent_fork` | `Task` = 兼容别名 |
| `SendMessage` | `send_message` | — |
| `RespondToCoordinator` | `send_message`（to parent） | 语义等价 |
| `TaskOutput` / `TaskStop` | `subagent_output`（新）/ `subagent_stop`（新） | — |
| `Skill` | `skill` | — |
| `AskUserQuestion` | `ask_user_question` | — |
| `EnterPlanMode` | `enter_plan_mode`（新） | — |
| `ExitPlanMode` | `exit_plan_mode` | — |
| `CreateWorkflow` | `workflow_run` | — |
| `AmendWorkflow` | `workflow_amend` | — |
| `SaveWorkflow` | `workflow_save` | — |
| `EvalWorkflowSnippet` | `workflow_eval` | — |
| `ListWorkflowRuns` | `workflow_list_runs` | — |
| `GetWorkflowRun` | `workflow_get_run` | — |
| `ResumeWorkflowRun` | `workflow_resume` | — |
| `FillWorkflowHole` | `workflow_answer_hole` | — |
| `ResolveWorkflowQuestion` | `workflow_resolve_question` | — |
| `ListSavedWorkflows` | `workflow_list_saved` | — |
| `submit_result` | `workflow_submit_result` | — |
| `escalate` | `workflow_escalate` | — |
| `ReadSessionContext` | `session_handoff`（新） | — |
| `ListModels` | `list_models`（新，映射 `list_subagent_models`） | — |
| `js` / `nodeRepl` | `js`（新）/ `nodeRepl` 兼容 | 见 WP-10 |
| `open_document` / `show_in_viewer` / `read_document` / `search_document` / `get_view` | 同名（新 `@zcd/tool-documents`） | 见 WP-13 |
| `present` | `present` | dsh 已有 |
| `Cron*` / `OffPeak*` | `cron_*` / `offpeak_*` | — |

---

## 1. 工作流（1）

| 技能 | 用途 | 依赖 | 处理 | 改动 | 优先级 |
|---|---|---|---|---|---|
| `dynamic-workflows` | 动态工作流作者指南：拓扑选择、facade、质量、交付、提交后 | `CreateWorkflow` 等 11 个 | **重写** | 全部工具名映射；facade 按 `04-durable-workflow.md` §6 改写（TS + `clock/random`）；删除 `report/artifact/world` 中 dsh 不支持的部分 | P2（随 WP-08/09） |

体量：ZCode 原文约 1,600 行（§16 facade 占大头）。建议拆成 2 个技能：`dynamic-workflows`（判断层）+ `workflow-facade`（API 参考），按需加载。

---

## 2. 浏览器（2）

| 技能 | 用途 | 依赖 | 处理 | 改动 | 优先级 |
|---|---|---|---|---|---|
| `control-browser` | 浏览器自动化：打开、点击、填表、快照、多 tab | `js`（12 次）、`nodeRepl`（8 次） | **改名 + 轻改** | `Read`→`read`；"fresh kernel"说明保留；`agent.browsers` API 按 `06-browser-cua.md` §4 实现 | P3（WP-10） |
| `web-gui-tester` | 黑盒 GUI 测试：点击、输入、截图验证 | `Read` | **改名** | 小改 | P3 |

---

## 3. CUA（1）

| 技能 | 用途 | 依赖 | 处理 | 改动 | 优先级 |
|---|---|---|---|---|---|
| `computer-use` | 桌面操作：窗口、点击、输入、截图 | `nodeRepl`（3）、`js`（2） | **改名 + 平台说明** | 平台能力按 dsh provider 写；Windows 标注实验 | P3（WP-11） |

---

## 4. Office（8）

| 技能 | 用途 | 依赖 | 处理 | 改动 | 优先级 |
|---|---|---|---|---|---|
| `docx` | 创建/编辑 Word | `js`（5）、`Read`、`present`、`Edit` | **改名** | 生成库调用不变（`js` 里跑）；`present` 保留 | P4（WP-13） |
| `docx-viewer` | 在面板查看/定位 Word | `open_document` 等 5 | **改名** | 工具由 `@zcd/tool-documents` 提供 | P4 |
| `pdf` | PDF 生成/编辑 | `js`（28） | **改名** | `js` 依赖强；确认 dsh `js` 的库可用性 | P4 |
| `pdf-viewer` | PDF 查看/定位 | 5 个 viewer 工具 | **改名** | — | P4 |
| `pptx` | 创建/编辑 PPT | `js`、`present`、`Write` | **改名** | — | P4 |
| `pptx-viewer` | PPT 查看 | 5 个 viewer 工具 | **改名** | — | P4 |
| `xlsx` | 创建/编辑 Excel | `Edit`、`present` | **改名** | — | P4 |
| `xlsx-viewer` | Excel 查看 | 5 个 viewer 工具 | **改名** | — | P4 |

> dsh 已有 `skill-office` 的 8 个资产（`office`/`office-docx`/`office-pptx`/`office-xlsx`/`office-render`/`office-recalculate`/`office-export-pdf` + `office` 路由）。**先评估能否直接用 dsh 的 office 技能，再决定是否移植 ZCode 版本**——两者功能重叠度高。建议：保留 dsh 的 `office-*` 作为底层，ZCode 的 `docx/pdf/pptx/xlsx` 只作为"用户视角的任务路由"，避免重复。

---

## 5. Gen UI（1）

| 技能 | 用途 | 依赖 | 处理 | 改动 | 优先级 |
|---|---|---|---|---|---|
| `visualize` | 生成 inline 可交互 HTML（图表、模拟、表单） | `Read`、`Write`、`present`、`js`、`Agent` | **重写** | ZCode 是 `::visualize{path}` 引用协议；dsh 是 `visualize` 工具 + 卡片。正文改为"调 `visualize` 工具"；`window.zcode.*` API 改为 `postMessage` 协议 | P4（WP-12） |

---

## 6. 工程方法（14，superpowers）

| 技能 | 依赖 | 处理 | 改动 | 优先级 |
|---|---|---|---|---|
| `using-superpowers` | `Skill`、`TodoWrite`、`Read`、`EnterPlanMode` | **改名** | 工具名映射 | P5 |
| `brainstorming` | `Write`、`present` | **改名** | — | P5 |
| `writing-plans` | `Task`、`Write` | **改名** | `Task`→`subagent` | P5 |
| `executing-plans` | `TodoWrite`、`Read`、`present` | **改名** | — | P5 |
| `test-driven-development` | `Write` | **原样** | — | P5 |
| `systematic-debugging` | `Read`、`Write` | **原样** | — | P5 |
| `requesting-code-review` | `Task` | **改名** | — | P5 |
| `receiving-code-review` | 无 | **原样** | — | P5 |
| `dispatching-parallel-agents` | `Agent`、`Task` | **改名** | — | P5 |
| `subagent-driven-development` | `Task`、`TodoWrite`、`Read` | **改名** | — | P5 |
| `verification-before-completion` | `Agent`、`Write` | **改名** | — | P5 |
| `finishing-a-development-branch` | `present` | **原样** | — | P5 |
| `using-git-worktrees` | `js` | **重写** | dsh 有 `create_worktree` 工具，改为用它 | P5 |
| `writing-skills` | `Skill`、`Write`、`Agent`、`js` | **重写** | dsh 技能格式/门禁不同 | P5 |

> 这 14 个是"方法论"技能，与产品耦合低，迁移成本最低、收益稳定。建议作为 P5 的第一批。

---

## 7. 自诊断（6，zcode-guide）

| 技能 | 用途 | 处理 | 改动 | 优先级 |
|---|---|---|---|---|
| `diagnosing-commands` | 斜杠命令不生效 | **重写** | dsh 的 commands 机制不同（Cordis 命令注册） | P5 |
| `diagnosing-hooks` | Hook 不触发 | **重写** | dsh 用 `hook-protocol` + `hooks-claude-code`；诊断路径不同 | P5 |
| `diagnosing-mcp` | MCP 连不上 | **改名** | dsh 的 MCP 诊断已有（`mcp-stdio-failure-stderr-diagnostics`） | P5 |
| `diagnosing-plugins` | 插件未加载 | **重写** | dsh 用 profile/bundle/patch；诊断改为 Cordis fiber 状态 | P5 |
| `diagnosing-skills` | 技能不触发 | **改名** | dsh skill registry 分层 | P5 |
| `zcode-configuration-guide` | 配置位置与优先级 | **重写** | 改为 dsh 的 profile/bundle/patch 语义 | P5 |

> 这组技能是"给用户排障"的，价值高但必须按 dsh 的实际机制重写，不能照抄。

---

## 8. 创作类（3）

| 技能 | 用途 | 处理 | 改动 | 优先级 |
|---|---|---|---|---|
| `skill-creator` | 创建/改进技能 | **改名** | dsh 技能格式（frontmatter）+ `skill` 工具 | P5 |
| `plugin-creator` | 创建 ZCode 插件 | **重写** | 改为"创建 Cordis 插件/bundle"（`docs/cookbook/adding-a-package.md`） | P5 |
| `site-deploy` | 发布静态站点 | **丢弃** | 依赖 ZCode Sites 服务 | — |

---

## 9. 设备与恢复（3）

| 技能 | 用途 | 处理 | 优先级 |
|---|---|---|---|
| `android-dev` | Android 模拟器 | **丢弃**（S4，需 Android bridge） | — |
| `ios-dev` | iOS 模拟器 | **丢弃**（S4，需 macOS bridge） | — |
| `restore-legacy-sessions` | 恢复旧 ZCode 会话 | **丢弃**（无旧会话） | — |

---

## 10. 汇总

| 处理 | 数量 | 技能 |
|---|---:|---|
| 原样 | 4 | `test-driven-development`、`systematic-debugging`、`receiving-code-review`、`finishing-a-development-branch` |
| 改名 | 22 | 浏览器 2、CUA 1、Office 8、superpowers 8、guide 2、`skill-creator` 1 |
| 重写 | 9 | `dynamic-workflows`、`visualize`、`plugin-creator`、`using-git-worktrees`、`writing-skills`、guide 4 |
| 丢弃 | 4 | `site-deploy`、`android-dev`、`ios-dev`、`restore-legacy-sessions` |
| **合计** | **39** | 38 个产品技能 + `dynamic-workflows` |

> Office 8 个技能在表中记为"改名"，但**是否复用 dsh 的 `skill-office` 资产**需要先评估（见 §4 注释）；这不改变计数。

### 10.1 实施顺序

1. **P5-a**：14 个 superpowers（改名为主，1 周）
2. **P5-b**：6 个 guide（重写，1.5 周）
3. **P5-c**：创作类 + 浏览器/CUA（随对应 WP）
4. **P5-d**：Office（先评估复用 dsh `skill-office`）

### 10.2 质量门

- `scripts/verify-naming.mjs`：扫描所有 `SKILL.md`，出现未注册工具名 → CI 失败。
- 每个技能一条 smoke：给定 trigger prompt，断言 `skill` 被调用且名称正确。
- 技能列表去重：`name` 唯一、`description` ≤ 200 字、不含内部路径。
- 许可：每个文件头加 `<!-- Ported from ZCode (Apache-2.0): <path> -->`。

### 10.3 不建议移植的技能（说明）

- `android-dev` / `ios-dev`：需要设备桥（ZCode 有 Android/iOS 模拟器插件与 2.3k/1.3k 行代码），本版本不做。
- `restore-legacy-sessions`：dsh 没有 ZCode 的旧会话格式。
- `site-deploy`：依赖 ZCode Sites 的后端服务。
- `plugin-creator` 中的"ZCode 插件 manifest"部分：改为 Cordis 包/bundle 指南。
