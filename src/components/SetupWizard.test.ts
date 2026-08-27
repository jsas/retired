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
    const d = wizardDataFrom(inputs);
    expect(d).toEqual({
      currentAge: 55, retirementAge: 60, maxAge: 95,
      rrspBalance: 600000, tfsaBalance: 120000, taxableBalance: 80000, cashCushionBalance: 40000,
      rrspContribution: 20000, tfsaContribution: 7000, taxableContribution: 0,
      cppStartAge: 70, cppMonthlyAmount: 1250, oasStartAge: 65, oasYearsInCanada: 40,
      desiredSpending: 52000,
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
});
