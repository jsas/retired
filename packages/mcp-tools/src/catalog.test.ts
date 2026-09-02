// Golden test for the assistant's tool surface.
//
// The zod schemas are the SINGLE source of truth for both consumers of the
// catalog — the LLM providers (via toolSpecs()'s JSON Schema) and the MCP
// server (which registers the same schemas). A change to a tool's name,
// description, or argument shape is a breaking change to the model contract,
// so this snapshot makes it intentional: if it fails, the diff IS the review
// of what the assistant's API just became. Regenerate with `vitest -u` and
// call it out in the commit message, like the engine's golden master.

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { TOOL_CATALOG, toolSpecs, type AgentToolName } from './tools';

describe('tool catalog surface', () => {
  it('exposes every catalog tool to LLM providers (names, descriptions, JSON Schema)', () => {
    const specs = toolSpecs().map(s => ({
      name: s.name,
      description: s.description,
      jsonSchema: s.jsonSchema,
    }));
    expect(specs).toMatchSnapshot();
  });

  it('advertises the same per-tool inputSchema the MCP server registers', () => {
    // What registerTool turns each schema into for tools/list — the MCP twin
    // of toolSpecs(). Pinning it here means the two surfaces can't drift.
    const advertised = Object.entries(TOOL_CATALOG).map(([name, entry]) => ({
      name,
      inputSchema: z.toJSONSchema(entry.schema),
    }));
    expect(advertised).toMatchSnapshot();
  });

  it('keeps the tool roster stable (sorted names)', () => {
    const expected: AgentToolName[] = [
      'get_scenario', 'run_projection', 'compare_scenarios', 'run_strategies',
      'solve_spending', 'run_monte_carlo', 'get_schedule',
      'set_scenario_value', 'propose_patch', 'propose_spouse', 'propose_income',
      'propose_spending_bands', 'propose_market_periods', 'propose_cash_event', 'propose_reverse_mortgage',
      'propose_rdsp', 'propose_fhsa', 'propose_revert',
      'manage_cash_event', 'manage_income', 'propose_debt', 'manage_debt',
      'remember', 'recall', 'open_scenario', 'save_scenario_as', 'list_scenarios',
      'find_page', 'get_sitemap', 'propose_navigate',
    ];
    expect(Object.keys(TOOL_CATALOG).sort()).toEqual([...expected].sort());
    expect(toolSpecs().map(s => s.name).sort()).toEqual([...expected].sort());
  });
});
