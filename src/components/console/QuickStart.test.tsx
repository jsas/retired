// @vitest-environment jsdom
// The set-up card is the intro screen's replacement, so its contract is the
// one the wizard used to own: the four fields start at the plan's own numbers,
// a bad number stops the button instead of writing a nonsense plan, and the
// button hands up answers + "is this somebody else's example?" — the flag that
// decides whether the example gets overwritten. Also pins when the card earns
// its space at the top of the Dashboard.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { createElement } from 'react';
import type { RetirementInputs } from '@retired/engine-core/retirementEngine';
import { baselineInputs } from '@retired/engine-core/exampleScenarios';
import { baseInputs } from '../../../packages/engine-core/test/helpers';
import { i18n } from '../../lib/i18n';
import {
  QuickStart, quickStartPlan, setupCardVisible, setupError, setupPrefill,
  type SetupAnswers,
} from './QuickStart';

// React 19 needs this to recognize act() outside @testing-library/react.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ANSWERS: SetupAnswers = { currentAge: 44, retirementAge: 60, savings: 350000, spending: 60000 };

describe('setupPrefill', () => {
  it('reads the pot across all four accounts, not just the registered ones', () => {
    const inputs = baseInputs({
      rrspBalance: 120000, tfsaBalance: 40000, taxableBalance: 7000, cashCushionBalance: 3000,
    } as Partial<RetirementInputs>);
    expect(setupPrefill(inputs)).toEqual({
      currentAge: 65, retirementAge: 65, savings: 170000, spending: 20000,
    });
  });

  it('treats a plan with no retirement age as ten years out', () => {
    expect(setupPrefill(baseInputs({ retirementAge: undefined } as Partial<RetirementInputs>)).retirementAge)
      .toBe(75);
  });

  it('reads a starter plan as zero savings rather than undefined', () => {
    expect(setupPrefill(baselineInputs()).savings).toBe(0);
  });
});

describe('setupError', () => {
  it('accepts a coherent set of answers', () => {
    expect(setupError(ANSWERS)).toBeNull();
  });

  it('rejects ages outside the working range', () => {
    expect(setupError({ ...ANSWERS, currentAge: 29 })).toBe('age');
    expect(setupError({ ...ANSWERS, currentAge: 101 })).toBe('age');
    // Retiring in the past is the mistake the old wizard actually allowed.
    expect(setupError({ ...ANSWERS, retirementAge: 43 })).toBe('retireAge');
    expect(setupError({ ...ANSWERS, retirementAge: 44 })).toBeNull();
  });

  it('rejects blanks and negatives, but not zero savings', () => {
    expect(setupError({ ...ANSWERS, savings: NaN })).toBe('savings');
    expect(setupError({ ...ANSWERS, savings: -1 })).toBe('savings');
    expect(setupError({ ...ANSWERS, savings: 0 })).toBeNull();
    expect(setupError({ ...ANSWERS, spending: NaN })).toBe('spending');
    // A year on $4k is a modelling artifact, not a plan.
    expect(setupError({ ...ANSWERS, spending: 4999 })).toBe('spending');
  });

  it('names the earliest problem only, so one message shows at a time', () => {
    expect(setupError({ currentAge: 5, retirementAge: 2, savings: -1, spending: 0 })).toBe('age');
  });
});

describe('quickStartPlan', () => {
  it('splits the pot 60/40 RRSP/TFSA and clears the accounts it never asked about', () => {
    const base = baseInputs({
      rrspBalance: 999, taxableBalance: 500000, cashCushionBalance: 12000,
    } as Partial<RetirementInputs>);
    const next = quickStartPlan(base, { ...ANSWERS, savings: 100001 });
    expect(next.rrspBalance).toBe(60001); // rounds to the dollar
    expect(next.tfsaBalance).toBe(40000);
    expect(next.rrspBalance + next.tfsaBalance).toBe(100001);
    expect(next.taxableBalance).toBe(0);
    expect(next.cashCushionBalance).toBe(0);
  });

  it('writes the four answers and leaves every other register alone', () => {
    const base = baseInputs({ desiredSpending: 20000 } as Partial<RetirementInputs>);
    const next = quickStartPlan(base, ANSWERS);
    expect(next).toMatchObject({
      currentAge: 44, retirementAge: 60, desiredSpending: 60000,
      provinceCode: base.provinceCode, investmentReturn: base.investmentReturn,
      withdrawalOrder: base.withdrawalOrder,
    });
  });
});

