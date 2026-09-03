/* Shared demo model for the three UX proposals.
   Deliberately simple and honest: one pot of money, steady growth,
   contributions while working, spending after retirement, and a
   government-benefit top-up from benefitAge. The market dial is a plain
   annual-return assumption sliding from down (MARKET_DOWN) to up
   (MARKET_UP) — no weather metaphors. Older pages still pass
   sky: 'storm' | 'normal' | 'sun'; both are accepted. */
const DEMO_DEFAULTS = {
  currentAge: 55,
  retireAge: 62,
  maxAge: 95,          // "I'm planning to 95"
  savings: 850000,
  contrib: 25000,      // added per year while working
  spending: 85000,     // per year after retirement
  benefits: 22000,     // CPP + OAS per year, from benefitAge
  benefitAge: 65,
  market: 0.03,        // average annual market return (down..up)
};

const MARKET_DOWN = 0.012, MARKET_UP = 0.045;   // the dial's ends
const SKY_RETURN = { storm: MARKET_DOWN, normal: 0.03, sun: MARKET_UP };
const HARD_CAP = 110;  // sim never runs past this age

/* Resolve the return assumption. A legacy `sky` mood wins when present —
   the older proposals never set market and override sky directly, so their
   storm/sun switches keep working untouched. Pages that dropped sky
   entirely (f7) drive the numeric `market` dial. */
function marketReturn(o) {
  if (o.sky != null && SKY_RETURN[o.sky] != null) return SKY_RETURN[o.sky];
  if (typeof o.market === 'number') return o.market;
  return SKY_RETURN.normal;
}

function simulate(o) {
  const r = marketReturn(o);
  let bal = o.savings;
  let depletionAge = null;
  const rows = [];
  for (let age = o.currentAge; age <= HARD_CAP; age++) {
    const working = age < o.retireAge;
    const inflow = working ? o.contrib : (age >= o.benefitAge ? o.benefits : 0);
    const outflow = working ? 0 : o.spending;
    bal = bal * (1 + r) + inflow - outflow;
    if (bal <= 0) { depletionAge = age; bal = 0; rows.push({ age, bal: 0 }); break; }
    rows.push({ age, bal });
  }
  const rowAtMax = rows.find(rw => rw.age === o.maxAge);
  const leftAtMax = (depletionAge != null && depletionAge <= o.maxAge) ? 0 : (rowAtMax ? rowAtMax.bal : 0);
  const ok = depletionAge == null || depletionAge > o.maxAge;
  return { rows, depletionAge, leftAtMax, ok };
}

/* The age the money lasts to, as display text: "96" or "110+". */
function lastsLabel(res) {
  return res.depletionAge == null ? HARD_CAP + '+' : String(res.depletionAge);
}

/* One gentle, concrete suggestion when the plan falls short. */
function suggest(o) {
  for (let d = 1; d <= 5; d++) {
    const t = { ...o, retireAge: o.retireAge + d };
    if (simulate(t).ok) return d === 1 ? 'Working one more year would close the gap.'
                                       : `Working ${d} more years would close the gap.`;
  }
  for (let cut = 5000; cut <= 30000; cut += 5000) {
    const t = { ...o, spending: o.spending - cut };
    if (simulate(t).ok) return `Spending ${fmtMoney(cut)} less a year would close the gap.`;
  }
  return null;
}

function fmtMoney(v) {
  if (Math.abs(v) >= 1000000) return '$' + (v / 1000000).toFixed(2).replace(/\.?0+$/, '') + 'M';
  return '$' + Math.round(v).toLocaleString('en-CA');
}
