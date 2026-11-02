---
name: diagnosing-plugins
description: Use when a DeepSeek Harness plugin is not listed, does not activate, or a row is ignored.
---

<!-- Rewritten for dsh from ZCode guide skills (Apache-2.0): apps/zcode-cli/packages/zcode-guide-plugin/skills -->

# Diagnosing plugins

## The composition model

`profile → bundles (ordered) → profile patch → home patch → --patch overlays`.
A patch replaces the targeted row's whole `config`; later layers win per row id.

## Checklist

1. `--dump-config` — is the row present? If not, the bundle that inserts it is missing or its patch path is wrong.
2. Is the row `disabled`? A later layer may have disabled it.
3. Startup log — `did not activate` lines name the plugin and the error. A schema error usually means an unsupported output/parameter shape.
4. Package resolution — the plugin must resolve from the dsh installation or the profile's `node_modules`.
5. Version gate — `engines.dsh` or a DSH peer dependency can block activation.

## Fix

- Add the plugin as a dependency of the profile, then `pnpm install` in the profile dir.
- Fix the schema first: dsh's value DSL rejects root-level `required` arrays and unknown keys.
- Do not edit upstream `packages/**`; express the change as a patch row in your own bundle.
