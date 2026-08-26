import { describe, it, expect } from 'vitest';
import { viewFromHash, hashForView, VIEW_ROUTES, type View } from './viewRoutes';

describe('viewFromHash', () => {
  it('maps each canonical route to its view', () => {
    expect(viewFromHash('#/projection')).toBe('projection');
    expect(viewFromHash('#/math')).toBe('math');
    expect(viewFromHash('#/steering')).toBe('eq');
    expect(viewFromHash('#/help')).toBe('help');
    expect(viewFromHash('#/settings')).toBe('settings');
  });

  it('accepts hashes without the leading slash', () => {
    expect(viewFromHash('#steering')).toBe('eq');
  });

  it('ignores a trailing slash', () => {
    expect(viewFromHash('#/steering/')).toBe('eq');
  });

  it('returns null for an empty hash', () => {
    expect(viewFromHash('')).toBeNull();
    expect(viewFromHash('#')).toBeNull();
    expect(viewFromHash('#/')).toBeNull();
  });

  it('returns null for unknown routes', () => {
    expect(viewFromHash('#/bogus')).toBeNull();
  });

  it('returns null for #plan= share links (different namespace)', () => {
    expect(viewFromHash('#plan=abc123')).toBeNull();
  });
});

describe('hashForView', () => {
  it('round-trips every view', () => {
    const views: View[] = ['projection', 'math', 'eq', 'help', 'settings'];
    for (const v of views) {
      expect(viewFromHash(hashForView(v))).toBe(v);
    }
  });

  it('uses every route exactly once', () => {
    const routes = Object.values(VIEW_ROUTES);
    expect(new Set(routes).size).toBe(routes.length);
  });
});
