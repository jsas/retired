// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  HELP_TOPICS,
  HELP_SECTIONS,
  helpTopic,
  searchHelpTopics,
} from './topics';

describe('HELP_TOPICS data source', () => {
  it('every topic has a unique kebab-case id', () => {
    const ids = HELP_TOPICS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it('every topic has title, non-empty body, keywords, and a known section', () => {
    for (const t of HELP_TOPICS) {
      expect(t.title.length).toBeGreaterThan(0);
      expect(Array.isArray(t.keywords)).toBe(true);
      expect(HELP_SECTIONS).toContain(t.section);
      const html = renderToStaticMarkup(<>{t.body}</>);
      expect(html.length).toBeGreaterThan(0);
    }
  });

  it('every section has at least one topic', () => {
    for (const s of HELP_SECTIONS) {
      expect(HELP_TOPICS.some((t) => t.section === s)).toBe(true);
    }
  });

  it('helpTopic resolves by id and returns undefined for unknown', () => {
    expect(helpTopic('cpp-start-age')?.title).toContain('CPP');
    expect(helpTopic('nope-not-a-topic')).toBeUndefined();
  });

  it('bodies render the interpolated TFSA limit', () => {
    const html = renderToStaticMarkup(<>{helpTopic('contribution-room')!.body}</>);
    expect(html).toContain('$');
  });
});

describe('searchHelpTopics', () => {
  it('empty query returns everything in page order', () => {
    const all = searchHelpTopics('');
    expect(all.length).toBe(HELP_TOPICS.length);
    expect(all[0].id).toBe(HELP_TOPICS[0].id);
  });

  it('matches on title', () => {
    const hits = searchHelpTopics('clawback');
    expect(hits.some((t) => t.id === 'oas-start-age')).toBe(true);
  });

  it('matches on keywords', () => {
    const hits = searchHelpTopics('rrif');
    expect(hits.some((t) => t.id === 'rrsp' || t.id === 'rrif-conversion')).toBe(true);
  });

  it('matches on body text', () => {
    const hits = searchHelpTopics('prescribed factors');
    expect(hits.some((t) => t.id === 'rrif-conversion')).toBe(true);
  });

  it('is case-insensitive and returns [] for nonsense', () => {
    expect(searchHelpTopics('CLAWBACK').length).toBeGreaterThan(0);
    expect(searchHelpTopics('zzqxj')).toEqual([]);
  });
});
