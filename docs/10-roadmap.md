# 10 · 路线图

> 阶段目标、依赖、人力、验收。人力为**单人周**，团队并行时按依赖压缩。
> 详细工作包见 `03-work-packages.md`。

---

## 0. 总览

| 阶段 | 目标 | WP | 人周 | 累计 | 产出 |
|---|---|---|---:|---:|---|
| **P0** | 证明"不改上游能跑" | 01 | 2–3 | 3 | 可启动的 product profile + CI |
| **P1** | ZCode 工具语义对齐 | 02, 03, 04, 05 | 10–14 | 17 | 工具/搜索/只读/闲时可用 |
| **P2** | 工作流与记忆 | 06, 07, 08, 09 | 20–25 | 42 | durable workflow + memory |
| **P3** | 浏览器与 CUA | 10, 11 | 11–15 | 57 | `js` + 浏览器 + 桌面 |
| **P4** | UI 体验 | 12, 13, 14 | 10–14 | 71 | Gen UI + Office + 设置页 |
| **P5** | 技能全量 | 15 | 3–4 | 75 | 39 个技能 |

**MVP 路径**（15–20 人周）：P0 + P1 + WP-13（文档工具，查看器已存在）+ WP-15 的 superpowers 部分。工作流引擎（WP-08/09）是最大单项，建议单独立项。

---

## 1. P0 · 地基（2–3 周）

**目标**：证明 overlay 可行。

| 里程碑 | 验收 |
|---|---|
| M0.1 upstream pin + workspace | `pnpm install` 成功；`upstream/` 只读 |
| M0.2 三个空壳包 + product profile | `dsh --profile product` 启动 Web |
| M0.3 CI（5 个 job） | 干净 clone 10 分钟内绿 |
| M0.4 `--dump-config` 快照 | 配置面可 diff |
| M0.5 命名/许可脚本 | `verify-naming` + `gen-notice --check` 可跑 |

**风险**：client half 的构建格式（lazy-CJS factory）需要复刻；若卡住，P0 延后 1 周。

**决策点**：若 P0 期间必须改 3 处以上上游代码 → 触发 ADR-01 复核（考虑 fork）。

---

## 2. P1 · 工具语义（10–14 周）

**目标**：让 ZCode 技能"改个名就能跑"。

| 里程碑 | 内容 | 周 | 验收 |
|---|---|---:|---|
| M1.1 | `todo_read`/`list_models`/`enter_plan_mode`/`schedule_delete|pause` | 2 | 单测 + dump-config |
| M1.2 | `tool_search` + 延迟加载 | 4 | 基础 schema ≤ 8k tokens |
| M1.3 | 只读 Bash 放行 + skill gate | 3 | 写命令仍审批；gate 生效 |
| M1.4 | OffPeak + Cron 对齐 | 4 | 空闲触发/接管/重启恢复 |
| M1.5 | superpowers 14 技能 | 1 | 技能可触发 |

**决策点**：tool_search 若使 step 延迟 > 100ms（100 工具）→ 改为 pre-step 一次性 resolve。

---

## 3. P2 · 工作流与记忆（20–25 周）

**目标**：最大差异化。

| 里程碑 | 内容 | 周 | 验收 |
|---|---|---:|---|
| M2.1 | `durableWorkflow` 契约 + store | 2 | 迁移/单测 |
| M2.2 | 单 node 执行 + worker RPC | 2 | `agent()` 跑通 |
| M2.3 | 状态机 + crash/resume | 4 | kill -9 后可继续 |
| M2.4 | 并发 + amend | 3 | live retune 不打断 |
| M2.5 | hole/question/submit | 3 | 留白补全/升级 |
| M2.6 | 12 个工具 + 通知 | 2 | 模型可编排 |
| M2.7 | run 面板 + 卡片 | 3 | UI 可观测 |
| M2.8 | memory + dream | 4 | 目录/工具/dream |
| M2.9 | Markdown profile + 子代理增强 | 3 | md → preset |

**决策点**：若 M2.3 的确定性 replay 无法在 4 周内达标 → 降级为"node 级 resume"（只跳过已完成 node，不保证脚本重新执行完全一致），并在文档/UI 明示。

