# 07 · UI：Gen UI / Office / 设置页

> **实现状态（2026-11-03）**：`visualize` 工具 + `/zcd/genui` 沙箱路由已落地；`read_document` / `search_document` 已支持 text/docx/xlsx/pdf 并输出位置锚点。Gen UI 卡片、文档卡、workflow 实时卡片已实现（手写 lazy-CJS）；文档卡用 `openFile` 打开内置预览，workflow 卡片轮询 `/zcd/workflow/runs/<id>` 并可 `POST .../cancel`。`open_document` / `show_in_viewer` 已实现（文本 `#l:n` 可定位行，其他格式打开文件）；右侧栏 `Workflows` run 面板已实现并通过视觉验收（[截图](assets/workflow-panel.png)），点击 run 可展开节点。`get_view` 已实现（会话级最近打开文档）；设置页写入仍待做。只读 ZCD 设置页已通过真实浏览器视觉验收（[截图](assets/zcd-settings.png)）。

> 目标：在 dsh Web 客户端上，用 client 插件补齐 ZCode 的三类 UI 体验，不重建组件库。
>
> 关键发现：dsh 已经内置 **Office/PDF/HTML 文档预览**（`ui-sidebar-documentpreview`：Word/PowerPoint 本地转 PDF，表格在浏览器打开），所以 Office **查看器**不是从零做；缺的是**模型可调用的文档工具**（`open_document`/`read_document`/`search_document`/`show_in_viewer`）与 ZCode 的定位锚点语义。

---

## 1. Gen UI（inline 可交互页面）

### 1.1 形态选择

| 方案 | 说明 | 取舍 |
|---|---|---|
| A. 解析助手文本里的 `::visualize{...}` | 与 ZCode 一致 | 需要改 markdown 渲染/消息投影，侵入性高 |
| B. `visualize` 工具 + 工具卡片渲染 | 用 dsh 的 `tool.call.toolview` keyed slot | **推荐**：零 markdown 侵入，工具结果即页面 |
| C. 附件 + 通用 HTML 预览 | 复用现有 HTML 预览 | 无内联卡片，体验差 |

选 B。模型写 HTML → `visualize` 工具落 artifact → 返回引用 → 客户端按工具名渲染 iframe。

### 1.2 工具契约

```ts
export interface VisualizeInput {
  html: string                 // 自包含 HTML（可引用内联 CSS/JS）
  title: string
  mode?: 'inline' | 'wide'
  height?: number              // 建议高度，240–10000
}

export interface VisualizeOutput {
  artifactId: string
  url: string                  // /zcd/genui/<session>/<artifact>
  title: string
  mode: 'inline' | 'wide'
  height: number
}
```

- 写入 `$DSH_HOME/artifacts/genui/<session>/<id>.html`（或 dsh attachment store）。
- 单文件 ≤ 2MB；禁止外链资源（CSP 只允许 inline/data）。
- 返回的 `url` 是**同源但沙箱**的路径；客户端用 `<iframe sandbox="allow-scripts">` 加载。

### 1.3 宿主路由

用 `dsh-host-webserver` 的 named route（`register(route)`，`kind: 'prefix'`）：

dsh 的 `ctx.webServer.register(route)` 接收 `{ kind: 'exact' | 'prefix', path, handler(req, res) }`（`packages/host/webserver/src/index.ts:48-60`），handler 直接持有 Node 的 `IncomingMessage`/`ServerResponse`：

```ts
ctx.webServer.register({
  kind: 'prefix',
  path: '/zcd/genui',
  handler: async (req, res) => {
    // 1) 解析 /zcd/genui/<sessionId>/<artifactId>
    // 2) 校验：当前 Peer 已认证、session 属于该 Peer、artifact 存在
    // 3) 返回 200 text/html + CSP（见下）；否则 404/403
    //    default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';
    //    img-src data: blob:; connect-src 'none'; frame-ancestors 'self'
  },
})
```

- 只允许当前已认证 Peer 访问自己的 session artifact。
- 不支持 range/目录遍历；路径规范化。
- 不提供任何 Host API；页面内不能调工具。

### 1.4 客户端卡片

```ts
ctx.slots.inject('tool.call.toolview', () =>
  ctx.slots.register({ name: 'tool.call.toolview', key: 'visualize' }, VisualizeCard))
```

