// Markdown rendering for assistant chat replies, built on `marked` (parsing)
// + `dompurify` (sanitizing). The model's answers carry headings, lists,
// bold/italic, code fences and tables; raw text-rendering left them as literal
// asterisks and pipes.
//
// Safety contract: marked does NOT sanitize — its output must never touch the
// DOM without passing through DOMPurify. Everything here funnels through
// `sanitizeHtml`, which strips scripts, event handlers, javascript: URLs and
// the rest of DOMPurify's default deny-list. No dangerouslySetInnerHTML happens
// outside `Markdown.tsx`, which uses this module's output exclusively.

import { marked } from 'marked';
import DOMPurify from 'dompurify';

// marked's sync API returns a string; no async extensions are in play.
marked.setOptions({
  gfm: true,        // tables, strikethrough, task lists
  breaks: true,     // single newlines become <br> (chat convention)
});

/** Parse markdown to HTML and sanitize it in one step. The ONLY path from
 *  model output to HTML in the chat UI. */
export function renderMarkdown(text: string): string {
  const raw = marked.parse(text, { async: false });
  return DOMPurify.sanitize(raw);
}
