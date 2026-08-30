import { describe, it, expect } from 'vitest';
import { runStrategies, runOne, sustainableSpending, type StrategySpec } from './strategies';
import { calculateHousehold, householdOutcome } from './retirementEngine';
import { testConfig, baseInputs } from '../test/helpers';

const config = testConfig();

// Lower-income retiree with a meaningful RRSP: withdrawal order and CPP/OAS
// timing move lifetime GIS a lot, so the metric must discriminate.
const gisSensitive = () => baseInputs({
  currentAge: 64, retirementAge: 65, maxAge: 90,
  rrspBalance: 200000, tfsaBalance: 200000, taxableBalance: 0,
  cppStartAge: 65, cppMonthlyAmount: 400, oasStartAge: 65, oasYearsInCanada: 40,
  desiredSpending: 26000, income: [],
});

describe('runStrategies', () => {
  it('always includes the current plan as the baseline', () => {
    const report = runStrategies(gisSensitive(), config);
    expect(report.baseline.id).toBe('baseline');
    expect(report.baseline.lifetimeTax).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(report.baseline.lifetimeGis)).toBe(true);
  });

  it('explores the six withdrawal orders (minus the current one)', () => {
    const report = runStrategies(gisSensitive(), config);
    const orders = report.strategies.filter(s => s.id.startsWith('order-'));
    expect(orders.length).toBe(5); // 6 permutations − current order
  });

  it('lifetime GIS varies by withdrawal order (the metric discriminates)', () => {
    const report = runStrategies(gisSensitive(), config);
    const orders = report.strategies.filter(s => s.id.startsWith('order-'));
    const gisValues = new Set(orders.map(o => Math.round(o.lifetimeGis)));
    expect(gisValues.size).toBeGreaterThan(1);
  });

  it('draw order changes lifetime GIS (income counted in-year, not deferred)', () => {
    // With GIS assessed on in-year income (the fix), a strategy that draws
    // taxable income during OAS years claws GIS back immediately — so order
    // matters, and drawing the RRSP down alongside OAS (rrsp-first here) does
    // NOT beat sheltering it behind TFSA-first on this fixture. The point of
    // the metric is that it discriminates; the direction follows the math.
    const report = runStrategies(gisSensitive(), config);
    const orders = report.strategies.filter(s => s.id.startsWith('order-'));
    const rrspFirst = orders.filter(o => o.id.startsWith('order-rrsp'));
    const tfsaFirst = orders.filter(o => o.id.startsWith('order-tfsa'));
    const bestRrsp = Math.max(...rrspFirst.map(o => o.lifetimeGis));
    const bestTfsa = Math.max(...tfsaFirst.map(o => o.lifetimeGis));
    expect(bestTfsa).toBeGreaterThan(bestRrsp);
  });

  it('sustainable spending is non-negative and delta is measured vs baseline', () => {
    const report = runStrategies(gisSensitive(), config);
    expect(report.baseline.sustainableSpending).toBeGreaterThanOrEqual(0);
    for (const s of report.strategies) {
      expect(s.deltaSpending).toBeCloseTo(s.sustainableSpending - report.baseline.sustainableSpending, 6);
    }
  });

  it('suggests a most-GIS-preserved option when one beats the baseline by >$1k', () => {
    const report = runStrategies(gisSensitive(), config);
    const bestGis = Math.max(...report.strategies.map(s => s.lifetimeGis));
    const mentions = report.suggestedActions.some(a => a.includes('Most GIS preserved'));
    expect(mentions).toBe(bestGis > report.baseline.lifetimeGis + 1000);
  });
});

// Homeowner with home equity recorded but RM not yet enabled: the optimizer
// should explore turning it on at several start ages and draw sizes.
const rmHomeowner = () => baseInputs({
  currentAge: 65, retirementAge: 65, maxAge: 95,
  rrspBalance: 0, tfsaBalance: 150000, taxableBalance: 0,
  cppStartAge: 65, cppMonthlyAmount: 700, oasStartAge: 65, oasYearsInCanada: 40,
  desiredSpending: 40000, income: [],
  reverseMortgage: { enabled: false, homeValue: 700000, appreciationRate: 0.02, interestRate: 0.065, maxLtv: 0.55 },
});

