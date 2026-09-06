// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ModelPickerSelect } from './AgentPage';
import { buildModelCatalog } from '../lib/modelCatalog';
import type { AiConnection } from '../lib/aiSettings';

const noop = () => {};

const localOnly = buildModelCatalog([]);

describe('ModelPickerSelect', () => {
  it('always lists on-computer models even with no connections (downloadable)', () => {
    const html = renderToStaticMarkup(
      <ModelPickerSelect entries={localOnly} activeKey={null} onPick={noop} onLoadModel={noop} />,
    );
    expect(html).toContain('<select');
    expect(html).toContain('Qwen3.5 4B');
    expect(html).toContain('__load__');
    expect(html).toContain('More models');
  });

  it('lists every ready connection’s models alongside the locals', () => {
    const gemini: AiConnection = {
      id: 'g1', provider: 'gemini', label: 'My key', apiKey: 'k', model: 'm-default',
    };
    const entries = buildModelCatalog([gemini], {
      cloudLists: { g1: [{ id: 'gemini-2.5-flash', detail: 'Gemini 2.5 Flash' }] },
    });
    const html = renderToStaticMarkup(
      <ModelPickerSelect entries={entries} activeKey="g1:gemini-2.5-flash" onPick={noop} onLoadModel={noop} />,
    );
    expect(html).toContain('Gemini 2.5 Flash');
    expect(html).toContain('My key');
    expect(html.match(/More models/g)?.length).toBe(1);
  });
});
