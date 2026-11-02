# 09 · 兼容、安全、发布

> 本文是二开的"长期维护手册"：上游怎么同步、命名怎么守、安全不变量是什么、许可怎么合规、怎么发布。

---

## 1. 上游同步

### 1.1 基线

| 项 | 值 |
|---|---|
| dsh 版本 | `0.2.2-alpha.2`（`package.json:3`） |
| 同步方式 | `upstream/dsh` submodule（pin commit），或 tarball + `pnpm.overrides` |
| 频率 | 每两周一次；安全修复随时 |
| 负责人 | 1 名轮值（arch owner） |

### 1.2 流程

```
1. git submodule update --remote upstream/dsh   （或改 pin）
2. pnpm install
3. node scripts/apply-overlay.mjs               （重放 overlay/ 的 patch）
4. pnpm typecheck && pnpm lint
5. pnpm test:unit
6. pnpm test:snapshot                            （keyless 会话回放）
7. node scripts/verify-naming.mjs
8. dsh --profile product --dump-config > /tmp/after.yml
   diff /tmp/before.yml /tmp/after.yml           （配置面变化必须评审）
9. 冒烟：启动 Web，跑 3 条脚本化对话（读/写/工具）
10. 记录 CHANGELOG（breaking / silent）
```

### 1.3 风险分级

| 级别 | 表现 | 处理 |
|---|---|---|
| `breaking-now` | typecheck 失败 / 启动失败 | 立即修；阻塞发布 |
| `silent` | 行为变化但编译通过 | 靠快照回放发现；评审后接受或修 |
| `cosmetic` | 文案/UI 变化 | 记录，不阻塞 |

### 1.4 关注的上游面（按脆弱度排序）

| 面 | 为什么脆弱 | 我们的依赖 |
|---|---|---|
| `ctx.tools.register({ when })` | 延迟加载的核心 | WP-03 |
| `SessionEventMap` 声明合并 | 新事件 | 全部 |
| `WorkflowEngine` 契约 | 我们并存而非继承 | WP-08 |
| `ctx.sessionProjections` | 加载集合/run 投影 | WP-03/09 |
| `ctx.subagents` 容量/消息 | 工作流并发 | WP-08 |
| `ctx.approval` 语义 | 只读放行/审批 | WP-04 |
| `dsh.client` 构建格式 | client 插件 | WP-10/11/12/13 |
| `webServer.register` 路由 | Gen UI 宿主 | WP-12 |
| `ctx.configForms` | 设置页 | WP-13 |
| `pid`/`effect` 生命周期 | 所有服务 | 全部 |

---

## 2. 命名契约

### 2.1 工具名

- 格式：`^[a-z][a-z0-9_]{2,40}$`；蛇形；无版本后缀。
- 前缀分组（建议，不强制）：`workflow_`、`memory_`、`offpeak_`、`cron_`、`session_`、`subagent_`。
- 禁止：与 dsh 内置同名（`bash`、`read`、`write`、`edit`、`glob`、`grep`、`web_fetch`、`web_search`、`todo_write`、`ask_user_question`、`skill`、`subagent`、`present`、`lsp`…）。
- 禁止：PascalCase、驼峰、缩写歧义（`cfg`、`mgr`）。
- 发布后不可改名（模型可见契约）；废弃用"新增 + 旧工具描述里指向新工具 + 一个版本后删除"。

### 2.2 事件名

- 格式：`<domain>/<verb-past>`，如 `workflow/run-started`、`memory/written`。
- 必须是 lossless JSON；不得含 `Date`/`Map`/`Set`/`BigInt`/`undefined`。
- 语义不可变；变更语义 → 新事件名。
- 每个事件必须有 consumer（projection/UI/test），否则不进主线。

### 2.3 配置字段

- `Config` 用 dsh 的 schemastery/zod 风格；字段有 JSDoc（dsh 会生成 config catalog）。
- 部署差异 → 字段；安全不变量 → 代码常量。
- 字段重命名 = breaking；需 upgrade guide。

### 2.4 包名

- `@zcd/<kebab>`；`@zcd/client-ui-<area>` 表示 client half。
- 不发布到公共 npm（私有 registry 或 workspace）。

---

## 3. 安全不变量（不可协商）

| # | 不变量 | 验证 |
|---|---|---|
| S1 | 沙箱默认值不被放宽（dsh 的 `read-only` / base 的 `workspace-write`） | 配置快照 diff |
| S2 | 审批 fail-closed：`unavailable` 视为拒绝 | 单测 |
| S3 | monotonic guard 不被绕过；只读放行走 approval answerer，不跳过 guard | 集成测试（写命令仍审批） |
| S4 | 只读判定不确定时 fail-closed（走审批） | 规则表反例测试 |
| S5 | 脚本执行无网络/文件（除 facade） | 沙箱逃逸测试 |
| S6 | Gen UI 页面无 same-origin、无 Host API | CSP + 安全测试 |
| S7 | 文档/浏览器/CUA 的外部动作有审批 | 集成测试 |
| S8 | 遥测不含 prompt/文件内容/命令输出 | 代码审查 + 采样检查 |
| S9 | memory 写入不能逃逸目录 | 路径测试（`..`/符号链接） |
| S10 | `plugin_manager` 的审批不被我们的插件绕过 | 集成测试 |

### 3.1 威胁模型（简版）

