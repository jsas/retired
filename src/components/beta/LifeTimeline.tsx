// The life timeline — this exact plan on one line. Working years, retired
// years, and where the money runs out (if it does). A faint balance curve sits
// above the axis; the funded baseline is solid until the money's gone, dotted
// red after. Pins mark you, work's end, and the run-out / outlasts verdict.
import type { RetirementInputs, YearlyBreakdown } from '@retired/engine-core/retirementEngine';
import { INK, FAINT, HAIRLINE, RED_DOT } from '../../design/tokens';

const W = 1000, H = 150;
const AXIS = 84;            // y of the baseline
const LL = 30, LR = 972;    // plot left/right

export function LifeTimeline({ inputs, breakdown }: {
  inputs: RetirementInputs;
  breakdown: YearlyBreakdown[];
}) {
  const { currentAge, retirementAge, maxAge } = inputs;
  const a0 = currentAge, a1 = maxAge;
  const xFor = (age: number) => LL + ((age - a0) / (a1 - a0)) * (LR - LL);

  const depletionAge = inputs && breakdown.length
    ? (breakdown.find(r => r.endingBalance <= 0)?.age ?? null)
    : null;
  const fundedEnd = depletionAge ?? a1;
  const maxBal = Math.max(1, ...breakdown.map(r => r.endingBalance));

  // Balance area above the axis (faint), scaled to the tallest year.
  const yForBal = (b: number) => AXIS - 6 - (Math.max(0, b) / maxBal) * 56;
  const areaPts = breakdown.map(r => `${xFor(r.age).toFixed(1)},${yForBal(r.endingBalance).toFixed(1)}`).join(' ');
  const areaD = breakdown.length
    ? `M ${xFor(a0)},${AXIS} L ${areaPts.replaceAll(' ', ' L ')} L ${xFor(breakdown[breakdown.length - 1].age)},${AXIS} Z`
    : '';

  const last = breakdown[breakdown.length - 1];
  const fmt = (v: number) => '$' + Math.round(v).toLocaleString('en-CA');

  // Per-year ticks: taller/darker every 5 years; red past depletion.
  const ticks = breakdown.map(r => {
    const major = r.age % 5 === 0;
    const working = r.age < retirementAge;
    const depleted = depletionAge != null && r.age > depletionAge;
    const color = depleted ? '#fca5a5' : working ? '#334155' : '#94a3b8';
    return { age: r.age, x: xFor(r.age), major, color };
  });

  return (
    <div>
      <p className="num mb-2 text-[11px] text-slate-400">
        {fmt(breakdown[0]?.startingBalance ?? 0)} today → {fmt(last?.endingBalance ?? 0)} at {last?.age ?? a1}
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img"
        aria-label={`Timeline from ${a0} to ${a1} showing working years, retirement years, and where the money runs out`}>
        {/* balance area */}
        {areaD && <path d={areaD} fill={INK} opacity="0.05" />}

        {/* funded baseline: solid to fundedEnd, dotted red after */}
        <line x1={LL} y1={AXIS} x2={xFor(fundedEnd)} y2={AXIS} stroke={INK} strokeWidth="2.5" />
        {depletionAge != null && depletionAge < a1 && (
          <line x1={xFor(depletionAge)} y1={AXIS} x2={LR} y2={AXIS} stroke={RED_DOT} strokeWidth="2" strokeDasharray="1 6" opacity="0.6" />
        )}

        {/* year ticks */}
        {ticks.map(t => (
          <line key={t.age} x1={t.x} y1={AXIS} x2={t.x} y2={AXIS + (t.major ? 12 : 7)} stroke={t.color} strokeWidth={t.major ? 2 : 1} />
        ))}
        {ticks.filter(t => t.major).map(t => (
          <text key={`l${t.age}`} x={t.x} y={AXIS + 26} textAnchor="middle" fontSize="11" fill={FAINT} fontFamily="inherit">{t.age}</text>
        ))}

        {/* pins */}
        <Pin x={xFor(currentAge)} y={AXIS + 40} anchor="start" color={INK} dot label={`you · ${currentAge}`} dotY={AXIS} />
        <Pin x={xFor(retirementAge)} y={18} anchor="middle" color="#475569" ring label={`work ends · ${retirementAge}`} dotY={AXIS} />
        {depletionAge != null && depletionAge <= a1 ? (
          <>
            <Pin x={xFor(depletionAge)} y={18} anchor="middle" color={RED_DOT} dot label={`money runs out · ${depletionAge}`} dotY={AXIS} />
            <text x={xFor(maxAge)} y={AXIS + 40} textAnchor="end" fontSize="11" fill={FAINT} fontFamily="inherit">planned to {maxAge}</text>
          </>
        ) : (
          <text x={LR} y={AXIS + 40} textAnchor="end" fontSize="11" fill="#166534" fontFamily="inherit">money outlasts the plan</text>
        )}
      </svg>
    </div>
  );
}

function Pin({ x, y, anchor, color, label, dot, ring, dotY }: {
  x: number; y: number; anchor: 'start' | 'middle' | 'end'; color: string;
  label: string; dot?: boolean; ring?: boolean; dotY: number;
}) {
  return (
    <g>
      {dot && <circle cx={x} cy={dotY} r="3.5" fill={color} />}
      {ring && <circle cx={x} cy={dotY} r="4.5" fill="#fff" stroke={color} strokeWidth="2" />}
      <line x1={x} y1={dotY} x2={x} y2={y - 4} stroke={HAIRLINE} strokeWidth="1" />
      <text x={x} y={y} textAnchor={anchor} fontSize="11" fontWeight="600" fill={color} fontFamily="inherit">{label}</text>
    </g>
  );
}
