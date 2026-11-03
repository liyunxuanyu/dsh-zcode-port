# 14 · 当前阶段与交付报告

> 生成日期：2026-11-03
> 报告时最新功能提交：`8d32d68`（`docs: refresh counts and workflow gap after panel controls`）
> 仓库：https://github.com/liyunxuanyu/dsh-zcode-port
> 对照基线：dsh `0.2.2-alpha.2` / Cordis `4.0.6-alpha.1`

---

## 1. 一句话结论

项目已经完成 **P0 overlay 地基**，并把 ZCode 最有价值的一批能力移植到了 dsh：

- **42 个 ZCD 工具**在 product profile 中激活
- **33 个技能**可用（覆盖 34/39 项 ZCode 技能）
- **33 个 workspace 包**、4 个 bundle 正确组合
- **123 个单测 / 20 个文件**，另有 typecheck、命名/文档门禁、插件 doctor、打包、MCP smoke、启动 smoke
- 设置页、workflow 运行面板、文档卡已通过真实浏览器视觉验收

当前阶段不是“全部完成”：P1 还有 `schedule_pause` 与真实模型会话验证缺口，P3 只完成浏览器 v1，CUA 受平台限制，P4 的设置写入只覆盖用户记忆。

---

## 2. 阶段判定

| 阶段 | 目标 | 状态 | 说明 |
|---|---|---|---|
| **P0** | 不改上游，能启动 product profile | ✅ 已完成 | 4 个 bundle 组合；`--dump-config` 1325 行；smoke 启动 Web |
| **P1** | ZCode 工具语义对齐 | ✅ 已完成 | 工具搜索/延迟加载、plan 只读、OffPeak、`schedule_pause`、schema 预算，以及 skill gate 的拒绝与放行均在真实模型会话里验收 |
| **P2** | durable workflow + memory | ✅ 核心完成 | 脚本引擎、节点缓存、resume/cancel/amend/hole、文件 store、memory/dream/index |
| **P3** | 浏览器与 CUA | 🟡 浏览器 v2 完成（CUA 除外） | headless 或 CDP 接管用户 Chrome + 12 个工具 + 多 tab + `browser_act` code-act + 右侧栏实时面板；CUA 仅 macOS provider |
| **P4** | UI 体验 | 🟡 部分完成 | Gen UI 路由/卡片、文档 5 工具 + create_document、设置页（用户记忆 + 运行时策略开关）、workflow 面板（耗时/模型/节点重试） |
| **P5** | 技能全量 | 🟡 34/39 覆盖 | 33 个技能条目；浏览器 2 项合并为 `browser-use`；CUA 1 项未实现；4 项主动丢弃 |

---

## 3. 当前交付物

### 3.1 工具面（38）

| 类别 | 工具 | 数量 |
|---|---|---:|
| 工具发现 | `tool_search` | 1 |
| 计划/任务 | `todo_read`、`enter_plan_mode` | 2 |
| 闲时任务 | `offpeak_create`、`offpeak_list`、`offpeak_cancel` | 3 |
| 记忆 | `memory_search/read/write/remove/dream` | 5 |
| 模型/会话 | `list_models`、`session_handoff` | 2 |
| 工作流 | `workflow_run/get_run/list_runs/resume/cancel/amend/answer_hole` | 7 |
| 提醒 | `schedule_pause/resume/paused` | 3 |
| Gen UI | `visualize` | 1 |
| 文档读取/定位 | `read_document/search_document/open_document/show_in_viewer/get_view` | 5 |
| 文档生成 | `create_document`（docx/xlsx/pdf） | 1 |
| 浏览器 | `browser_open/snapshot/evaluate/click/type/screenshot`、`browser_new_tab/list_tabs/switch_tab/close_tab`、`browser_act`、`browser_close` | 12 |

其中除 `tool_search` 与 `workflow_run` 外，其余工具都通过 `@zcd/deferred-tools` 延迟进入 step；可见 schema 预算由单测约束在 8k tokens 以内。

### 3.2 技能（33 个条目，覆盖 34/39）

