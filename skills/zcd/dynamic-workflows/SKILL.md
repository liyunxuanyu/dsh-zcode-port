---
name: dynamic-workflows
description: Use when authoring, resuming, or debugging a durable workflow script with workflow_run: choosing subagent topology, fan-out, holes, replay-safe node keys, and result reporting.
---

<!-- Rewritten for dsh from the ZCode dynamic-workflows skill (Apache-2.0):
     apps/zcode-cli/packages/zcode-cli/skills/dynamic-workflows (CreateWorkflow
     family). dsh replaces the tool facade with one script tool, workflow_run,
     and the sandbox API in docs/04-durable-workflow.md. -->

# Durable workflows

`workflow_run` executes a JavaScript body on the host. Every `agent(prompt)`
call becomes a durable node: if the run resumes, completed nodes return their
stored output instead of calling the model again. Use a workflow when work has
several independent subagent calls, an obvious phase boundary, or a question
that may need a human answer in the middle.

`workflow_run` is visible. The other workflow tools are deferred: load the one
you need with `tool_search` (`workflow_get_run`, `workflow_list_runs`,
`workflow_resume`, `workflow_cancel`, `workflow_amend`,
`workflow_answer_hole`).

## Script shape

```js
phase('collect')
const files = args.files

const summaries = await parallel(files, async (file) => {
  return await agent(`Summarize ${file} in three bullets.`, { key: `summary:${file}` })
}, { concurrency: 4 })

phase('synthesize')
const answer = await agent(
  `Combine these summaries into one brief:\n\n${summaries.join('\n\n')}`,
  { key: 'synthesis' },
)
report({ answer })
return answer
```

Sandbox:

| Name | Contract |
|---|---|
| `args` | JSON object passed to `workflow_run` |
| `agent(prompt, { key? })` | Run one subagent and return its final text. Without a key, identity is the call ordinal; with a key, identity is the key. |
| `parallel(items, fn, { concurrency? })` | Run `fn(item, index)` concurrently; default 4, max 16. |
| `pipeline(items, ...stages)` | Run each item through stages sequentially; returns one result per item. |
| `phase(name)` | Append a phase marker to the journal. |
| `log(message)` | Append a progress line. |
| `report(value)` | Append a structured report to the journal. |
| `hole(prompt)` | Pause and ask the user; after `workflow_answer_hole`, replay returns the answer. |
| `console.log` | Alias of `log`. |

Return a JSON-serializable value; it becomes the run result.

## Replay rules

- A node is identified by `(scriptHash, ordinal-or-key, prompt)`. Keep prompts
  deterministic from `args` and prior node outputs. Never build a prompt from
  the current time, randomness, or iteration order that can change.
- Use an explicit `{ key }` for every branch of `parallel`, or a resumed run
  can allocate ordinals in a different order and re-call the model.
- `log`, `phase`, and `report` are journal events, not cached values. A replay
  appends them again; keep them idempotent and cheap.
- Do not do filesystem or network side effects directly: the script sandbox has
  no `fs`, `fetch`, or `require`. Ask a subagent to do that work, and make the
  subagent prompt say whether it may write.
- A completed run is not re-executed by `workflow_resume`; amend the script with
  `workflow_amend` to create a successor run.

## Topology choices

| Task | Shape |
|---|---|
| One inspection, then one answer | Two sequential `agent()` calls |
| Same operation over independent files | `parallel(items, fn)` with per-item keys |
| Each item needs several ordered stages | `pipeline(items, stage1, stage2)` |
| Unknown scope discovered mid-run | `agent()` to plan, then `parallel()` over the plan |
| Missing human decision | `hole('Which environment should I deploy to?')` |

Keep fan-out justified: every node is a model call with cost and latency. Do
not create a workflow for a single subagent call; call `subagent` directly.

## Operating a run

- `workflow_run({ script, name?, args? })` returns a run id immediately; the
  run continues in the background and notifies the parent session when it
  settles or pauses at a hole.
- `workflow_get_run(id)` returns status, result, error, holes, and node count.
- `workflow_list_runs` lists recent runs; the right sidebar shows the same runs
  with node state and journal events.
- `workflow_cancel(id)` stops a queued/running run. Completed nodes stay cached.
- `workflow_resume(id)` replays from the store; no completed node is re-called.
- `workflow_amend(id, { script, name? })` creates a successor run and cancels
  the old one.
- `workflow_answer_hole({ run_id, hole_id, answer })` fills a hole and resumes.

Limits: at most 100 `agent()` calls per run (bundle default) and 30 minutes per
node. Split a larger job into several runs instead of raising the cap blindly.
