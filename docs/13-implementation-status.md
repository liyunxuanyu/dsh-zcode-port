# 13 · 实现状态

> 最后更新：2026-11-03。
> 本文是**唯一**的实现进度入口；`docs/10-roadmap.md` 只描述计划，状态以此为准。阶段性汇总见 [`docs/14-status-report.md`](14-status-report.md)。

---

## 0. 一句话

**P0 已通过，P1/P2/P4 部分落地**：product profile 在 dsh 0.2.2-alpha.2 上启动 Web，四个 bundle 正确组合，**39 个** ZCD 工具激活，**33 个技能**可用（26 个文件技能 + 7 个 dsh 原生 Office；覆盖 34/39 项 ZCode 技能），**99 个单测（18 个文件）**、命名门禁、docs 链接、运行时 doctor 与启动 smoke 全部通过。设置页已能在真实浏览器里列出、添加、删除**用户记忆**；workflow run 面板与文档卡已可用。

---

## 1. 已完成

### 1.1 工程骨架（WP-01）

| 项 | 证据 |
|---|---|
| pnpm workspace + `tsconfig.base.json` + vitest | 根 `package.json`、`pnpm-workspace.yaml`、`vitest.config.ts` |
| dsh 依赖 pin 到 `0.2.2-alpha.2`，Cordis `4.0.6-alpha.1` | `packages/*/package.json`、`pnpm-lock.yaml` |
| `node-linker=hoisted` 保证 dsh 类型只有一份物理副本 | `.npmrc`；否则模块增强会落到不同副本 |
| 运行时清单 + 一键安装 | `runtime/manifest.json`、`scripts/ensure-runtime.mjs` |
| profile 物化（`$DSH_HOME/profiles/product`） | `scripts/link-profile.mjs` |
| 产品打包（可含 `node_modules`） | `scripts/pack-product.mjs` |
| 命名门禁 / 文档门禁 / 插件 doctor | `scripts/verify-naming.mjs`、`check-docs.cjs`、`doctor-plugins.mjs` |
| CI | `.github/workflows/ci.yml`（typecheck/test/verify/build/pack/doctor/MCP check/smoke） |
| MCP 运行时 | `runtime/mcp` pin `server-everything@2.1.0`；`pnpm mcp:check` 完成 initialize + tools/list（16 tools） |

当前 workspace 共 **33 个包**：2 个 bundle、4 个 client bundle、5 个 Web host、其余为服务与工具包。

### 1.2 插件与工具