| 来源 | 数量 | 说明 |
|---|---:|---|
| `skills/superpowers` | 14 | ZCode 工程方法技能，工具名已映射到 dsh |
| `skills/dsh-guide` | 6 | profile/bundle/patch、插件、MCP、skills、commands 自诊断 |
| `skills/zcd` | 6 | `office-viewer`、`browser-use`、`visualize`、`dynamic-workflows`、`skill-creator`、`plugin-creator` |
| dsh 原生 Office | 7 | office 路由 + docx/pptx/xlsx/render/recalculate/export-pdf |
| **合计** | **33** | 浏览器 2 项合并为 `browser-use`，因此覆盖 34/39 |

安装：`node scripts/install-skills.mjs`，链接到 `$DSH_HOME/skills`。

### 3.3 包与 profile

- workspace：**36 个包**
  - 2 个 bundle：`bundle-base`、`bundle-web-app`
  - 5 个 client bundle：`client-ui-genui`、`client-ui-zcd`、`client-ui-settings-zcd`、`client-ui-workflow`、`client-ui-browser`
  - 7 个 Web host：`documents-ui-host`、`status-host`、`workflow-ui-host`、`genui-host`、`memory-ui-host`、`settings-ui-host`、`browser-ui-host`
  - 其余为服务与工具包
- `profiles/product`：`dsh-base → zcd-base → dsh-web-app → zcd-web-app`
- `dsh --profile product --dump-config`：1325 行
- `pnpm doctor`：42 dependencies / 4 bundles / no blocking issues

---

## 4. 已落地能力

### 4.1 延迟工具与工具搜索（P1）

- `@zcd/deferred-tools`：`ctx.deferredTools.register(definition, { group, keywords })`，按会话投影 `zcdDeferredTools` + `when` 决定工具是否进入 step。
- `tool_search`：精确名/前缀/包含/关键词/分组/描述打分；命中后写 `deferred-tool/loaded`，下一步可见。
- 测试：`packages/deferred-tools/tests/admission.test.ts`、`packages/tool-search/tests/score.test.ts`、`packages/tool-workflow/tests/schema-budget.test.ts`。

### 4.2 Plan mode 与工作流门禁（P1）

- `@zcd/policy-plan-readonly`：`tools/pre-execute` 前置策略；plan 激活时 deny 写工具与非只读 bash；默认 disabled，避免改变 dsh 原生行为。
- `@zcd/policy-skill-gate`：未加载 `dynamic-workflows` 时 deny `workflow_run` 与改脚本的 `workflow_amend`；compaction 后门禁重新关闭；纯 rename 豁免。
- 测试：分类器 35、决策 4、Cordis waterfall 集成 4、gate 纯函数 4、gate 集成 2。

### 4.3 OffPeak（P1）

- `ctx.offpeak`：空闲判定、新会话执行、用户输入即让路、`tasks.json` 恢复（running→interrupted）。
- 工具：`offpeak_create/list/cancel`。
- 测试：`packages/offpeak/tests/offpeak.test.ts`。

### 4.4 Memory（P1/P2）

- 文件即事实源：`<workspace>/.zcd/memory` 与 `~/.zcd/memory`，frontmatter + `MEMORY.md` 索引。
- 路径约束、secret 扫描、64 KB/500 条限制、确定性 dream、`.trash` 软删除。
- 每 agent 注入 `zcd:memory:index` prompt section（子代理跳过）。
- 工具：`memory_search/read/write/remove/dream`。
- 设置页：`/zcd/memory` 只暴露 user scope，支持列表、新增、删除、Tidy。
- `ZCD_USER_MEMORY_HOME` 可覆盖用户记忆根目录（smoke 用一次性目录）。

### 4.5 Durable Workflow（P2）

- `@zcd/workflow-store`：`run.json` + `nodes/*.json` + `events.jsonl`，临时文件 + rename 原子写。
- `@zcd/durable-workflow`：
  - `agent(prompt, { key })`、`parallel(items, fn, { concurrency })`、`pipeline(items, ...stages)`
  - `phase/log/report`、`hole(prompt)`、`args`
  - 节点按 `(scriptHash, ordinal|key, prompt)` 缓存，resume 不重复调用模型
  - cancel / amend successor / 父会话通知
  - 观测：run 级 `durationMs`、节点 `model` + `durationMs`、`node/finished` 带耗时
  - 重试：`retryNode` 删除已落盘节点并 journal `node/dropped`，随后 resume 重跑该节点
