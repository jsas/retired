// Annual real (after-inflation) total-return series for a Canadian 60/40
// balanced portfolio, 1970–2024. Each entry is the real growth multiplier for
// that calendar year (e.g. 1.13 = +13% after inflation).
//
// Construction (60% equity / 40% bond, both deflated by CPI):
//   Equity — S&P/TSX Composite annual price return plus a 3.0% constant
//     dividend yield (the long-run TSX average) to approximate total return.
//     Price returns: S&P/TSX Composite Index yearly-returns table.
//   Bond — derived total return for a ~constant 8-year-duration Government of
//     Canada long bond, reconstructed from the StatCan 10yr+ benchmark yield
//     (series V122515 annual averages) via R ≈ y_prev − D·Δy + ½·C·(Δy)².
//   CPI — Statistics Canada all-items CPI, annual average % change.
// Real portfolio return = 0.6·equityReal + 0.4·bondReal, rounded to 2 decimals.
//
// Regenerate with `npx tsx src/build.historical.mjs` (prints the TS block).
// The equity leg and CPI are actual published data; the bond leg is a
// documented reconstruction from yields, not an official index total return.

export const HISTORICAL_REAL_RETURNS: { startYear: number; returns: number[] } = {
  startYear: 1970,
  returns: [
    /* 1970 */ 0.98, /* 1971 */ 1.06, /* 1972 */ 1.13, /* 1973 */ 0.95,
    /* 1974 */ 0.76, /* 1975 */ 1.02, /* 1976 */ 1.02, /* 1977 */ 1.01,
    /* 1978 */ 1.08, /* 1979 */ 1.16, /* 1980 */ 1.04, /* 1981 */ 0.81,
    /* 1982 */ 1.00, /* 1983 */ 1.25, /* 1984 */ 0.96, /* 1985 */ 1.19,
    /* 1986 */ 1.09, /* 1987 */ 1.02, /* 1988 */ 1.05, /* 1989 */ 1.11,
    /* 1990 */ 0.88, /* 1991 */ 1.08, /* 1992 */ 1.04, /* 1993 */ 1.23,
    /* 1994 */ 1.01, /* 1995 */ 1.11, /* 1996 */ 1.21, /* 1997 */ 1.14,
    /* 1998 */ 1.04, /* 1999 */ 1.19, /* 2000 */ 1.04, /* 2001 */ 0.94,
    /* 2002 */ 0.94, /* 2003 */ 1.17, /* 2004 */ 1.10, /* 2005 */ 1.16,
    /* 2006 */ 1.10, /* 2007 */ 1.05, /* 2008 */ 0.82, /* 2009 */ 1.22,
    /* 2010 */ 1.10, /* 2011 */ 0.96, /* 2012 */ 1.07, /* 2013 */ 1.07,
    /* 2014 */ 1.05, /* 2015 */ 0.97, /* 2016 */ 1.13, /* 2017 */ 1.04,
    /* 2018 */ 0.92, /* 2019 */ 1.14, /* 2020 */ 1.06, /* 2021 */ 1.10,
    /* 2022 */ 0.86, /* 2023 */ 1.01, /* 2024 */ 1.11,
  ],
};

export interface BacktestWindow {
  startYear: number;
  finalBalance: number;
  depleted: boolean;
  depletionAge: number | null;
}

export interface BacktestResult {
  windowYears: number;
  windowCount: number;
  successCount: number;
  successRate: number; // 0..1
  worstWindow: BacktestWindow;
  bestWindow: BacktestWindow;
  medianFinalBalance: number;
  windows: BacktestWindow[];
}

// Local structural types so this module doesn't import the engine (avoids a
// module cycle: engine has no need for historical data, only this runner does).
interface BacktestInputsLike {
  currentAge: number;
  maxAge: number;
  investmentReturn: number;
  spouse?: unknown;
}

interface BacktestResultsLike {
  depletionAge: number | null;
  yearlyBreakdown: { age: number; endingBalance: number }[];
}

type EngineRun = (
  inputs: never,
  config: never,
  options?: { returnSequence?: Record<number, number> },
) => BacktestResultsLike;

/**
 * Run the plan against every rolling window of the historical real-return
 * series whose length covers the plan horizon (currentAge → maxAge).
 *
 * Because the series is in REAL terms, the caller passes a config whose
 * engine.inflationRate is 0 (spending stays in today's dollars, tax tables
 * frozen), and each window injects the historical real multiplier per age via
 * the engine's returnSequence option. The plan's own investmentReturn is the
 * fallback for ages beyond the window (shouldn't happen — windows are sized
 * to the horizon).
 */
export function runBacktest(
  inputs: BacktestInputsLike,
  realConfig: unknown,
  engineRun: EngineRun,
): BacktestResult {
  const { startYear, returns } = HISTORICAL_REAL_RETURNS;
  const horizon = Math.max(1, Math.round(inputs.maxAge - inputs.currentAge));
  const windowCount = returns.length - horizon + 1;

  const windows: BacktestWindow[] = [];
  for (let w = 0; w < windowCount; w++) {
    const seq: Record<number, number> = {};
    for (let y = 0; y < horizon; y++) {
      // Engine rates are growth factors applied to balances; historical
      // entries are real multipliers already (1.05 = +5%).
      seq[Math.round(inputs.currentAge) + y] = returns[w + y] - 1;
    }
    // Strip spouse to keep each window a single deterministic run of the
    // primary plan — spouse windows would need aligned-age sequencing and are
    // a documented future refinement.
    const { spouse: _spouse, ...soloInputs } = inputs;
    const runInputs = {
      ...soloInputs,
      investmentReturn: inputs.investmentReturn,
      returnVolatility: 0,
    };
    const result = engineRun(runInputs as never, realConfig as never, { returnSequence: seq });
    const last = result.yearlyBreakdown[result.yearlyBreakdown.length - 1];
    windows.push({
      startYear: startYear + w,
      finalBalance: last?.endingBalance ?? 0,
      depleted: result.depletionAge != null,
      depletionAge: result.depletionAge,
    });
  }

  const sorted = [...windows].sort((a, b) => a.finalBalance - b.finalBalance);
  const successCount = windows.filter((w) => !w.depleted).length;
  return {
    windowYears: horizon,
    windowCount: windows.length,
    successCount,
    successRate: windows.length > 0 ? successCount / windows.length : 0,
    worstWindow: sorted[0],
    bestWindow: sorted[sorted.length - 1],
    medianFinalBalance: sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)].finalBalance : 0,
    windows,
  };
}