describe('runStrategies — reverse mortgage timing', () => {
  it('explores RM start ages and draw sizes when a home value is recorded', () => {
    const report = runStrategies(rmHomeowner(), config);
    const rmStrats = report.strategies.filter(s => s.id.startsWith('rm-'));
    // startAge ∈ {65, 70, 75} × two draw sizes; all are inside the horizon.
    expect(rmStrats.length).toBe(6);
    expect(new Set(rmStrats.map(s => s.patch.reverseMortgage?.startAge))).toEqual(new Set([65, 70, 75]));
    expect(rmStrats.every(s => (s.patch.reverseMortgage?.drawAmount ?? 0) > 0)).toBe(true);
    expect(rmStrats.every(s => s.patch.reverseMortgage?.enabled)).toBe(true);
  });

  it('skips RM variants entirely when no home value is recorded (never invents equity)', () => {
    const report = runStrategies(gisSensitive(), config); // no reverseMortgage at all
    expect(report.strategies.filter(s => s.id.startsWith('rm-')).length).toBe(0);
  });

  it('RM variants can beat the no-RM baseline on sustainable spending', () => {
    const report = runStrategies(rmHomeowner(), config);
    const rmStrats = report.strategies.filter(s => s.id.startsWith('rm-'));
    expect(Math.max(...rmStrats.map(s => s.sustainableSpending)))
      .toBeGreaterThan(report.baseline.sustainableSpending);
  });

  it('suggests an RM strategy in plain language when one beats the baseline by >$500', () => {
    const report = runStrategies(rmHomeowner(), config);
    const rmStrats = report.strategies.filter(s => s.id.startsWith('rm-'));
    const best = Math.max(...rmStrats.map(s => s.deltaSpending));
    const mentions = report.suggestedActions.some(a => a.includes('Reverse mortgage'));
    expect(mentions).toBe(best > 500);
  });

  it('offers the top-up backstop when RM is enabled without top-up', () => {
    const inputs = rmHomeowner();
    inputs.reverseMortgage = { ...inputs.reverseMortgage!, enabled: true, drawAmount: 8000, startAge: 70, topUp: false };
    const report = runStrategies(inputs, config);
    expect(report.strategies.some(s => s.id === 'rm-topup' && s.patch.reverseMortgage?.topUp === true)).toBe(true);
  });

  it('does not duplicate the RM setup the user already runs', () => {
    const inputs = rmHomeowner();
    inputs.reverseMortgage = { ...inputs.reverseMortgage!, enabled: true, drawAmount: 16000, startAge: 65, topUp: true };
    const report = runStrategies(inputs, config);
    expect(report.strategies.filter(s => s.id === 'rm-65-16000').length).toBe(0);
    expect(report.strategies.filter(s => s.id === 'rm-topup').length).toBe(0); // already on
  });
});

