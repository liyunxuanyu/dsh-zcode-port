# 参考文档归档

本目录是二开项目的**只读参考基线**：从两个上游仓库复制了真正定义语义的规范与接口文档，避免上游重构后引用失效。

- 归档时间：2026-11-03
- 来源：
  - ZCode `D:\workspace\zcode workspace\ZCode-upstream`（Apache-2.0，见 `zcode/LICENSE`）
  - DeepSeek Harness `D:\workspace\zcode workspace\deepseek-harness`（MIT，见 `dsh/LICENSE`）
- 复制方式：保留原始相对路径；未做任何内容修改。
- 注意：归档是**快照**。上游更新后需重新同步，并在 `docs/09-compat-security-release.md` 的同步流程里执行。

---

## 1. ZCode（60 个文件）

### 1.1 架构与产品边界

| 本地路径 | 用途 | 对应工作包 |
|---|---|---|
| `zcode/docs/architecture/zcode-code-architecture-overview.md` | 三层进程模型、workspace identity、协议拓扑 | WP-01 |
| `zcode/docs/product-capability-map.md` | 能力群、状态所有权、套餐/用量边界 | WP-01 / WP-13 |
| `zcode/docs/zcode-protocol.md` | V4 conversation topic、snapshot/delta | WP-01 |
| `zcode/UI_PLUGIN.md` | MCP Apps / UI Plugin 契约 | WP-11 |

### 1.2 动态工作流（核心参考）

| 本地路径 | 用途 | 对应工作包 |
|---|---|---|
| `zcode/docs/dynamic-workflow.md` | 总览 | WP-07/08 |
| `zcode/docs/dynamic-workflow/authoring.md` | facade、skill gate、类型检查 | WP-07 |
| `zcode/docs/dynamic-workflow/concurrency.md` | 双层并发、governor、live retune | WP-07 |
| `zcode/docs/dynamic-workflow/launch.md` | 6 种启动面、确认、amend/resume | WP-08 |
| `zcode/docs/dynamic-workflow/presentation.md` | run 卡片/面板呈现 | WP-08 |
| `zcode/docs/dynamic-workflow/transcript-and-notifications.md` | 完成/提问通知 | WP-08 |

### 1.3 工具与运行时

| 本地路径 | 用途 | 对应工作包 |
|---|---|---|
| `zcode/docs/hooks-runtime-contract.md` | 7 事件、process/command、trust | WP-02 |
| `zcode/docs/mcp-dual-era-version-negotiation.md` | modern/legacy 协商 | WP-02 |
| `zcode/docs/mcp-tool-output-budget.md` | MCP 图片 200KiB 预算 | WP-02 |
| `zcode/docs/skills-product.md` | Skill scope、目录约定、激活 | WP-14 |
| `zcode/docs/plugins/workspace-level-plugin-architecture.md` | User/Workspace scope | WP-13（延后） |
| `zcode/docs/session-context-tool.md` | ReadSessionContext 语义 | WP-05 |
| `zcode/docs/plan-mode-*.md`（3 个） | plan mode 边界、状态、plan 文件连续性 | WP-02 |

### 1.4 浏览器 / CUA / Office / Gen UI

| 本地路径 | 用途 | 对应工作包 |
|---|---|---|
| `zcode/apps/zcode-cli/packages/browser-use-plugin/docs/*.md` | 浏览器对象模型、Playwright Tab API、安全、截图/录制 | WP-09 |
| `zcode/apps/zcode-cli/packages/browser-use-plugin/skills/control-browser/SKILL.md` | 浏览器控制技能原文 | WP-09 |
| `zcode/apps/zcode-cli/packages/browser-use-plugin/skills/web-gui-tester/SKILL.md` | Web GUI 测试技能原文 | WP-09 |
| `zcode/apps/zcode-cli/packages/zcode-cua-plugin/docs/computer-use.md` | CUA 运行时/权限 | WP-10 |
| `zcode/apps/zcode-cli/packages/zcode-cua-plugin/skills/computer-use/SKILL.md` | CUA 技能原文 | WP-10 |
| `zcode/apps/zcode-cli/packages/{documents,pdf,presentations,spreadsheets}-plugin/skills/**/SKILL.md` | 8 个 Office 生成/查看技能 | WP-12 |
| `zcode/packages/ui/src/gen-ui/CONTRACT.md` + `zcode/docs/specs/gen-ui-*.md` | inline 页面、尺寸、外链、模型上下文 | WP-11 |
| `zcode/apps/zcode-cli/packages/visualize-plugin/skills/visualize/SKILL.md` | Gen UI 作者技能 | WP-11 |

### 1.5 设置页（IA 参考）

`zcode/docs/settings-*.md` 共 10 个：command / hook / mcp / skill / subagent / directory-sources / list-create-actions / preview-updates-copy / storage-management / sync-provider-import。

