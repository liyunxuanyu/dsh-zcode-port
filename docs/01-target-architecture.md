# 01 · 目标架构

> 本文定义分层、仓库布局、运行时序、包清单与依赖方向。
> 决策依据见 `00-decisions.md`；能力清单见 `02-migration-matrix.md`。

---

## 1. 分层

```
L3 产品组合层    profiles / bundles / presets / skills / locale
      │ 只写 patch 行与静态资源，不含业务逻辑
L2 能力插件层    @zcd/* 包：工具、服务、策略、UI、存储
      │ 只通过 ctx.* 与 dsh 交互；不 import 上游内部路径
L1 dsh 内核      pinned upstream，只读
```

### 1.1 依赖方向（强制）

| 层 | 可以依赖 | 不可以依赖 |
|---|---|---|
| L3 | L2 的公开导出、dsh 的公开包名 | L2 的内部文件路径；L1 的 src |
| L2 | dsh 的公开包名（`@deepseek-ai/dsh-*`）、第三方库 | 其它 L2 包的内部路径（只能走公开导出） |
| L1 | — | L2/L3（上游不知道我们存在） |

CI 用 `dependency-cruiser` 或等价规则检查：
- `packages/**` 内禁止出现 `@zcd/` 的 import；
- `@zcd/*` 禁止出现相对路径越界（`../../` 到上游目录）；
- L2 包之间只允许 import 已声明在 `package.json` 的依赖。

### 1.2 为什么不再多分一层

ZCode 是 Renderer/Host/CLI 三层，因为要跨进程；我们的第一版只跑 dsh Web/Desktop，进程模型由 dsh 提供，所以不需要再引入第三层。若将来做远程/移动，把"UI 插件"与"Host 插件"分开即可（dsh 已经用 `dsh.client` 声明区分）。

---

## 2. 仓库布局

```
dsh-zcode-port/
├─ README.md
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
├─ upstream/
│  └─ dsh/                        # submodule，pin 到 0.2.2-alpha.2；只读
├─ packages/
│  ├─ shared/                     # @zcd/shared：类型、品牌 id、事件声明合并
│  │  ├─ src/events/              # SessionEventMap 扩展
│  │  ├─ src/brands.ts
│  │  └─ src/locale/              # en / zh 字典
│  ├─ bundle-base/                # @zcd/bundle-base：base patch（工具/服务/策略行）
│  ├─ bundle-web-app/             # @zcd/bundle-web-app：web-app patch + client 行
│  ├─ tool-workflow/              # workflow_* 工具族（durable）
│  ├─ workflow-durable/           # ctx.durableWorkflow 定义 + 引擎
│  ├─ workflow-store-sqlite/      # journal/run/turn 持久化
│  ├─ tool-search/                # tool_search + ctx.deferredTools
│  ├─ tool-offpeak/               # offpeak_create/list/cancel
│  ├─ offpeak/                    # ctx.offpeak 服务 + idle 检测
│  ├─ tool-memory/                # memory_search/write/read
│  ├─ memory/                     # ctx.memory + dream 整理
│  ├─ policy-bash-readonly/       # tools/pre-execute 只读放行
│  ├─ policy-skill-gate/          # 工作流作者技能门
│  ├─ browser-automation/         # code-act JS 会话（js 工具）
│  ├─ browser-provider-desktop/   # 可选：Desktop 内置浏览器 provider
│  ├─ cua-bridge/                 # 可选：CUA SDK 适配
│  ├─ tool-visualize/             # visualize 工具 + 资源
│  ├─ client-ui-genui/            # Gen UI 渲染（client half）
│  ├─ client-ui-workflow/         # 工作流面板 + run 卡片
│  ├─ tool-documents/            # open/read/search/show_in_viewer 工具
│  ├─ client-ui-settings-zcd/     # 设置页（Memory/Agents/Tools/Workflow）
│  └─ test-support/               # 测试夹具：临时 DSH_HOME、假 provider
├─ skills/                        # 产品技能（SKILL.md，带许可头）
│  ├─ dynamic-workflows/
│  ├─ control-browser/
│  ├─ web-gui-tester/
│  ├─ computer-use/
│  ├─ visualize/
│  ├─ office-*/
│  └─ superpowers/                # 可选的工程方法集
├─ profiles/
│  └─ product/
│     ├─ package.json             # dsh.profile.bundles = [zcd-base, zcd-web-app]
│     └─ cordis.patch.yml         # 用户层（空或少量偏好）
├─ overlay/                       # 只在必须改上游时出现
│  └─ <pkg>/<file>.patch + REASON.md
├─ scripts/
│  ├─ sync-upstream.mjs           # 拉上游 + 重放 overlay + 跑冒烟
│  ├─ gen-notice.mjs              # 生成 NOTICE（ZCode 技能来源）
│  ├─ verify-naming.mjs           # 工具/事件命名规范检查
│  └─ check-archive.js            # 归档索引一致性
└─ docs/
```