describe('work strategies (employment, issue #22)', () => {
  // A modest plan with clear early-retirement withdrawal pressure.
  const worker = () => baseInputs({
    currentAge: 65, retirementAge: 65, maxAge: 90,
    rrspBalance: 300000, tfsaBalance: 100000, taxableBalance: 0,
    cppStartAge: 70, cppMonthlyAmount: 800, oasStartAge: 70, oasYearsInCanada: 40,
    desiredSpending: 40000, income: [],
  });

  it('offers fixed part-time work variants', () => {
    const report = runStrategies(worker(), config);
    const jobs = report.strategies.filter(s => s.id.startsWith('work-') && !s.id.startsWith('work-gap'));
    expect(jobs.length).toBeGreaterThanOrEqual(2);
    // Each adds an employment source on top of the existing (empty) register.
    for (const j of jobs) {
      expect(Array.isArray(j.patch.income)).toBe(true);
      expect(j.patch.income!.length).toBe(1);
      expect(j.patch.income![0].kind).toBe('employment');
      expect(j.patch.income![0].topUpSpending).toBe(true);
    }
  });

  it('a work stint supports at least as much spending as the baseline', () => {
    const report = runStrategies(worker(), config);
    const jobs = report.strategies.filter(s => s.id.startsWith('work-10k'));
    expect(jobs.length).toBe(1);
    expect(jobs[0].sustainableSpending).toBeGreaterThanOrEqual(report.baseline.sustainableSpending);
  });

  it('suggested work stints save to taxable (no room tracking yet, issue #24)', () => {
    const report = runStrategies(worker(), config);
    const jobs = report.strategies.filter(s => s.id.startsWith('work-'));
    expect(jobs.length).toBeGreaterThan(0);
    for (const j of jobs) {
      expect(j.patch.income![0].destAccount).toBe('taxable');
    }
  });

  it('skips a fixed variant already in the plan', () => {
    const inputs = worker();
    inputs.income = [{
      id: 'mine', label: 'my job', kind: 'employment', annualAmount: 10000, startAge: 65, endAge: 70,
      destAccount: 'tfsa', topUpSpending: true, indexedToCpi: false,
    }];
    const report = runStrategies(inputs, config);
    expect(report.strategies.filter(s => s.id === 'work-10k-65-70').length).toBe(0);
  });

  it('adds a gap-targeted stint when the plan runs a shortfall', () => {
    const inputs = worker();
    inputs.desiredSpending = 90000; // far beyond the portfolio → depletes
    const report = runStrategies(inputs, config);
    const gap = report.strategies.filter(s => s.id.startsWith('work-gap'));
    expect(gap.length).toBe(1);
    const job = gap[0].patch.income![0];
    expect(job.kind).toBe('employment');
    expect(job.topUpSpending).toBe(true);
    expect(job.annualAmount).toBeGreaterThan(0);
    expect(job.startAge).toBeLessThanOrEqual(job.endAge!);
  });

  it('no gap-targeted stint when the plan is healthy', () => {
    const inputs = worker();
    inputs.desiredSpending = 10000; // comfortably funded → never depletes
    const report = runStrategies(inputs, config);
    expect(report.strategies.filter(s => s.id.startsWith('work-gap')).length).toBe(0);
  });
});

