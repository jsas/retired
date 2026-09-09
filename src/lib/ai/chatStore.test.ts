import { describe, it, expect } from 'vitest';
import {
  loadChats, saveChats, newThread, newThreadId, titleFromFirstMessage,
  getChats, subscribeChats, updateChats, setChats, resetChatsForTests,
  type ChatStore, type StoredTurn,
} from './chatStore';

function kv() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
  };
}

function turn(text: string): StoredTurn {
  return { id: `t-${text}`, role: 'user', text, tools: [], changes: [] };
}

describe('chatStore persistence', () => {
  it('round-trips threads with their full transcript', () => {
    const store: ChatStore = {
      threads: [{
        ...newThread('My plan', 1000),
        title: 'Am I on track?',
        turns: [turn('Am I on track?'), { ...turn('Yes, to 95.'), role: 'assistant', state: 'done' }],
      }],
      activeThreadId: null,
    };
    store.activeThreadId = store.threads[0].id;
    const mem = kv();
    saveChats(store, mem);
    const loaded = loadChats(mem);
    expect(loaded.threads).toHaveLength(1);
    expect(loaded.threads[0].title).toBe('Am I on track?');
    expect(loaded.threads[0].turns).toHaveLength(2);
    expect(loaded.threads[0].turns[1].text).toBe('Yes, to 95.');
    expect(loaded.activeThreadId).toBe(store.threads[0].id);
  });

  it('falls back to empty on corrupt or missing storage', () => {
    const mem = kv();
    expect(loadChats(mem).threads).toHaveLength(0); // nothing stored
    mem.setItem('retirement_ai_chats', '{not json');
    expect(loadChats(mem).threads).toHaveLength(0); // corrupt
    mem.setItem('retirement_ai_chats', '{"threads":"nope"}');
    expect(loadChats(mem).threads).toHaveLength(0); // wrong shape
  });

  it('drops a dangling activeThreadId to the first thread', () => {
    const store: ChatStore = {
      threads: [newThread('Plan', 1000)],
      activeThreadId: 'chat-does-not-exist',
    };
    const mem = kv();
    saveChats(store, mem);
    const loaded = loadChats(mem);
    expect(loaded.activeThreadId).toBe(store.threads[0].id);
  });

  it('survives a storage write failure without throwing', () => {
    const broken = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
    expect(() => saveChats({ threads: [], activeThreadId: null }, broken)).not.toThrow();
  });

  it('round-trips a turn paused on a decision (needs-decision + unresolved change)', () => {
    // The confirm-before-apply pause must survive a reload so the decision
    // card can be re-bound and the loop resumed — a 'streaming' state would
    // wrongly read as "still working" and offer no way back.
    const paused: StoredTurn = {
      id: 'a1', role: 'assistant', text: 'I can defer CPP for you.',
      tools: [{ id: 'm1', name: 'set_scenario_value', state: 'running' }],
      changes: [{
        callId: 'm1', patch: { cppStartAge: 70 }, label: 'Set cppStartAge',
        preview: { field: 'cppStartAge', from: null, to: 70 },
      }],
      state: 'needs-decision',
    };
    const store: ChatStore = {
      threads: [{ ...newThread('Plan', 1000), turns: [turn('defer cpp'), paused] }],
      activeThreadId: null,
    };
    store.activeThreadId = store.threads[0].id;
    const mem = kv();
    saveChats(store, mem);
    const loaded = loadChats(mem);
    const t = loaded.threads[0].turns[1];
    expect(t.state).toBe('needs-decision');
    expect(t.changes[0].resolved).toBeUndefined();
    expect(t.changes[0].patch).toEqual({ cppStartAge: 70 });
  });

  it('normalizes a turn persisted mid-stream to done (the stuck-reply fix)', () => {
    // A 'streaming' state can only be persisted by a page dying mid-reply; the
    // abort/finalize that would have flipped it never ran. Loading it as
    // 'streaming' leaves a permanently busy bubble and a cut-off conversation.
    const stuck: StoredTurn = {
      id: 'a1', role: 'assistant', text: 'partial answ…',
      tools: [], changes: [], state: 'streaming',
    };
    const store: ChatStore = {
      threads: [{ ...newThread('Plan', 1000), turns: [turn('hi'), stuck] }],
      activeThreadId: null,
    };
    store.activeThreadId = store.threads[0].id;
    const mem = kv();
    saveChats(store, mem);
    const loaded = loadChats(mem);
    expect(loaded.threads[0].turns[1].state).toBe('done');
  });

  it('round-trips checkpoints on a thread', () => {
    const store: ChatStore = {
      threads: [{
        ...newThread('Plan', 1000),
        checkpoints: [{
          id: 'cp-1', label: 'Set cppStartAge', at: 1234,
          inputs: { currentAge: 65 } as never,
        }],
      }],
      activeThreadId: null,
    };
    store.activeThreadId = store.threads[0].id;
    const mem = kv();
    saveChats(store, mem);
    const loaded = loadChats(mem);
    expect(loaded.threads[0].checkpoints).toHaveLength(1);
    expect(loaded.threads[0].checkpoints?.[0]).toMatchObject({ id: 'cp-1', label: 'Set cppStartAge' });
  });
});

