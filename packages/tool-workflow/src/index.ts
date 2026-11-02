/**
 * Durable workflow tools (MVP).
 *
 * `workflow_run` is visible so a model can start a run without a search; the
 * inspection/control tools are deferred because they are only useful once a
 * run exists. The script surface is intentionally small: `agent(prompt)`,
 * `log(value)`, `args`, and `return`. Parallel/hole/amend are specified in
 * docs/04 and land later.
 *
 * @module @zcd/tool-workflow
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@zcd/deferred-tools'
import type {} from '@zcd/durable-workflow'

export const name = 'zcd-tool-workflow'
export const inject = ['tools', 'deferredTools', 'durableWorkflow']

const runSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    name: { type: 'string', required: true },
    status: {
      type: 'string',
      required: true,
      enum: ['queued', 'running', 'waiting-hole', 'succeeded', 'failed', 'cancelled', 'interrupted'],
    },
    nodeCount: { type: 'integer', required: true },
    result: { type: 'string' },
    error: {
      type: 'object',
      additionalProperties: false,
      properties: {
        code: { type: 'string', required: true },
        message: { type: 'string', required: true },
      },
    },
    holes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          prompt: { type: 'string', required: true },
          answer: { type: 'string' },
        },
      },
    },
  },
} as const

/**
 * Register the workflow tools.
 * @param ctx - context carrying tools, the deferred seam, and the engine.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'workflow_run',
    description:
      'Start a durable workflow: a JavaScript body with `await agent(prompt, { key })`, `parallel(items, fn)`, '
      + '`pipeline(items, ...stages)`, `phase(name)`, `report(value)`, `log(value)`, ending with `return <json>`. Each agent call is persisted by '
      + '(script, ordinal, prompt); resuming the run replays completed steps without calling the '
      + 'model again. Load the dynamic-workflows skill before calling this tool; the host denies '
      + 'the call until that skill is loaded. Use it for multi-step work that should survive a '
      + 'restart. Returns immediately with a run id unless `wait` is true.',
    parameters: {
      script: {
        type: 'string',
        required: true,
        description: 'JavaScript body. Example: `const a = await agent("list files"); return a`.',
      },
      name: { type: 'string', description: 'Display label.' },
      args: { type: 'object', additionalProperties: true, description: 'JSON object exposed to the script as `args`.' },
      wait: { type: 'boolean', description: 'Wait for the run to finish before returning.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { run: { ...runSchema, required: true } } },
      render: (_args, value) => [{
        type: 'text',
        text: `Workflow ${value.run.id} [${value.run.status}] (${value.run.nodeCount} nodes)`
          + (value.run.result === undefined ? '' : `: ${JSON.stringify(value.run.result)}`),
      }],
    },
    async execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) throw new Error('workflow_run requires an owning agent session')
      const view = ctx.durableWorkflow.start({
        script: args.script,
        ...(args.name === undefined ? {} : { name: args.name }),
        ...(args.args === undefined ? {} : { args: args.args }),
      }, agent)
      const run = args.wait === true ? await ctx.durableWorkflow.wait(view.id) : view
      return { run: project(run) }
    },
  }))

  const offGet = ctx.deferredTools.register(defineTool({
    name: 'workflow_get_run',
    description: 'Read one durable workflow run by id.',
    parameters: { run_id: { type: 'string', required: true } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { run: { ...runSchema, required: true } } },
      render: (_args, value) => [{ type: 'text', text: `Workflow ${value.run.id} [${value.run.status}]` }],
    },
    async execute(args) {
      return { run: project(ctx.durableWorkflow.get(args.run_id)) }
    },
  }), { group: 'workflow', keywords: ['run', 'status', 'workflow'] })

  const offList = ctx.deferredTools.register(defineTool({
    name: 'workflow_list_runs',
    description: 'List recent durable workflow runs, newest first.',
    parameters: { limit: { type: 'integer', description: 'Maximum rows (default 20).' } },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { runs: { type: 'array', required: true, items: runSchema } },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.runs.length === 0
          ? 'No workflow runs.'
          : value.runs.map(run => `- ${run.id} [${run.status}] ${run.name}`).join('\n'),
      }],
    },
    async execute(args) {
      return { runs: ctx.durableWorkflow.list(args.limit ?? 20).map(project) }
    },
  }), { group: 'workflow', keywords: ['runs', 'list', 'history'] })

  const offResume = ctx.deferredTools.register(defineTool({
    name: 'workflow_resume',
    description: 'Resume an interrupted or failed run; completed steps are replayed from the store.',
    parameters: { run_id: { type: 'string', required: true } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { run: { ...runSchema, required: true } } },
      render: (_args, value) => [{ type: 'text', text: `Resumed ${value.run.id} [${value.run.status}]` }],
    },
    async execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) throw new Error('workflow_resume requires an owning agent session')
      return { run: project(ctx.durableWorkflow.resume(args.run_id, agent)) }
    },
  }), { group: 'workflow', keywords: ['resume', 'continue', 'recover'] })

  const offCancel = ctx.deferredTools.register(defineTool({
    name: 'workflow_cancel',
    description: 'Cancel a queued or running durable workflow run.',
    parameters: { run_id: { type: 'string', required: true } },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { run: { ...runSchema, required: true } } },
      render: (_args, value) => [{ type: 'text', text: `Cancelled ${value.run.id} [${value.run.status}]` }],
    },
    async execute(args) {
      ctx.durableWorkflow.cancel(args.run_id)
      return { run: project(ctx.durableWorkflow.get(args.run_id)) }
    },
  }), { group: 'workflow', keywords: ['cancel', 'stop'] })

  const offAmend = ctx.deferredTools.register(defineTool({
    name: 'workflow_amend',
    description:
      'Amend a workflow run. A new `script` creates a successor run and stops the old one; a '
      + '`name` alone relabels the existing run. Use it when the plan changes after a run started.',
    parameters: {
      run_id: { type: 'string', required: true },
      script: { type: 'string', description: 'Replacement script; starts a successor run.' },
      name: { type: 'string', description: 'New display label.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { run: { ...runSchema, required: true } } },
      render: (_args, value) => [{ type: 'text', text: `Amended to ${value.run.id} [${value.run.status}]` }],
    },
    async execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) throw new Error('workflow_amend requires an owning agent session')
      return {
        run: project(ctx.durableWorkflow.amend(args.run_id, {
          ...(args.script === undefined ? {} : { script: args.script }),
          ...(args.name === undefined ? {} : { name: args.name }),
        }, agent)),
      }
    },
  }), { group: 'workflow', keywords: ['amend', 'change', 'revise', 'successor'] })

  const offAnswer = ctx.deferredTools.register(defineTool({
    name: 'workflow_answer_hole',
    description:
      'Answer an open hole and continue the run. The script receives the answer from its hole() call; '
      + 'completed steps and earlier holes are replayed from the store.',
    parameters: {
      run_id: { type: 'string', required: true },
      hole_id: { type: 'string', required: true },
      answer: { type: 'string', required: true, description: 'Code or text the script should receive.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { run: { ...runSchema, required: true } } },
      render: (_args, value) => [{ type: 'text', text: `Answered ${value.run.id}; status ${value.run.status}` }],
    },
    async execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) throw new Error('workflow_answer_hole requires an owning agent session')
      return { run: project(ctx.durableWorkflow.answerHole(args.run_id, args.hole_id, args.answer, agent)) }
    },
  }), { group: 'workflow', keywords: ['hole', 'answer', 'resume'] })

  ctx.effect(() => () => { offGet(); offList(); offResume(); offCancel(); offAmend(); offAnswer() }, 'zcd-tool-workflow: deferred registrations')
}

/** Drop the script from tool-facing rows. */
function project(run: ReturnType<Context['durableWorkflow']['get']>) {
  return {
    id: run.id,
    name: run.name,
    status: run.status,
    nodeCount: run.nodeCount,
    ...(run.result === undefined ? {} : { result: JSON.stringify(run.result) ?? '' }),
    ...(run.error === undefined ? {} : { error: run.error }),
    ...(run.holes === undefined ? {} : { holes: run.holes.map(hole => ({ ...hole })) }),
  }
}