describe('runStrategies — employer pension timing (issue #40)', () => {
  // A retiree with two DB pensions: a small bridge (non-indexed, ends at 65)
  // and a larger lifetime indexed pension. Plus CPP/OAS so the stacking is real.
  const pensioner = () => baseInputs({
    currentAge: 60, retirementAge: 60, maxAge: 90,
    rrspBalance: 200000, tfsaBalance: 100000, taxableBalance: 0,
    cppStartAge: 65, cppMonthlyAmount: 800, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 45000,
    income: [
      { id: 'bridge', label: 'Bridge', kind: 'pension' as const, annualAmount: 6000, startAge: 60, endAge: 65, indexedToCpi: false },
      { id: 'db', label: 'Work DB', kind: 'pension' as const, annualAmount: 24000, startAge: 65, endAge: null, indexedToCpi: true },
    ],
  });

  it('generates start-age variants for each pension, skipping the current age', () => {
    const report = runStrategies(pensioner(), config);
    const pt = report.strategies.filter(s => s.categories.includes('pension_timing'));
    // Bridge is at 60 → variants at 55/65/70; Work DB is at 65 → 55/60/70.
    const bridge = pt.filter(s => s.id.startsWith('pension-primary-0-'));
    const db = pt.filter(s => s.id.startsWith('pension-primary-1-'));
    expect(new Set(bridge.map(s => s.patch.income![0].startAge))).toEqual(new Set([55, 65, 70]));
    expect(new Set(db.map(s => s.patch.income![1].startAge))).toEqual(new Set([55, 60, 70]));
  });

  it('each single-pension variant patches only that pension start age', () => {
    const report = runStrategies(pensioner(), config);
    const v = report.strategies.find(s => s.id === 'pension-primary-1-70')!;
    // Defers the Work DB from 65 to 70, leaves the bridge at 60.
    expect(v.patch.income![1].startAge).toBe(70);
    expect(v.patch.income![0].startAge).toBe(60);
    expect(v.patch.income![1].endAge).toBeNull(); // other fields preserved
    expect(v.patch.income![1].indexedToCpi).toBe(true);
  });

  it('a pension variant changes lifetime GIS (DB income is clawback income)', () => {
    // Lower-income retiree: the portfolio is small, so OAS/GIS carry the plan
    // and a DB pension's start age moves the GIS clawback directly.
    const inputs = baseInputs({
      currentAge: 64, retirementAge: 65, maxAge: 90,
      rrspBalance: 40000, tfsaBalance: 30000, taxableBalance: 0,
      cppStartAge: 65, cppMonthlyAmount: 400, oasStartAge: 65, oasYearsInCanada: 40,
      desiredSpending: 22000,
      income: [
        { id: 'db', label: 'Work DB', kind: 'pension' as const, annualAmount: 6000, startAge: 65, endAge: null, indexedToCpi: true },
      ],
    });
    const report = runStrategies(inputs, config);
    const pt = report.strategies.filter(s => s.categories.includes('pension_timing'));
    expect(pt.length).toBeGreaterThan(0);
    // Some pension timing leaves GIS on the table that another keeps.
    const gis = new Set(pt.map(s => Math.round(s.lifetimeGis)));
    expect(gis.size).toBeGreaterThan(1);
    expect(Math.max(...pt.map(s => s.lifetimeGis))).toBeGreaterThan(0);
  });

  it('adds a pairwise "bridge with the small one, defer the large one" flagship', () => {
    const report = runStrategies(pensioner(), config);
    const pair = report.strategies.find(s => s.id === 'pension-pair-early-small-defer-large')!;
    expect(pair).toBeDefined();
    // Both pensions belong to the primary → one merged register patch.
    expect(pair.patch.income![0].startAge).toBeLessThan(60);   // small bridge pulled early
    expect(pair.patch.income![1].startAge).toBeGreaterThan(65); // large DB deferred
  });

  it('no pension variants at all when the plan has no pensions', () => {
    const report = runStrategies(gisSensitive(), config); // income: []
    expect(report.strategies.filter(s => s.categories.includes('pension_timing')).length).toBe(0);
  });

  it('a single pension gets start-age variants but no pairwise flagship', () => {
    const inputs = pensioner();
    inputs.income = [inputs.income![1]]; // only the big DB
    const report = runStrategies(inputs, config);
    const pt = report.strategies.filter(s => s.categories.includes('pension_timing'));
    expect(pt.length).toBeGreaterThan(0);
    expect(pt.some(s => s.id === 'pension-pair-early-small-defer-large')).toBe(false);
  });

  it('scopes to pension_timing via the category filter', () => {
    const report = runStrategies(pensioner(), config, { categories: ['pension_timing'] });
    expect(report.strategies.length).toBeGreaterThan(0);
    for (const s of report.strategies) {
      expect(s.categories).toContain('pension_timing');
    }
    expect(report.strategies.some(s => s.id.startsWith('cpp-'))).toBe(false);
    expect(report.strategies.some(s => s.id.startsWith('order-'))).toBe(false);
  });

  it('spouse pensions are swept under spouse.income (patched via the spouse object)', () => {
    const inputs = pensioner();
    inputs.income = [];
    inputs.spouse = {
      enabled: true, currentAge: 60, retirementAge: 60,
      rrspBalance: 100000, tfsaBalance: 50000, taxableBalance: 0, cashCushionBalance: 0,
      rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
      cppStartAge: 65, cppMonthlyAmount: 500, oasStartAge: 65, oasYearsInCanada: 40,
      desiredSpending: 20000,
      income: [
        { id: 'sp-db', label: 'Spouse DB', kind: 'pension' as const, annualAmount: 15000, startAge: 65, endAge: null, indexedToCpi: true },
      ],
    };
    const report = runStrategies(inputs, config);
    const sp = report.strategies.filter(s => s.id.startsWith('pension-spouse-0-'));
    expect(sp.length).toBeGreaterThan(0);
    // The variant patches the spouse's pension start age through the spouse object.
    const v = sp.find(s => s.id === 'pension-spouse-0-60')!;
    expect(v.patch.spouse!.income![0].startAge).toBe(60);
    // The primary's own (empty) register is untouched.
    expect(v.patch.income).toBeUndefined();
  });

  it('pension results reflect the post-split tax pass, not pre-split amounts', () => {
    // A couple where the higher-income spouse has the DB pension: deferring it
    // changes the eligible split income, which the household splitting pass then
    // re-optimizes. The strategy's lifetimeTax must come from the run that
    // already applied pension splitting (the engine does this internally).
    const inputs = pensioner();
    inputs.spouse = {
      enabled: true, currentAge: 60, retirementAge: 60,
      rrspBalance: 50000, tfsaBalance: 50000, taxableBalance: 0, cashCushionBalance: 0,
      rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
      cppStartAge: 65, cppMonthlyAmount: 300, oasStartAge: 65, oasYearsInCanada: 40,
      desiredSpending: 15000,
      income: [],
    };
    const report = runStrategies(inputs, config);
    const defer70 = report.strategies.find(s => s.id === 'pension-primary-1-70')!;
    // Recompute the truth directly: merged inputs → engine (which splits) → tax.
    const merged = { ...inputs, ...defer70.patch };
    const truth = calculateHousehold(merged, config)
      .yearlyBreakdown.reduce((s, y) => s + (y.incomeTax ?? 0), 0);
    expect(defer70.lifetimeTax).toBeCloseTo(truth, 6);
  });
});

