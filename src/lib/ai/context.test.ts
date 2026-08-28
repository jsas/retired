import { describe, it, expect } from 'vitest';
import {
  CHARS_PER_TOKEN, defaultContextSize, estimateTokens, planCompaction, summaryNote,
} from './context';
import type { ChatMessage } from './providers';

const user = (content: string): ChatMessage => ({ role: 'user', content });
const assistant = (content: string): ChatMessage => ({ role: 'assistant', content });

describe('estimateTokens', () => {
  it('counts system + message characters at ~4 chars/token', () => {
    const system = 'x'.repeat(100);
    const messages = [user('y'.repeat(40))];
    // (100 + 40 + 8 framing) / 4 = 37
    expect(estimateTokens(system, messages)).toBe(Math.ceil(148 / CHARS_PER_TOKEN));
  });

  it('includes tool calls and results', () => {
    const withTools = estimateTokens('', [
      { role: 'assistant', content: '', toolCalls: [{ id: 'c', name: 'run_projection', args: { withSpending: true } }] },
      { role: 'user', content: '', toolResults: [{ toolCallId: 'c', content: 'z'.repeat(200) }] },
    ]);
    const without = estimateTokens('', [assistant('')]);
    expect(withTools).toBeGreaterThan(without);
  });
});

describe('defaultContextSize', () => {
  it('gives local web-llm models a modest window and cloud a large one', () => {
    // 16384: big enough that the plan digest + tool catalog + history aren't
    // compacted into incoherence (the 8192 default caused word-salad rambles),
    // small enough to compile on a mid-range GPU. Cloud gets a large window.
    expect(defaultContextSize('webllm')).toBe(16384);
    expect(defaultContextSize('openai')).toBeGreaterThan(16384);
  });
});

describe('planCompaction', () => {
  const bigContext = 1_000_000;

  it('passes history through untouched when it fits', () => {
    const messages = [user('hello'), assistant('hi there')];
    const plan = planCompaction({ system: 's', messages, contextSize: bigContext });
    expect(plan.compacted).toBe(false);
    expect(plan.messages).toEqual(messages);
    expect(plan.excerptToDigest).toBe('');
  });

  it('compacts the oldest turns when over the trigger, keeping a verbatim tail', () => {
    const long = 'lorem ipsum '.repeat(60); // ~720 chars each
    const messages = [
      user(long), assistant(long), user(long), assistant(long),
      user(long), assistant(long), user(long), assistant(long),
      user('recent question'), assistant('recent answer'),
    ];
    const contextSize = 600; // trigger at 480 tokens
    const plan = planCompaction({ system: 'sys', messages, contextSize, keepRecent: 2 });
    expect(plan.compacted).toBe(true);
    // The recent verbatim tail is preserved.
    expect(plan.messages.at(-1)).toEqual(assistant('recent answer'));
    expect(plan.messages.at(-2)).toEqual(user('recent question'));
    // The first message is the digest note, NOT a verbatim copy of the dropped
    // history (a copy wouldn't save any space — the digest is model-written).
    expect(plan.messages[0].role).toBe('user');
    expect(plan.messages[0].content).toContain('compacted');
    // The excerpt handed back for digesting covers the dropped turns.
    expect(plan.excerptToDigest).toContain('lorem ipsum');
  });

  it('always keeps the recent verbatim tail even when very long', () => {
    const long = 'x'.repeat(4000);
    const messages = [user(long), assistant(long), user('now'), assistant('answer')];
    const plan = planCompaction({ system: '', messages, contextSize: 200, keepRecent: 2 });
    // Even though the kept tail alone exceeds the window, the recent exchange
    // is preserved — the model must not lose the immediate thread.
    expect(plan.messages.at(-1)).toEqual(assistant('answer'));
    expect(plan.messages.at(-2)).toEqual(user('now'));
  });

  it('threads a prior digest into the note and the excerpt', () => {
    const prior = 'User is 60, RRSP $500k, wants to retire at 62.';
    const long = 'y'.repeat(3000);
    const messages = [user(long), assistant(long), user('q'), assistant('a')];
    const plan = planCompaction({ system: '', messages, contextSize: 200, priorSummary: prior, keepRecent: 2 });
    expect(plan.compacted).toBe(true);
    expect(plan.messages[0].content).toContain(prior);
    expect(plan.excerptToDigest).toContain(prior);
  });

  it('the digest note wraps whatever digest it is given', () => {
    expect(summaryNote('User is 60.')).toContain('User is 60.');
    expect(summaryNote('')).toContain('(no digest yet');
  });
});
