---
name: skill-creator
description: Use when creating a new dsh skill, editing an existing SKILL.md, or improving a skill description so the model loads it at the right time. Covers frontmatter, discovery roots, naming gates, and test prompts.
---

<!-- Rewritten for dsh from the ZCode skill-creator skill (Apache-2.0). -->

# Creating skills

A dsh skill is a directory with `SKILL.md` (or a flat `<name>.md`). The model
sees the frontmatter summary in its catalog and loads the body on demand with
the `skill` tool.

## Frontmatter

```markdown
---
name: kebab-case-name
description: Use when ... . One or two sentences with the concrete trigger.
---
```

- `name` is required, unique in its layer, and kebab-case. Duplicate names in
  one layer are rejected; a nearer discovery root wins over a farther one.
- `description` is required and non-empty. Write it as a trigger, not a topic
  list: "Use when the user wants to compare two API responses", not "API
  comparison". Keep it under ~300 characters.
- `disable-model-invocation: true` hides the skill from the model catalog while
  leaving it loadable by an explicit user invocation.
- Put attribution immediately **after** the frontmatter, never before it.

## Discovery roots

1. `<project>/.dsh/skills`
2. `<project>/.agents/skills`
3. configured `customSkillDirs`
4. `$DSH_HOME/skills`
5. `~/.agents/skills`
6. bundled assets

Only a top-level directory bundle (`<name>/SKILL.md`) or a flat `<name>.md` is
discovered; nested `**/SKILL.md` is not. In this repository, keep categories
under `skills/<category>/<name>/` and run `node scripts/install-skills.mjs`,
which links each bundle into `$DSH_HOME/skills`.

## Body

- State the outcome and the first action. Do not restate the description.
- Name tools exactly as they are registered (`read_document`, `workflow_run`).
  Do not invent aliases; `scripts/verify-naming.mjs` fails on unregistered
  ZCode-style names.
- Prefer a short workflow with concrete calls over a long feature list.
- Include the failure mode that matters (empty result, missing dependency,
  selector ambiguity) and what to do instead.
- Do not paste whole manuals. Put long references in sibling files and link
  them with relative paths.

## Verify

1. `node scripts/verify-naming.mjs` — every referenced tool exists.
2. `node scripts/install-skills.mjs` — the bundle is linked at the top level.
3. Write one trigger prompt and one non-trigger prompt; confirm the model loads
   the skill only for the first.
4. Re-read the body after editing: bodies are read fresh on every load, while
   the catalog summary may be cached until the registry invalidates.

## Common failures

| Symptom | Cause |
|---|---|
| Skill not listed | Bundle is nested below the root, or frontmatter is malformed |
| Listed but never loaded | Description describes a topic instead of a trigger |
| Loaded for the wrong task | Description is too broad; add the negative boundary |
| Name collision | Another root already defines the same `name`; a nearer layer wins |
| Tool call fails after load | Body references a tool that is not registered or is deferred and not loaded |
