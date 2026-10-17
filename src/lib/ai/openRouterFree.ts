// OpenRouter's no-cost pool: the `openrouter/free` router plus any model id
// ending in `:free`. One key reaches them; the app never proxies the call.

import {
  defaultBaseUrlFor,
  newConnectionId,
  type AiConnection,
  type AiSettings,
} from '../aiSettings';

/** Router that picks a free-variant model matching the request (tools, vision, …). */
export const OPENROUTER_FREE_ROUTER = 'openrouter/free';
export const OPENROUTER_KEYS_URL = 'https://openrouter.ai/keys';
export const OPENROUTER_FREE_PAGE_URL = 'https://openrouter.ai/openrouter/free';
export const OPENROUTER_SIGNUP_URL = 'https://openrouter.ai/';

export function isOpenRouterFreeId(id: string): boolean {
  const s = id.trim().toLowerCase();
  return s === OPENROUTER_FREE_ROUTER || s.endsWith(':free');
}

export function openRouterConnection(settings: AiSettings): AiConnection | undefined {
  return settings.connections.find(c => c.provider === 'openrouter');
}

/** Create or reuse the OpenRouter connection and point it at the free router.
 *  Does not invent a key — paste that on the Connections page. */
export function ensureOpenRouterFree(
  settings: AiSettings,
  newId: () => string = newConnectionId,
): AiSettings {
  const next: AiSettings = {
    ...settings,
    connections: settings.connections.map(c => ({ ...c })),
  };
  const idx = next.connections.findIndex(c => c.provider === 'openrouter');
  const baseUrl = defaultBaseUrlFor('openrouter');
  if (idx < 0) {
    const id = newId();
    next.connections.push({
      id,
      provider: 'openrouter',
      label: 'OpenRouter free',
      apiKey: '',
      model: OPENROUTER_FREE_ROUTER,
      baseUrl,
    });
    next.activeConnectionId = id;
  } else {
    const cur = next.connections[idx]!;
    next.connections[idx] = {
      ...cur,
      model: OPENROUTER_FREE_ROUTER,
      baseUrl: cur.baseUrl || baseUrl,
      label: cur.label || 'OpenRouter free',
    };
    next.activeConnectionId = cur.id;
  }
  return next;
}
