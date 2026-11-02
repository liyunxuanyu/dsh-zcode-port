# Runtime manifest

This directory is the single source of truth for **what the product needs to run**
and **how a checkout becomes runnable without hunting for missing pieces**.

- `manifest.json` — pinned Node, pnpm, dsh, Cordis, required/optional system tools.
- `python-requirements.txt` — pinned Python dependencies for shipped MCP servers
  (empty until one is added; never leave it floating).
- `vendor/` — optional offline drop point for binaries or wheels. Nothing here
  is committed by default; each file must ship with a `.sha256` beside it.

## One command

```sh
node scripts/ensure-runtime.mjs
```

It checks the Node version, installs the exact dependency graph from
`pnpm-lock.yaml`, builds every package, and reports missing optional tools
(LibreOffice, ripgrep, Python) without failing the build.

## Why node_modules is not committed

`node_modules` is a build artifact. The reproducibility guarantee is the
lockfile plus the manifest: a fresh clone runs `pnpm install --frozen-lockfile`
and gets byte-identical package versions. Committing the tree would make the
repository hundreds of megabytes and impossible to review.

If you need a truly offline bundle, run `pnpm pack:product`; it produces a
tarball containing the built packages, the product profile, the skill library,
and this manifest. Unpack it and run `ensure-runtime.mjs` with
`ZCD_OFFLINE=1` to skip network resolution.

## System tools

| Tool | Needed for | If missing |
|---|---|---|
| `git` | workspace changes, worktrees | hard failure |
| `libreoffice` | Word/PowerPoint → PDF preview | viewer falls back to download |
| `rg` | optional host search | dsh's packaged ripgrep is used |
| `python` | experimental PTC Python / Python MCP | feature unavailable |
