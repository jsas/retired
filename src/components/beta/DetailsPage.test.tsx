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
const render = (over = {}, props = {}) => renderToStaticMarkup(
  createElement(DetailsPage, { inputs: { ...inputs, ...over }, onChange: noop, section: null, ...props }),
);

describe('DetailsPage inline editors', () => {
  it('renders every hint anchor including the editable collections', () => {
    const html = render();
    for (const id of ['details-profile', 'details-spouse', 'details-accounts', 'details-contributions',
      'details-income', 'details-benefits', 'details-events', 'details-spending', 'details-withdrawal', 'details-markets', 'details-debts']) {
      expect(html, id).toContain(id);
    }
  });

  it('renders the Markets section: flat volatility and return anchors', () => {
    const html = render({ returnVolatility: 0.15 });
    expect(html).toContain('Volatility');
    expect(html).toContain('value="15"');
    expect(html).toContain('+ add an anchor');
    const withAnchors = render({
      marketPeriods: [{ id: 'p1', age: 62, return: -0.20, volatility: 0.25 }],
    });
    expect(withAnchors).toContain('From age');
    expect(withAnchors).toContain('value="62"');
    expect(withAnchors).toContain('value="-20"');
    expect(withAnchors).toContain('value="25"');
    expect(withAnchors).toContain('aria-label="Remove anchor at age 62"');
  });

  it('shows a blank volatility anchor when none is set', () => {
    const html = render({ marketPeriods: [{ id: 'p1', age: 70, return: 0.05 }] });
    expect(html).toContain('Vol % (blank = flat)');
  });

  it('renders Province as a select of the config\'s codes, keeping unknown codes', () => {
    const html = render({}, { provinceCodes: ['AB', 'BC', 'ONT'] });
    expect(html).toContain('Province');
    expect(html).toContain('<select');
    expect(html).toContain('value="BC"');
    expect(html).toContain('value="ONT"');
    // a plan carrying a code outside the config stays selectable
    const htmlUnknown = render({ provinceCode: 'YT' }, { provinceCodes: ['AB', 'BC', 'ONT'] });
    expect(htmlUnknown).toContain('value="YT"');
  });

  it('lists existing income sources with add and remove controls', () => {
    const html = render({ income: [{ id: 'a', label: 'Day job', kind: 'employment', annualAmount: 80000, startAge: 55, endAge: 62, indexedToCpi: true }] });
    expect(html).toContain('Day job');
    expect(html).toContain('+ add income');
    expect(html).toContain('aria-label="Remove Day job"');
  });

  it('lists existing events with inflow/outflow add controls', () => {
    const html = render({ events: [{ id: 'a', age: 62, label: 'Inheritance', amount: 100000, direction: 'in' }] });
    expect(html).toContain('Inheritance');
    expect(html).toContain('+ add inflow');
    expect(html).toContain('+ add outflow');
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

  it('offers the RDSP toggle and editors once enabled', () => {
    const off = render();
    expect(off, 'rdsp section always present').toContain('details-rdsp');
    expect(off).not.toContain('DTC eligible');
    const on = render({ rdsp: { enabled: true, balance: 10000, contribution: 1000, familyIncome: 40000, dtcEligible: true } });
    expect(on).toContain('Family income');
    expect(on).toContain('DTC eligible');
    expect(on).toContain('value="10000"');
    expect(on).toContain('value="40000"');
  });

  it('offers the FHSA toggle and editors once enabled', () => {
    const off = render();
    expect(off).toContain('details-fhsa');
    const on = render({ fhsa: { enabled: true, balance: 5000, contribution: 8000, openAge: 30 } });
    expect(on).toContain('Opened at age');
    expect(on).toContain('value="30"');
    expect(on).toContain('value="5000"');
    expect(on).toContain('value="8000"');
  });

  it('offers the home-equity toggle and full editor once enabled', () => {
    const off = render();
    expect(off).toContain('details-home');
    expect(off).toContain('Borrow against the home');
    const on = render({
      reverseMortgage: {
        enabled: true, homeValue: 900000, appreciationRate: 0.02, interestRate: 0.065,
        mode: 'heloc', maxLtv: 0.5, drawAmount: 12000, startAge: 70, durationYears: 15, topUp: true,
      },
    });
    expect(on).toContain('HELOC (interest paid yearly)');
    expect(on).toContain('value="900000"');
    expect(on).toContain('Max loan-to-value');
    expect(on).toContain('Draw $/yr');
    expect(on).toContain('value="12000"');
    expect(on).toContain('value="70"');
    expect(on).toContain('value="15"');
    expect(on).toContain('Last-resort top-up');
  });

  it('turns home-equity scheduled draws on with defaults', () => {
    const html = render({ reverseMortgage: { enabled: true, homeValue: 500000, appreciationRate: 0.02, interestRate: 0.06 } });
    expect(html).toContain('Scheduled draws');
    expect(html).not.toContain('Draw $/yr');
  });
});