`VisualizeCard`：

- `phase === 'result'` 时读 `output.url`，渲染 iframe；
- 高度：`min(max(output.height, 240), 10000)`；`mode: 'wide'` 撑满内容宽度；
- 加载失败/超时：显示"在新窗口打开"+ 错误；
- 复制图片：用 `html2canvas` 或宿主截图（v1 可只做"打开"）；
- 外链：页面内 `window.open` 被 CSP 阻止；提供 `postMessage({type:'open-external', href})`，客户端校验 `http(s)` + 用户手势后调用平台 opener；
- 不把页面状态写进模型上下文（v1）；需要时模型重新生成。

### 1.5 安全清单

- iframe `sandbox="allow-scripts"`（**不加** `allow-same-origin`）；
- CSP `default-src 'none'`；禁止 `connect-src`、`form-action`、`frame-src`；
- 页面不能读 cookie/localStorage（无 same-origin）；
- 不执行页面里的 `<script src>`（CSP）；
- 用户手势才允许外链；
- 生成内容做 HTML 白名单？不需要——沙箱已隔离；但要做大小/数量限制防 DoS。

### 1.6 验收

1. 助手消息出现可交互图；页面脚本不能访问父页面。
2. 外链点击被阻止/需手势；`javascript:` 拒绝。
3. 高度自适应；移动端全宽。
4. 会话重开后仍可渲染（artifact 持久化）。
5. 删除会话时 artifact 清理（或 TTL）。

---

## 2. Office：查看器已有，补"模型工具"

### 2.1 现状（dsh）

`ui-sidebar-documentpreview` 已支持：

- Markdown/代码（分页）、图片、PDF、HTML；
- Word/PowerPoint **本地转 PDF**；
- 表格在浏览器打开；
- 渲染器注册：`ctx.documentPreviews.register({ id, extensions, binaryExtensions, priority, title, loading, wrap })`（`archive/dsh/packages/client/ui-sidebar-documentpreview/README.md`）；
- 右侧栏 tab 类型：`ctx.sidebarRightTabs.register({ id, kind, patterns, ... })`。

所以 ZCode 的"查看器面板"大部分是 **S1**。

### 2.2 缺口：模型可调用的文档工具

ZCode 的 viewer 技能依赖 5 个工具：

| 工具 | 作用 | dsh 现状 |
|---|---|---|
| `open_document` | 在面板打开文件 | 无模型工具；只能用户点 |
| `show_in_viewer` | 定位到指定位置 | 无 |
| `read_document` | 读文本（带位置锚点） | 无（`read` 只能读原始文件） |
| `search_document` | 文档内搜索 | 无 |
| `get_view` | 读当前视图状态 | 无 |

**方案**：新增 `@zcd/tool-documents`（S2），提供这 5 个工具：

```ts
open_document({ path, pane?: 'right'|'left' })
read_document({ path, range?: { page?: number; paragraph?: number; sheet?: string; cells?: string } })
search_document({ path, query, limit? })
show_in_viewer({ path, anchor })     // anchor: '#p:12' | '#t:1/r3c2' | '#s:Sheet1!A1'
get_view({ path? })
```

- 通过 remote API 让 client 打开对应 tab（`ctx.sidebarRight.openTab`）。
- `read_document`：
  - docx：段落/表格 → 文本 + `#p:n` / `#t:r/c` 锚点；
  - xlsx：sheet + cell 地址 → 文本；
  - pptx：slide 序号；
  - pdf：页码。
  - 实现库：`mammoth`（docx）、`exceljs`（xlsx）、`pdfjs-dist`（pdf）、`pptx` 用 `jszip` + XML；或复用 `ctx.officeToPdf.convert()`（`packages/document/office-to-pdf/README.md:30`）再解析 PDF（保真但丢结构）。
- `search_document`：对提取文本做关键词/正则，返回锚点。
- `show_in_viewer`：把锚点转成 client 的 `resourceAddress` 导航（dsh 的 documentpreview 已有 `sourceLines` 锚点机制，可扩展）。

### 2.3 技能

移植 8 个 SKILL.md：