| 威胁 | 入口 | 缓解 |
|---|---|---|
| 页面注入 | 浏览器内容 | 系统提示 + 不执行页面指令 + 下载/上传审批 |
| 恶意脚本 | workflow 脚本 | worker + sandbox + facade 白名单 |
| 恶意 Gen UI | 模型生成 HTML | iframe sandbox + CSP |
| 路径穿越 | memory/artifact | 规范化 + 拒绝 `..`/符号链接 |
| 凭证泄漏 | 记忆/日志 | secret 扫描 + redaction |
| 供应链 | 第三方依赖 | lockfile + 许可扫描 + 最小依赖 |
| 自修改滥用 | plugin_manager | 保留 dsh 的 danger-full-access/审批；产品默认关闭 |

---

## 4. 许可与合规

### 4.1 代码

| 来源 | 许可 | 我们的用法 |
|---|---|---|
| dsh | MIT | 依赖（不复制）；自有代码 MIT |
| ZCode | Apache-2.0 | **不复制 TS 源码**；只按文档重实现 |
| 第三方（d3、floating-ui、docx、xlsx、pdfjs…） | 各自 | 按其许可；`THIRD_PARTY_NOTICES` |

### 4.2 技能与文档

- 复制的 `SKILL.md`/文档：文件头加
  ```
  <!-- Ported from ZCode (Apache-2.0): apps/zcode-cli/packages/<pkg>/skills/<name>/SKILL.md -->
  ```
- `NOTICE` 自动生成：`scripts/gen-notice.mjs` 扫描 `skills/**` 的 `Ported from` 行 + `package.json` 依赖。
- Apache-2.0 要求保留版权与许可声明；`NOTICE` 不得暗示 ZCode 背书。

### 4.3 商标

- 产品名不用 "ZCode"（除非获得授权）；文档里用 "ZCode" 指代上游时注明来源。
- 技能文本里的 "ZCode" 改为产品名（`<Product>`），避免用户混淆。

### 4.4 检查

```bash
node scripts/gen-notice.mjs --check     # NOTICE 与源文件一致
npx license-checker --onlyAllow 'MIT;Apache-2.0;BSD-3-Clause;ISC'
```

---

## 5. 发布

### 5.1 产物

| 产物 | 内容 |
|---|---|
| npm 包（私有） | `@zcd/*` |
| 产品 profile | `zcd-base` + `zcd-web-app` 两个 bundle |
| 桌面/Web 分发包 | 由 dsh 的打包链生成（`dsh` CLI + 我们的 bundle） |
| 技能包 | `skills/` 打进 bundle 的 `docs` 或独立包 |

### 5.2 版本

- 三个版本号：上游 dsh 版本、产品版本、bundle 版本。
- 产品版本语义化；bundle 版本的 patch 跟随产品。
- 每个版本写 upgrade guide（工具改名/事件语义/配置字段）。

### 5.3 灰度

- `experimental` 包默认不进 product bundle。
- 新工具先在 `preset: dev` 打开；稳定后进 base。
- 破坏性变更：一个 minor 版本内提供双工具（旧描述指向新工具），下一个 minor 删除。

### 5.4 回滚

- profile 级：`--patch` 关闭某个插件行。
- 产品级：回滚 bundle 版本（patch 是数据，不涉及迁移）。
- store 迁移不可逆：升级前自动备份 `workflow.db`（`VACUUM INTO`）。

---

## 6. 测试矩阵

| 层 | 命令 | 触发 |
|---|---|---|
| 单元 | `pnpm test:unit` | 每次提交 |
| 类型 | `pnpm typecheck` | 每次提交 |
| Lint | `pnpm lint` | 每次提交 |
| 命名 | `node scripts/verify-naming.mjs` | 每次提交 |
| 快照回放 | `pnpm test:snapshot` | 合并前 |
| 集成（headless） | `pnpm test:integration` | 合并前 |
| 浏览器 | `pnpm test:browser`（本地 fixture） | 合并前 |
| UI 视觉 | 截图对比（关键 4 屏） | 合并前 |
| 上游 sync | `node scripts/sync-upstream.mjs --check` | 每周定时 |
| 安全 | `pnpm test:security`（注入/穿越/沙箱） | 合并前 + 每周 |

---

## 7. 可观测与运维

| 项 | 做法 |
|---|---|
| 崩溃 | dsh 的 `fatal`/`shutdown` 链路 + 我们的日志 |
| run 卡住 | `workflow/run-stalled` 事件 + 面板提示 |
| store 增长 | run 保留天数（默认 30），自动 `purge` 终态 |
| 只读放行误判 | 计数器 + 采样日志（命令 hash，不含原文） |
| Gen UI 滥用 | 每会话 artifact 数量/总大小上限 |

---

## 8. 已知风险登记

| ID | 风险 | 影响 | 缓解 | 状态 |
|---|---|---|---|---|
| R1 | dsh pre-stable 破坏性变更 | 高 | pin + 双周 sync + 快照 | 持续 |
| R2 | workflow 确定性做不到 | 高 | 限制 facade + 降级为"node 级 resume" | 设计期 |
| R3 | 浏览器打包体积 | 中 | 首启下载 + 可选 provider | 待验证 |
| R4 | CUA 平台限制 | 中 | v1 只支持 dsh 已有平台 | 已知 |
| R5 | 技能与工具名漂移 | 中 | `verify-naming` + smoke | 持续 |
| R6 | Office 转换质量 | 中 | 复用 dsh office-to-pdf；回退下载 | 已知 |
| R7 | 设置页导航顺序不可插入 | 低 | 放末尾 | 已知 |
| R8 | 工具数过多导致上下文膨胀 | 中 | tool_search 延迟加载 | 设计已覆盖 |
| R9 | overlay 目录膨胀 | 中 | 阈值告警（>10 文件） | 持续 |
| R10 | 许可遗漏 | 中 | `gen-notice --check` + CI | 持续 |