describe('runStrategies filtering', () => {
  it('narrowing to cpp drops other families but keeps the defer-both flagship', () => {
    const report = runStrategies(gisSensitive(), config, { categories: ['cpp'] });
    for (const s of report.strategies) {
      expect(s.categories).toContain('cpp');
    }
    expect(report.strategies.some(s => s.id === 'defer-all-70')).toBe(true);
    expect(report.strategies.some(s => s.id.startsWith('order-'))).toBe(false);
    expect(report.strategies.some(s => s.id.startsWith('work-'))).toBe(false);
  });

  it('category filter touches only the variant list, never the baseline', () => {
    const unfiltered = runStrategies(gisSensitive(), config);
    const filtered = runStrategies(gisSensitive(), config, { categories: ['withdrawal_order'] });
    expect(filtered.baseline.sustainableSpending).toBe(unfiltered.baseline.sustainableSpending);
    for (const s of filtered.strategies) {
      expect(s.id.startsWith('order-')).toBe(true);
    }
  });

  it('maxVariants caps the shown list but keeps the full ranked list', () => {
    const report = runStrategies(gisSensitive(), config, { maxVariants: 2 });
    expect(report.shown).toHaveLength(2);
    expect(report.strategies.length).toBeGreaterThan(2);
    // Best-first order is preserved in the shown slice.
    expect(report.shown[0].sustainableSpending).toBeGreaterThanOrEqual(report.shown[1].sustainableSpending);
    expect(report.filteredFrom).toBe(report.strategies.length);
  });

  it('no filter → shown equals strategies and filteredFrom reports the build count', () => {
    const report = runStrategies(gisSensitive(), config);
    expect(report.shown).toBe(report.strategies);
    expect(report.filteredFrom).toBe(report.strategies.length);
  });

  it('an unknown category throws (never silently narrows)', () => {
    expect(() => runStrategies(gisSensitive(), config, { categories: ['cppp' as never] }))
      .toThrow(/Unknown strategy categor/);
  });

  it('combining categories and maxVariants works together', () => {
    const report = runStrategies(gisSensitive(), config, { categories: ['cpp', 'oas'], maxVariants: 2 });
    expect(report.shown).toHaveLength(2);
    for (const s of report.shown) {
      expect(s.categories.some(c => c === 'cpp' || c === 'oas')).toBe(true);
    }
  });
});