| 技能 | 改动 |
|---|---|
| `docx` / `pdf` / `pptx` / `xlsx` | `js` → dsh 的 `js`（WP-10）；`Read/Write/Edit` → 小写；`present` 保留（dsh 有） |
| `docx-viewer` / `pdf-viewer` / `pptx-viewer` / `xlsx-viewer` | `open_document` 等 5 个工具由 `@zcd/tool-documents` 提供；锚点语法保持 |

### 2.4 验收

1. 模型 `open_document` 后右侧栏打开对应文件。
2. `read_document` 返回带锚点的文本；`show_in_viewer` 能定位。
3. docx/xlsx/pptx/pdf 各有一个 smoke 用例。
4. 无 LibreOffice 时 docx/pptx 回退为"下载/系统打开"。

### 2.5 风险

- 文档解析质量（复杂表格、合并单元格、文本框）。
- 锚点与 dsh 预览器的导航契约需要扩展（`sourceLines` 目前是文本行）。
- 大文件内存；需要流式/分页。

---

## 3. 设置页

### 3.1 dsh 的扩展点（已确认）

| 扩展点 | 用途 |
|---|---|
| `settings.section` | 注册一个设置分区（页面） |
| `settings.plugins.tab` | Plugins 页内的 tab |
| `settings.onboarding` | onboarding 步骤 |
| `plugins.item` + `ctx.configForms.whileServed` | 插件详情里的配置卡 |
| `ctx.configForms.get(entryId)` | 读写某个 Host 插件的 Config |
| `ctx.slots.inject('settings.section', ...)` | 注册页面 |

来源：`archive/dsh/packages/client/ui-settings/README.md:28-64`、`docs/cookbook/adding-a-settings-card.md`。

### 3.2 ZCode IA → dsh 映射

| ZCode 导航 | dsh 落点 | 实现 |
|---|---|---|
| Memory | `settings.section` "Memory" | 读写 `@zcd/memory` Config + 条目管理 |
| 子智能体 | `settings.section` "Agents" | 读 preset 列表 + Markdown profile 管理（WP-07） |
| 插件 | 已有 Plugins 页 | 复用；加 ZCode 式 scope 选择器（v2） |
| MCP | 已有 MCP 设置 | 复用 |
| 技能 | 已有 Skills 设置 | 复用；加"导入 ZCode 技能"按钮 |
| 命令 | 已有 Commands | 复用 |
| Hooks | 已有 Hooks | 复用 |
| Tools | 新 "Tools" 分区 | 延迟加载清单、只读策略开关、工具搜索预算 |
| Workflow | 新 "Workflow" 分区 | run store 路径、并发默认、保留天数 |

### 3.3 实现

- 一个包 `@zcd/client-ui-settings-zcd`，注册 3–4 个 `settings.section`（Memory / Agents / Tools / Workflow），其余复用 dsh 已有页面。
- 每个 section 用 `ctx.configForms.get('<entry-id>')` 读写；不直接改文件。
- 表单复用 dsh 的 `SettingsForm`/`SettingsFormModel`（`ui-primitives`），不自建控件。
- 文案走 locale 字典（en/zh），不硬编码。

### 3.4 验收

1. 每个 section 能读/写，保存后下一个操作生效（volatile）。
2. 非法值被 Host 拒绝，UI 保留草稿并显示错误。
3. 390px 无横向溢出；键盘可达。
4. 不绕过 plugin_manager 的审批。

### 3.5 风险

- 设置导航顺序可能由 shell 固定；若不能插入到 ZCode 的位置，就放在末尾（可接受）。
- `configForms` 的 revision/CAS 需要正确处理，否则并发编辑丢写。

---

## 4. 视觉与交互

- 不移植 ZCode 的组件库；用 dsh 的 primitives + token。
- 需要"ZCode 手感"时，只改：间距、圆角、字号层级、工具卡信息密度。
- 三处重点：
  1. 工具卡（运行中/完成/失败）——ZCode 的信息密度更高；
  2. run 面板——节点树 + 状态色；
  3. 设置页——分区标题 + 说明 + 危险操作确认。
- 所有文案 en/zh 双语；中文用产品语气，不用直译。

---

## 5. 交付顺序

1. `tool-documents` + viewer 技能（不依赖 Gen UI）。
2. Gen UI（`visualize` + 卡片 + 路由）。
3. 设置页（依赖 memory/offpeak/workflow 的 Config）。
4. 视觉打磨（与前三项并行）。