### 2.1 为什么 bundle 拆两个

dsh 的 `web-app` bundle 自己就有 593 行 patch。我们的 base（工具/服务/策略）与 web-app（client half）分开，好处：

- headless/SDK profile 只叠 base，不引入 UI 依赖；
- client half 的失败不影响 Agent 启动；
- 上游 web-app 升级时，我们的差异集中在一个文件。

---

## 3. 包清单与依赖

| 包 | 类型 | 依赖（dsh） | 依赖（自有） | 说明 |
|---|---|---|---|---|
| `@zcd/shared` | lib | `dsh-session`, `dsh-agent` | — | 事件声明合并、brand、locale |
| `@zcd/bundle-base` | bundle | — | `@zcd/shared` | 纯 patch，无代码 |
| `@zcd/bundle-web-app` | bundle | — | `@zcd/bundle-base` | 纯 patch + client 行 |
| `@zcd/workflow-durable` | service | `dsh-agent`, `dsh-session`, `dsh-subagent`, `dsh-llm` | `@zcd/shared` | `ctx.durableWorkflow` |
| `@zcd/workflow-store-sqlite` | provider | `dsh-storage`（可选） | `@zcd/shared` | 自有 SQLite schema |
| `@zcd/tool-workflow` | consumer | `dsh-tools`, `dsh-system-prompt` | `@zcd/workflow-durable` | 11 个工具 |
| `@zcd/tool-search` | consumer | `dsh-tools`, `dsh-session` | `@zcd/shared` | `tool_search` + 目录 |
| `@zcd/offpeak` | service | `dsh-agent`, `dsh-session` | `@zcd/shared` | idle 判定、票据 |
| `@zcd/tool-offpeak` | consumer | `dsh-tools` | `@zcd/offpeak` | 2–3 个工具 |
| `@zcd/memory` | service | `dsh-session`, `dsh-fs` | `@zcd/shared` | 目录、抽取、dream |
| `@zcd/tool-memory` | consumer | `dsh-tools` | `@zcd/memory` | 3 个工具 |
| `@zcd/policy-bash-readonly` | policy | `dsh-tools` | `@zcd/shared` | `tools/pre-execute` 监听 |
| `@zcd/policy-skill-gate` | policy | `dsh-tools`, `dsh-skill` | — | 读历史判定技能已加载 |
| `@zcd/browser-automation` | service+consumer | `dsh-tools`, `dsh-sandbox` | — | `js` 工具 + 会话内核 |
| `@zcd/tool-visualize` | consumer | `dsh-tools`, `dsh-fs` | — | 写输出目录 + 引用 |
| `@zcd/client-ui-genui` | client | `dsh-client-ui-slots`, `dsh-client-ui-renderer` | `@zcd/shared` | inline 页面沙箱 |
| `@zcd/client-ui-workflow` | client | `dsh-client-ui-conversation`, `dsh-client-ui-sidebar-right` | `@zcd/shared` | run 面板 |
| `@zcd/tool-documents` | consumer | `dsh-tools`, `dsh-office-to-pdf`（可选） | — | 5 个文档工具，驱动内置 documentpreview |
| `@zcd/client-ui-settings-zcd` | client | `dsh-client-ui-settings` | `@zcd/shared` | 设置卡 |

> 依赖名以 dsh 实际包名为准；上表用短名便于阅读。

---

## 4. 运行时序

### 4.1 启动