describe('thread helpers', () => {
  it('generates unique thread ids', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newThreadId()));
    expect(ids.size).toBe(50);
  });

  it('titles a thread from the first message, truncated', () => {
    expect(titleFromFirstMessage('How much can I spend?')).toBe('How much can I spend?');
    const long = 'x'.repeat(80);
    expect(titleFromFirstMessage(long)).toHaveLength(48);
    expect(titleFromFirstMessage(long).endsWith('…')).toBe(true);
    expect(titleFromFirstMessage('  multi\n\nline   text ')).toBe('multi line text');
  });

  it('newThread starts empty with the scenario name and timestamps', () => {
    const t = newThread('Retirement 2026', 5000);
    expect(t.scenarioName).toBe('Retirement 2026');
    expect(t.createdAt).toBe(5000);
    expect(t.updatedAt).toBe(5000);
    expect(t.turns).toHaveLength(0);
    expect(t.title).toBe('New chat');
  });
});

// ---------------------------------------------------------------------------
// The LIVE store: background runs write turns with no component mounted
// ---------------------------------------------------------------------------

describe('live chat store (module-level)', () => {
  it('updateChats patches one thread and persists', () => {
    const store = kv();
    resetChatsForTests(store);
    const t = newThread('P', 1);
    setChats({ threads: [t], activeThreadId: t.id });
    updateChats(prev => ({
      ...prev,
      threads: prev.threads.map(x => x.id === t.id
        ? { ...x, turns: [...x.turns, { id: 'u1', role: 'user' as const, text: 'hi', tools: [], changes: [] }] }
        : x),
    }));
    expect(getChats().threads[0].turns).toHaveLength(1);
    // Persisted to the store's own KV (localStorage in the browser).
    expect(loadChats(store).threads[0].turns).toHaveLength(1);
  });

  it('notifies subscribers on every mutation', () => {
    resetChatsForTests();
    let n = 0;
    const unsub = subscribeChats(() => { n += 1; });
    updateChats(prev => ({ ...prev, activeThreadId: null }));
    expect(n).toBe(1);
    // A mutator returning null means "no change" — no notify, no save.
    updateChats(() => null);
    expect(n).toBe(1);
    unsub();
  });

  it('a background run appends turns after "unmount" (no component at all)', () => {
    // This is the regression contract for "chats keep running when I go to
    // another page": runTurn closes over updateChats + threadId, never over
    // component state, so the patch below models exactly what a streaming
    // event does after the Conversation is gone.
    resetChatsForTests();
    const t = newThread('P', 1);
    setChats({ threads: [t], activeThreadId: t.id });
    const patchTurnsOf = (threadId: string) => (mutate: (turns: StoredTurn[]) => StoredTurn[]) => {
      updateChats(prev => ({
        ...prev,
        threads: prev.threads.map(x => x.id === threadId
          ? { ...x, turns: mutate(x.turns as StoredTurn[]), updatedAt: Date.now() }
          : x),
      }));
    };
    const patch = patchTurnsOf(t.id);
    patch(prev => [...prev, { id: 'a1', role: 'assistant', text: '', tools: [], changes: [], state: 'streaming' }]);
    patch(prev => prev.map(x => x.id === 'a1' ? { ...x, text: 'streamed in the background' } : x));
    const saved = getChats().threads.find(x => x.id === t.id)!;
    expect(saved.turns).toHaveLength(1);
    expect(saved.turns[0].text).toBe('streamed in the background');
  });
});
