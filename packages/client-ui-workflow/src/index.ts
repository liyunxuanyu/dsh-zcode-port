/**
 * Host half of the workflow run panel. Behavior lives in `client.js`.
 *
 * @module @zcd/client-ui-workflow
 */

import type { Context } from '@deepseek-ai/cordis'

export const name = 'zcd-client-ui-workflow'

/**
 * Mount nothing on the host.
 * @param _ctx - unused host context.
 */
export function apply(_ctx: Context): void {}
