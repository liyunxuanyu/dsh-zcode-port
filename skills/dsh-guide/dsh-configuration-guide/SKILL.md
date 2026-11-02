---
name: dsh-configuration-guide
description: Use when configuring DeepSeek Harness profiles, bundles, models, permissions, or workspace preferences.
---

<!-- Rewritten for dsh from ZCode guide skills (Apache-2.0): apps/zcode-cli/packages/zcode-guide-plugin/skills -->

# dsh configuration guide

## Where configuration lives

- `$DSH_HOME/profiles/<name>/package.json` — `dsh.profile.bundles`, plugin dependencies.
- `$DSH_HOME/profiles/<name>/cordis.patch.yml` — the user's own layer (top-level YAML array).
- A bundle's `package.json` declares `dsh.bundle.patch` (one file or an ordered list).
- `--patch <file>` adds a launcher overlay after the profile layer.

## Precedence

`bundles in order → profile patch → home patch → --patch overlays`.
Within a preset, the same patch rules apply to `config.plugins`.
A patch replaces the whole `config` of the row it targets, so restate every field you need.

## Common tasks

- **Add a plugin**: add it to the profile's dependencies, `pnpm install` in the profile dir, insert a row or enable an existing one.
- **Change a model**: edit the `agent-default-model` row; the session can still override per agent.
- **Change permissions**: `sandbox-policy.mode` is the file policy; `approval` is the ask policy. Do not weaken both at once.
- **Project memory**: `<workspace>/.zcd/memory`; user memory: `~/.zcd/memory`.
- **Skills**: `$DSH_HOME/skills` or `<project>/.agents/skills`.

## Verify

`dsh --profile <name> --dump-config` and `node scripts/smoke-profile.mjs` (this repo).
Never edit upstream `packages/**`; express product differences in your own bundle.
