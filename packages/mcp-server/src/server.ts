// The retirement engine as a real MCP server.
//
// Every tool the AI assistant can call — reads AND mutation proposals — is
// registered here from ONE catalog (`@retired/mcp-tools`), so the LLM-facing
// JSON-Schema surface and the MCP surface can never drift apart. The server
// itself is host-agnostic: it owns no plan state. Whatever hosts it (the
// in-page web client today; a standalone process over Streamable HTTP later)
// injects the live plan through `capabilities.getContext()`, resolved fresh
// on every call so a just-approved change is visible to the next tool call.
//
// Confirm-before-apply survives the trip: propose_*/manage_* tools never
// apply themselves. Their `mutation` outcome rides back in the result's
// `structuredContent` — the host turns it into the existing user-confirm
// card. There is still no path from model output to plan state that bypasses
// that card; MCP only changes WHERE the tool boundary lives, not WHO approves.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  TOOL_CATALOG, executeToolCall,
  type AgentToolName, type ToolOutcome,
} from '@retired/mcp-tools/tools';
import type { RetirementServerCapabilities } from './capabilities';

/** Marker key under which a mutation proposal rides in structuredContent. The
 *  web client looks for exactly this shape to render the confirm card. */
export const MUTATION_STRUCTURED_KEY = 'mutation';

/** The structured payload of a mutation result — identical to the `mutation`
 *  branch of ToolOutcome, carried over the MCP boundary. */
export type MutationStructuredContent = Omit<
  Extract<ToolOutcome, { kind: 'mutation' }>,
  'kind'
>;

function outcomeToCallToolResult(outcome: ToolOutcome): CallToolResult {
  switch (outcome.kind) {
    case 'result':
      return { content: [{ type: 'text', text: outcome.content }] };
    case 'error':
      return {
        content: [{ type: 'text', text: outcome.content }],
        isError: true,
      };
    case 'mutation': {
      const { patch, label, preview, rationale, revert } = outcome;
      return {
        content: [{
          type: 'text',
          text: `${label} — proposal created; waiting for the user to confirm.`,
        }],
        structuredContent: {
          [MUTATION_STRUCTURED_KEY]: { patch, label, preview, rationale, revert },
        },
      };
    }
  }
}

/**
 * Build an MCP server exposing the full retirement tool catalog.
 *
 * `capabilities.getContext()` is invoked per tool call (never cached): the
 * engine always reads the plan as it is right now. Connect this server to a
 * client with any MCP transport — the web app uses
 * `InMemoryTransport.createLinkedPair()` (same-tab, zero network); the same
 * server object can later be mounted on StreamableHTTPServerTransport to be
 * hosted elsewhere.
 */
export function createRetirementMcpServer(
  capabilities: RetirementServerCapabilities,
): McpServer {
  const server = new McpServer({
    name: capabilities.serverName ?? 'retired',
    version: '1.0.0',
  });

  for (const [name, entry] of Object.entries(TOOL_CATALOG) as Array<
    [AgentToolName, (typeof TOOL_CATALOG)[AgentToolName]]
  >) {
    server.registerTool(
      name,
      {
        description: entry.description,
        inputSchema: entry.schema,
      },
      (args) => {
        const outcome = executeToolCall(capabilities.getContext(), {
          // executeToolCall validates args against the same schema; the MCP
          // layer has already parsed them, so this id is the only field the
          // caller fabricates (the in-app agent loop supplies its own ids).
          id: `mcp-${name}`,
          name,
          args: args as Record<string, unknown>,
        });
        return outcomeToCallToolResult(outcome);
      },
    );
  }

  return server;
}
