/**
 * Host half of the Gen UI card.
 *
 * The package exists so the client module system has a Loader row to serve;
 * all behavior is in `client.js` (hand-written lazy-CJS bundle). The host half
 * intentionally registers nothing.
 *
 * @module @zcd/client-ui-genui
 */

import type { Context } from '@deepseek-ai/cordis'

export const name = 'zcd-client-ui-genui'

/**
 * Mount nothing on the host.
 * @param _ctx - unused host context.
 */
export function apply(_ctx: Context): void {}
