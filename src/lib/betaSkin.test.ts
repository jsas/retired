import { describe, it, expect } from 'vitest';
import {
  parseBetaParam,
  readBetaCookie,
  decideBeta,
  BETA_COOKIE_NAME,
} from './betaSkin';

describe('parseBetaParam', () => {
  it('reads the value with and without the leading ?', () => {
    expect(parseBetaParam('?beta')).toBe('');
    expect(parseBetaParam('beta=on')).toBe('on');
    expect(parseBetaParam('?foo=1&beta=0')).toBe('0');
  });
  it('is null when the flag is absent', () => {
    expect(parseBetaParam('')).toBeNull();
    expect(parseBetaParam('?other=1')).toBeNull();
  });
});

describe('readBetaCookie', () => {
  it('is true only for beta-version=1', () => {
    expect(readBetaCookie(`${BETA_COOKIE_NAME}=1`)).toBe(true);
    expect(readBetaCookie(`theme=dark; ${BETA_COOKIE_NAME}=1; x=y`)).toBe(true);
    expect(readBetaCookie(`${BETA_COOKIE_NAME}=0`)).toBe(false);
    expect(readBetaCookie('')).toBe(false);
    expect(readBetaCookie('beta-version-extra=1')).toBe(false);
  });
});

describe('decideBeta', () => {
  it('?beta turns the skin on and writes the cookie', () => {
    const d = decideBeta('?beta', '');
    expect(d.beta).toBe(true);
    expect(d.set).toContain(`${BETA_COOKIE_NAME}=1`);
    expect(d.set).toContain('max-age=');
  });
  it('any non-off value counts as on', () => {
    expect(decideBeta('?beta=on', '').beta).toBe(true);
    expect(decideBeta('?beta=whatever', '').beta).toBe(true);
  });
  it('?beta=off (and 0/false/no) turns it off and expires the cookie', () => {
    const d = decideBeta('?beta=off', `${BETA_COOKIE_NAME}=1`);
    expect(d.beta).toBe(false);
    expect(d.set).toContain(`${BETA_COOKIE_NAME}=0`);
    expect(d.set).toContain('max-age=0');
    expect(decideBeta('?beta=0', '').beta).toBe(false);
    expect(decideBeta('?beta=FALSE', '').beta).toBe(false);
  });
  it('without the param the cookie alone decides', () => {
    expect(decideBeta('', `${BETA_COOKIE_NAME}=1`).beta).toBe(true);
    expect(decideBeta('', `${BETA_COOKIE_NAME}=0`).beta).toBe(false);
    expect(decideBeta('', '').beta).toBe(false);
  });
  it('writes nothing when the URL makes no claim', () => {
    expect(decideBeta('', `${BETA_COOKIE_NAME}=1`).set).toBeNull();
    expect(decideBeta('?other=1', '').set).toBeNull();
  });
});