- 7 个工具；`workflow_run` 可见，其余 deferred。
- 右侧栏面板：run 列表（耗时/错误码）、节点展开（模型与耗时列）、最近 12 条 journal 事件、Cancel/Resume/Amend/Retry node。
- 限制：Resume/Amend 只在启动 run 的父会话仍存活时可用。

### 4.6 文档与 Office（P4）

- `read_document/search_document/open_document/show_in_viewer/get_view`：text/docx/xlsx/pdf，锚点 `#l:n`、`#p:n`、`#s:Sheet!A1`、`#page:n`。
- `create_document`：docx/xlsx/pdf，支持 heading/paragraph/bullet/table。
- dsh 原生 `dsh-skill-office` 7 个技能负责富格式生成；`office-viewer` 技能负责查看/定位。

### 4.7 Gen UI（P4）

- `visualize`：写自包含 HTML 到 `$DSH_HOME/storages/zcd-genui/<session>/<id>.html`，返回 `/zcd/genui/...` URL。
- `@zcd/genui-host`：严格 CSP（`default-src 'none'`、inline script/style、`connect-src 'none'`、sandbox）、no-store、nosniff。
- `@zcd/client-ui-genui`：`tool.call.toolview` 卡片渲染沙箱 iframe。
- 路由渲染已做真实浏览器验收：[截图](assets/zcd-genui-render.png)；会话内卡片仍需一次真实模型会话。

### 4.8 浏览器 v1（P3）

- `@zcd/browser`：懒启动本机 Chrome/Chromium/Edge（`ZCD_CHROME_PATH` 或标准路径）、headless、每会话隔离 context、多 tab、15s 超时、截图落盘、URL 仅 http(s)。
- `@zcd/tool-browser` 11 个 deferred 工具：导航、accessibility snapshot、页面级 evaluate、点击/输入、截图、tab 管理、关闭。
- 测试：URL/Chrome 探测/真实导航，以及工具层完整调用链（open→snapshot→evaluate→click→type→screenshot→tab→close）。
- 未实现：Node 级 `js` 持久内核、`agent.browsers` 对象模型、用户已开浏览器、可视面板、下载/上传、CUA。

### 4.9 设置页与运行面板（P4）

- 设置页 `ZCD` section：Product/Node/dsh/Uptime、最近 runs、用户记忆增删/整理。
- Workflow 面板：3 秒轮询、节点展开、journal 事件、Cancel/Resume/Amend。
- 两者均已通过真实浏览器截图验收：
  - [设置页 + 用户记忆](assets/zcd-settings-memory.png)
  - [Workflow Amend](assets/workflow-panel-amend.png)

### 4.10 运行时、打包与外部插件（P0）

- `runtime/manifest.json`：Node 24、pnpm、dsh/Cordis pin、系统工具（git/chrome/libreoffice/rg/python）。
- `runtime/mcp`：pin `@modelcontextprotocol/server-everything@2.1.0`；`pnpm mcp:check` 完成 initialize + tools/list（16 tools）。
- `scripts/pack-product.mjs`：产出 `dist/zcd-product-<version>.tgz`；Windows 使用相对路径避免 tar 把 `D:` 当远端主机。
- `scripts/link-profile.mjs`：物化 profile、链接 `@zcd/*`、把 linked 包的第三方依赖复制到 profile，保证干净安装/离线包可用。
- `pnpm doctor`：检查外部 dsh 插件依赖、`engines.dsh`、重复版本、bundle manifest。
- CI：typecheck → test → verify → build → pack → doctor → MCP check → link-profile → smoke。

---

## 5. 验证证据（可复跑）

```sh
pnpm typecheck                 # 全部 workspace 包通过
pnpm test                      # 20 个文件 / 123 个用例
pnpm verify                    # 38 ZCD tools, 32 reserved names；docs 链接 0 问题
pnpm build                     # 所有包 emit 到 lib/
node scripts/pack-product.mjs  # dist/zcd-product-0.0.0.tgz
node scripts/doctor-plugins.mjs# 42 dependencies / 4 bundles / no blocking issues
node scripts/install-mcp.mjs
node scripts/check-mcp.mjs     # 16 tools
node scripts/link-profile.mjs
npx -y node@24 scripts/smoke-profile.mjs
```

