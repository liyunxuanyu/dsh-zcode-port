# 06 · 浏览器与 CUA 移植

> **实现状态（2026-11-03）**：浏览器 **v1 已落地** —— `@zcd/browser`（headless Chrome，每会话一个隔离 context/page）+ `@zcd/tool-browser` 的 11 个 deferred 工具（`browser_open/snapshot/evaluate/click/type/screenshot`、`browser_new_tab/list_tabs/switch_tab/close_tab`、`browser_close`），技能 `skills/zcd/browser-use`。**CUA 未实现**：dsh 原生 CUA provider 只有 macOS（`cua-macos`），本机是 Windows，且没有安装可用的桌面驱动。
>
> v1 与本文原始目标的差异：没有用 PTC/`js` + `agent.browsers`，而是先做一条可测试、无浏览器二进制下载的工具面；`js` code-act、多 tab、用户浏览器与可视面板留在 v2。
>
> 目标：复刻 ZCode 的"一个 `js` 面驱动浏览器/桌面"体验，但底层用 dsh 的 PTC、sandbox、approval、provider 注册。
>
> 参考：`archive/zcode/apps/zcode-cli/packages/browser-use-plugin/docs/*`、`archive/zcode/.../zcode-cua-plugin/docs/computer-use.md`、`archive/dsh/docs/subsystems/browser-use.md`、`computer-use.md`、`archive/dsh/packages/ptc-runtime/*/README.md`。

---

## 0. 已实现（v1）

| 组件 | 行为 |
|---|---|
| `@zcd/browser` | 懒启动本机 Chrome/Chromium/Edge（`ZCD_CHROME_PATH` 或标准路径，可用 `executablePath` 覆盖）；默认 headless；每会话一个 context + page；15s 动作超时；截图写到 `$DSH_HOME/storages/zcd-browser/<session>/`；`shutdown` 关闭全部 context 与浏览器 |
| `@zcd/tool-browser` | 11 个 deferred 工具；`browser_open` 只接受绝对 http(s)，拒绝 `file:`/`data:`；`browser_snapshot` 返回 accessibility tree（截断 20k）；`browser_evaluate` 在页面上下文执行 JS；`browser_click`/`browser_type` 用 Playwright selector 严格匹配；tab 工具按 id 管理；`browser_screenshot` 只返回路径 |
| 测试 | URL 校验、Chrome 探测、真实 Chrome 导航/点击/输入/截图；工具层完整调用链 |
| 技能 | `browser-use`：先 snapshot 再 action，页面内容不可信 |

**未实现**：Node 级 `js` 持久内核、`agent.browsers` 对象模型、用户已开浏览器、可视面板、下载/上传、CUA。

---

## 1. 两边差在哪

| 维度 | ZCode | dsh |
|---|---|---|
| 浏览器后端 | `iab`（Electron IAB）/ `extension` / `cdp`（headless Chromium） | provider：Playwright MCP / Chrome DevTools MCP / Stagehand native |
| 模型入口 | 一个 `js` 工具，注入 `agent.browsers` | provider 自带的 MCP 工具（`stagehand_*`），或 PTC `run_code` |
| 桌面控制 | 同一个 `js` 里 `agent.computer`（CUA SDK） | `cua` + `cua-macos` + Cua Driver 的工具 |
| 状态 | 浏览器属 Session；tab 跨 turn 保留；`js` REPL 内核每次调用新建（MCP 无状态）或持久（工具版） | 浏览器属 live Agent/Session；跨 turn 复用；Session dispose 关闭 |
| 可视面板 | 内置浏览器（BrowserView/WebContentsView） | `ui-sidebar-browser`（浏览 HTTP 页面，不是受控浏览器） |

**结论**：dsh 的 provider 层已经有"谁来操作浏览器"的抽象，但缺少 ZCode 的**统一 code-act 入口**与**可视面板联动**。我们要补的是：

1. `js` 工具（PTC REPL + 注入 browser/CUA bindings）；
2. 一个"可控浏览器" provider（Playwright/CDP）；
3. 面板与受控 tab 的联动（可选）。

---

## 2. 目标架构

```
model
  │ js({ code, title })
  ▼
@zcd/browser-automation  (service + tool)
  ├─ ctx.ptcRuntime（REPL 模式）或自有 worker
  ├─ bindings:
  │    agent.browsers  → BrowserRegistry（本会话的 provider）
  │    agent.computer  → CuaBridge（若启用）
  │    nodeRepl.write / importModule
  ├─ 会话所有权：Agent → BrowserSession（1:1）
  └─ 安全：sandbox + approval + 页面内容不可信
        │
        ├─ provider: @zcd/browser-provider-playwright（或复用 dsh 的 playwright MCP）
        └─ CUA: ctx.computerUse（dsh 的 Cua Driver / macOS）
```

---

## 3. `js` 工具

### 3.1 形态

