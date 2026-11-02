---
name: diagnosing-skills
description: Use when a skill is not discovered, does not load, or the model never invokes it.
---

<!-- Rewritten for dsh from ZCode guide skills (Apache-2.0): apps/zcode-cli/packages/zcode-guide-plugin/skills -->

# Diagnosing skills

## Discovery roots (rank order)

1. `<project>/.dsh/skills` (100)
2. `<project>/.agents/skills` (200)
3. `customSkillDirs` (300)
4. `$DSH_HOME/skills` (400)
5. `~/.agents/skills` (500)
6. `bundledSkillDir` (600)

Only a top-level directory bundle `<name>/SKILL.md` (or flat `<name>.md`) is discovered; nested `**/SKILL.md` is not.

## Checklist

1. Frontmatter has non-empty `name` and `description`.
2. The bundle is at the top level of a scanned root; this repo installs links into `$DSH_HOME/skills`.
3. `disable-model-invocation: true` hides it from the model catalog on purpose.
4. The name is unique in its layer; a nearer layer's duplicate wins.
5. The body references tools that exist (run `node scripts/verify-naming.mjs` in this repo).

## Fix

- Run `node scripts/install-skills.mjs` after adding a category.
- Keep the attribution comment after the frontmatter, not before it.
- Re-read the skill after editing: bodies are re-read on every load.
