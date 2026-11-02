---
name: diagnosing-hooks
description: Use when a DeepSeek Harness hook does not fire, fires twice, or is blocked by trust.
---

<!-- Rewritten for dsh from ZCode guide skills (Apache-2.0): apps/zcode-cli/packages/zcode-guide-plugin/skills -->

# Diagnosing hooks

## Inputs

- `hook-protocol` owns the wire format, matcher, multi-hook merge, and `hook/*` events.
- `hooks-claude-code` / `hooks-codex` bridge external hook configs onto dsh events.
- Project hooks pass a trust review before execution; an untrusted workspace blocks them.

## Checklist

1. Is the bridge plugin in the profile? `--dump-config` and look for `hooks-claude-code`.
2. Does the matcher actually match the tool name? Matchers are exact or documented patterns, not glob guesses.
3. Did the hook exit non-zero? A failing hook is reported, not silently ignored.
4. Is the workspace trusted? Check the Hooks settings page and the trust records.
5. Did you edit config mid-session? Hook config is captured at session start; start a new session.

## Fix

- Put project hooks under the workspace convention the bridge scans.
- Use `process` (argv) when you do not need a shell; `command` only for Claude-compatible shell hooks.
- Re-test with a hook that writes one line to stderr; absence of the `hook/invoked` event means it never matched.
