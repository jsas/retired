// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LanguageSwitch } from './LanguageSwitch';

describe('LanguageSwitch', () => {
  it('shows both locale codes with the current one emphasised (#192)', () => {
    const en = renderToStaticMarkup(
      <LanguageSwitch locale="en-CA" onChange={() => {}} />,
    );
    expect(en).toContain('>EN<');
    expect(en).toContain('>FR<');
    // the action still speaks the OTHER language (Canada.ca convention)
    expect(en).toContain('Switch language to Français');
    expect(en).toContain('lang="fr"');
    // the active code is bold, the other dimmed
    expect(en).toContain('class="font-bold">EN');
    expect(en).toContain('class="opacity-40">FR');

    const fr = renderToStaticMarkup(
      <LanguageSwitch locale="fr-CA" onChange={() => {}} />,
    );
    expect(fr).toContain('Switch language to English');
    expect(fr).toContain('lang="en"');
    expect(fr).toContain('class="opacity-40">EN');
    expect(fr).toContain('class="font-bold">FR');
  });
});
