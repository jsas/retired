// Tests for the chat markdown pipeline: `marked` parsing + DOMPurify
// sanitizing. The pipeline is the only path from model output to HTML in the
// chat UI, so the dangerous-output cases matter as much as the formatting.
// DOMPurify needs a real DOM, hence the jsdom environment for this file.
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderMarkdown } from './markdown';

describe('renderMarkdown', () => {
  it('renders headings, emphasis and lists', () => {
    const html = renderMarkdown('# Title\n\n**bold** and *italic*\n\n- one\n- two');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<li>one</li>');
  });

  it('renders GFM tables and fenced code', () => {
    const html = renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |\n\n```js\nconst x = 1;\n```');
    expect(html).toContain('<table>');
    expect(html).toContain('<td>1</td>');
    expect(html).toContain('<pre><code');
  });

  it('treats single newlines as breaks (chat convention)', () => {
    const html = renderMarkdown('line one\nline two');
    expect(html).toContain('line one<br>line two');
  });

  it('strips script tags and event handlers (DOMPurify)', () => {
    const html = renderMarkdown('hello <script>alert(1)</script> world');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert(1)');
    const withHandler = renderMarkdown('<img src=x onerror="alert(1)">');
    expect(withHandler).not.toContain('onerror');
  });

  it('neutralizes javascript: URLs and iframes', () => {
    const html = renderMarkdown('[click me](javascript:alert(1))');
    expect(html).not.toContain('javascript:');
    const iframe = renderMarkdown('<iframe src="https://evil.example"></iframe>');
    expect(iframe).not.toContain('<iframe');
  });

  it('keeps safe links with their href', () => {
    const html = renderMarkdown('[CPP deferral](https://www.canada.ca/en/service/pensions.html)');
    expect(html).toContain('href="https://www.canada.ca/en/service/pensions.html"');
    expect(html).toContain('<a ');
  });

  it('passes plain prose through unchanged (no wrapping elements added)', () => {
    const html = renderMarkdown('Just a sentence about your TFSA.');
    expect(html).toContain('Just a sentence about your TFSA.');
    expect(html).not.toContain('<h1');
  });
});
