import { describe, it, expect } from 'vitest';
import {
  loadChats, saveChats, newThread, newThreadId, titleFromFirstMessage,
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
