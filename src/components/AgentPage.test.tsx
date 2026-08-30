// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ModelPicker } from './AgentPage';
import type { AiSettings } from '../lib/aiSettings';

const noConnections: AiSettings = {
  connections: [],
  activeConnectionId: null,
  prompts: [],
};

const oneConnection: AiSettings = {
  connections: [
    { id: 'c1', provider: 'webllm', label: 'Local', apiKey: '', model: 'm1' },
  ],
  activeConnectionId: 'c1',
  prompts: [],
};

const noop = () => {};

describe('ModelPicker', () => {
  it('renders nothing when no connections exist (OfflineAssistant owns the CTA)', () => {
    const html = renderToStaticMarkup(
      <ModelPicker settings={noConnections} activeId={null} onChoose={noop} onLoadModel={noop} />,
    );
    expect(html).toBe('');
  });

  it('renders the select with a single Load a model… option when connections exist', () => {
    const html = renderToStaticMarkup(
      <ModelPicker settings={oneConnection} activeId="c1" onChoose={noop} onLoadModel={noop} />,
    );
    expect(html).toContain('<select');
    expect(html.match(/Load a model/g)?.length).toBe(1);
    expect(html).toContain('__load__');
  });
});
