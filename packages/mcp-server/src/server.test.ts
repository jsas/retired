// Protocol round-trip tests for the retirement MCP server: initialize →
// tools/list → tools/call over a real in-memory transport, asserting the
// catalog surface and the ToolOutcome → CallToolResult mapping (including
// the mutation-via-structuredContent channel the confirm card depends on).

import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { baseInputs, testConfig } from '@retired/engine-core/test/helpers';
import { TOOL_CATALOG, type ToolContext } from '@retired/mcp-tools/tools';
import { createRetirementMcpServer, MUTATION_STRUCTURED_KEY } from './server';

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    inputs: baseInputs(),
    config: testConfig(),
    scenarioName: 'Test plan',
    scenarioList: [{ id: 's1', name: 'Test plan' }],
    ...overrides,
  };
}

async function connected(ctx: ToolContext) {
  const server = createRetirementMcpServer({ getContext: () => ctx });
  const client = new Client({ name: 'test-client', version: '0.0.1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(ct), server.connect(st)]);
  return { client, server };
}

describe('retirement MCP server (in-memory round trip)', () => {
  it('lists every catalog tool with a description and an object inputSchema', async () => {
    const { client, server } = await connected(makeContext());
    const { tools } = await client.listTools();

    expect(tools.map(t => t.name).sort()).toEqual(Object.keys(TOOL_CATALOG).sort());
    for (const tool of tools) {
      expect(tool.description).toBe(TOOL_CATALOG[tool.name as keyof typeof TOOL_CATALOG].description);
      expect(tool.inputSchema.type).toBe('object');
    }
    await Promise.allSettled([client.close(), server.close()]);
  });

  it('runs a read tool end to end (get_plan returns plan text)', async () => {
    const { client, server } = await connected(makeContext());
    const result = await client.callTool({ name: 'get_plan', arguments: { section: 'summary' } });

    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)
      .filter(c => c.type === 'text').map(c => c.text).join('\n');
    expect(text).toContain('Test plan');
    await Promise.allSettled([client.close(), server.close()]);
  });

  it('runs the engine over the wire (run_projection returns a verdict)', async () => {
    const { client, server } = await connected(makeContext());
    const result = await client.callTool({ name: 'run_projection', arguments: {} });

    expect(result.isError).toBeFalsy();
    const text = (result.content as Array<{ type: string; text: string }>)
      .filter(c => c.type === 'text').map(c => c.text).join('\n');
    expect(text.length).toBeGreaterThan(0);
    await Promise.allSettled([client.close(), server.close()]);
  });

  it('reports tool-level errors as isError text, not a transport failure', async () => {
    const { client, server } = await connected(makeContext());
    const result = await client.callTool({
      name: 'set_scenario_value',
      arguments: { field: 'events', value: [] }, // structural field: refused
    });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)
      .filter(c => c.type === 'text').map(c => c.text).join('\n');
    expect(text).toContain('not changeable');
    await Promise.allSettled([client.close(), server.close()]);
  });

  it('carries a mutation proposal in structuredContent (confirm-before-apply survives MCP)', async () => {
    const { client, server } = await connected(makeContext());
    const result = await client.callTool({
      name: 'set_scenario_value',
      arguments: { field: 'cppStartAge', value: 65 },
    });

    expect(result.isError).toBeFalsy();
    const structured = result.structuredContent as Record<string, Record<string, unknown>>;
    expect(structured).toBeDefined();
    const mutation = structured[MUTATION_STRUCTURED_KEY];
    expect(mutation).toBeDefined();
    expect(mutation.label).toBeTruthy();
    expect((mutation.patch as Record<string, unknown>).cppStartAge).toBe(65);
    expect(mutation.preview).toBeDefined();
    // The text content stays a human-readable summary, never the patch itself.
    const text = (result.content as Array<{ type: string; text: string }>)
      .filter(c => c.type === 'text').map(c => c.text).join('\n');
    expect(text).toContain('confirm');
    await Promise.allSettled([client.close(), server.close()]);
  });

  it('reads the live context per call (deferred getContext)', async () => {
    const ctx = makeContext();
    const { client, server } = await connected(ctx);

    await client.callTool({ name: 'get_plan', arguments: { section: 'summary' } });
    ctx.scenarioName = 'Renamed plan';
    const result = await client.callTool({ name: 'get_plan', arguments: { section: 'summary' } });

    const text = (result.content as Array<{ type: string; text: string }>)
      .filter(c => c.type === 'text').map(c => c.text).join('\n');
    expect(text).toContain('Renamed plan');
    await Promise.allSettled([client.close(), server.close()]);
  });
});
