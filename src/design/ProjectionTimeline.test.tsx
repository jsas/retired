// @vitest-environment node
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { ProjectionTimeline } from './ProjectionTimeline';
import { RED_DOT as RED } from './tokens';

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
          { age: 60, label: 'start drawing · 60' },
        ],
      }),
    );
    expect(html).toContain('you · 50');
    expect(html).toContain('start drawing · 60');
  });

  it('says why when there is nothing to draw (a zero-savings plan)', () => {
    // Every value 0 degenerates the axis ($0 top label, flat line) — the
    // chart must show the plain-English empty state instead of the lines.
    const empty = [{ id: 'a', label: 'Plan', points: [{ age: 65, value: 0 }, { age: 90, value: 0 }] }];
    const html = renderToStaticMarkup(createElement(ProjectionTimeline, { series: empty }));
    expect(html).toContain('Nothing to draw');
    expect(html).not.toContain('d="M'); // no balance lines drawn
  });

  it('the strips stay OFF unless an interactive handler arrives', () => {
    // Read-only surfaces (Compare, print) pass no callbacks — the viewBox
    // must not grow and no strip chrome may render.
    const html = renderToStaticMarkup(createElement(ProjectionTimeline, { series }));
    expect(html).not.toContain('>market<');
    expect(html).not.toContain('rotate-45'); // the event legend diamonds
    expect(html).not.toContain('cursor-crosshair');
    // With handlers, the strips appear (legend entries at minimum).
    const live = renderToStaticMarkup(
      createElement(ProjectionTimeline, {
        series,
        spend: { points: [{ age: 50, value: 60000 }, { age: 90, value: 90000 }], baseSpend: 60000 },
        events: [{ id: 'e1', age: 55, amount: 10000, direction: 'out', label: 'Car' }],
        anchors: [{ id: 'a1', age: 60, return: 0.05 }],
        onSpendChange: () => {},
        onEventChange: () => {},
        onAnchorsChange: () => {},
      }),
    );
    expect(live).toContain(' spend</span>');
    expect(live).toContain(' events</span>');
    expect(live).toContain(' market</span>');
    // The event diamond renders as a rose square (out = money leaves).
    expect(live).toContain(`fill="${RED}"`);
  });

  it('the market strip renders the volatility curve only for anchors carrying σ', () => {
    const withVol = renderToStaticMarkup(
      createElement(ProjectionTimeline, {
        series,
        anchors: [
          { id: 'a1', age: 60, return: 0.05 },
          { id: 'a2', age: 68, return: -0.15, volatility: 0.25 },
        ],
        onAnchorsChange: () => {},
      }),
    );
    // Violet return curve + amber dashed volatility curve.
    expect(withVol).toContain('stroke="#7c3aed"');
    expect(withVol).toContain('stroke="#f59e0b"');
    // No anchor selected on mount -> no delete affordance.
    expect(withVol).not.toContain('Delete this anchor');

    const noVol = renderToStaticMarkup(
      createElement(ProjectionTimeline, {
        series,
        anchors: [{ id: 'a1', age: 60, return: 0.05 }],
        onAnchorsChange: () => {},
      }),
    );
    expect(noVol).toContain('stroke="#7c3aed"');
    expect(noVol).not.toContain('stroke="#f59e0b"');
  });

  it('each anchor shows its % beside the handle (no hover needed)', () => {
    const html = renderToStaticMarkup(
      createElement(ProjectionTimeline, {
        series,
        anchors: [
          { id: 'a1', age: 60, return: 0.05 },
          { id: 'a2', age: 68, return: -0.15, volatility: 0.25 },
        ],
        onAnchorsChange: () => {},
      }),
    );
    expect(html).toContain('>5.0%</text>');
    expect(html).toContain('>-15.0%</text>');
    expect(html).toContain('>25%</text>');
  });

  it('a pin with onDragAge renders the drag affordance; plain pins stay static', () => {
    const live = renderToStaticMarkup(
      createElement(ProjectionTimeline, {
        series,
        pins: [{ age: 62, label: 'start drawing · 62', onDragAge: () => {} }],
      }),
    );
    expect(live).toContain('cursor-ew-resize');
    const still = renderToStaticMarkup(
      createElement(ProjectionTimeline, {
        series,
        pins: [{ age: 62, label: 'start drawing · 62' }],
      }),
    );
    expect(still).not.toContain('cursor-ew-resize');
  });
});
