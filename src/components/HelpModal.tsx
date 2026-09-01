// ---------------------------------------------------------------------------
// The Help page. Renders entirely from src/help/topics.tsx — the single source
// of truth also used by the ? hint popups (HelpHint). Nothing here re-states
// an explanation; if the text is wrong, it is wrong in topics.tsx.
//
// Linkable: #/help?topic=<id> scrolls to and flashes one topic. Searchable:
// searchHelpTopics matches title + body text + keywords.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Search, X } from 'lucide-react';
import { HELP_SECTIONS, helpTopic, searchHelpTopics, type HelpTopic } from '../help/topics';

// Highlight every occurrence of `query` inside string children of `node`.
function highlight(node: ReactNode, query: string): ReactNode {
  if (!query) return node;
  if (typeof node === 'string') {
    const lower = node.toLowerCase();
    const q = query.toLowerCase();
    if (!lower.includes(q)) return node;
    const parts: ReactNode[] = [];
    let i = 0;
    let k = 0;
    while (i < node.length) {
      const hit = lower.indexOf(q, i);
      if (hit === -1) { parts.push(node.slice(i)); break; }
      if (hit > i) parts.push(node.slice(i, hit));
      parts.push(
        <mark key={k++} className="bg-yellow-200 text-inherit px-px">
          {node.slice(hit, hit + q.length)}
        </mark>
      );
      i = hit + q.length;
    }
    return <>{parts}</>;
  }
  if (Array.isArray(node)) return node.map((n, i) => <span key={i}>{highlight(n, query)}</span>);
  if (typeof node === 'object' && node != null && 'props' in node) {
    const el = node as React.ReactElement<{ children?: ReactNode }>;
    return { ...el, props: { ...el.props, children: highlight(el.props.children, query) } };
  }
  return node;
}

function topicFromHash(): string | null {
  const m = window.location.hash.match(/[?&]topic=([a-z0-9-]+)/);
  return m ? m[1] : null;
}

export function HelpModal() {
  const [query, setQuery] = useState('');
  const [flashId, setFlashId] = useState<string | null>(null);
  const q = query.trim();

  const filtered = useMemo(() => searchHelpTopics(q), [q]);
  const bySection = useMemo(() => {
    const map = new Map<string, HelpTopic[]>();
    for (const s of HELP_SECTIONS) map.set(s, []);
    for (const t of filtered) map.get(t.section)?.push(t);
    return [...map.entries()].filter(([, topics]) => topics.length > 0);
  }, [filtered]);

  // Deep-link: #/help?topic=<id> scrolls to the topic and flashes it.
  useEffect(() => {
    const apply = () => {
      const id = topicFromHash();
      if (!id || !helpTopic(id)) return;
      setFlashId(id);
      // Wait a frame so the section exists before scrolling.
      requestAnimationFrame(() => {
        document.getElementById(`topic-${id}`)?.scrollIntoView({ block: 'start' });
      });
      const t = setTimeout(() => setFlashId(null), 2400);
      return () => clearTimeout(t);
    };
    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, []);

  const matchCount = q ? filtered.length : null;

  return (
    <div>
      {/* Re-run the guided first-scenario setup (the welcome wizard). */}
      <a
        href="#/welcome"
        className="group mb-5 flex items-baseline gap-3 border-b border-slate-200 pb-4 text-[13px] text-slate-600 hover:text-slate-900"
      >
        <span className="flex-1">
          <span className="font-semibold text-slate-900">Walk through your first scenario</span>
          {' '}— a 5-step guided setup (ages, savings, benefits, spending).
        </span>
        <span className="shrink-0 text-[11px] font-medium group-hover:underline">Open →</span>
      </a>

      {/* Search */}
      <div className="relative mb-3">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search help — try “clawback”, “TFSA”, “share link”…"
          className="w-full border border-slate-300 py-1.5 pl-8 pr-8 text-xs focus:border-slate-900 focus:outline-none"
        />
        {q && (
          <button
            onClick={() => setQuery('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-700"
            title="Clear search"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {/* Table of contents — sections, grouped */}
      <nav className="mb-5 pb-4 border-b border-slate-200">
        <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
          Contents
          {matchCount != null && (
            <span className="ml-2 normal-case font-normal text-slate-400">
              {matchCount} {matchCount === 1 ? 'topic' : 'topics'} match{matchCount === 1 ? 'es' : ''}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {bySection.map(([section]) => (
            <a key={section} href={`#section-${section.replace(/\s+/g, '-').toLowerCase()}`} className="text-xs text-slate-600 hover:text-slate-900 hover:underline">
              {section}
            </a>
          ))}
          {bySection.length === 0 && (
            <span className="text-xs text-slate-500">No matches — try a shorter or different term.</span>
          )}
        </div>
      </nav>

      {/* Every topic, grouped by section, each with its stable anchor. */}
      <div className="pb-8">
        {bySection.map(([section, topics]) => (
          <section
            key={section}
            id={`section-${section.replace(/\s+/g, '-').toLowerCase()}`}
            className="mb-6 scroll-mt-4"
          >
            <h2 className="text-sm font-bold text-slate-900 border-b border-slate-200 pb-1 mb-2">
              {highlight(section, q)}
            </h2>
            {topics.map((t) => (
              <div
                key={t.id}
                id={`topic-${t.id}`}
                className={`py-1.5 border-b border-slate-100 last:border-0 scroll-mt-4 ${
                  flashId === t.id ? 'bg-slate-100' : ''
                }`}
              >
                <div className="flex items-baseline gap-2">
                  <div className="text-xs font-medium text-slate-800">{highlight(t.title, q)}</div>
                  <a
                    href={`#/help?topic=${t.id}`}
                    title="Link to this topic"
                    className="text-[10px] text-slate-300 hover:text-slate-900"
                  >
                    #
                  </a>
                </div>
                <div className="mt-0.5">{highlight(t.body, q)}</div>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
