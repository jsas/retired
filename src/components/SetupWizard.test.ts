import { describe, it, expect } from 'vitest';
import { wizardDataFrom, applyWizardData } from './SetupWizard';
import { baseInputs } from '../test/helpers';

describe('SetupWizard data helpers', () => {
  it('wizardDataFrom extracts exactly the wizard-collected fields', () => {
    const inputs = baseInputs({
      currentAge: 55, retirementAge: 60, maxAge: 95,
      rrspBalance: 600000, tfsaBalance: 120000, taxableBalance: 80000, cashCushionBalance: 40000,
      rrspContribution: 20000, tfsaContribution: 7000, taxableContribution: 0,
      cppStartAge: 70, cppMonthlyAmount: 1250, oasStartAge: 65, oasYearsInCanada: 40,
      desiredSpending: 52000,
    });
    const d = wizardDataFrom(inputs, 'Retire at 60');
    expect(d).toEqual({
      scenarioName: 'Retire at 60',
      currentAge: 55, retirementAge: 60, maxAge: 95,
      rrspBalance: 600000, tfsaBalance: 120000, taxableBalance: 80000, cashCushionBalance: 40000,
      rrspContribution: 20000, tfsaContribution: 7000, taxableContribution: 0,
      cppStartAge: 70, cppMonthlyAmount: 1250, oasStartAge: 65, oasYearsInCanada: 40,
      desiredSpending: 52000,
      ownsHome: null, // no reverseMortgage recorded → unanswered
      homeValue: 800000,
    });
  });

  it('applyWizardData overlays the wizard fields and leaves everything else untouched', () => {
    const base = baseInputs({
      provinceCode: 'BC',
      investmentReturn: 0.06,
      withdrawalOrder: ['rrsp', 'tfsa', 'taxable'],
      events: [{ id: 'e', age: 70, label: 'sale', amount: 1, direction: 'in', account: 'tfsa' }],
      spendingBands: [{ fromAge: 80, pctOfBase: 0.8 }],
    });
    const data = wizardDataFrom(baseInputs({
      currentAge: 50, retirementAge: 58, maxAge: 92,
      rrspBalance: 100000, desiredSpending: 40000,
    }));
    const out = applyWizardData(base, data);
    // Wizard fields come from `data`...
    expect(out.currentAge).toBe(50);
    expect(out.retirementAge).toBe(58);
    expect(out.rrspBalance).toBe(100000);
    expect(out.desiredSpending).toBe(40000);
    // ...while engine defaults, events, bands, order and province survive.
    expect(out.provinceCode).toBe('BC');
    expect(out.investmentReturn).toBe(0.06);
    expect(out.withdrawalOrder).toEqual(['rrsp', 'tfsa', 'taxable']);
    expect(out.events).toHaveLength(1);
    expect(out.spendingBands).toEqual([{ fromAge: 80, pctOfBase: 0.8 }]);
  });

  it('a wizard round-trip preserves nullable benefit start ages', () => {
    // A user who leaves CPP/OAS blank (not receiving) must round-trip null, not 0.
    const base = baseInputs({ cppStartAge: null, oasStartAge: null });
    const d = wizardDataFrom(base);
    expect(d.cppStartAge).toBeNull();
    expect(d.oasStartAge).toBeNull();
    const out = applyWizardData(baseInputs({ cppStartAge: 65 }), d);
    expect(out.cppStartAge).toBeNull();
  });

  it('answering "own your home: yes" records the equity as a disabled RM section', () => {
    // The question must not be a dead end: Yes + a value becomes a real
    // (still-off) reverseMortgage so Optimize and the RM sidebar can use it.
    const d = wizardDataFrom(baseInputs());
    d.ownsHome = true;
    d.homeValue = 650000;
    const out = applyWizardData(baseInputs(), d);
    expect(out.reverseMortgage?.enabled).toBe(false);
    expect(out.reverseMortgage?.homeValue).toBe(650000);
  });

  it('answering "own your home: no" leaves reverseMortgage unset', () => {
    const d = wizardDataFrom(baseInputs());
    d.ownsHome = false;
    const out = applyWizardData(baseInputs(), d);
    expect(out.reverseMortgage).toBeUndefined();
  });

  it('editing the home value on a plan that already has an RM updates it (not a no-op)', () => {
    // Regression: applyWizardData only wrote homeValue when reverseMortgage was
    // null, so re-running the wizard and correcting the value was ignored.
    const base = baseInputs({
      reverseMortgage: { enabled: true, homeValue: 650000, appreciationRate: 0.02, interestRate: 0.06, maxLtv: 0.55, topUp: true },
    });
    const d = wizardDataFrom(base); // pre-fills ownsHome=true, homeValue=650000
    d.homeValue = 720000;
    const out = applyWizardData(base, d);
    expect(out.reverseMortgage?.homeValue).toBe(720000);
    // The existing loan's enabled state and terms are preserved, not reset.
    expect(out.reverseMortgage?.enabled).toBe(true);
    expect(out.reverseMortgage?.interestRate).toBe(0.06);
  });

  it('answering "own your home: no" on a plan with an RM removes it', () => {
    const base = baseInputs({
      reverseMortgage: { enabled: true, homeValue: 650000, appreciationRate: 0.02, interestRate: 0.06, topUp: true },
    });
    const d = wizardDataFrom(base);
    d.ownsHome = false;
    const out = applyWizardData(base, d);
    expect(out.reverseMortgage).toBeUndefined();
  });

  it('the scenario name never leaks into the engine inputs', () => {
    const d = wizardDataFrom(baseInputs(), 'Early Retirement');
    const out = applyWizardData(baseInputs(), d);
    expect((out as unknown as Record<string, unknown>).scenarioName).toBeUndefined();
  });
});
