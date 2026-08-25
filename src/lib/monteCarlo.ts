import { calculateHousehold, type RetirementInputs } from './retirementEngine';
import type { AppConfig } from './appConfig';

/**
 * Monte Carlo success-rate simulation, matching the reference engine:
 * return sequences follow geometric Brownian motion with Student-t shocks
 * (10 degrees of freedom) for fat-tailed extreme years.
 */

export interface MonteCarloRequest {
  inputs: RetirementInputs;
  config: AppConfig;
  runs: number;
  volatility: number; // annual standard deviation of returns
}

export interface PercentileBand {
  age: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

export interface MonteCarloResults {
  runs: number;
  successCount: number;
  successRate: number;          // 0..1 — plan funded through maxAge
  medianFinalBalance: number;
  percentileBands: PercentileBand[];
  depletionHistogram: Array<{ age: number; count: number }>; // only failed runs
  meanReturn: number;
  volatility: number;
}

const DEGREES_OF_FREEDOM = 10;
const BALANCE_TOLERANCE = 1; // treat dust balances as depleted

function randNormal(rng: () => number): number {
  let u1 = 0;
  while (u1 === 0) u1 = rng(); // log(0) guard
  const u2 = rng();
  return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
}

function randStudentT(rng: () => number, df: number): number {
  const z = randNormal(rng);
  let v = 0;
  for (let i = 0; i < df; i++) {
    const n = randNormal(rng);
    v += n * n;
  }
  return z / Math.sqrt(v / df);
}

/** GBM annual return: exp(drift − σ²/2 + σZ) − 1 with Student-t Z. */
export function randomAnnualReturn(mean: number, volatility: number, rng: () => number): number {
  if (volatility <= 0) return mean;
  const drift = Math.log(1 + mean);
  const z = randStudentT(rng, DEGREES_OF_FREEDOM);
  const r = Math.exp(drift - 0.5 * volatility * volatility + volatility * z) - 1;
  return Math.round(r * 10000) / 10000;
}

export function generateReturnSequence(
  startAge: number,
  maxAge: number,
  mean: number,
  volatility: number,
  rng: () => number
): Record<number, number> {
  const seq: Record<number, number> = {};
  for (let age = startAge; age <= maxAge; age++) {
    seq[age] = randomAnnualReturn(mean, volatility, rng);
  }
  return seq;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return sorted[idx];
}

export function runMonteCarlo(request: MonteCarloRequest): MonteCarloResults {
  const { inputs, config, runs, volatility } = request;
  const rng = Math.random;

  let successCount = 0;
  const finalBalances: number[] = [];
  const depletionAges = new Map<number, number>();
  // balanceAtAge[age] = array of ending balances across runs (0 once depleted)
  const balanceAtAge = new Map<number, number[]>();

  for (let run = 0; run < runs; run++) {
    const seq = generateReturnSequence(inputs.currentAge, inputs.maxAge, inputs.investmentReturn, volatility, rng);
    const result = calculateHousehold(inputs, config, { returnSequence: seq });

    const depleted = result.depletionAge !== null;
    if (!depleted) {
      successCount++;
    } else {
      const age = result.depletionAge as number;
      depletionAges.set(age, (depletionAges.get(age) ?? 0) + 1);
    }

    let depletedSeen = false;
    for (let age = inputs.currentAge; age <= inputs.maxAge; age++) {
      const row = result.yearlyBreakdown.find(y => y.age === age);
      const balance = row && !depletedSeen ? Math.max(0, row.endingBalance) : 0;
      if (!row || row.endingBalance <= BALANCE_TOLERANCE) depletedSeen = true;
      if (!balanceAtAge.has(age)) balanceAtAge.set(age, []);
      balanceAtAge.get(age)!.push(balance);
    }

    const lastRow = result.yearlyBreakdown[result.yearlyBreakdown.length - 1];
    finalBalances.push(depleted ? 0 : Math.max(0, lastRow?.endingBalance ?? 0));
  }

  const percentileBands: PercentileBand[] = [];
  for (let age = inputs.currentAge; age <= inputs.maxAge; age++) {
    const balances = (balanceAtAge.get(age) ?? []).slice().sort((a, b) => a - b);
    percentileBands.push({
      age,
      p10: percentile(balances, 10),
      p25: percentile(balances, 25),
      p50: percentile(balances, 50),
      p75: percentile(balances, 75),
      p90: percentile(balances, 90)
    });
  }

  finalBalances.sort((a, b) => a - b);

  const depletionHistogram = Array.from(depletionAges.entries())
    .map(([age, count]) => ({ age, count }))
    .sort((a, b) => a.age - b.age);

  return {
    runs,
    successCount,
    successRate: runs > 0 ? successCount / runs : 0,
    medianFinalBalance: percentile(finalBalances, 50),
    percentileBands,
    depletionHistogram,
    meanReturn: inputs.investmentReturn,
    volatility
  };
}
