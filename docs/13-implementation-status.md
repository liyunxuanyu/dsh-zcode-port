# 13 · 实现状态

> 最后更新：2026-11-03（P0 提交 `7afcdd8` 之后）。
> 本文是**唯一**的实现进度入口；`docs/10-roadmap.md` 只描述计划，状态以此为准。

---

## 0. 一句话

**P0 已通过，P1 进行中**：product profile 能在 dsh 0.2.2-alpha.2 上启动 Web，四个 bundle 正确组合，**十二个** ZCD 工具激活（deferred-tools / tool-search / todo-read / plan-mode / plan-policy / offpeak / tool-offpeak / memory / tool-memory / tool-models / tool-session），并安装 14 个技能，单测与命名门禁通过。

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
| 产品打包 | `scripts/pack-product.mjs` |
| 命名门禁 | `scripts/verify-naming.mjs` |
| CI | `.github/workflows/ci.yml`（typecheck/test/verify/build/pack/smoke） |

### 1.2 插件（P0 验收所需）

| 包 | 工具/能力 | 状态 | 测试 |
|---|---|---|---|
| `@zcd/shared` | 事件声明合并（`deferred-tool/loaded`、`offpeak/*`、`memory/*`、`workflow/*`）、branded id | 已编译 | — |
| `@zcd/deferred-tools` | `ctx.deferredTools`：工具注册时带 `when`，按会话投影决定是否进入 step | 激活成功 | — |
| `@zcd/tool-search` | `tool_search`：搜 `ctx.deferredTools` 目录，命中后写 `deferred-tool/loaded` | 激活成功 | 5 个单测（排序/分词/限额） |
| `@zcd/tool-todo-read` | `todo_read`：**deferred** 工具，读 `todos` 投影 | 激活成功 | — |
| `@zcd/tool-plan-mode` | `enter_plan_mode`：程序化执行 `/plan`，不拥有 plan 状态 | 激活成功 | — |
| `@zcd/offpeak` | `ctx.offpeak`：空闲判定、新会话执行、用户输入即让路 | 激活成功 | — |
| `@zcd/tool-offpeak` | `offpeak_create/list/cancel`（deferred） | 激活成功 | — |
| `@zcd/tool-models` | `list_models`：按 provider 列出可路由模型（deferred） | 激活成功 | — |
| `@zcd/tool-session` | `session_handoff`：同 cwd 会话的 bounded handoff（deferred） | 激活成功 | — |
| `@zcd/memory` | `ctx.memory`：项目/用户 Markdown 条目、索引重建、路径约束、secret 拒绝 | 激活成功 | 6 个单测（slug/parse/secret） |
| `@zcd/tool-memory` | `memory_search/read/write/remove`（deferred） | 激活成功 | — |
| `skills/superpowers`（14） | ZCode 工程方法技能，工具名已映射为 dsh | 已安装到 `$DSH_HOME/skills` | `install-skills.mjs` |
| `@zcd/policy-plan-readonly` | plan mode 严格只读：deny 写工具与非只读 bash | 编译通过；bundle 中默认 `disabled: true` | 35 个分类器单测 |
| `@zcd/bundle-base` | 三行 insert（tool-search / todo-read / plan policy） | 已组合 | dump-config |
| `@zcd/bundle-web-app` | 空 insert（为 UI 工作包预留） | 已组合 | dump-config |
| `profiles/product` | bundles = dsh-base → zcd-base → dsh-web-app → zcd-web-app | 已组合 | dump 1243 行 |

### 1.3 验证证据（可复跑）

```sh
pnpm typecheck     # 4 个包全部通过
pnpm test          # 2 个文件 / 40 个用例通过
pnpm verify        # verify-naming: 2 ZCD tools, 34 known names；docs 链接检查通过
pnpm build         # 4 个包 emit 到 lib/
node scripts/link-profile.mjs
node scripts/smoke-profile.mjs
# ✓ product profile boots on :<port>; HTTP 303; all plugins active
```

`--dump-config` 的实际输出（节选）：

