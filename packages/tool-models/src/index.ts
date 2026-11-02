/**
 * `list_models` — the model catalog a deployment currently advertises.
 *
 * ZCode exposes this so a workflow author can pick `subagent_model` without
 * guessing. dsh's adapter seam already answers the question; this tool is the
 * model-facing surface, kept deferred because it is a discovery step, not a
 * per-turn need.
 *
 * @module @zcd/tool-models
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@zcd/deferred-tools'

export const name = 'zcd-tool-models'
export const inject = ['tools', 'deferredTools', 'llm']

const modelSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    provider: { type: 'string', required: true },
    id: { type: 'string', required: true },
    name: { type: 'string', required: true },
    description: { type: 'string' },
  },
} as const

/**
 * Register `list_models` through the deferred seam.
 * @param ctx - context carrying tools, the seam, and the LLM service.
 */
export function apply(ctx: Context): void {
  const off = ctx.deferredTools.register(defineTool({
    name: 'list_models',
    description:
      'List the provider routes and models this deployment advertises. Use it before choosing '
      + 'a model for delegated work (for example a workflow subagent). Unlisted ids may still '
      + 'route, but only listed models are guaranteed selectable from the UI.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          providers: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                name: { type: 'string', required: true },
                models: { type: 'array', required: true, items: modelSchema },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        if (value.providers.length === 0) {
          return [{ type: 'text', text: 'No provider routes are registered.' }]
        }
        const lines = value.providers.flatMap(provider => [
          `${provider.name} (${provider.id}):`,
          ...provider.models.map(model => `  - ${model.id}${model.name === model.id ? '' : ` — ${model.name}`}`),
        ])
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute() {
      const providers = ctx.llm.listProviders()
      const rows = []
      for (const provider of providers) {
        const models = await ctx.llm.listModels(provider.id)
        rows.push({
          id: provider.id,
          name: provider.name ?? provider.id,
          models: models.map(model => ({
            provider: model.provider,
            id: model.id,
            name: model.name,
            ...(model.description === undefined ? {} : { description: model.description }),
          })),
        })
      }
      return { providers: rows }
    },
  }), { group: 'models', keywords: ['model', 'provider', 'catalog', 'subagent'] })

  ctx.effect(() => off, 'zcd-tool-models: deferred registration')
}
