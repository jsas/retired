// @vitest-environment node
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { BetaPage, type VerdictChip } from './BetaPage';

const chip: VerdictChip = { tone: 'holds', age: '90+', label: 'the plan holds' };

describe('BetaPage assistant dock', () => {
  it('renders the Assistant toggle and the dock rail when an assistant is given', () => {
    const html = renderToStaticMarkup(
      createElement(BetaPage, {
        chip,
        assistant: createElement('div', null, 'chat-body'),
        children: createElement('div', null, 'page-body'),
      }),
    );
    expect(html).toContain('Assistant');
    expect(html).toContain('chat-body');
    expect(html).toContain('page-body');
    expect(html).toContain('aria-label="Close the assistant"');
  });

  it('omits the dock entirely when no assistant is given', () => {
    const html = renderToStaticMarkup(
      createElement(BetaPage, { chip, children: createElement('div', null, 'page-body') }),
    );
    expect(html).not.toContain('chat-body');
    expect(html).not.toContain('aria-label="Close the assistant"');
    expect(html).toContain('page-body');
  });

  it('keeps the persistent verdict chip and the named homes', () => {
    const html = renderToStaticMarkup(
      createElement(BetaPage, { chip, assistant: createElement('div'), children: createElement('div') }),
    );
    expect(html).toContain('90+');
    for (const label of ['Details', 'Schedule', 'Insights', 'Plans']) {
      expect(html, label).toContain(label);
    }
  });
});
