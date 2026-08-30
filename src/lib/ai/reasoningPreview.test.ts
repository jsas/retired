import { describe, it, expect } from 'vitest';
import { reasoningTail } from './reasoningPreview';

describe('reasoningTail', () => {
  it('returns short reasoning unchanged', () => {
    expect(reasoningTail('CPP at 65 is reduced.')).toBe('CPP at 65 is reduced.');
  });

  it('uses the last line for line-per-step models (DeepSeek style)', () => {
    const reasoning = 'First I check the age.\nThen the CPP reduction.\nFinally the drawdown order.';
    expect(reasoningTail(reasoning)).toBe('Finally the drawdown order.');
  });

  it('shows the LIVE TAIL of a long prose paragraph (glm style), not its first line', () => {
    // Prose-style reasoners stream one long unbroken paragraph; the old
    // last-non-empty-LINE preview pinned its opening words for the whole
    // stream. The header must show the most recent words instead.
    const head = "You're doing very well — honestly, this plan is over-funded. Here's the picture: ";
    const tail = 'net worth holds past 95 because RRIF minimums alone cover the gap';
    const preview = reasoningTail(head + tail);
    expect(preview).toContain('RRIF minimums alone cover the gap');
    expect(preview.startsWith('…')).toBe(true);
    expect(preview.length).toBeLessThanOrEqual(91); // ellipsis + ≤90 chars
    expect(preview).not.toContain('over-funded');
  });

  it('keeps the tail as the stream grows (simulated streaming)', () => {
    let reasoning = 'Step one. ';
    const seen: string[] = [];
    for (const chunk of ['Step two. ', 'Step three with a much longer explanation that runs well past ninety characters in total length.']) {
      reasoning += chunk;
      seen.push(reasoningTail(reasoning));
    }
    expect(seen[0]).toBe('Step one. Step two.');
    // Once over the cap, the preview tracks the END, not the first line.
    expect(seen[1]).toContain('total length.');
    expect(seen[1]).not.toContain('Step one.');
  });

  it('collapses whitespace runs inside the previewed line for a clean header', () => {
    expect(reasoningTail('line one\n\nline   two\tafter tab')).toBe('line two after tab');
  });

  it('falls back to the flattened tail when the stream ends on a newline', () => {
    expect(reasoningTail('first step\nsecond step\n')).toBe('first step second step');
  });

  it('handles empty and whitespace-only input', () => {
    expect(reasoningTail('')).toBe('');
    expect(reasoningTail('   \n ')).toBe('');
  });

  it('hard-clips on a word boundary when possible, mid-word only when no space fits', () => {
    const noSpaces = 'x'.repeat(120);
    expect(reasoningTail(noSpaces)).toBe(`…${'x'.repeat(90)}`);
  });
});