describe('setupCardVisible', () => {
  const own = baseInputs();            // someone's real plan ($500k TFSA)
  const blank = baselineInputs();      // a New-Scenario starter

  it('shows on a stock example or a blank plan, and never on the user’s own', () => {
    const opts = { alwaysShow: false, dismissed: false };
    expect(setupCardVisible({ ...opts, planIsExample: true, inputs: own })).toBe(true);
    expect(setupCardVisible({ ...opts, planIsExample: false, inputs: blank })).toBe(true);
    expect(setupCardVisible({ ...opts, planIsExample: false, inputs: own })).toBe(false);
  });

  it('honours Settings over a dismissal, and a dismissal over an example', () => {
    expect(setupCardVisible({
      alwaysShow: true, dismissed: true, planIsExample: false, inputs: own,
    })).toBe(true);
    expect(setupCardVisible({
      alwaysShow: false, dismissed: true, planIsExample: true, inputs: blank,
    })).toBe(false);
  });
});

// The card's own controls are found by what they say, not by position: the
// Panel header renders a Help `?` button ahead of them. The four number fields
// keep their order (age, retire-at, savings, spending), so those stay positional.
function fields(host: HTMLElement) {
  return [...host.querySelectorAll<HTMLInputElement>('input[type="number"]')];
}

function named(host: HTMLElement, key: 'go' | 'dismiss') {
  const label = i18n.t(`start:${key}`);
  const btn = [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === label);
  if (!(btn instanceof HTMLButtonElement)) throw new Error(`no ${key} button rendered`);
  return btn;
}

// React remembers the value it wrote, so a bare `input.value = …` reads as no
// change and onChange never fires. Type through the native setter, the way a
// keystroke does, and React sees a real edit.
function typeNumber(input: HTMLInputElement, value: string) {
  const native = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!native) throw new Error('no native value setter for <input>');
  act(() => {
    native.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('the set-up card', () => {
  let host: HTMLElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function renderCard(inputs: RetirementInputs, planIsExample: boolean,
    onStart = vi.fn(), onDismiss = vi.fn()) {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(createElement(QuickStart, { inputs, planIsExample, onStart, onDismiss }));
    });
    return { onStart, onDismiss };
  }

  it('starts at the plan’s own numbers instead of a blank form', () => {
    renderCard(baseInputs({
      currentAge: 51, retirementAge: 62, tfsaBalance: 200000, rrspBalance: 100000, desiredSpending: 45000,
    } as Partial<RetirementInputs>), false);
    expect(fields(host).map(i => i.value)).toEqual(['51', '62', '300000', '45000']);
    expect(named(host, 'go').disabled).toBe(false);
  });

  it('refuses to write a plan from an impossible age', () => {
    renderCard(baseInputs(), false);
    const age = fields(host)[0];
    typeNumber(age, '5');
    expect(named(host, 'go').disabled).toBe(true);
    expect(host.querySelector('[role="status"]')?.textContent).toBeTruthy();
  });

  it('hands up the edited answers, and says when the plan on screen is an example', () => {
    const own = renderCard(baseInputs(), false);
    const spending = fields(host)[3];
    typeNumber(spending, '72000');
    act(() => { named(host, 'go').click(); });
    expect(own.onStart).toHaveBeenCalledWith(
      { currentAge: 65, retirementAge: 65, savings: 500000, spending: 72000 }, false,
    );

    act(() => root.unmount());
    const example = renderCard(baseInputs(), true);
    act(() => { named(host, 'go').click(); });
    // The second argument is what keeps the example from being edited in place.
    expect(example.onStart).toHaveBeenLastCalledWith(
      { currentAge: 65, retirementAge: 65, savings: 500000, spending: 20000 }, true,
    );
  });

  it('dismissal is its own action, not a way to skip into a plan', () => {
    const { onStart, onDismiss } = renderCard(baseInputs(), true);
    act(() => { named(host, 'dismiss').click(); });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onStart).not.toHaveBeenCalled();
  });
});
