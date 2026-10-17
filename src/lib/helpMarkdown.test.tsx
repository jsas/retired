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

  it('keeps a fenced block with blank lines in one pre', () => {
    const html = renderToStaticMarkup(
      <HelpMarkdown markdown={'```\nMIT License\n\nCopyright (c) 2026\n\nPermission is hereby granted.\n```'} />,
    );
    expect(html.match(/<pre/g)?.length).toBe(1);
    expect(html).toContain('MIT License');
    expect(html).toContain('Copyright (c) 2026');
    expect(html).toContain('Permission is hereby granted.');
    expect(html).not.toContain('```');
    expect(/<p[\s>]/.test(html)).toBe(false);
  });

  it('renders the catalog MIT license as one pre', async () => {
    const { i18n } = await import('./i18n');
    const body = (i18n.getResourceBundle('en-CA', 'help') as {
      topics: Record<string, { body: string }>;
    }).topics['mit-license'].body;
    const html = renderToStaticMarkup(<HelpMarkdown markdown={body} />);
    expect(html.match(/<pre/g)?.length).toBe(1);
    expect(html).toContain('THE SOFTWARE IS PROVIDED');
    expect(/<p[\s>]/.test(html)).toBe(false);
    expect(html).not.toContain('```');
  });
});

describe('markdownPlain', () => {
  it('strips markup for search', () => {
    expect(markdownPlain('**CPP** start age')).toBe('CPP start age');
    expect(markdownPlain('- one\n- two')).toContain('one');
  });
});