| 包 | 工具/能力 | 状态 | 测试 |
|---|---|---|---|
| `@zcd/shared` | 事件声明合并（`deferred-tool/loaded`、`offpeak/*`、`memory/*`、`workflow/*`）、branded id | 已编译 | — |
| `@zcd/deferred-tools` | `ctx.deferredTools`：工具注册带 `when`，按会话投影决定是否进入 step | 激活成功 | 3 个 admission 单测 |
| `@zcd/tool-search` | `tool_search`：搜未加载的 deferred 目录，命中后写 `deferred-tool/loaded` | 激活成功 | 5 个单测（排序/分词/限额） |
| `@zcd/tool-todo-read` | `todo_read`：deferred，读 `todos` 投影 | 激活成功 | — |
| `@zcd/tool-plan-mode` | `enter_plan_mode`：程序化执行 `/plan`，不拥有 plan 状态 | 激活成功 | — |
| `@zcd/policy-plan-readonly` | plan mode 严格只读：deny 写工具与非只读 bash | 编译通过；bundle 中默认 `disabled: true` | 35 + 4 单测 + 4 集成测试 |
| `@zcd/policy-skill-gate` | 工作流作者门禁：未加载 `dynamic-workflows` 时 deny `workflow_run`/改脚本 amend；compaction 后失效 | 激活成功 | 4 单测 + 2 集成测试 |
| `@zcd/offpeak` | `ctx.offpeak`：空闲判定、新会话执行、用户输入即让路、`tasks.json` 恢复 | 激活成功 | 3 个单测 |
| `@zcd/tool-offpeak` | `offpeak_create/list/cancel`（deferred） | 激活成功 | — |
| `@zcd/tool-models` | `list_models`：按 provider 列出可路由模型（deferred） | 激活成功 | — |
| `@zcd/tool-session` | `session_handoff`：同 cwd 会话的 bounded handoff（deferred） | 激活成功 | — |
| `@zcd/memory` | `ctx.memory`：项目/用户 Markdown 条目、索引重建、路径约束、secret 拒绝 | 激活成功 | 6 个单测（slug/parse/root/secret） |
| `@zcd/tool-memory` | `memory_search/read/write/remove/dream`（deferred） | 激活成功 | — |
| `@zcd/workflow-store` | 文件型 run 存储：`run.json` + nodes + `events.jsonl`，原子写 | 已编译 | 3 个单测 |
| `@zcd/durable-workflow` | `ctx.durableWorkflow`：脚本执行、`agent()`/`parallel()`/`pipeline()`、`hole()`、节点缓存、resume、cancel、amend、完成/留白通知 | 激活成功 | 8 个单测 |
| `@zcd/tool-workflow` | `workflow_run/get_run/list_runs/resume/cancel/amend/answer_hole` | 激活成功 | — |
| `@zcd/tool-documents` | `read_document/search_document/open_document/show_in_viewer/get_view`：text/docx/xlsx/pdf，带锚点 | 激活成功 | 2 个单测 |
| `@zcd/tool-office` | `create_document`：docx/xlsx/pdf，heading/paragraph/bullet/table | 激活成功 | 3 个单测 |
| `@zcd/document-view` | `ctx.documentView`：每会话最近打开文档与锚点 | 激活成功 | smoke 往返 |
| `@zcd/documents-ui-host` | `POST/GET /zcd/documents/view` | 激活成功 | smoke 往返 |
| `@zcd/genui-host` | `/zcd/genui/...` 沙箱路由：严格 CSP + sandbox + no-store | 激活成功 | smoke 200 + CSP；[路由渲染截图](assets/zcd-genui-render.png) |
| `@zcd/client-ui-genui` | lazy-CJS：`visualize` 结果渲染为沙箱 iframe | 进入 boot graph | smoke 检查；会话内卡片待模型会话验收 |
| `@zcd/status-host` | `/zcd/status`：Node/dsh/uptime/最近 runs | 激活成功 | smoke 200 |
| `@zcd/workflow-ui-host` | 列表、`/<id>`（含 script）、nodes、events、`POST cancel/resume/amend` | 激活成功 | smoke：fixture 列表/节点/事件/cancel + resume/amend 409 契约 |
| `@zcd/memory-ui-host` | `GET/POST /zcd/memory`、`DELETE /zcd/memory/<id>`、`POST /zcd/memory/dream`（仅 user scope） | 激活成功 | smoke 增删查 + dream 往返 |
| `@zcd/client-ui-settings-zcd` | `settings.section` 的 ZCD 页：运行环境、最近 runs、**用户记忆增删/整理** | **视觉验收通过** | [截图](assets/zcd-settings-memory.png) + smoke |
| `@zcd/client-ui-workflow` | 右侧栏 workflow tab：3s 轮询 + 节点展开 + journal 事件 + 取消/恢复/改脚本 | **视觉验收通过** | [截图](assets/workflow-panel-amend.png) + smoke |
| `@zcd/client-ui-zcd` | 文档卡 Open/自动打开、workflow 卡片轮询 + 取消 | 进入 boot graph | smoke 检查 |
| `@zcd/tool-visualize` | `visualize`：写自包含 HTML，返回沙箱 URL（deferred） | 激活成功 | 2 个单测（落盘/URL、限额/高度） |
| `@zcd/browser` | `ctx.browser`：headless Chrome、每会话隔离 context + 多 tab、截图落盘、URL 白名单；`act()` 跑 Node 级 code-act（vm 沙箱、REPL 语义、`state`/`globalThis` 跨调用、输出预算） | 激活成功 | 3 个单测 + 10 个 code-act 单测 |
| `@zcd/tool-browser` | `browser_open/snapshot/evaluate/click/type/screenshot` + tab 4 工具 + `browser_act`（Node 级 code-act）+ `browser_close`（deferred） | 激活成功 | 1 个真实 Chrome 工具链测试 |
| `skills/superpowers`（14） | ZCode 工程方法技能，工具名已映射为 dsh | 已安装 | `install-skills.mjs` |
| `skills/dsh-guide`（6） | dsh 自诊断：profile/bundle/patch、插件、MCP、skills | 已安装 | `install-skills.mjs` |
| `skills/zcd/office-viewer`（1） | Word/Excel/PDF/文本的 read/search/open/show/get_view 与锚点语义 | 已安装 | `install-skills.mjs` + verify-naming |
| `skills/zcd/browser-use`（1） | browser_* 工具的工作流、selector 纪律、evaluate 边界与安全 | 已安装 | `install-skills.mjs` + verify-naming |
| `skills/zcd/visualize`（1） | 会话内 HTML 可视化的选择、CSP 契约与 authoring | 已安装 | verify-naming |
| `skills/zcd/dynamic-workflows`（1） | workflow_run 脚本 API、拓扑、replay/hole 规则 | 已安装 | verify-naming |
| `skills/zcd/skill-creator`（1） | dsh SKILL.md frontmatter、发现顺序与门禁 | 已安装 | verify-naming |
| `skills/zcd/plugin-creator`（1） | Cordis 插件/bundle/profile 接入与故障排查 | 已安装 | verify-naming |
| `@deepseek-ai/dsh-skill-office`（7） | office 路由 + docx/pptx/xlsx/render/recalculate/export-pdf | 已挂载 | 启动 smoke；LibreOffice kit 由 dsh 依赖提供 |
| `@zcd/bundle-base` | 基础能力行（tool-search / todo-read / deferred / offpeak / memory / workflow / documents / genui / browser …） | 已组合 | dump-config |
| `@zcd/bundle-web-app` | 5 个 host 行 + 4 个 client bundle 行 | 已组合 | dump-config |
| `profiles/product` | bundles = dsh-base → zcd-base → dsh-web-app → zcd-web-app | 已组合 | dump-config + smoke |