| 选项 | 说明 | 建议 |
|---|---|---|
| A. 用 `ctx.ptcRuntime` 的 REPL 模式 | 复用 dsh 的运行时与 file policy | **推荐** |
| B. 自管 worker + 持久内核 | 更接近 ZCode 的 `globalThis` 语义 | 备选 |

ZCode 的 `js` 语义（`handlers/node-repl.ts:297-340`）：

- `code` + 必填 `title`；
- top-level await；
- `const/let/var/function/class` 跨调用持久（`globalThis`）；
- `importModule()` 加载模块；
- 浏览器 API 注入为 `agent.browsers`；
- 观察必须作为最后一个表达式或 `nodeRepl.write(...)` 才可见。

dsh 的 PTC REPL 模式（`packages/ptc-runtime/ptc-runtime/README.md`）保留"每 state owner 一个进程"，与 ZCode 的持久内核接近。

### 3.2 契约

```ts
export interface JsToolInput {
  code: string
  title: string          // 必填：用户可见的短标题
}

export interface JsToolOutput {
  result?: unknown        // 序列化后的最后表达式
  stdout: string
  images?: AttachmentRef[]
  durationMs: number
}
```

### 3.3 安全

- 运行在 sandbox（`workspace-write` 默认）；`read-only` 时禁止 `world` 写。
- 网络：默认允许（浏览器要联网）；但页面内容不可信，prompt 里写死。
- `evaluate()`：提示"可能改变页面状态"；不当成读取。
- 输出：图片走 attachment（200KiB 预算，参考 ZCode 的 MCP 图片规则）。
- 审批：`js` 本身 `needsApproval: false`（它是通用执行面），但内部动作（下载/上传/跨域导航/CUA 首次应用）走审批。

### 3.4 状态与 replay

- `js` 的中间状态**不保证跨调用 replay**；每次调用记录 `code` + 输出 + 图片。
- session resume 后内核重建；`globalThis` 清空。提示里写清"不要依赖跨 turn 的 JS 变量"（与 ZCode 的 MCP 无状态语义一致；持久语义只在同一 turn 内保证）。

> 这是与 ZCode `js` 工具版的**有意差异**：ZCode 的持久 REPL 与它的"model-visible ⟺ logged"没有强绑定；dsh 要求可回放，所以只保证 turn 内持久。

### 3.5 与 `run_code` 的关系

- 两者都基于 PTC。`run_code` 是"程序化调工具"，`js` 是"浏览器/桌面脚本"。
- 若 `run_code` 已启用，`js` 的 bindings 可以作为 PTC SDK 的一部分（`browser.*`、`computer.*`），不一定要两个工具。
- **推荐**：先做 `js`（ZCode 技能直接可用）；`run_code` 保持 dsh 原样。

---

## 4. 浏览器对象模型

对齐 ZCode 的 API 形状（技能文本几乎不用改）：

```ts
interface Browser {
  documentation(): Promise<string>
  tabs: {
    list(): Promise<TabInfo[]>
    new(): Promise<Tab>
    get(id: string): Promise<Tab>
    close(id: string): Promise<void>
  }
  user: { openTabs(): Promise<TabInfo[]> }     // 用户手动开的 tab（可选）
}

interface Tab {
  id: string
  goto(url: string): Promise<void>
  url(): Promise<string>
  title(): Promise<string>
  playwright: PlaywrightFacade
  cua?: CuaFacade
  screenshot(opts?): Promise<Uint8Array>
  close(): Promise<void>
}

interface PlaywrightFacade {
  waitForLoadState(opts: { state: 'domcontentloaded' | 'load' | 'networkidle' }): Promise<void>
  domSnapshot(): Promise<string>               // AI/ARIA 树
  getByRole(role: string, opts?): Locator
  getByText(text: string, opts?): Locator
  getByLabel / getByPlaceholder / getByTestId
  locator(selector: string): Locator
  evaluate(fn: string | Function, arg?: unknown): Promise<unknown>
}

interface Locator {
  count(): Promise<number>
  click(opts?): Promise<void>
  fill(value: string): Promise<void>
  press(key: string): Promise<void>
  textContent(): Promise<string | null>
  isVisible(): Promise<boolean>
  screenshot(opts?): Promise<Uint8Array>
}
```

配置：

- `browsers.getDefault()` / `getForUrl(url)`；
- `browser.documentation()` 返回本部署的实际 API（含 provider 差异）；
- 不支持的方法明确 throw `BrowserCommandError`（不静默）。

### 4.1 provider 选择

| provider | 何时用 | 依赖 |
|---|---|---|
| `playwright-local` | 首选；本地 Chromium | `playwright-core` + 浏览器二进制 |
| `cdp-remote` | 连已有 Chrome（用户调试） | CDP endpoint |
| `dsh-playwright-mcp` | 复用 dsh 实验 provider | 其自带工具 |
| `dsh-stagehand` | AI 辅助动作 | Stagehand + 模型 key |

