// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LanguageSwitch } from './LanguageSwitch';

describe('LanguageSwitch', () => {
  it('names the other language (Canada.ca convention)', () => {
    const en = renderToStaticMarkup(
      <LanguageSwitch locale="en-CA" onChange={() => {}} />,
    );
    expect(en).toContain('Français');
    expect(en).toContain('lang="fr"');
    expect(en).not.toContain('>English<');

    const fr = renderToStaticMarkup(
      <LanguageSwitch locale="fr-CA" onChange={() => {}} />,
    );
    expect(fr).toContain('English');
    expect(fr).toContain('lang="en"');
  });
});