---

## 4. P3 · 浏览器与 CUA（11–15 周）

| 里程碑 | 内容 | 周 | 验收 |
|---|---|---:|---|
| M3.1 | `js` 工具（PTC REPL） | 2 | 代码执行 + 输出 |
| M3.2 | `browserAutomation` + Playwright provider | 3 | 打开/快照/点击/截图 |
| M3.3 | 会话所有权 + 生命周期 | 1 | dispose 无孤儿 |
| M3.4 | 安全（下载/上传/跨域审批） | 1 | 注入测试通过 |
| M3.5 | 截图卡 + 面板（v1） | 2 | 用户可见 |
| M3.6 | CUA bridge（方案 A） | 3 | macOS 可用 |
| M3.7 | 3 个技能移植 | 1 | 技能可触发 |

**决策点**：若 Electron 打包体积不可接受 → 改为"首启下载 Chromium"或只支持外部 Chrome（CDP）。

---

## 5. P4 · UI（11–15 周）

| 里程碑 | 内容 | 周 | 验收 |
|---|---|---:|---|
| M4.1 | `tool-documents` 5 工具 | 2 | docx/xlsx/pptx/pdf 读写 |
| M4.2 | Office viewer 技能 8 个 | 1 | 打开/定位 |
| M4.3 | Gen UI：`visualize` + 路由 + 卡片 | 4 | 沙箱页面 |
| M4.4 | 设置页 4 个 section | 3 | 读写生效 |
| M4.5 | 视觉打磨（工具卡/run 面板） | 3 | 截图评审 |

---

## 6. P5 · 技能（3–4 周，可与 P2–P4 并行）

| 里程碑 | 内容 | 周 |
|---|---|---:|
| M5.1 | superpowers 14（已在 P1） | — |
| M5.2 | guide 6 个重写 | 1.5 |
| M5.3 | 创作类 3 个 | 0.5 |
| M5.4 | Office/浏览器/CUA 技能（随 P3/P4） | 1 |
| M5.5 | 技能回归 + 许可检查 | 1 |

---

## 7. 人员与并行

| 角色 | 人数 | 负责 |
|---|---:|---|
| 架构/后端 A | 1 | WP-01/03/04/08 |
| 后端 B | 1 | WP-05/06/07/09 |
| 前端 | 1 | WP-12/13/14 |
| 客户端/系统 | 1 | WP-10/11 |
| 内容/技能 | 0.5 | WP-15 |

4.5 人 × 16 周 ≈ 72 人周，与总估算一致。

**并行策略**：

- P1 的 4 个 WP 可并行（工具/搜索/策略/闲时互不依赖）。
- P2 的 workflow（A）与 memory/profile（B）并行。
- P3 依赖 P1（tool_search/sandbox）；P4 依赖 P2（设置页要 Config）。

**关键路径**：P0 → P1(M1.2 tool_search) → P2(M2.1–M2.7 workflow) → P4(M4.3 Gen UI)。约 **30 周**（单线），并行后 **16–18 周**。

---

## 8. 里程碑检查表（每个阶段结束）

- [ ] 上游 sync 一次并且绿
- [ ] `overlay/` 文件数 ≤ 10
- [ ] 安全不变量 S1–S10 全部有测试
- [ ] 工具命名/事件命名检查通过
- [ ] 快照回放通过
- [ ] 文档更新（含 upgrade guide）
- [ ] NOTICE 更新
- [ ] 至少 1 次端到端演示（录屏）

---

## 9. 明确不做的（避免范围蔓延）

| 项 | 原因 |
|---|---|
| bots / 分享 / 手机远控 / 计费 | 产品面，独立立项 |
| MCP Apps（UI Plugin） | v2；v1 用 Gen UI 覆盖 |
| Workspace 级插件 scope | 用 profile/preset 替代 |
| 原地 rewind | 用 fork 替代 |
| Android/iOS 模拟器 | 需设备桥 |
| ZCode Sites | 依赖后端服务 |
| 语义记忆检索（embedding） | dsh 无内建 embedding；v1 关键词 |
| Graph/可视化工作流编辑器 | v1 只读面板 |