```
dsh --profile product
  → app-boot 读 profiles/product/package.json
  → 依次应用 zcd-base.patch、zcd-web-app.patch、profile patch、--patch
  → Loader 启动插件：
      @zcd/* 服务插件先起（effect 注册 service）
      @zcd/tool-* 等 service 就绪后注册工具（inject 依赖）
      @zcd/client-ui-* 由 client module system 在页面加载
  → 每个 Agent 创建时：tools.resolve({ agent }) 得到本 step 工具集
```

### 4.2 一次工具调用（新增的部分）

```
model tool_call
  → tools/pre-execute
      ├─ @zcd/policy-bash-readonly：只读命令在 approval 阶段返回 allowed-once
      └─ @zcd/policy-skill-gate：工作流工具未加载技能 → deny
  → monotonic guards（dsh）
  → approval（dsh，fail-closed）
  → tool body（@zcd/tool-*）
  → tools/post-execute
  → tool/result（dsh）
```

### 4.3 一次 durable workflow run

```
model → workflow_run 工具
  → ctx.durableWorkflow.start({ script, args, meta, parent, maxConcurrency })
      → 编译/校验（沙箱内 typecheck 或解释执行）
      → 写 run 记录（store: queued → running）
      → append session event: workflow/run-started（id + 摘要）
      → 后台执行：每 step 写 journal，spawn 子代理
      → 完成：写 run 结果 + append workflow/run-finished
  → 工具立即返回 run_id（不阻塞）
  → 完成事件 → agent.inject() 通知（user/message）
```

与 dsh `workflow` 的差别：`workflow` 阻塞父 turn；`workflow_run` **默认非阻塞**，有 `wait: true` 选项兼容阻塞用法。

---

## 5. 配置面

所有 L2 插件的 `Config` 必须是可 patch 的字段（dsh 的 "no hardcoded tunables" 纪律）：

```yaml
# bundles/zcd-base/cordis.patch.yml（节选）
- id: zcd-offpeak
  name: '@zcd/offpeak'
  config:
    idleMinutes: 10
    minIdleRounds: 1
    maxConcurrentTasks: 2

- id: zcd-tool-search
  name: '@zcd/tool-search'
  config:
    alwaysVisible: [read, write, edit, bash, todo_write]
    maxResults: 8
    catalogRefresh: step
```

原则：

- 部署差异 → `Config` 字段，不写常量；
- 安全不变量（只读判定表、审批语义）→ 代码固定，不做成配置；
- 环境相关（路径、端口）→ `Volatile<T>`（dsh 的 live config）。

---

## 6. 可观测性

| 需求 | 做法 |
|---|---|
| 工具耗时/失败 | dsh 的 `tools/*` 事件 + OTel（`otel` 插件已在 base） |
| 工作流 run | 自有 store 的 `run`/`node` 表 + `workflow/*` 事件摘要 |
| 只读放行命中率 | `policy-bash-readonly` 自增计数器，经 `telemetry/*` 上报 |
| 记忆整理 | `memory/*` 事件 + 日志（不落敏感内容） |
| 延迟工具加载 | `tool/loaded` 事件 + run 面板"工具"页 |

禁止：把 prompt 全文、文件内容、命令输出写进遥测（沿用 dsh 的 redaction 纪律）。

---

## 7. 失败与降级

| 故障 | 行为 |
|---|---|
| workflow store 不可写 | `workflow_run` 返回业务错误（不静默降级到内存）；提示用户检查路径/权限 |
| 子代理达上限 | 引擎排队并记录 `run-stalled`，UI 显示等待原因；超时后失败该 node |
| Gen UI 页面崩溃 | client 侧错误边界显示原文 + "在新窗口打开"；不影响消息流 |
| Office 查看器无法转换 | 回退为下载/系统打开；不阻塞 Agent |
| 记忆目录不可读 | `memory_*` 工具返回结构化错误；dream 跳过并记录 |
| 上游破坏性变更 | 编译失败优先；行为变化靠快照回放捕获（`09` §3） |

---

## 8. 与 dsh 上游的边界（再次强调）

- 不 import 上游 `src/**`；只用包导出。
- 不注册与 dsh 同名工具（`bash/read/edit/...`）；新工具名统一 `zcd` 语义前缀或独立名（`tool_search`、`workflow_run`、`memory_search`、`offpeak_create`）。
- 不覆盖 dsh 的 `Config` 字段语义；只在自己的 `Config` 内扩展。
- 不改 `approval` 的 `ask/never`；只读放行走 pre-execute 意见。