describe('RDSP withdrawal-order variants (S-03)', () => {
  // Retiree with a funded RDSP: the explorer's order variants must test
  // explicit 'rdsp' placements, not just the 3-account permutations — the
  // engine auto-injects 'rdsp' ahead of taxable when the order omits it, so
  // the base permutations all collapse into that one RDSP shape.
  const rdspRetiree = () => baseInputs({
    currentAge: 65, retirementAge: 65, maxAge: 90,
    rrspBalance: 100000, tfsaBalance: 150000, taxableBalance: 50000,
    cppStartAge: 65, cppMonthlyAmount: 500, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 24000,
    rdsp: { enabled: true, balance: 60000, contribution: 0, familyIncome: 40000, dtcEligible: true },
    income: [],
  });

  it('order variants place rdsp explicitly when the RDSP is active (S-03)', () => {
    const report = runStrategies(rdspRetiree(), config);
    const orders = report.strategies.filter(s => s.id.startsWith('order-'));
    expect(orders.length).toBeGreaterThan(0);
    // Every order variant includes 'rdsp' in its patch...
    for (const o of orders) {
      expect(o.patch.withdrawalOrder).toContain('rdsp');
    }
    // ...and both extremes exist: rdsp first (spend the partly-tax-free dollar
    // earliest) and rdsp last (preserve it longest).
    expect(orders.some(o => o.patch.withdrawalOrder![0] === 'rdsp')).toBe(true);
    expect(orders.some(o => o.patch.withdrawalOrder!.at(-1) === 'rdsp')).toBe(true);
    // The other accounts are never dropped from the ordering.
    for (const o of orders) {
      const w = o.patch.withdrawalOrder!;
      expect(w).toContain('tfsa');
      expect(w).toContain('rrsp');
      expect(new Set(w).size).toBe(w.length); // no duplicates
    }
  });

  it('order variants omit rdsp when no RDSP is active', () => {
    const report = runStrategies(gisSensitive(), config);
    const orders = report.strategies.filter(s => s.id.startsWith('order-'));
    expect(orders.length).toBe(5); // the 6 base permutations minus current
    for (const o of orders) {
      expect(o.patch.withdrawalOrder).not.toContain('rdsp');
    }
  });

  it('a disabled or zero-balance RDSP does not produce rdsp orderings', () => {
    const off = rdspRetiree();
    off.rdsp = { ...off.rdsp!, enabled: false };
    expect(runStrategies(off, config).strategies.filter(s => s.id.startsWith('order-') && s.patch.withdrawalOrder!.includes('rdsp')).length).toBe(0);
    const empty = rdspRetiree();
    empty.rdsp = { ...empty.rdsp!, balance: 0 };
    expect(runStrategies(empty, config).strategies.filter(s => s.id.startsWith('order-') && s.patch.withdrawalOrder!.includes('rdsp')).length).toBe(0);
    const notDtc = rdspRetiree();
    notDtc.rdsp = { ...notDtc.rdsp!, dtcEligible: false };
    expect(runStrategies(notDtc, config).strategies.filter(s => s.id.startsWith('order-') && s.patch.withdrawalOrder!.includes('rdsp')).length).toBe(0);
  });

  it('rdsp order variants run the engine without error and report finite metrics', () => {
    const report = runStrategies(rdspRetiree(), config);
    for (const o of report.strategies.filter(s => s.id.startsWith('order-'))) {
      expect(Number.isFinite(o.sustainableSpending)).toBe(true);
      expect(Number.isFinite(o.endingBalance)).toBe(true);
      expect(o.lifetimeTax).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('sustainableSpending ceiling edge (S-02)', () => {
  // A runaway plan: $100M in TFSA (tax-free, no CPP/OAS) funding a 25-year
  // horizon survives even the $5M/yr ceiling (PV of $5M × 25 yrs at 5% ≈
  // $70M), so no failing `hi` exists within the search bounds. Before the fix
  // the expansion kept multiplying past the ceiling, the binary search ran
  // anyway on a surviving `hi` (invariant violated), and it returned the
  // ×1.5^40 overshoot — a value ABOVE the 5M ceiling — instead of the ceiling.
  const runaway = () => baseInputs({
    currentAge: 65, retirementAge: 65, maxAge: 90,
    tfsaBalance: 100000000, rrspBalance: 0, taxableBalance: 0,
    desiredSpending: 100000, income: [],
  });

  it('a plan that survives the ceiling returns the ceiling, not an overshoot', () => {
    expect(sustainableSpending(runaway(), config)).toBe(5000000);
  });

  it('a normal plan still returns a finite interior value (fix changes nothing there)', () => {
    const r = sustainableSpending(gisSensitive(), config);
    expect(Number.isFinite(r)).toBe(true);
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThan(5000000);
  });

  it('a plan that depletes even at zero spending returns 0', () => {
    const broke = baseInputs({
      currentAge: 65, retirementAge: 65, maxAge: 90,
      tfsaBalance: 0, rrspBalance: 0, taxableBalance: 0,
      desiredSpending: 50000, income: [],
    });
    // No CPP/OAS and no assets: every year is unfunded → never survives.
    expect(sustainableSpending(broke, config)).toBe(0);
  });
});

describe('runOne — verdict scored against the patched inputs (S-01)', () => {
  // A plan that depletes PAST the base maxAge but BEFORE the extended one
  // (depletes at 93: funded to 90, short by 95) — so the depletion age falls in
  // the window where the two horizons disagree.
  const tight = () => baseInputs({
    currentAge: 65, retirementAge: 65, maxAge: 90,
    rrspBalance: 300000, tfsaBalance: 0, taxableBalance: 0,
    cppStartAge: 65, cppMonthlyAmount: 800, oasStartAge: 65, oasYearsInCanada: 40,
    desiredSpending: 40000, income: [],
  });

  it('runOne agrees with householdOutcome scored against the MERGED inputs', () => {
    const inputs = tight();
    const spec: StrategySpec = {
      id: 'extend-maxage', name: 'Plan to 95', description: 'synthetic',
      patch: { maxAge: 95 }, categories: [],
    };
    const s = runOne(inputs, config, spec);

    // Ground truth: the engine run on the merged inputs, scored against merged.
    const merged = { ...inputs, ...spec.patch };
    const truth = householdOutcome(calculateHousehold(merged, config), merged);
    // Sanity: this fixture genuinely exercises the horizon — the merged run
    // depletes at 93, past the base inputs' horizon (90) but within the extended.
    expect(truth.depletionAge).toBe(93);
    // runOne's verdict must be the merged-inputs verdict, field for field.
    expect(s.depletionAge).toBe(truth.depletionAge);
    expect(s.endingBalance).toBeCloseTo(truth.endingBalance, 6);
    expect(s.survived).toBe(truth.depletionAge === null);
  });

  it('householdOutcome status itself depends on which inputs are passed (the S-01 hazard)', () => {
    // The reason runOne must pass `merged`: householdOutcome reads inputs.maxAge
    // for the status horizon. This run depletes at 93 — scored against `merged`
    // (horizon 95) that's a real SHORTFALL; scored against the base `inputs`
    // (horizon 90) the depletion is past-horizon and reads ON_TRACK. StrategyResult
    // doesn't carry status, but this locks the semantics the fix protects so a
    // future field (or a refactor) can't silently revert it.
    const inputs = tight();
    const merged = { ...inputs, maxAge: 95 };
    const r = calculateHousehold(merged, config);
    expect(householdOutcome(r, merged).status).toBe('SHORTFALL');
    expect(householdOutcome(r, inputs).status).toBe('ON_TRACK');
  });
});