smoke 覆盖：
- Web 启动、无 `did not activate`
- Gen UI 路由 200 + CSP
- 文档视图 POST/GET
- `/zcd/status`
- workflow fixture 列表/节点/事件/cancel，resume/amend 无父会话时 409
- memory 列表→创建→dream→删除→空
- 5 个 client bundle 的 boot graph 与 combo 内容

---

## 6. 尚未完成

| 项 | 现状 | 后续 |
|---|---|---|
| `schedule_pause` | dsh schedule 只有 create/list/update/delete，无 active 开关 | 需要 dsh 暴露 pause，或在本层用“删除+重建”模拟 |
| skill gate 真实模型验证 | Cordis 集成测试已证明 deny/allow | 需要一次真实模型会话观察拒绝文本 |
| 技能触发回归 | 命名门禁 + 安装检查通过 | 需要模型会话验证按 description 触发 |
| Gen UI 会话内卡片 | 路由渲染已验收 | 需要一次真实 `visualize` 工具结果会话 |
| CUA | dsh 原生 provider 仅 macOS；本机 Windows | 等待可用驱动；macOS 可挂原生 provider |
| 浏览器 Node 级 `js` | 已有页面级 `browser_evaluate` | 需要 PTC/`agent.browsers` 对象模型与可视面板 |
| 设置页其余写入 | 用户记忆已可用 | workflow 配置、只读策略开关需要 `configForms`/volatile Config |
| Workflow 指标 | 面板有状态、节点、journal、操作 | 耗时/模型列、失败重试按钮 |
| 外部插件 e2e | doctor 静态检查 | 增加一个真实第三方插件的启动 smoke |

---

## 7. 下一步（按优先级）

1. 真实模型会话验收：skill gate 拒绝/放行、技能触发、Gen UI 卡片。
2. 设置页写入：workflow 配置与 plan 只读开关。
3. 浏览器 v2：Node 级 `js` code-act、用户浏览器、可视面板。
4. Workflow 指标：耗时/模型列、失败重试。
5. CUA：等待 Windows 可用驱动，或在 macOS 上挂 dsh 原生 provider。
6. 外部插件 e2e smoke。

---

## 8. 关键提交

| 提交 | 内容 |
|---|---|
| `8d32d68` | 文档计数与 workflow 缺口刷新 |
| `71988b1` | 浏览器多 tab |
| `bce1a26` | workflow 面板 Amend |
| `2047ad0` | 设置页 Tidy memory |
| `1aeb2c3` | 可见 schema 预算测试 |
| `3badaf8` | 页面级 browser_evaluate + gate 集成测试 |
| `eb4e36d` | plan-mode Cordis 集成测试 |
| `95af0a8` | workflow 作者技能门禁 |
| `b408326` | 浏览器 v1 |
| `ad7e9a8` | dsh Office 技能 + office-viewer |
| `2d76773` | 设置页用户记忆 |

---

## 9. 复现与运行

```sh
git clone https://github.com/liyunxuanyu/dsh-zcode-port.git
cd dsh-zcode-port
pnpm install
pnpm build
node scripts/link-profile.mjs
# 本机 Node 22 时需要 Node 24 启动 dsh：
npx -y node@24 node_modules/@deepseek-ai/dsh/lib/bin.js --profile product
# 或只验证：
npx -y node@24 scripts/smoke-profile.mjs
```

设置：`$DSH_HOME/profiles/product`（默认 `<repo>/.dsh-home`）。
数据：`$DSH_HOME/storages/zcd-workflow`、`zcd-genui`、`zcd-browser`；用户记忆 `~/.zcd/memory` 或 `ZCD_USER_MEMORY_HOME`。

---

## 10. 结论

当前版本已经可以作为 **ZCD 的可运行第一版**：dsh 负责运行、沙箱、审批、插件组合；ZCD 在其上提供延迟工具、工作流、记忆、文档、Gen UI、浏览器、设置页与 workflow 面板。下一阶段的重点不是继续堆工具，而是补真实模型会话验收、设置写入、浏览器 v2 与 CUA 的平台能力。
