---
name: diagnosing-mcp
description: Use when an MCP server will not connect, exposes no tools, or its tools fail.
---

<!-- Rewritten for dsh from ZCode guide skills (Apache-2.0): apps/zcode-cli/packages/zcode-guide-plugin/skills -->

# Diagnosing MCP

## Checklist

1. `--dump-config`: the `mcp` row exists and the server entry is not disabled.
2. Transport matches the server: `stdio` needs a command that starts; `http` needs a reachable URL.
3. Credentials: a missing env var usually surfaces as a connection failure, not a tool error.
4. Tools list: a connected server with zero tools is a server-side configuration problem.
5. Large outputs: image results over the budget are externalized; a missing artifact store degrades to text.

## Reading failures

- Startup failures include stderr from the child; read it before changing config.
- A tool call failure is a normal tool result; inspect the `tool/result` error, not the connection.
- Resources are addressed per server; a resource call from another session is rejected by design.

## Fix

- Prefer a pinned package version in the MCP command.
- Keep secrets in the credential store or environment, never in `cordis.patch.yml`.
- Restart the profile after changing a stdio server's command.
