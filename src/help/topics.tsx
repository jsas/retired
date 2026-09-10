// ---------------------------------------------------------------------------
// The help data source — the ONE place help text lives (HELP-MAP.md §2).
//
// Bodies live in src/locales/{en-CA,fr-CA}/help.json as markdown so both
// languages share one renderer (HelpMarkdown). The Help page and the ?
// popups (HelpHint) both read from here. Ids are URLs — kebab-case, don't
// rename. Legal MIT text stays the English source in both catalogs.
// ---------------------------------------------------------------------------

import type { ReactNode } from 'react';
import { i18n } from '../lib/i18n';
import { HelpMarkdown } from '../lib/helpMarkdown';

export interface HelpTopic {
  id: string;
  title: string;
  /** The teaching text — rendered identically on the page and in the popup. */
  body: ReactNode;
  /** Extra search terms (synonyms, acronyms) beyond title + body. */
  keywords: string[];
  /** Grouping on the page — English catalog key, stable for #section- anchors. */
  section: string;
}

interface TopicCatalog {
  title: string;
  section: string;
  keywords: string[];
  body: string;
}

/** Section order on the page. Keys match help.json `sections` / topic.section. */
export const HELP_SECTIONS = [
  'People', 'Accounts', 'Income', 'Spending', 'Property', 'Levers',
  'Reading the answer', 'Analysis', 'Schedule', 'Plans', 'Assistant', 'Data',
  'Assumptions', 'Glossary', 'Legal',
] as const;

function bundle(lng?: string): { topics?: Record<string, TopicCatalog> } {
  const lang = lng ?? i18n.language ?? 'en-CA';
  return (i18n.getResourceBundle(lang, 'help') ?? i18n.getResourceBundle('en-CA', 'help') ?? {}) as {
    topics?: Record<string, TopicCatalog>;
  };
}

function topicIds(): string[] {
  const en = bundle('en-CA').topics ?? {};
  return Object.keys(en);
}

function toTopic(id: string, t: TopicCatalog): HelpTopic {
  return {
    id,
    title: t.title,
    section: t.section,
    keywords: t.keywords ?? [],
    body: <HelpMarkdown markdown={t.body} />,
  };
}

/** Live catalog for the current language. */
export function helpTopics(): HelpTopic[] {
  const current = bundle().topics ?? {};
  const en = bundle('en-CA').topics ?? {};
  return topicIds().map((id) => toTopic(id, current[id] ?? en[id]));
}

/** Snapshot at module load (en-CA). Tests that import HELP_TOPICS stay English. */
export const HELP_TOPICS: HelpTopic[] = helpTopics();

export function helpTopic(id: string): HelpTopic | undefined {
  const current = bundle().topics ?? {};
  const en = bundle('en-CA').topics ?? {};
  const t = current[id] ?? en[id];
  return t ? toTopic(id, t) : undefined;
}

function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  if (typeof node === 'object' && 'props' in node) {
    const props = (node as { props: { children?: ReactNode; markdown?: string } }).props;
    if (typeof props.markdown === 'string') return props.markdown;
    return textOf(props.children);
  }
  return '';
}

/** Full-text search over title + body + keywords, in page order. */
export function searchHelpTopics(query: string): HelpTopic[] {
  const all = helpTopics();
  const q = query.trim().toLowerCase();
  if (!q) return all;
  return all.filter((t) =>
    t.title.toLowerCase().includes(q) ||
    t.section.toLowerCase().includes(q) ||
    t.keywords.some((k) => k.toLowerCase().includes(q)) ||
    textOf(t.body).toLowerCase().includes(q),
  );
}
