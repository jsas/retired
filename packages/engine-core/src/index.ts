// Public surface of @retired/engine-core: the whole retirement engine, decoupled
// from the web app. Pure and environment-agnostic — no DOM, localStorage, or
// fetch — so it runs in a browser tab, a Node MCP server, or a test worker.
// The web app re-exports these modules through thin barrels in src/lib/ so
// existing importers keep working unchanged.

export * from './retirementEngine';
export * from './canadianTax';
export * from './appConfig';
export * from './householdTypes';
export * from './strategies';
export * from './spendingSolver';
export * from './monteCarlo';
export * from './marketPeriods';
export * from './types';
export * from './compareMetrics';
export * from './eqConstraints';
export * from './eqSolver';
export * from './exampleScenarios';
