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

export function HelpMarkdown({ markdown }: { markdown: string }): ReactNode {
  const blocks = markdown.replace(/\r\n/g, '\n').trim().split(/\n\n+/);
  return (
    <>
      {blocks.map((block, i) => {
        if (block.startsWith('```')) {
          const inner = block.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '');
          return (
            <pre key={i} className="text-[11px] leading-relaxed text-slate-600 bg-slate-50 border border-slate-200 rounded p-3 whitespace-pre-wrap font-mono">
              {inner}
            </pre>
          );
        }
        const lines = block.split('\n');
        if (lines.every(l => l.startsWith('- '))) {
          return (
            <ul key={i} className="list-disc pl-5 space-y-1 mb-2">
              {lines.map((l, j) => (
                <li key={j} className={LI_STYLE}>{inline(l.slice(2), `${i}-${j}`)}</li>
              ))}
            </ul>
          );
        }
        if (lines.every(l => /^\d+\. /.test(l))) {
          return (
            <ol key={i} className="list-decimal pl-5 space-y-1 mb-2">
              {lines.map((l, j) => (
                <li key={j} className={LI_STYLE}>{inline(l.replace(/^\d+\. /, ''), `${i}-${j}`)}</li>
              ))}
            </ol>
          );
        }
        return <p key={i} className={P_STYLE}>{inline(block.replace(/\n/g, ' '), String(i))}</p>;
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
