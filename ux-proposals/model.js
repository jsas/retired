/* Shared demo model for the three UX proposals.
   Deliberately simple and honest: one pot of money, steady growth,
   contributions while working, spending after retirement, and a
   government-benefit top-up from benefitAge. The "sky" is the market's
   mood: storm / ordinary / kind — the layperson's Monte Carlo. */
const DEMO_DEFAULTS = {
  currentAge: 55,
  retireAge: 62,
  maxAge: 95,          // "I'm planning to 95"
  savings: 850000,
  contrib: 25000,      // added per year while working
  spending: 85000,     // per year after retirement
  benefits: 22000,     // CPP + OAS per year, from benefitAge
  benefitAge: 65,
  sky: 'normal',       // 'storm' | 'normal' | 'sun'
};

const SKY_RETURN = { storm: 0.012, normal: 0.03, sun: 0.045 };
const HARD_CAP = 110;  // sim never runs past this age

function simulate(o) {
  const r = SKY_RETURN[o.sky] ?? SKY_RETURN.normal;
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
