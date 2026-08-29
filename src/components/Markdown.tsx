// React wrapper for the markdown pipeline (src/lib/ai/markdown.ts). Assistant
// replies render through this; user bubbles and reasoning stay plain text.
// The HTML is sanitized (DOMPurify) before it ever reaches the DOM — see the
// safety contract in markdown.ts.

import { useMemo } from 'react';
import { renderMarkdown } from '../lib/ai/markdown';

/** Assistant-message markdown. Fill `children` with the raw model text. */
export function Markdown({ text, className }: { text: string; className?: string }) {
  // Memoize per text: streaming updates change `text` each chunk, but
  // re-parse on exactly those renders is what we want anyway; this only
  // avoids re-parsing when a parent re-renders for unrelated reasons.
  const html = useMemo(() => renderMarkdown(text), [text]);
  return (
    <div
      className={`md-reply leading-relaxed [&_a]:underline [&_a]:text-violet-700 [&_code]:rounded [&_code]:bg-slate-200/70 [&_code]:px-1 [&_code]:py-px [&_code]:text-[11px] [&_pre]:bg-slate-800 [&_pre]:text-slate-100 [&_pre]:rounded [&_pre]:p-2 [&_pre]:overflow-x-auto [&_pre_code]:bg-transparent [&_pre_code]:text-inherit [&_table]:border-collapse [&_th]:border [&_th]:border-slate-300 [&_th]:px-1.5 [&_th]:py-0.5 [&_th]:bg-slate-100 [&_td]:border [&_td]:border-slate-300 [&_td]:px-1.5 [&_td]:py-0.5 ${className ?? ''}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
