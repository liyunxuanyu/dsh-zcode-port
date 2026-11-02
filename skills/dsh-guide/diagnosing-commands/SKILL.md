---
name: diagnosing-commands
description: Use when a slash command is missing, does nothing, or is shadowed in DeepSeek Harness.
---

<!-- Rewritten for dsh from ZCode guide skills (Apache-2.0): apps/zcode-cli/packages/zcode-guide-plugin/skills -->

# Diagnosing commands

## Check the composition first

1. `dsh --profile <name> --dump-config` — confirm the command's plugin row is present and not `disabled`.
2. `dsh --profile <name> --help` — app-level flags are not slash commands.
3. In a session, ask for the command list; the client renders it from `ctx.commands`.

## Common causes

- The owning plugin is not mounted (the profile/bundle patch is missing a row).
- The row is disabled by a later patch layer; the last write wins per row id.
- Two plugins register the same command name; the nearest scope wins.
- The command requires an argument or attachment capability it did not declare.

## Fix

- Add or re-enable the row in `profiles/<name>/cordis.patch.yml`, not in `packages/**`.
- Re-run `node scripts/link-profile.mjs` if the profile lives outside the repo.
- Re-run `--dump-config` and confirm the row's `name` and `config` are what you expect.
