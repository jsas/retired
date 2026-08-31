// @vitest-environment node
// Smoke tests for the design system: every primitive renders, tokens carry
// the documented values, and the verdict colours stay semantic. These guard
// the style guide's promise that the page and the code can't drift.
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import * as T from './tokens';
import {
  VerdictHero, Panel, Fader, Chip, Stat, AccountBars, Legend, Dropdown, Footnote, AppHeader,
} from './primitives';

const render = (el: React.ReactElement) => renderToStaticMarkup(el);

describe('design tokens', () => {
  it('carries the documented verdict palette', () => {
    expect(T.BLUE).toBe('#1d4ed8');
    expect(T.BLUE_DEEP).toBe('#1e3a8a');
    expect(T.RED_TEXT).toBe('#be123c');
    expect(T.AMBER_TEXT).toBe('#b45309');
    expect(T.HAIRLINE).toBe('#e2e8f0');
  });

  it('exposes shared class fragments', () => {
    expect(T.cls.sectionLabel).toContain('uppercase');
    expect(T.cls.primaryBtn).toContain('bg-slate-900');
    expect(T.NUM_CLASS).toBe('num');
  });
});

describe('primitives render', () => {
  it('VerdictHero renders eyebrow, verdict and sub', () => {
    const html = render(<VerdictHero verdict="Your money lasts to 95." sub="Spending $85k." />);
    expect(html).toContain('Your money lasts to 95.');
    expect(html).toContain('The verdict');
    expect(html).toContain('Spending $85k.');
  });

  it('Panel renders a label and children', () => {
    const html = render(<Panel label="The rules"><p>body</p></Panel>);
    expect(html).toContain('The rules');
    expect(html).toContain('body');
  });

  it('Fader renders a labelled range input with tabular value', () => {
    const html = render(
      <Fader label="Spend a year" value={85000} min={40000} max={160000} step={1000}
        format={(v) => '$' + v.toLocaleString()} onChange={() => {}} />,
    );
    expect(html).toContain('type="range"');
    expect(html).toContain('Spend a year');
    expect(html).toContain('fader');
    expect(html).toContain('num');
  });

  it('Chip colours the dot by tone', () => {
    expect(render(<Chip tone="holds" title="ok" />)).toContain(T.BLUE);
    expect(render(<Chip tone="short" title="bad" />)).toContain(T.RED_DOT);
    expect(render(<Chip tone="borderline" title="edge" />)).toContain(T.AMBER_DOT);
  });

  it('Stat applies verdict tone to the value', () => {
    expect(render(<Stat label="x" value="95" tone="holds" />)).toContain('text-blue-700');
    expect(render(<Stat label="x" value="80" tone="short" />)).toContain('text-rose-700');
    expect(render(<Stat label="x" value="1" />)).toContain('text-slate-900');
  });

  it('AccountBars renders proportional bars', () => {
    const html = render(
      <AccountBars total={1000} rows={[{ label: 'TFSA', value: 500, active: true }]} />,
    );
    expect(html).toContain('TFSA');
    expect(html).toContain('width:50%');
    expect(html).toContain('bg-blue-700');
  });

  it('Legend renders the swatch kinds', () => {
    const html = render(
      <Legend items={[
        { swatch: 'line-blue', label: 'boundary' },
        { swatch: 'box-blue', label: 'holds' },
        { swatch: 'box-rose', label: 'short' },
      ]} />,
    );
    expect(html).toContain('boundary');
    expect(html).toContain('border-blue-300');
    expect(html).toContain('bg-rose-100');
  });

  it('Dropdown renders its trigger label', () => {
    expect(render(<Dropdown label="Details"><p>menu</p></Dropdown>)).toContain('Details');
  });

  it('Footnote and AppHeader render', () => {
    expect(render(<Footnote>not advice</Footnote>)).toContain('not advice');
    expect(render(<AppHeader><span>x</span></AppHeader>)).toContain('RE:');
  });
});