```yaml
# == @zcd/bundle-base
- id: zcd-tool-search
  name: '@zcd/tool-search'
  config: { deferred: [], maxResults: 8 }
- id: zcd-tool-todo-read
  name: '@zcd/tool-todo-read'
- id: zcd-policy-plan-readonly
  name: '@zcd/policy-plan-readonly'
  disabled: true
```

---

## 2. 进行中 / 下一步（按顺序）

| 顺序 | 工作 | 说明 |
|---|---|---|
| 1 | ~~`todo_read` 接入 deferred~~ | 已完成：`@zcd/deferred-tools` + `when` 策略；`tool_search` 命中后下一步可见 |
| 2 | ~~`enter_plan_mode`~~ | 已完成：通过 `ctx.commands.execute(agent, '/plan', ...)`，不碰 plan 私有状态 |
| 3 | ~~`session_handoff`~~ | 已完成：读 `ctx.sessionQuery.readSurface`，按 cwd 精确授权，截断 20 条/20k 字符 |
| 4 | ~~`list_models`~~ | 已完成：`ctx.llm.listProviders()` + `listModels()`，deferred |
| 5 | ~~OffPeak~~ | 已完成：`ctx.offpeak` + 3 个 deferred 工具；空闲 10 分钟启动，用户输入即 taken-over |
| 6 | ~~Memory~~（WP-06） | v1 已完成：条目/索引/路径/secret/软删除；dream 与 prompt 注入留待下一步 |
| 7 | **Durable Workflow**（WP-08/09） | 唯一新 seam；单独立项 |
| 8 | **Memory dream + prompt index** | 空闲整理、system prompt 注入索引 |
| 8.5 | **其余技能** | 已完成 superpowers 14/39；office/browser/CUA/guide 随对应 WP |
| 9 | **Browser / CUA**（WP-10/11） | `js` code-act + 浏览器 provider + 面板 |
| 10 | **UI**（WP-12/13/14） | Gen UI、文档工具、设置页 |

## 3. 已知缺口

| 缺口 | 影响 | 计划 |
|---|---|---|
| 暂无 `session_handoff` / `list_models` | 跨会话上下文与模型目录仍靠 dsh 原生工具 | 下一步实现 |
| `policy-plan-readonly` 默认关闭 | 默认行为与 dsh 一致；ZCode 式严格模式需显式开 | 在 bundle 文档与设置页里提供开关（WP-14） |
| 未实现 `enter_plan_mode` | 模型只能用 `/plan` 命令进入计划模式 | 先验证 command 执行 API |
| 无 `skills/` 目录 | 技能尚未移植 | WP-15 |
| 无 client half | 还没有 Gen UI / 工作流面板 / 设置页 | WP-11–14 |
| CI 的 smoke 依赖 profile 安装 | 需要 `pnpm-lock.yaml` 与 dsh 下载 | 已在 CI 中串好，首次可能较慢 |

## 4. 关键设计修正（相对早期文档）

实现过程中发现并已修正的三点，后续文档以此为准：

1. **`tools/pre-execute` 没有“批准”语义**：`PreToolDecision` 只有 `allow/deny/cancel/ask`。只读放行不能作为“意见”，只能：命中只读时返回 `allow`（仍会跑 guards），否则 `next()`。见 `docs/00-decisions.md` ADR-07 的更新说明。
2. **dsh 的 plan mode 默认不限制工具**：严格只读是 ZCode 的取舍，所以 `policy-plan-readonly` 做成**可选**插件（默认 disabled），不改变 dsh 原生行为。
3. **Office 查看器已存在**：`ui-sidebar-documentpreview` 已支持 Word/PPT 转 PDF、表格、PDF、图片、HTML；缺的是 5 个模型工具，不是查看器。

## 5. 提交与巡检

- 仓库：https://github.com/liyunxuanyu/dsh-zcode-port
- 提交：`7afcdd8 feat(P0): overlay skeleton boots a product profile on dsh`
- 15 分钟巡检：`automation-2f335fed-67e7-4da1-a814-19cf0764c842`（`CronList` 可查）
- 巡检规则：读本文件 + `git log`，推进“下一步”的第一个未完成项；提交并推送；推送失败则继续本地开发。
