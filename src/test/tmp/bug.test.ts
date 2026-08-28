import { it, expect } from 'vitest';
import { calculateRetirement } from '../../lib/retirementEngine';
import { testConfig, baseInputs, yearAt } from '../helpers';

// Employment top-up excess: does the year's money identity still hold when the
// excess routes to a REGISTERED account (double-count suspected)?
it('top-up excess into RRSP keeps the year reconciling', () => {
  const r = calculateRetirement(baseInputs({
    tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0, rrspBalance: 0,
    desiredSpending: 5000, cppStartAge: null, oasStartAge: null,
    employment: [{ id: 'j', label: 'pt', annualAmount: 20000, startAge: 65, endAge: 69, destAccount: 'rrsp', topUpSpending: true, indexedToCpi: false }],
  }), testConfig());
  const y = yearAt(r.yearlyBreakdown, 65);
  // Identity: end = start + gains + deposits − withdrawals (+ employment net injected)
  const start = y.startingBalance, gains = y.marketGains, end = y.endingBalance;
  const wd = y.withdrawals;
  // employmentNet − topUpUsed(5000) is the excess; where did it land?
  console.log('start', start, 'gains', gains, 'wd', wd, 'end', end);
  console.log('employmentNet', y.employmentNet, 'rrspBal', y.rrspBalance);
  // Expected end if excess (net−5000) lands in rrsp once:
  const excess = y.employmentNet! - 5000;
  const expectedEnd = (start + excess) * 1.05;
  console.log('excess', excess, 'expectedEnd(single-count)', expectedEnd, 'actual end', end);
});
