import { Fragment, useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import type { YearlyBreakdown, YearDetail } from '../lib/retirementEngine';

interface ScheduleTableProps {
  breakdown: YearlyBreakdown[];
  retirementAge: number;
  // Household mode: the primary person's own rows + the spouse's rows keyed by
  // the primary's age axis (calendar year), so an expanded year can show both
  // people's detail. The combined `breakdown` rows themselves carry no detail.
  primaryBreakdown?: YearlyBreakdown[];
  spouseBreakdown?: YearlyBreakdown[];
  spouseAgeOffset?: number; // inputs.currentAge - spouse.currentAge
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

// A single labelled money line inside the drill-down panel.
function Line({ label, value, hint, strong, indent }: {
  label: string; value: number; hint?: string; strong?: boolean; indent?: boolean;
}) {
  if (Math.abs(value) < 0.5) return null; // hide zero lines to reduce noise
  return (
    <div className={`flex items-baseline justify-between gap-3 ${indent ? 'pl-3' : ''}`}>
      <span className={`text-[11px] ${strong ? 'font-semibold text-slate-800' : 'text-slate-600'}`} title={hint}>
        {label}
      </span>
      <span className={`text-[11px] font-mono ${strong ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>
        {formatCurrency(value)}
      </span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-[13rem]">
      <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-1">{title}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

// The expanded per-year drill-down: withdrawal provenance, growth, tax, RM,
// benefits and cash events.
function YearDetailPanel({ detail, row }: { detail: YearDetail; row: YearlyBreakdown }) {
  const w = detail.withdraw;
  const totalWithdrawn = row.withdrawals;
  const registeredTotal = w.rrifMin + w.rrif + w.rrsp;
  const pct = (v: number) => (totalWithdrawn > 0 ? ` ${Math.round((v / totalWithdrawn) * 100)}%` : '');
  const hasWithdrawals = totalWithdrawn > 0.5;
  const hasContrib = detail.contrib && (detail.contrib.rrsp + detail.contrib.tfsa + detail.contrib.taxable) > 0.5;
  const hasBenefits = row.cppIncome + row.oasIncome + row.gisIncome + row.pensionIncome > 0.5;
  const hasEmployment = (row.employmentGross ?? 0) > 0.5;
  const hasTax = Math.abs(row.incomeTax) > 0.5 || detail.tax.oasClawback > 0.5 || (row.totalTaxPaid ?? 0) > 0.5;
  const rm = detail.rm;

  return (
    <div className="flex flex-wrap gap-x-8 gap-y-4 px-2 py-1">
      {hasWithdrawals && (
        <Section title={`Where the ${formatCurrency(totalWithdrawn)} came from`}>
          {w.rrifMin > 0.5 && <Line label={`RRIF minimum${pct(w.rrifMin)}`} value={w.rrifMin} hint="Mandatory RRIF minimum, forced out first. Taxed as income." />}
          {w.rrif > 0.5 && <Line label={`RRIF draw${pct(w.rrif)}`} value={w.rrif} hint="Discretionary RRIF withdrawal. Taxed as income; grossed up so after-tax covers the need." />}
          {w.rrsp > 0.5 && <Line label={`RRSP draw${pct(w.rrsp)}`} value={w.rrsp} hint="RRSP withdrawal (before RRIF conversion). Taxed as income; grossed up." />}
          {w.tfsa > 0.5 && <Line label={`TFSA${pct(w.tfsa)}`} value={w.tfsa} hint="Tax-free: $1 withdrawn = $1 of spending." />}
          {w.taxable > 0.5 && (
            <>
              <Line label={`Taxable${pct(w.taxable)}`} value={w.taxable} hint="Non-registered. Only the embedded-gain fraction is taxed." />
              {detail.tax.capitalGains > 0.5 && (
                <Line label="↳ taxable gain portion" value={detail.tax.capitalGains} indent hint="The embedded-gain part of this draw, taxed at the inclusion rate. The rest is return of capital (tax-free)." />
              )}
            </>
          )}
          {w.cash > 0.5 && <Line label={`Cash cushion${pct(w.cash)}`} value={w.cash} hint="After-tax cash reserve, used as a last resort." />}
          {(w.rdsp ?? 0) > 0.5 && (
            <>
              <Line label={`RDSP${pct(w.rdsp ?? 0)}`} value={w.rdsp ?? 0} hint="Disability-plan withdrawal. The grant/bond/growth portion is taxable; the contribution principal is a tax-free return of capital." />
              {(detail.rdsp?.taxablePortion ?? 0) > 0.5 && (
                <Line label="↳ taxable portion" value={detail.rdsp!.taxablePortion ?? 0} indent hint="The grant/bond/growth part of this draw, added to taxable income. The rest is tax-free contribution principal." />
              )}
            </>
          )}
          {w.rmDraw > 0.5 && <Line label={`Reverse mortgage${pct(w.rmDraw)}`} value={w.rmDraw} hint="Tax-free borrowing against home equity; the loan grows by this amount." />}
          {registeredTotal > 0.5 && (
            <div className="pt-1 text-[10px] text-slate-400">Registered draws are grossed up for tax.</div>
          )}
        </Section>
      )}

      {hasContrib && (
        <Section title="Contributions">
          <Line label="RRSP" value={detail.contrib!.rrsp} />
          <Line label="TFSA" value={detail.contrib!.tfsa} />
          <Line label="Taxable" value={detail.contrib!.taxable} />
          {(detail.contrib!.rdsp ?? 0) > 0.5 && <Line label="RDSP" value={detail.contrib!.rdsp ?? 0} hint="Not deductible (like a TFSA); attracts grants/bonds at lower incomes." />}
          {(detail.contrib!.fhsa ?? 0) > 0.5 && <Line label="FHSA" value={detail.contrib!.fhsa ?? 0} hint="Deductible (like an RRSP); capped by the annual and lifetime limits." />}
        </Section>
      )}

      <Section title="Growth / interest earned">
        <Line label="RRSP" value={detail.growth.rrsp} />
        <Line label="RRIF" value={detail.growth.rrif} />
        <Line label="TFSA" value={detail.growth.tfsa} />
        <Line label="Taxable" value={detail.growth.taxable} />
        <Line label="Cash cushion" value={detail.growth.cash} hint="Cash earns the lower cushion rate." />
        {(detail.growth.rdsp ?? 0) > 0.5 && <Line label="RDSP" value={detail.growth.rdsp ?? 0} hint="Tax-sheltered growth; taxable only when withdrawn." />}
        {(detail.growth.fhsa ?? 0) > 0.5 && <Line label="FHSA" value={detail.growth.fhsa ?? 0} hint="Tax-sheltered growth; transfers to the RRSP at retirement (tax-free there too)." />}
      </Section>

      {detail.rdsp && (detail.rdsp.contribution > 0.5 || detail.rdsp.grant > 0.5 || detail.rdsp.bond > 0.5) && (
        <Section title="RDSP grants & bonds">
          {detail.rdsp.contribution > 0.5 && <Line label="Your contribution" value={detail.rdsp.contribution} />}
          {detail.rdsp.grant > 0.5 && <Line label="CDSG (grant)" value={detail.rdsp.grant} hint="Canada Disability Savings Grant — matches contributions up to 300%/200% at lower incomes." />}
          {detail.rdsp.bond > 0.5 && <Line label="CDSB (bond)" value={detail.rdsp.bond} hint="Canada Disability Savings Bond — income-tested; no contribution needed." />}
          <Line label="Balance" value={detail.rdsp.balance} strong />
        </Section>
      )}

      {detail.fhsa && detail.fhsa.contribution > 0.5 && (
        <Section title="FHSA">
          <Line label="Contribution (deductible)" value={detail.fhsa.contribution} hint="Reduces this year's taxable income like an RRSP contribution." />
          <Line label="Contributed to date" value={detail.fhsa.contributionBasis} hint={`Toward the lifetime limit.`} />
          <Line label="Balance" value={detail.fhsa.balance} strong />
        </Section>
      )}

      {/* Contribution-room ledger (issue #24 / #119 T5): remaining room at year
          end for each tracked account, plus any over-contribution that overflowed
          to taxable this year. Shown only when room tracking is on. */}
      {detail.roomRemaining && (
        <Section title="Contribution room">
          {detail.roomRemaining.tfsa !== undefined && (
            <Line label="TFSA room left" value={detail.roomRemaining.tfsa} strong hint="Remaining TFSA contribution room at year end (after this year's accrual and deposits)." />
          )}
          {detail.roomRemaining.rrsp !== undefined && (
            <Line label="RRSP room left" value={detail.roomRemaining.rrsp} strong hint="Remaining RRSP contribution room at year end (after this year's accrual and deposits)." />
          )}
          {(detail.overflow?.tfsa ?? 0) > 0.5 && (
            <Line label="TFSA over-contribution" value={detail.overflow!.tfsa} hint="This much would have gone into the TFSA but ran out of room, so it was redirected to the taxable account." />
          )}
          {(detail.overflow?.rrsp ?? 0) > 0.5 && (
            <Line label="RRSP over-contribution" value={detail.overflow!.rrsp} hint="This much would have gone into the RRSP but ran out of room, so it was redirected to the taxable account." />
          )}
        </Section>
      )}

      {hasBenefits && (
        <Section title="Benefits (gross)">
          <Line label="CPP" value={row.cppIncome} />
          <Line label="OAS" value={row.oasIncome} />
          <Line label="GIS" value={row.gisIncome} hint="Tax-free." />
          <Line label="Pension" value={row.pensionIncome} />
        </Section>
      )}

      {hasEmployment && (
        <Section title="Employment income">
          <Line label="Gross pay" value={row.employmentGross ?? 0} hint="Earned income — stacks on benefits for tax, OAS clawback and GIS." />
          <Line label="Tax on it" value={row.employmentTax ?? 0} hint="The marginal tax on this pay, on top of the tax on benefits alone." />
          <Line label="After-tax (net)" value={row.employmentNet ?? 0} strong hint="Saved into the job's account, or used to top up spending first." />
        </Section>
      )}

      {hasTax && (
        <Section title="Tax on withdrawals">
          <Line label="Income tax" value={row.incomeTax} strong hint="Tax on registered draws and realized gains beyond the tax on benefits alone, plus OAS clawback." />
          <Line label="Total tax (all income)" value={row.totalTaxPaid ?? 0} hint="Tax on the year's ENTIRE income (benefits + employment + withdrawals + gains) plus OAS clawback — what a tax return would show. Charged every year taxable income is received." />
          {detail.tax.oasClawback > 0.5 && <Line label="↳ OAS clawback" value={detail.tax.oasClawback} indent hint="OAS recovery tax: net income above the threshold is clawed back at 15¢/$." />}
          <Line label="Cumulative tax" value={row.cumulativeTax} hint="Total income tax since retirement." />
        </Section>
      )}

      {rm && (
        <Section title="Reverse mortgage">
          <Line label="Interest accrued" value={rm.interestAccrued} hint="Compounds onto the loan even after the LTV ceiling stops new draws." />
          {rm.scheduledDraw > 0.5 && <Line label="Scheduled draw" value={rm.scheduledDraw} hint="Planned draw, CPI-indexed, capped by LTV headroom." />}
          {rm.topUpDraw > 0.5 && <Line label="Top-up draw" value={rm.topUpDraw} hint="Last-resort borrowing to cover the year's shortfall." />}
          <Line label="Loan balance" value={rm.loanBalance} strong />
          <Line label="Home value" value={rm.homeValue} />
        </Section>
      )}

      {detail.events.length > 0 && (
        <Section title="Cash events">
          {detail.events.map((ev, i) => (
            <div key={i} className="flex items-baseline justify-between gap-3">
              <span className="text-[11px] text-slate-600">{ev.label}</span>
              <span className={`text-[11px] font-mono ${ev.direction === 'in' ? 'text-emerald-700' : 'text-red-700'}`}>
                {ev.direction === 'in' ? '+' : '−'}{formatCurrency(ev.amount)}
              </span>
            </div>
          ))}
        </Section>
      )}
    </div>
  );
}

export function ScheduleTable({ breakdown, retirementAge, primaryBreakdown, spouseBreakdown, spouseAgeOffset = 0 }: ScheduleTableProps) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const toggle = (age: number) =>
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(age)) next.delete(age); else next.add(age);
      return next;
    });

  // Household mode: look each row's per-person detail up by age (the combined
  // rows carry no detail — per-source numbers don't sum meaningfully).
  const household = !!(primaryBreakdown || spouseBreakdown);
  const primaryByAge = new Map((primaryBreakdown ?? []).map(r => [r.age, r]));
  const spouseByAge = new Map((spouseBreakdown ?? []).map(r => [r.age + spouseAgeOffset, r]));

  // Reverse-mortgage columns appear only when the feature produced them.
  const hasRm = breakdown.some(r => r.netHomeEquity !== undefined);
  // RDSP balance column appears only when a person has an RDSP.
  const hasRdsp = breakdown.some(r => r.rdspBalance !== undefined);
  // FHSA balance column appears only when a person has an FHSA.
  const hasFhsa = breakdown.some(r => r.fhsaBalance !== undefined);
  const anyDetail = household || breakdown.some(r => r.detail);
  // Number of columns the detail row must span: base 19 + the expand chevron
  // (when any row is expandable) + optional RM/RDSP/FHSA columns. The chevron column
  // was previously left out, so an expandable table's detail row spanned one
  // column too few and the panel didn't reach the table's right edge.
  const colCount = 19 + (anyDetail ? 1 : 0) + (hasRm ? 1 : 0) + (hasRdsp ? 1 : 0) + (hasFhsa ? 1 : 0);

  return (
    <div className="bg-white border border-slate-200 rounded overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              {anyDetail && <th className="w-6 px-1 py-2" title="Expand a year to see where the money came from" />}
              <th className="text-left px-3 py-2 font-semibold text-slate-700">Age</th>
              <th className="text-right px-3 py-2 font-semibold text-slate-700">Starting Balance</th>
              <th className="text-right px-3 py-2 font-semibold text-slate-700">Contributions</th>
              <th className="text-right px-3 py-2 font-semibold text-slate-700">Market Gains</th>
              <th className="text-right px-3 py-2 font-semibold text-slate-700" title="After-tax income goal for the year (desired spending inflated to that year)">Spending Target</th>
              <th className="text-right px-3 py-2 font-semibold text-slate-700">Withdrawals</th>
              <th className="text-right px-3 py-2 font-semibold text-slate-700" title="Incremental tax on this year's withdrawals (registered draws + realized gains) beyond the tax on benefits alone, plus OAS clawback. Reads $0 late in life once the portfolio is drained — that does NOT mean tax stopped; see Total Tax.">Income Tax</th>
              <th className="text-right px-3 py-2 font-semibold text-slate-700" title="Total tax on ALL of the year's income (CPP, OAS, pension, employment, withdrawals) plus OAS clawback. Charged every year taxable income is received, right to the final year.">Total Tax</th>
              <th className="text-right px-3 py-2 font-semibold text-slate-700" title="Running total of income tax paid since retirement">Tax Burden</th>
              <th className="text-right px-3 py-2 font-semibold text-slate-700">CPP</th>
              <th className="text-right px-3 py-2 font-semibold text-slate-700">OAS</th>
              <th className="text-right px-3 py-2 font-semibold text-slate-700" title="Guaranteed Income Supplement (tax-free; couples assessed on combined income)">GIS</th>
              <th className="text-right px-3 py-2 font-semibold text-slate-700" title="Defined-benefit / bridge pension income (taxable)">Pension</th>
              <th className="text-right px-3 py-2 font-semibold text-slate-700">Ending Balance</th>
              <th className="text-right px-3 py-2 font-semibold text-slate-700">RRSP</th>
              <th className="text-right px-3 py-2 font-semibold text-slate-700">RRIF</th>
              <th className="text-right px-3 py-2 font-semibold text-slate-700">TFSA</th>
              <th className="text-right px-3 py-2 font-semibold text-slate-700">Taxable</th>
              <th className="text-right px-3 py-2 font-semibold text-slate-700">Cash Cushion</th>
              {hasRdsp && (
                <th className="text-right px-3 py-2 font-semibold text-slate-700" title="Registered Disability Savings Plan. Growth is tax-sheltered; on withdrawal the grant/bond/growth portion is taxable (only contribution principal is tax-free).">RDSP</th>
              )}
              {hasFhsa && (
                <th className="text-right px-3 py-2 font-semibold text-slate-700" title="First Home Savings Account. Contributions are deductible; growth is tax-sheltered. Transfers to the RRSP at retirement (never drawn directly).">FHSA</th>
              )}
              {hasRm && (
                <th className="text-right px-3 py-2 font-semibold text-slate-700" title="Home value minus reverse-mortgage loan balance. The loan compounds with interest and draws, eroding equity over time.">Home Equity</th>
              )}
            </tr>
          </thead>
          <tbody>
            {breakdown.map((row, index) => {
              const isRetirement = row.age === retirementAge;
              const isOpen = expanded.has(row.age);
              const personRows = household
                ? ([['You', primaryByAge.get(row.age)], ['Spouse', spouseByAge.get(row.age)]] as Array<[string, YearlyBreakdown | undefined]>)
                    .filter((x): x is [string, YearlyBreakdown] => !!x[1]?.detail)
                : [];
              const canExpand = household ? personRows.length > 0 : !!row.detail;
              const rowBg = index % 2 === 0 ? 'bg-white' : 'bg-slate-50/50';
              return (
                <Fragment key={index}>
                  <tr
                    className={`${rowBg} ${isRetirement ? 'border-t-2 border-blue-500' : ''} ${canExpand ? 'cursor-pointer hover:bg-blue-50/40' : ''}`}
                    onClick={canExpand ? () => toggle(row.age) : undefined}
                    title={canExpand ? (isOpen ? 'Collapse year detail' : 'Expand year detail') : undefined}
                  >
                    {anyDetail && (
                      <td className="px-1 py-1.5 text-slate-400">
                        {canExpand && (isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />)}
                      </td>
                    )}
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
                    <td className="px-3 py-1.5 text-right font-mono text-amber-800">
                      {formatCurrency(row.totalTaxPaid ?? 0)}
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
                    {hasRdsp && (
                      <td className="px-3 py-1.5 text-right font-mono text-slate-600"
                        title={row.detail?.rdsp ? `Contribution basis ${formatCurrency(row.detail.rdsp.contributionBasis)} (tax-free); the rest is taxable on withdrawal` : undefined}>
                        {row.rdspBalance !== undefined ? formatCurrency(row.rdspBalance) : '—'}
                      </td>
                    )}
                    {hasFhsa && (
                      <td className="px-3 py-1.5 text-right font-mono text-slate-600"
                        title={row.detail?.fhsa ? `Contributed to date ${formatCurrency(row.detail.fhsa.contributionBasis)}; transfers to the RRSP at retirement` : undefined}>
                        {row.fhsaBalance !== undefined ? formatCurrency(row.fhsaBalance) : '—'}
                      </td>
                    )}
                    {hasRm && (
                      <td className={`px-3 py-1.5 text-right font-mono ${(row.netHomeEquity ?? 0) < 0 ? 'text-red-600 font-semibold' : 'text-slate-600'}`}
                        title={row.homeValue !== undefined ? `Home ${formatCurrency(row.homeValue)} − loan ${formatCurrency(row.loanBalance ?? 0)}` : undefined}>
                        {row.netHomeEquity !== undefined ? formatCurrency(row.netHomeEquity) : '—'}
                      </td>
                    )}
                  </tr>
                  {isOpen && canExpand && (
                    <tr className={rowBg}>
                      <td colSpan={colCount} className="px-3 py-3 border-l-2 border-blue-300 bg-blue-50/30">
                        {household ? (
                          <div className="space-y-4">
                            {personRows.map(([label, personRow]) => (
                              <div key={label}>
                                <div className="text-[10px] font-bold uppercase tracking-wider text-blue-700 mb-1.5">
                                  {label}{personRow.age !== row.age ? ` (age ${personRow.age})` : ''}
                                </div>
                                <YearDetailPanel detail={personRow.detail!} row={personRow} />
                              </div>
                            ))}
                          </div>
                        ) : (
                          <YearDetailPanel detail={row.detail!} row={row} />
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="px-3 py-2 text-[10px] text-slate-400 border-t border-slate-100">
        Click a year to expand its inner workings — withdrawal sources, growth, tax, benefits and reverse
        mortgage. Amounts are in nominal (future) dollars of each year: the spending target and contributions
        grow with inflation, while balances, gains and benefits are the actual dollars that year. CPP/OAS are
        shown at 2026 values unless "Index tax tables, OAS and CPP" is on in Settings → Engine.
      </p>
    </div>
  );
}
