# 12 · 运行时与打包

> 目标：新机器 `git clone` 后一条命令进入可运行状态；不需要用户手动找 Node、pnpm、dsh、插件依赖或技能资源。
>
> 实现：`runtime/manifest.json` + `scripts/ensure-runtime.mjs` + `pnpm-lock.yaml` + `scripts/pack-product.mjs`。

---

## 1. 什么进仓库，什么不进

| 内容 | 进仓库 | 原因 |
|---|---|---|
| 源码、`SKILL.md`、MCP 配置 | 是 | 可审、可 diff |
| `pnpm-lock.yaml` | 是 | 精确版本，是可复现性的锚点 |
| `runtime/manifest.json` | 是 | Node/pnpm/dsh/Cordis 与系统工具的唯一事实 |
| `runtime/python-requirements.txt` | 是 | Python MCP/PTC 的锁定入口（当前为空，禁止浮动） |
| `runtime/vendor/` | 按需 | 离线二进制/whl 的投放点，必须带 `.sha256` |
| `node_modules/` | **否** | 构建产物；提交会让仓库数百 MB 且不可审 |
| `lib/`（构建输出） | **否**（`dist` 打包时包含） | 源码即可重建 |
| `upstream/dsh/` | **否** | 由 `scripts/sync-upstream.mjs` 按 pin 拉取 |
| `.dsh-home/` | **否** | 本机运行态，含凭据与会话 |

## 2. 一键启动

```sh
# 1) 依赖 + 构建 + 系统工具检查
node scripts/ensure-runtime.mjs

# 2) 把 profiles/product 物化到 $DSH_HOME/profiles/product
node scripts/link-profile.mjs

# 3) 冒烟：启动 Web，确认所有插件激活
node scripts/smoke-profile.mjs

# 4) 正常使用
DSH_HOME=./.dsh-home npx @deepseek-ai/dsh@0.2.2-alpha.2 --profile product
```

`ensure-runtime.mjs` 的行为：

- Node < 24.9 → 失败并给出版本文件；`ZCD_ALLOW_NODE22=1` 只用于 typecheck。
- `pnpm install --frozen-lockfile`（已安装则跳过）。
- `pnpm build`。
- 必装工具（git）缺失 → 退出码 1；可选工具（LibreOffice/rg/python）只报告。

## 3. 为什么依赖能“打包”

`pnpm-lock.yaml` 固定了 779 个解析结果（含 dsh 0.2.2-alpha.2 与 Cordis 4.0.6-alpha.1）。
`scripts/pack-product.mjs` 产出 `dist/zcd-product-<version>.tgz`（离线包用 `ZCD_PACK_NODE_MODULES=1`，产物带 `-offline` 后缀并包含 `node_modules`），包含：

```
packages/        # 源码 + 构建后的 lib
profiles/        # 产品 profile
skills/          # 技能库（若存在）
runtime/         # manifest + vendor 投放点
scripts/         # ensure-runtime / link-profile / smoke
docs/            # 架构与状态
package.json / pnpm-lock.yaml / pnpm-workspace.yaml / tsconfig.base.json
```

解包后 `node scripts/ensure-runtime.mjs` 即可恢复依赖；`ZCD_OFFLINE=1` 时要求
`node_modules` 已随离线包提供（`runtime/vendor` 放 tarball 或直接打包 `node_modules`）。

## 4. 系统工具

| 工具 | 必要性 | 缺失时 |
|---|---|---|
| `git` | 必需 | `ensure-runtime` 失败 |
| `libreoffice` | 可选 | 文档查看器回退为下载/系统打开 |
| `rg` | 可选 | dsh 的 `glob`/`grep` 用自带 ripgrep |
| `python` | 可选 | PTC Python / Python MCP 不可用 |

## 5. 接入外部 dsh 插件

产品 profile 的 bundles 顺序是：

```
@deepseek-ai/dsh-base
@zcd/bundle-base
@deepseek-ai/dsh-web-app
@zcd/bundle-web-app
```

接入外部插件**不需要改我们的包**：

1. `dsh plugin --profile product add <npm-package>`（或 `plugin_manager` 工具）；
2. 插件写入 profile 的 `cordis.patch.yml` / bundle 列表；
3. 我们的 bundle 只按 id 定位自己的行，不覆盖别人的行。

约束：

- 不注册与 dsh 同名的工具（`verify-naming.mjs` 会拦）。
- 不改 `dsh-base` / `dsh-web-app` 的行；需要改时在自己的 bundle 里用同一 id 覆盖并写理由。
- 外部插件若声明 `engines.dsh`，pin 的 dsh 版本必须满足。

## 5.5 接入外部插件前的 doctor

```sh
pnpm doctor
```

`scripts/doctor-plugins.mjs` 在启动前检查：

- profile 声明的依赖是否真的安装在 profile 的 `node_modules`；
- 每个包的 `engines.dsh` 是否接受 pin 的 dsh 版本；
- 同名包是否解析到两个版本；
- bundle 列表里的包是否存在、是否声明 `dsh.bundle.patch`。

它不联网、不依赖第三方库；CI 在 `link-profile` 之前运行它。发现硬冲突时退出码 1，警告只打印不阻塞。

## 5.6 MCP runtime

`runtime/mcp/` pins the MCP servers this product ships or tests with.

```sh
node scripts/install-mcp.mjs   # pnpm install in runtime/mcp, outside the workspace
```

The profile patch contains a commented `@deepseek-ai/dsh-mcp-client` example.
Enable it after installing the runtime, or point `command` at your own server.
`runtime/mcp/pnpm-lock.yaml` is committed; `node_modules` is not.

## 6. 故障排查

| 现象 | 原因 | 处理 |
|---|---|---|
| `Cannot find module '@zcd/...'` | 未 `link-profile` 或未 build | `pnpm build && node scripts/link-profile.mjs` |
| `did not activate` + `JsonSchemaError` | output schema 用了 dsh 不支持的根级 `required` | 改成逐属性 `required: true` |
| `EADDRINUSE` | 3080 被占用 | `--port 0` 或指定端口 |
| `401` 打开页面 | token 走 cookie 跳转 | 用日志里的完整 URL；`smoke-profile` 接受 303 |
| 插件版本不兼容 | dsh `engines.dsh` 不匹配 | `dsh plugin allow-version`（需显式确认） |
