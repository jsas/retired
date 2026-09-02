import { describe, it, expect } from 'vitest';
import { wizardDataFrom, applyWizardData, spouseWizardDataFrom, applySpouseWizardData, stepsFor } from './SetupWizard';
import { baseInputs } from '@retired/engine-core/test/helpers';

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
      person: 'primary',
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

  it('the plan name never leaks into the engine inputs', () => {
    const d = wizardDataFrom(baseInputs(), 'Early Retirement');
    const out = applyWizardData(baseInputs(), d);
    expect((out as unknown as Record<string, unknown>).scenarioName).toBeUndefined();
  });
});

describe('SetupWizard — spouse pass', () => {
  it('the spouse pass hides household-level fields (maxAge) but keeps person fields', () => {
    const spouse = stepsFor('spouse');
    const primary = stepsFor('primary');
    expect(spouse).toHaveLength(primary.length); // same five steps
    const agesSpouse = spouse[0];
    const agesPrimary = primary[0];
    expect(agesPrimary.fields.map(f => f.key)).toContain('maxAge');
    expect(agesSpouse.fields.map(f => f.key)).not.toContain('maxAge');
    expect(agesSpouse.fields.map(f => f.key)).toEqual(['currentAge', 'retirementAge']);
  });

  it('spouseWizardDataFrom seeds from the existing spouse when one exists', () => {
    const host = baseInputs({
      spouse: {
        enabled: true, currentAge: 58, retirementAge: 63,
        rrspBalance: 210000, tfsaBalance: 55000, taxableBalance: 10000, cashCushionBalance: 5000,
        rrspContribution: 8000, tfsaContribution: 3000, taxableContribution: 0,
        cppStartAge: 65, cppMonthlyAmount: 780, oasStartAge: 67, oasYearsInCanada: 30,
        desiredSpending: 24000,
      },
    });
    const d = spouseWizardDataFrom(host);
    expect(d.person).toBe('spouse');
    expect(d.currentAge).toBe(58);
    expect(d.retirementAge).toBe(63);
    expect(d.rrspBalance).toBe(210000);
    expect(d.cppMonthlyAmount).toBe(780);
    expect(d.oasStartAge).toBe(67);
    expect(d.desiredSpending).toBe(24000);
    // Household-level fields are never the spouse's to answer.
    expect(d.maxAge).toBe(host.maxAge);
    expect(d.ownsHome).toBeNull();
  });

  it('spouseWizardDataFrom falls back to partner defaults when there is no spouse yet', () => {
    const host = baseInputs({ currentAge: 55, retirementAge: 60, desiredSpending: 52000, spouse: undefined });
    const d = spouseWizardDataFrom(host);
    expect(d.currentAge).toBe(55);
    expect(d.retirementAge).toBe(60);
    expect(d.desiredSpending).toBe(26000); // half the host's goal
    expect(d.rrspBalance).toBe(0);
    expect(d.cppStartAge).toBe(65);
  });

  it('applySpouseWizardData writes the spouse block, enables it, and keeps the host untouched', () => {
    const host = baseInputs({ currentAge: 55, desiredSpending: 52000, spouse: undefined });
    const d = spouseWizardDataFrom(host);
    d.currentAge = 57;
    d.rrspBalance = 180000;
    d.cppMonthlyAmount = 820;
    d.desiredSpending = 22000;
    const out = applySpouseWizardData(host, d);
    expect(out.spouse?.enabled).toBe(true);
    expect(out.spouse?.currentAge).toBe(57);
    expect(out.spouse?.rrspBalance).toBe(180000);
    expect(out.spouse?.cppMonthlyAmount).toBe(820);
    expect(out.spouse?.desiredSpending).toBe(22000);
    expect(out.spouseSource).toEqual({ kind: 'builtin' });
    // Host fields are untouched.
    expect(out.currentAge).toBe(55);
    expect(out.desiredSpending).toBe(52000);
    expect(out.rrspBalance).toBe(host.rrspBalance);
  });

  it('applySpouseWizardData preserves spouse fields the wizard never asks about', () => {
    // Income sources, events, bands and a withdrawal order set earlier must
    // survive a spouse-wizard re-run (the pass edits the basics, not the whole
    // person).
    const host = baseInputs({
      spouse: {
        enabled: true, currentAge: 58, retirementAge: 63,
        rrspBalance: 100000, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
        rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
        cppStartAge: 65, cppMonthlyAmount: 700, oasStartAge: 65, oasYearsInCanada: 40,
        desiredSpending: 20000,
        withdrawalOrder: ['rrsp', 'tfsa', 'taxable'],
        income: [{ id: 'p1', label: 'DB', kind: 'pension', annualAmount: 12000, startAge: 60, endAge: null, indexedToCpi: true }],
        events: [{ id: 'e1', age: 70, label: 'gift', amount: 5000, direction: 'in', account: 'tfsa' }],
      },
    });
    const d = spouseWizardDataFrom(host);
    d.rrspBalance = 150000;
    const out = applySpouseWizardData(host, d);
    expect(out.spouse?.rrspBalance).toBe(150000);
    expect(out.spouse?.withdrawalOrder).toEqual(['rrsp', 'tfsa', 'taxable']);
    expect(out.spouse?.income).toHaveLength(1);
    expect(out.spouse?.events).toHaveLength(1);
  });
});