### 1.3 设置页写入（本轮新增）

- 新增 `@zcd/memory-ui-host`，只暴露 **user scope**：全局设置页不需要 workspace 就能管理条目；project scope 继续由会话内的 `memory_*` 工具读写。
- `GET /zcd/memory` 返回 `{ entries }`；`POST` 接收 `{name, description, type, body}`，`type` 限定 `fact/preference/decision/reference`；`DELETE /zcd/memory/<id>` 删除。
- 请求体上限 128 KB；错误以 `{ error }` 返回 400/404；响应带 `no-store` 与 `nosniff`。
- 设置页表单支持选择类型、保存后立即刷新列表、删除后回到空态、`Tidy memory` 调 `dream` 并展示 scanned/removed/kept；视觉验收截图见 `docs/assets/zcd-settings-memory.png`。
- `ZCD_USER_MEMORY_HOME` 可覆盖用户记忆根目录，smoke 用它指向一次性目录，避免污染真实的 `~/.zcd/memory`。

### 1.4 验证证据（可复跑）

```sh
pnpm typecheck     # 全部 workspace 包通过
pnpm test          # 18 个文件 / 99 个用例通过
pnpm verify        # verify-naming: 39 ZCD tools, 32 reserved names；docs 链接 0 问题
pnpm mcp:check     # pinned MCP server: initialize + tools/list
pnpm build         # 所有包 emit 到 lib/
node scripts/pack-product.mjs   # dist/zcd-product-<version>.tgz（相对路径，Windows 也可用）
node scripts/link-profile.mjs
npx -y node@24 scripts/smoke-profile.mjs
# ✓ product profile boots on :<port>; HTTP 303; all plugins and client cards active
```

smoke 覆盖：Web 启动、无 `did not activate`、Gen UI CSP、文档视图 POST/GET、`/zcd/status`、workflow fixture 的列表/节点/事件与 404 契约、**memory 列表→创建→列表→删除→列表**、四个 client bundle 的 boot graph 与 combo 内容。

---

## 2. 下一步（按顺序）

