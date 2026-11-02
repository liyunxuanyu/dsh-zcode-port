/**
 * Host half of the ZCD tool cards. Behavior lives in `client.js`.
 *
 * @module @zcd/client-ui-zcd
 */

import type { Context } from '@deepseek-ai/cordis'

export const name = 'zcd-client-ui-zcd'

/**
 * Mount nothing on the host.
 * @param _ctx - unused host context.
 */
export function apply(_ctx: Context): void {}