> 这些是 ZCode 的设置页交互规范，不是 dsh 的 API；WP-13 只借鉴 IA 与文案结构，不复用组件。

### 1.6 暂不实施但归档

`zcode/docs/bots.md`、`zcode/docs/conversation-share-v1.md`：产品面能力（S4），当前版本不做，保留为后续决策依据。

---

## 2. dsh（38 个文件）

### 2.1 内核与扩展点

| 本地路径 | 用途 | 对应工作包 |
|---|---|---|
| `dsh/docs/architecture.md` | Cordis、profile/bundle、turn flow、session log、seams | 全部 |
| `dsh/docs/capability-seams.md` | 762 行能力 seam 图 | 全部 |
| `dsh/docs/tool-execution-pipeline.md` | pre/execute/post/result 管线 | WP-02/03 |
| `dsh/docs/agent-lifecycle.md` | turn/step 时序 | WP-07 |
| `dsh/AGENTS.md` | 仓库纪律、门禁、命名 | WP-01/09 |
| `dsh/packages/bundle/base/cordis.patch.yml` | 96 插件基线 | WP-01 |

### 2.2 能力 seam 与包契约

| 本地路径 | 用途 | 对应工作包 |
|---|---|---|
| `dsh/docs/subsystems/tools.md` | 工具注册/作用域/守卫 | WP-02/03 |
| `dsh/docs/subsystems/approval.md` | 审批策略、fail-closed | WP-02 |
| `dsh/docs/subsystems/compaction.md` | 压缩 | WP-03 |
| `dsh/docs/subsystems/session.md` | 会话日志/投影 | WP-07 |
| `dsh/docs/subsystems/skills.md` | skill provider 分层 | WP-14 |
| `dsh/docs/subsystems/workflow.md` | workflow seam 现状与边界 | WP-07 |
| `dsh/docs/subsystems/browser-use.md` | 浏览器 provider 只注册名字 | WP-09 |
| `dsh/docs/subsystems/computer-use.md` | CUA provider、macOS 限制 | WP-10 |
| `dsh/docs/subsystems/conversation.md` | Conversation Node 装配 | WP-11/13 |
| `dsh/docs/subsystems/client-modules.md` | 浏览器半包加载 | WP-11/13 |

### 2.3 开发指南

| 本地路径 | 用途 |
|---|---|
| `dsh/docs/cookbook/adding-a-tool.md` | 新工具的正确姿势（含 UI 呈现） |
| `dsh/docs/cookbook/adding-a-package.md` | 新包/包元数据 |
| `dsh/docs/cookbook/adding-a-settings-card.md` | 设置卡、client half、`plugins.detail.*` |
| `dsh/docs/cookbook/adding-a-plugin-preview.md` | 插件详情图 |
| `dsh/docs/cookbook/extension-cookbook.md` | 扩展点索引 |
| `dsh/docs/testing.md` | 100% 覆盖/快照回放 |

### 2.4 关键包 README

| 本地路径 | 用途 |
|---|---|
| `dsh/packages/workflow/workflow/README.md` | `WorkflowEngine` 契约、已知限制 |
| `dsh/packages/workflow/workflow-ptc/README.md` | PTC 引擎、VM、并发 |
| `dsh/packages/subagent/subagent/README.md` | provider seam、容量、消息 |
| `dsh/packages/extensions/README.md` + `cordis-host-runner/README.md` | 运行时自修改 |
| `dsh/packages/boot/plugin-manager/README.md` | 插件安装/审批 |
| `dsh/packages/client/ui-slots/README.md` | Slot/Factory/Store |
| `dsh/packages/client/ui-conversation/README.md` | Node Definition/View/Group |
| `dsh/packages/client/ui-sidebar-right/README.md` | 右侧栏 tab 注册 |
| `dsh/packages/client/ui-sidebar-browser/README.md` | 内置浏览器面板参考 |
| `dsh/packages/skill/skill/README.md` + `skill-office/README.md` | skill provider / Office 资产 |
| `dsh/packages/ptc-runtime/ptc-runtime/README.md` + `ptc-runtime-node/README.md` | PTC 运行时（`js` 工具底座） |
| `dsh/packages/interaction/user-approval/README.md` | 审批 seam |

---

## 3. 使用规则

1. **归档只读**：不要在 `archive/` 里改内容；需要补充时新增文件并更新本索引。
2. **引用格式**：架构文档引用归档时写 `archive/<repo>/<path>`；引用上游代码时写原仓库相对路径（`packages/...:line`）。
3. **许可证**：ZCode 文件按 Apache-2.0 使用，dsh 文件按 MIT 使用；移植技能文本时保留原许可头，并在产品 `NOTICE` 中列出。
4. **同步**：上游升级时，用 `scripts/sync-archive.mjs`（待建）重新复制并在 `docs/09-compat-security-release.md` 记录 diff。
