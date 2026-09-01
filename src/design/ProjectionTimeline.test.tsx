// @vitest-environment node
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { ProjectionTimeline } from './ProjectionTimeline';

const series = [
  { id: 'a', label: 'Retire Together', points: [{ age: 50, value: 1000000 }, { age: 90, value: 500000 }] },
  { id: 'b', label: 'Pierre', points: [{ age: 50, value: 900000 }, { age: 90, value: 0 }] },
];

describe('ProjectionTimeline', () => {
  it('renders one legend entry and one line per series', () => {
    const html = renderToStaticMarkup(createElement(ProjectionTimeline, { series }));
    expect(html).toContain('Retire Together');
    expect(html).toContain('Pierre');
    expect(html.match(/<path/g)?.length).toBe(2);
  });

  it('renders overlay lines (spend, market) with their own legend entries', () => {
    const html = renderToStaticMarkup(
      createElement(ProjectionTimeline, {
        series,
        overlays: [{ id: 'spend', label: 'spend', color: '#059669', points: [{ age: 50, value: 60000 }, { age: 90, value: 90000 }] }],
      }),
    );
    expect(html).toContain('spend');
    expect(html.match(/<path/g)?.length).toBe(3);
  });

  it('draws the retirement marker as a dashed line or a square dot', () => {
    const line = renderToStaticMarkup(
      createElement(ProjectionTimeline, { series, marker: { age: 62, style: 'line' } }),
    );
    expect(line).toContain('stroke-dasharray="5 3"');
    const dot = renderToStaticMarkup(
      createElement(ProjectionTimeline, { series, marker: { age: 50, style: 'dot' } }),
    );
    expect(dot).not.toContain('stroke-dasharray="5 3"');
    expect(dot).toContain('fill="#f59e0b"');
  });

  it('renders labelled pins and the dashboard-style axis ticks', () => {
    const html = renderToStaticMarkup(
      createElement(ProjectionTimeline, {
        series,
        pins: [
          { age: 50, label: 'you · 50', place: 'below', anchor: 'start' },
          { age: 60, label: 'work ends · 60' },
        ],
      }),
    );
    expect(html).toContain('you · 50');
    expect(html).toContain('work ends · 60');
  });

  it('says why when there is nothing to draw (a zero-savings plan)', () => {
    // Every value 0 degenerates the axis ($0 top label, flat line) — the
    // chart must show the plain-English empty state instead of the lines.
    const empty = [{ id: 'a', label: 'Plan', points: [{ age: 65, value: 0 }, { age: 90, value: 0 }] }];
    const html = renderToStaticMarkup(createElement(ProjectionTimeline, { series: empty }));
    expect(html).toContain('Nothing to draw');
    expect(html).not.toContain('d="M'); // no balance lines drawn
  });
});
