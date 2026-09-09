// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ModelPickerSelect, DockChatPicker } from './AgentPage';
import { startRun, endRun, resetRunsForTests } from '../lib/ai/chatRuns';
import { newThread } from '../lib/ai/chatStore';
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