| 顺序 | 工作 | 说明 |
|---|---|---|
| 1 | Gen UI 会话内卡片验收 | 沙箱路由已渲染验收；仍需要一次真实 `visualize` 结果会话确认 iframe 卡片 |
| 2 | CUA（WP-11） | dsh 原生 provider 仅 macOS；Windows 需另找 CUA 驱动 |
| 3 | 浏览器 v2 | 🟡 部分完成：Node 级 `browser_act` code-act 已落地（vm 沙箱 + 注入 bindings + REPL 语义）；用户浏览器与可视面板未做 |
| 4 | 设置页继续写入 | workflow 配置、只读策略开关；用户记忆已经可用 |
| 5 | Workflow run 详情 | 耗时/模型列、失败重试入口；cancel/resume/amend 已完成 |
| 6 | 剩余技能 | 覆盖 34/39；剩 CUA 1 + 主动丢弃 4（站点/移动端/旧会话恢复） |

## 2.5 P1 尚未全部通过的验收

P0 已通过；P1（"ZCode 工具语义对齐"）**还没有全部验收**，巡检任务不要提前结束：

| 项 | 状态 |
|---|---|
| ToolSearch 可观测性 | 已有服务级测试：加载前 `when=false`，加载后 `when=true`；可见 schema 预算测试 < 8k tokens（chars/4 估算） |
| OffPeak 恢复 | 已有持久化测试：pending 恢复、running→interrupted、空闲执行 |
| 只读策略集成 | 已有分类器/决策单测 + Cordis waterfall 集成测试（deny write / allow read / bash classify / inactive） |
| skill gate | 已实现并通过纯函数测试；尚未在真实模型会话里观察拒绝 |
| S1 工具对齐 | 删除由 dsh 原生 `schedule_delete` 覆盖；**`schedule_pause` 未实现**（dsh 的 schedule 只有 delete/update，没有 active 开关）；`list_agents`/`interrupt_agent` 覆盖 subagent 查询/停止 |
| 技能 | 33 个技能可用，覆盖 34/39（26 个移植/改写 + 7 个 dsh 原生 Office） |
| 设置页写入 | 用户记忆已通；其余配置项未做 |

## 3. 已知缺口

| 缺口 | 影响 | 计划 |
|---|---|---|
| 无 CUA 工具 | Windows 上无法做桌面自动化 | 等待可用驱动；macOS 可挂 dsh 原生 provider |
| ~~浏览器无 Node 级脚本~~ | ✅ 已补 `browser_act`（Node 级 code-act）；仍无用户已开浏览器与可视面板 | — |
| 设置页只写用户记忆 | Memory 配置、只读策略开关仍不可改 | 复用 `configForms` |
| workflow 面板缺指标 | 无耗时/模型列与失败重试按钮 | 保存在节点上的模型与计时 |
| policy-plan-readonly 默认关闭 | 默认行为与 dsh 一致；严格模式需显式开 | 设置页开关 |
| 外部插件 e2e | doctor 只做静态检查 | 增加一个真实第三方插件 smoke |

## 4. 关键设计修正（相对早期文档）

1. **`tools/pre-execute` 没有“批准”语义**：`PreToolDecision` 只有 `allow/deny/cancel/ask`。命中只读时返回 `allow`（仍会跑 guards），否则 `next()`。见 `docs/00-decisions.md` ADR-07。
2. **dsh 的 plan mode 默认不限制工具**：严格只读是 ZCode 的取舍，所以 `policy-plan-readonly` 做成可选插件（默认 disabled）。
3. **Office 查看器已存在**：`ui-sidebar-documentpreview` 已支持 Word/PPT 转 PDF、表格、PDF、图片、HTML；缺的是模型工具，不是查看器。
4. **设置页不能用固定 section 数量假设**：dsh 的 `settings.section` 每个 section 需要 `inject: ['slots','locale']` 与 `ctx.locale.register`；否则导航有、正文为空。

## 5. 提交与巡检

- 仓库：https://github.com/liyunxuanyu/dsh-zcode-port
- 15 分钟巡检：`automation-2f335fed-67e7-4da1-a814-19cf0764c842`（`CronList` 可查）
- 巡检规则：读本文件 + `git log`，推进“下一步”的第一个未完成项；提交并推送；推送失败则继续本地开发。
