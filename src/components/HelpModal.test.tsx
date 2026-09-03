// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HelpModal } from './HelpModal';
import { HELP_TOPICS, HELP_SECTIONS } from '../help/topics';

function renderHelp(): string {
  return renderToStaticMarkup(<HelpModal />);
}

describe('Help page renders from the topics data source', () => {
  it('renders every topic with a stable anchor', () => {
    const html = renderHelp();
    for (const t of HELP_TOPICS) {
      expect(html).toContain(`id="topic-${t.id}"`);
    }
  });

  it('renders every section with an anchor', () => {
    const html = renderHelp();
    for (const s of HELP_SECTIONS) {
      expect(html).toContain(`id="section-${s.replace(/\s+/g, '-').toLowerCase()}"`);
    }
  });

  it('has a search box and a per-topic link', () => {
    const html = renderHelp();
    expect(html).toContain('Search help');
    expect(html).toContain('#/help?topic=cpp-start-age');
  });

  it('keeps the legal coverage (single source of truth in topics.tsx)', () => {
    const html = renderHelp().replace(/\s+/g, ' ');
    expect(html).toContain('not</strong> financial, investment, tax, or legal advice');
    expect(html).toContain('no liability for lost');
    expect(html).toContain('never personalized advice');
    expect(html).toContain('&quot;as is&quot;');
    expect(html).toContain('not liable for any loss or damage');
  });
});
