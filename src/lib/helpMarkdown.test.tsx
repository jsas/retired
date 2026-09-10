// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HelpMarkdown, markdownPlain } from './helpMarkdown';

describe('HelpMarkdown', () => {
  it('renders paragraphs, lists, emphasis and links', () => {
    const html = renderToStaticMarkup(
      <HelpMarkdown markdown={'A **bold** and *em* and `code`.\n\n- one\n- two\n\nSee [Help](https://example.com).'} />,
    );
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>em</em>');
    expect(html).toContain('<code');
    expect(html).toContain('<ul');
    expect(html).toContain('href="https://example.com"');
  });
});

describe('markdownPlain', () => {
  it('strips markup for search', () => {
    expect(markdownPlain('**CPP** start age')).toBe('CPP start age');
    expect(markdownPlain('- one\n- two')).toContain('one');
  });
});
