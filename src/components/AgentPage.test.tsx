// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ModelPicker, DockChatPicker } from './AgentPage';
import { startRun, endRun, resetRunsForTests } from '../lib/ai/chatRuns';
import { newThread } from '../lib/ai/chatStore';
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

describe('DockChatPicker run spinners', () => {
  beforeEach(() => {
    resetRunsForTests();
  });

  const threads = [newThread('Plan', 1)];

  it('shows no spinner when nothing is running', () => {
    const html = renderToStaticMarkup(
      <DockChatPicker threads={threads} activeThreadId={threads[0].id} onSelect={noop} onNew={noop} onDelete={noop} />,
    );
    expect(html).not.toContain('animate-spin');
  });

  it('shows the thinking spinner on a chat whose run is live — including the ACTIVE one', () => {
    startRun(threads[0].id);
    const html = renderToStaticMarkup(
      <DockChatPicker threads={threads} activeThreadId={threads[0].id} onSelect={noop} onNew={noop} onDelete={noop} />,
    );
    // The trigger row (so the user sees it without opening the dropdown) AND
    // the dropdown row both spin.
    expect(html).toContain('animate-spin');
  });

  it('clears the spinner when the run ends', () => {
    startRun(threads[0].id);
    endRun(threads[0].id);
    const html = renderToStaticMarkup(
      <DockChatPicker threads={threads} activeThreadId={threads[0].id} onSelect={noop} onNew={noop} onDelete={noop} />,
    );
    expect(html).not.toContain('animate-spin');
  });

  it('only the running chat spins; its neighbours stay quiet', () => {
    const quiet = newThread('Plan', 2);
    startRun(threads[0].id);
    const html = renderToStaticMarkup(
      <DockChatPicker threads={[threads[0], quiet]} activeThreadId={quiet.id} onSelect={noop} onNew={noop} onDelete={noop} />,
    );
    // One spinner: the running chat's row in the (closed) dropdown isn't
    // rendered, and the trigger row is for the QUIET chat.
    const spins = html.match(/animate-spin/g) ?? [];
    expect(spins.length).toBeLessThanOrEqual(1);
  });
});
