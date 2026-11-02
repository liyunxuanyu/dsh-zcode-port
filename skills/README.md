# Skill library

Skills are prompt-level capability packs: a directory with `SKILL.md` plus
optional references, scripts, and assets. dsh's filesystem provider discovers a
directory bundle only at the top level of a scanned root, so this repository
keeps categories (`skills/superpowers/<name>`) and `scripts/install-skills.mjs`
links each bundle into `$DSH_HOME/skills/<name>`.

## What is here

| Category | Source | Status |
|---|---|---|
| `superpowers/` (14) | ZCode `superpowers-plugin` (Apache-2.0) | Ported; tool names adapted to dsh (`subagent`, `todo_write`, `enter_plan_mode`, lowercase file/shell tools) |
| `dsh-guide/` (6) | ZCode `zcode-guide-plugin` (Apache-2.0) | Rewritten for dsh: profile/bundle/patch, MCP, hooks, skills, commands |
| `zcd/office-viewer` (1) | ZCode documents/spreadsheets/pdf/presentations viewer skills (Apache-2.0) | Rewritten for `read_document`/`search_document`/`open_document`/`show_in_viewer`/`get_view` |

Office authoring is **not** forked from ZCode: the profile mounts dsh's
`@deepseek-ai/dsh-skill-office` (7 skills: office router, docx, pptx, xlsx,
render, recalculate, export-pdf), and `zcd/office-viewer` covers viewing.

Planned categories (see `docs/08-skills-catalog.md`): browser (2),
computer-use (1), visualize (1), creators (2).

## Porting rules

1. Keep the frontmatter `name`/`description`; dsh requires both.
2. Adapt tool names to dsh's snake_case wire names. Do not add aliases.
3. Put the attribution comment immediately **after** the frontmatter:
   `<!-- Ported from ZCode (Apache-2.0): <path> -->`.
4. Do not copy TypeScript source; skills are content only.
5. Add a smoke case: the skill must be discoverable by `skill` and its
   referenced tools must pass `scripts/verify-naming.mjs`.

## Install

```sh
node scripts/install-skills.mjs
# or as part of the profile:
node scripts/link-profile.mjs
```

The script is idempotent. It refuses to overwrite an existing non-link entry,
so a user's own skill with the same name always wins.

## Attribution

Ported skills remain under the Apache License 2.0; see `NOTICE` and
`archive/zcode/LICENSE`.
