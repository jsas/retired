// @vitest-environment jsdom
// `Num` is the only number box in the app, and the plan must never see a value
// it cannot do arithmetic with: `NaN` reaches the engine, autosave's JSON
// round-trip turns it into `null`, and the engine reads `null` as 0. So the
// static-markup suite can't cover this — the contract is about events.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act, useState } from 'react';
import { Num } from './primitives';

// React 19 needs this to recognize act() outside @testing-library/react.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement;
let root: Root;

/** The app's shape: the box owns nothing, the plan holds the value. */
function Field({ onCommit }: { onCommit: (v: number) => void }) {
  const [balance, setBalance] = useState(50000);
  return (
    <>
      <Num label="RDSP balance" value={balance} onChange={(v) => { setBalance(v); onCommit(v); }} />
      <span data-testid="plan">{JSON.stringify({ balance })}</span>
    </>
  );
}

/** React tracks the value itself; only the prototype setter looks like typing. */
function type(text: string) {
  const input = host.querySelector('input') as HTMLInputElement;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setValue.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

// React reports a blur as focusout.
const blur = () => act(() => {
  (host.querySelector('input') as HTMLInputElement).dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
});
const box = () => (host.querySelector('input') as HTMLInputElement).value;
const plan = () => host.querySelector('[data-testid="plan"]')!.textContent!;

/** A field whose blank is a real value: contribution room with no limit. */
function RoomField({ onClear }: { onClear: () => void }) {
  const [room, setRoom] = useState<number | null>(20000);
  return (
    <Num label="TFSA room" value={room ?? NaN}
      onChange={(v) => setRoom(v)}
      onClear={() => { setRoom(null); onClear(); }} />
  );
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('Num', () => {
  it('shows the plan value', () => {
    const commit = vi.fn();
    act(() => root.render(<Field onCommit={commit} />));
    expect(box()).toBe('50000');
  });

  it('sends a typed number to the plan', () => {
    const commit = vi.fn();
    act(() => root.render(<Field onCommit={commit} />));
    type('42000');
    expect(commit).toHaveBeenCalledWith(42000);
    expect(plan()).toBe('{"balance":42000}');
  });

  it('empties without sending NaN, and never writes null into the plan', () => {
    const commit = vi.fn();
    act(() => root.render(<Field onCommit={commit} />));
    type('');
    expect(box()).toBe('');            // the user sees their own edit
    expect(commit).not.toHaveBeenCalled();
    expect(plan()).toBe('{"balance":50000}');
  });

  it('sends nothing for a half-typed value', () => {
    const commit = vi.fn();
    act(() => root.render(<Field onCommit={commit} />));
    type('1e');                        // an invalid number reads as empty to the DOM
    expect(commit).not.toHaveBeenCalled();
    expect(plan()).toBe('{"balance":50000}');
  });

  it('restores the plan value when an emptied box loses focus', () => {
    const commit = vi.fn();
    act(() => root.render(<Field onCommit={commit} />));
    type('');
    blur();
    expect(box()).toBe('50000');       // no box lying about the plan it holds
    expect(commit).not.toHaveBeenCalled();
  });
});

describe('Num with a clear channel', () => {
  it('lets blank mean “no limit”, and leaves the box blank', () => {
    const onClear = vi.fn();
    act(() => root.render(<RoomField onClear={onClear} />));
    expect(box()).toBe('20000');
    type('');
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(box()).toBe('');
    blur();
    expect(box()).toBe('');       // nothing to restore: the plan really is empty
  });
});
