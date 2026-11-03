/**
 * Host half of the live browser panel. Behavior lives in `client.js`.
 *
 * @module @zcd/client-ui-browser
 */

import type { Context } from '@deepseek-ai/cordis'

export const name = 'zcd-client-ui-browser'

/**
 * Mount nothing on the host.
 * @param _ctx - unused host context.
 */
export function apply(_ctx: Context): void {}
