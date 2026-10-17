// Trusted catalog markdown → React nodes. Help bodies live in JSON so en-CA
// and fr-CA share this renderer; search indexes the markdown source. No HTML
// injection — nodes only, so node tests keep working without jsdom.
import { createElement, type ReactNode } from 'react';

const P_STYLE = 'text-xs text-slate-600 leading-relaxed mb-1.5';
const LI_STYLE = 'text-xs text-slate-600 leading-relaxed';

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let k = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) {
      out.push(<strong key={`${keyBase}-${k++}`}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith('*')) {
      out.push(<em key={`${keyBase}-${k++}`}>{tok.slice(1, -1)}</em>);
    } else if (tok.startsWith('`')) {
      out.push(<code key={`${keyBase}-${k++}`} className="num">{tok.slice(1, -1)}</code>);
    } else {
      const link = tok.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (link) {
        const href = link[2];
        const external = /^https?:/i.test(href);
        out.push(
          <a
            key={`${keyBase}-${k++}`}
            href={href}
            className="text-blue-600 hover:underline"
            {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
          >
            {link[1]}
          </a>,
        );
      }
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function mdBlock(block: string, key: string): ReactNode {
  const lines = block.split('\n');
  if (lines.every(l => l.startsWith('- '))) {
    return (
      <ul key={key} className="list-disc pl-5 space-y-1 mb-2">
        {lines.map((l, j) => (
          <li key={j} className={LI_STYLE}>{inline(l.slice(2), `${key}-${j}`)}</li>
        ))}
      </ul>
    );
  }
  if (lines.every(l => /^\d+\. /.test(l))) {
    return (
      <ol key={key} className="list-decimal pl-5 space-y-1 mb-2">
        {lines.map((l, j) => (
          <li key={j} className={LI_STYLE}>{inline(l.replace(/^\d+\. /, ''), `${key}-${j}`)}</li>
        ))}
      </ol>
    );
  }
  return <p key={key} className={P_STYLE}>{inline(block.replace(/\n/g, ' '), key)}</p>;
}

export function HelpMarkdown({ markdown }: { markdown: string }): ReactNode {
  // Pull fenced blocks out first — they contain blank lines (the MIT license)
  // and must not be split into paragraphs.
  const src = markdown.replace(/\r\n/g, '\n').trim();
  const chunks: Array<{ kind: 'fence'; inner: string } | { kind: 'md'; text: string }> = [];
  const fenceRe = /```[a-z]*\r?\n?([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(src))) {
    const before = src.slice(last, m.index).trim();
    if (before) chunks.push({ kind: 'md', text: before });
    chunks.push({ kind: 'fence', inner: m[1].replace(/\n$/, '') });
    last = m.index + m[0].length;
  }
  const after = src.slice(last).trim();
  if (after) chunks.push({ kind: 'md', text: after });

  return (
    <>
      {chunks.flatMap((chunk, i) => {
        if (chunk.kind === 'fence') {
          return (
            <pre key={`f-${i}`} className="text-[11px] leading-relaxed text-slate-600 bg-slate-50 border border-slate-200 rounded p-3 whitespace-pre-wrap font-mono">
              {chunk.inner}
            </pre>
          );
        }
        return chunk.text.split(/\n\n+/).filter(Boolean).map((block, j) => mdBlock(block, `${i}-${j}`));
      })}
    </>
  );
}

/** Flatten markdown to searchable plain text. */
export function markdownPlain(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^[-*] /gm, '')
    .replace(/^\d+\. /gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Keep createElement referenced so this file stays a module under isolated builds.
void createElement;
