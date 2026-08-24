import type { YearlyBreakdown } from '../lib/retirementEngine';

interface ScheduleTableProps {
  breakdown: YearlyBreakdown[];
  retirementAge: number;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function ScheduleTable({ breakdown, retirementAge }: ScheduleTableProps) {
  return (
    <div className="bg-white border border-slate-200 rounded overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-3 py-2 font-semibold text-slate-700">Age</th>
              <th className="text-right px-3 py-2 font-semibold text-slate-700">Starting Balance</th>
              <th className="text-right px-3 py-2 font-semibold text-slate-700">Contributions</th>
              <th className="text-right px-3 py-2 font-semibold text-slate-700">Market Gains</th>
              <th className="text-right px-3 py-2 font-semibold text-slate-700" title="After-tax income goal for the year (desired spending inflated to that year)">Spending Target</th>
              <th className="text-right px-3 py-2 font-semibold text-slate-700">Withdrawals</th>
              <th className="text-right px-3 py-2 font-semibold text-slate-700">Income Tax</th>
              <th className="text-right px-3 py-2 font-semibold text-slate-700" title="Running total of income tax paid since retirement">Tax Burden</th>
              <th className="text-right px-3 py-2 font-semibold text-slate-700">CPP</th>
              <th className="text-right px-3 py-2 font-semibold text-slate-700">OAS</th>
              <th className="text-right px-3 py-2 font-semibold text-slate-700" title="Guaranteed Income Supplement (tax-free, single-pensioner approximation)">GIS</th>
              <th className="text-right px-3 py-2 font-semibold text-slate-700" title="Defined-benefit / bridge pension income (taxable)">Pension</th>
              <th className="text-right px-3 py-2 font-semibold text-slate-700">Ending Balance</th>
              <th className="text-right px-3 py-2 font-semibold text-slate-700">RRSP</th>
              <th className="text-right px-3 py-2 font-semibold text-slate-700">RRIF</th>
              <th className="text-right px-3 py-2 font-semibold text-slate-700">TFSA</th>
              <th className="text-right px-3 py-2 font-semibold text-slate-700">Taxable</th>
              <th className="text-right px-3 py-2 font-semibold text-slate-700">Cash Cushion</th>
            </tr>
          </thead>
          <tbody>
            {breakdown.map((row, index) => {
              const isRetirement = row.age === retirementAge;
              return (
                <tr
                  key={index}
                  className={`${index % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'} ${
                    isRetirement ? 'border-t-2 border-blue-500' : ''
                  }`}
                >
                  <td className={`px-3 py-1.5 ${isRetirement ? 'font-bold text-blue-700' : 'text-slate-900'}`}>
                    {row.age}
                    {isRetirement && ' 🎯'}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-700">
                    {formatCurrency(row.startingBalance)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-emerald-700">
                    {formatCurrency(row.contributions)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-700">
                    {formatCurrency(row.marketGains)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-700">
                    {formatCurrency(row.spendingTarget)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-red-700">
                    {formatCurrency(row.withdrawals)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-amber-700">
                    {formatCurrency(row.incomeTax)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-amber-900">
                    {formatCurrency(row.cumulativeTax)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-emerald-700">
                    {formatCurrency(row.cppIncome)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-emerald-700">
                    {formatCurrency(row.oasIncome)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-emerald-700">
                    {formatCurrency(row.gisIncome)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-emerald-700">
                    {formatCurrency(row.pensionIncome)}
                  </td>
                  <td className={`px-3 py-1.5 text-right font-mono font-semibold ${isRetirement ? 'text-blue-700' : 'text-slate-900'}`}>
                    {formatCurrency(row.endingBalance)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-600">
                    {formatCurrency(row.rrspBalance)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-600">
                    {formatCurrency(row.rrifBalance)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-600">
                    {formatCurrency(row.tfsaBalance)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-600">
                    {formatCurrency(row.taxableBalance)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-slate-600">
                    {formatCurrency(row.cashCushionBalance)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
