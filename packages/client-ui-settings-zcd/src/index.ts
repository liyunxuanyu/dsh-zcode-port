/**
 * Host half of the ZCD settings section. Behavior lives in `client.js`.
 *
 * @module @zcd/client-ui-settings-zcd
 */

import type { Context } from '@deepseek-ai/cordis'

export const name = 'zcd-client-ui-settings-zcd'

/**
 * Mount nothing on the host.
 * @param _ctx - unused host context.
 */
export function apply(_ctx: Context): void {}
