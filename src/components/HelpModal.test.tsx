// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HelpModal } from './HelpModal';

function renderHelp(): string {
  return renderToStaticMarkup(<HelpModal />);
}

describe('HelpModal legal coverage', () => {
  it('keeps the existing not-financial-advice disclaimer', () => {
    const html = renderHelp();
    expect(html).toContain('Disclaimer — not financial advice');
    expect(html.replace(/\s+/g, ' ')).toContain('not</strong> financial, investment, tax, or legal advice');
  });

  it('states that data/backups are the user’s responsibility with no liability for loss', () => {
    const html = renderHelp();
    expect(html).toContain('Your data &amp; backups — your responsibility');
    expect(html).toContain('your responsibility');
    expect(html).toContain('no liability for lost');
  });

  it('warns that AI output may be wrong and is not personalized advice', () => {
    const html = renderHelp();
    expect(html).toContain('AI output may be wrong');
    expect(html).toContain('never personalized advice');
    expect(html).toContain('state false things');
  });

  it('includes an as-is / use-at-your-own-risk no-warranty clause', () => {
    const html = renderHelp();
    expect(html).toContain('No warranty — use at your own risk');
    expect(html).toContain('&quot;as is&quot;');
    expect(html).toContain('not liable for any loss or damage');
  });
});