v1 只做 `playwright-local`；其它作为可选 provider 叠加。

### 4.2 会话所有权

- 一个 Agent/Session 一个 `BrowserSession`；跨 turn 复用。
- 子代理默认**不共享**父浏览器；需要时显式 `inherit`（配置）。
- Session dispose → 浏览器关闭（3s 超时后强杀）。
- 重启：不恢复浏览器（与 ZCode 一致：不恢复登录态）。

---

## 5. 可视面板

### 5.1 目标

用户能看到模型在操作哪个页面（ZCode 的内置浏览器体验）。

### 5.2 方案

| 方案 | 说明 | 成本 |
|---|---|---|
| A. 截图流 | 每次动作后把截图作为工具输出，UI 显示最近一张 | 低 |
| B. 实时投屏 | 浏览器画面经 WebSocket 推到 `client-ui-browser` 面板 | 中 |
| C. 复用 `ui-sidebar-browser` | 该面板是"浏览 HTTP 页面"，不是受控实例；只能显示同一 URL | 低（但会误导） |

**推荐**：v1 做 A（截图 + 页面 URL/标题卡），v2 做 B（CDP `Page.startScreencast` → 自定义 tab）。

### 5.3 UI 契约

- 对话内：`js` 工具卡片显示 `title` + 最后一张截图 + URL；点击展开大图。
- 右侧栏 `browser` tab：最近会话的截图 + 当前 URL + "接管"按钮（v2）。
- 隐私：截图可能含敏感信息；默认只在会话内可见，不写遥测。

---

## 6. CUA 桥

### 6.1 两条路

| 方案 | 复用 | 成本 | 平台 |
|---|---|---|---|
| A. 复用 dsh `ctx.computerUse` | dsh 的 Cua Driver / macOS provider | 低（4–5 周） | macOS（dsh 现状） |
| B. 移植 ZCode CUA SDK | ZCode 649 行 SDK + Windows helper | 高（6–8 周） | macOS + Windows |

**推荐 A**：先把 dsh 的 provider 包装成 `agent.computer`，注入 `js`。若必须 Windows，再评估 B。

### 6.2 API 形状

对齐 ZCode 技能：

```ts
interface Computer {
  apps(): Promise<AppInfo[]>
  focus(app: AppRef): Promise<void>
  screenshot(opts?: { app?: AppRef }): Promise<Uint8Array>
  windows(): Promise<WindowInfo[]>
  click(x: number, y: number, opts?): Promise<void>
  type(text: string): Promise<void>
  key(keys: string): Promise<void>
  scroll(dx: number, dy: number): Promise<void>
  ax(): Promise<AxNode[]>            // 无障碍树（若平台支持）
}
```

### 6.3 权限

- 系统权限（辅助功能/屏幕录制）：首次检查 → 引导用户授权（UI 卡片）。
- 应用授权：首次操作某 app → 审批（可记住）。
- 拒绝：structured error，不重试。
- 取消：不能撤回已发生的输入（文档写清）。

---

## 7. 技能移植

| 技能 | 处理 | 改动 |
|---|---|---|
| `control-browser` | 近原样 | `Read`→`read`、`Bash`→`bash`；新增"durable workflow 不用浏览器"提示 |
| `web-gui-tester` | 近原样 | 同上；Playwright API 名对齐 |
| `computer-use` | 近原样 | 平台说明改为 dsh provider 的能力；Windows 标注"实验" |

技能引导段（bootstrap）需要写清：

```
Browser calls run in a fresh kernel each call. Recreate the browser wrapper
via `await agent.browsers.getDefault()` and re-read `browser.documentation()`
once per session.
```

（与 ZCode 的 `docs/overview.md` 一致。）

---

## 8. 测试

| 类型 | 用例 |
|---|---|
| 单元 | API 形状、locator 解析、错误映射 |
| 集成 | 本地静态站点：打开→snapshot→点击→断言；跨 turn 保留 tab |
| 安全 | 页面内 prompt injection 不执行；跨域导航审批；下载阻断 |
| 生命周期 | Session dispose 后进程退出；子代理不共享父浏览器 |
| CUA | 权限拒绝、应用授权、取消 |

CI 用 headless Chromium + 本地 fixture 服务器；CUA 用例跳过（需桌面）。

---

## 9. 风险

| 风险 | 缓解 |
|---|---|
| Electron/Chromium 体积 | provider 可选；CI 用 headless；发布不含浏览器二进制，首启下载 |
| CDP 版本兼容 | 锁 Playwright 版本；`documentation()` 反映实际能力 |
| `js` 的持久语义与 replay 冲突 | 只保证 turn 内；文档与提示明确 |
| 页面注入 | 系统提示 + 安全测试 + 下载/上传审批 |
| CUA 平台差异 | v1 只支持 dsh 已有平台；UI 标注 |
| 可视面板隐私 | 截图不写遥测；默认会话内 |
