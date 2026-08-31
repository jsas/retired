// @vitest-environment node
// The Details page is the full plan editor: the always-present inline editors
// (income, events, debts, spouse) render inside their sections and fire onChange.
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { baseInputs } from '../../../packages/engine-core/test/helpers';
import { DetailsPage } from './DetailsPage';

// Node has no localStorage — the lever range prefs read it.
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
});

const inputs = baseInputs({ currentAge: 55, retirementAge: 62, maxAge: 90 });
const noop = () => {};
const render = (over = {}) => renderToStaticMarkup(
  createElement(DetailsPage, { inputs: { ...inputs, ...over }, onChange: noop, section: null }),
);

describe('DetailsPage inline editors', () => {
  it('renders every hint anchor including the editable collections', () => {
    const html = render();
    for (const id of ['details-profile', 'details-spouse', 'details-accounts', 'details-contributions',
      'details-income', 'details-benefits', 'details-events', 'details-spending', 'details-withdrawal', 'details-debts']) {
      expect(html, id).toContain(id);
    }
  });

  it('lists existing income sources with add and remove controls', () => {
    const html = render({ income: [{ id: 'a', label: 'Day job', kind: 'employment', annualAmount: 80000, startAge: 55, endAge: 62, indexedToCpi: true }] });
    expect(html).toContain('Day job');
    expect(html).toContain('+ add income');
    expect(html).toContain('aria-label="Remove Day job"');
  });

  it('lists existing events with in/out add controls', () => {
    const html = render({ events: [{ id: 'a', age: 62, label: 'Inheritance', amount: 100000, direction: 'in' }] });
    expect(html).toContain('Inheritance');
    expect(html).toContain('+ add money in');
    expect(html).toContain('+ add money out');
    expect(html).toContain('aria-label="Remove Inheritance"');
  });

  it('lists existing debts with add and remove controls', () => {
    const html = render({ debts: [{ id: 'a', label: 'Mortgage', kind: 'mortgage', balance: 900000, interestRate: 0.05, monthlyPayment: 3000 }] });
    expect(html).toContain('Mortgage');
    expect(html).toContain('+ add a debt');
    expect(html).toContain('aria-label="Remove Mortgage"');
  });

  it('offers the partner toggle and renders partner fields once enabled', () => {
    const off = render();
    expect(off).toContain('Include a partner');
    expect(off).not.toContain('Partner age');
    const on = render({
      spouse: {
        enabled: true, currentAge: 55, retirementAge: 60,
        rrspBalance: 1, tfsaBalance: 2, taxableBalance: 3, cashCushionBalance: 4,
        rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
        cppStartAge: 65, cppMonthlyAmount: 1000, oasStartAge: 65, oasYearsInCanada: 40,
        desiredSpending: 0,
      },
    });
    expect(on).toContain('Partner age');
    expect(on).toContain('CPP start age');
  });
});
