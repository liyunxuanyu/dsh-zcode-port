# MCP runtime

Pinned local MCP servers for deployments that cannot use `npx` at runtime.

```sh
node scripts/install-mcp.mjs
```

This installs the pinned server package under `runtime/mcp/node_modules`. Then a
profile row can run the local entry instead of downloading on first use:

```yaml
- id: mcp-everything
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: everything
    transport: stdio
    command: node
    args:
      - ./runtime/mcp/node_modules/@modelcontextprotocol/server-everything/dist/index.js
```

The example server is a protocol smoke target, not a product capability. Add the
servers you actually ship here and keep every version exact; `pnpm-lock.yaml` in
this directory is the reproducibility anchor.
