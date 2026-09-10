import { describe, it, expect, vi } from 'vitest';
import {
  subscribeRuns, getRun, hasActiveRun, startRun, setRunPhase,
  setRunProgress, setRunDecision, takeRunDecision, abortRun, endRun,
  resetRunsForTests,
} from './chatRuns';

describe('chatRuns registry', () => {
  it('starts with no runs', () => {
    resetRunsForTests();
    expect(hasActiveRun()).toBe(false);
    expect(getRun('t1')).toBeNull();
  });

  it('registers a streaming run and reports it', () => {
    resetRunsForTests();
    startRun('t1');
    expect(getRun('t1')?.phase).toBe('streaming');
    expect(hasActiveRun()).toBe(true);
  });

  it('phase transitions and progress publish to subscribers', () => {
    resetRunsForTests();
    const listener = vi.fn();
    const unsub = subscribeRuns(listener);
    startRun('t1');
    setRunPhase('t1', 'parked');
    setRunProgress('t1', { progress: 0.5, text: 'Compiling…' });
    expect(getRun('t1')?.phase).toBe('parked');
    expect(getRun('t1')?.progress?.text).toBe('Compiling…');
    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(3);
    unsub();
  });

  it('progress updates for an unknown thread are ignored', () => {
    resetRunsForTests();
    setRunProgress('ghost', { progress: 1, text: 'x' });
    setRunPhase('ghost', 'parked');
    expect(getRun('ghost')).toBeNull();
  });

  it('endRun clears the record and internals', () => {
    resetRunsForTests();
    startRun('t1');
    setRunDecision('t1', 'call-1', () => {});
    expect(takeRunDecision('t1', 'call-1')).toBeTypeOf('function');
    endRun('t1');
    expect(getRun('t1')).toBeNull();
    expect(hasActiveRun()).toBe(false);
    // Internals are gone too.
    expect(takeRunDecision('t1', 'call-1')).toBeUndefined();
  });

  it('abortRun fires the run\'s abort controller', () => {
    resetRunsForTests();
    const abort = startRun('t1');
    abortRun('t1');
    expect(abort.signal.aborted).toBe(true);
    endRun('t1');
  });

  it('decisions are get-and-delete (each resolver resolves once)', () => {
    resetRunsForTests();
    startRun('t1');
    setRunDecision('t1', 'call-1', () => {});
    expect(takeRunDecision('t1', 'call-1')).toBeDefined();
    expect(takeRunDecision('t1', 'call-1')).toBeUndefined();
    endRun('t1');
  });

  it('runs are independent per thread', () => {
    resetRunsForTests();
    startRun('t1');
    startRun('t2');
    setRunPhase('t2', 'parked');
    expect(getRun('t1')?.phase).toBe('streaming');
    expect(getRun('t2')?.phase).toBe('parked');
    endRun('t1');
    expect(hasActiveRun()).toBe(true);
    endRun('t2');
    expect(hasActiveRun()).toBe(false);
  });
});
