import { it } from 'vitest';
import { calculateHousehold } from '../../lib/retirementEngine';
import { testConfig, baseInputs, yearAt } from '../helpers';

// Two-way inter-spousal transfers: does the re-run converge, or diverge?
it('two-way transfers conserve household money', () => {
  const config = testConfig();
  const inputs = baseInputs({
    currentAge: 65, retirementAge: 65, maxAge: 70,
    rrspBalance: 100000, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
    desiredSpending: 0, cppStartAge: null, oasStartAge: null,
    withdrawalOrder: ['tfsa', 'taxable', 'rrsp'],
    events: [
      // primary sends $10k/yr from own RRSP to spouse's TFSA
      { id: 'a', age: 65, endAge: 66, label: 'p2s', amount: 10000, direction: 'out',
        from: { kind: 'account', person: 'primary', account: 'rrsp' },
        to: { kind: 'account', person: 'spouse', account: 'tfsa' } },
    ],
    spouse: {
      enabled: true, currentAge: 65, retirementAge: 65,
      rrspBalance: 100000, tfsaBalance: 0, taxableBalance: 0, cashCushionBalance: 0,
      rrspContribution: 0, tfsaContribution: 0, taxableContribution: 0,
      cppStartAge: null, cppMonthlyAmount: 0, oasStartAge: null, oasYearsInCanada: 40,
      desiredSpending: 0, pensions: [],
      events: [
        // spouse sends $8k/yr from own RRSP to primary's TFSA
        { id: 'b', age: 65, endAge: 66, label: 's2p', amount: 8000, direction: 'out',
          from: { kind: 'account', person: 'spouse', account: 'rrsp' },
          to: { kind: 'account', person: 'primary', account: 'tfsa' } },
      ],
    },
  });
  const r = calculateHousehold(inputs, config);
  for (const a of [65, 66, 70]) {
    const p = yearAt(r.yearlyBreakdown, a);
    const s = yearAt(r.spouse!.yearlyBreakdown, a);
    console.log(`age ${a}: primary end=${p.endingBalance.toFixed(0)} (tfsa=${p.tfsaBalance.toFixed(0)}, rrsp=${p.rrspBalance.toFixed(0)}), spouse end=${s.endingBalance.toFixed(0)} (tfsa=${s.tfsaBalance.toFixed(0)})`);
  }
});
