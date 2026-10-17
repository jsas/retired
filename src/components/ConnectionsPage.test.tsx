// @vitest-environment node
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ConnectionsPage } from './ConnectionsPage';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
});

describe('ConnectionsPage OpenRouter free section', () => {
  it('walks signup, keys, and the free router without needing a key first', () => {
    const html = renderToStaticMarkup(createElement(ConnectionsPage));
    expect(html).toContain('Free — OpenRouter');
    expect(html).toContain('https://openrouter.ai/openrouter/free');
    expect(html).toContain('https://openrouter.ai/keys');
    expect(html).toContain('Set up OpenRouter free');
    expect(html).toContain('Create an OpenRouter account');
    expect(html).toContain('use it for training');
  });
});
