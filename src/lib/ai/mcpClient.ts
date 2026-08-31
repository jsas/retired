// The in-page MCP client: how the web app runs the assistant's tools through
// the real MCP server (`@retired/mcp-server`) instead of calling the catalog
// directly. One linked in-memory transport pair per page, a shared lazily-
// connected client, and an executor the agent loop can `await`.
//
// Because the boundary is the protocol (not a function call), the exact same
// server code can later be hosted elsewhere — swap `createInPageMcpSession`
// for a Streamable HTTP client and nothing above this file changes.
//
// Confirm-before-apply is preserved: a mutation proposal comes back in the
// result's `structuredContent` (never applied by the server) and is mapped
// back to the `mutation` ToolOutcome the agent loop already turns into a
// user-confirm card.

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  createInPageMcpSession,
  MUTATION_STRUCTURED_KEY,
  type MutationStructuredContent,
} from '@retired/mcp-server';
import type { AgentToolCall } from './providers';
import type { ToolContext, ToolOutcome } from './tools';

export interface McpToolExecutor {
  /** Execute one tool call through the MCP server. Async: it awaits the
   *  JSON-RPC round trip. */
  (call: AgentToolCall): Promise<ToolOutcome>;
}

// The session is a module singleton: the tools are stateless w.r.t. the
// transport (the live plan arrives through the deferred getContext closure),
// so one server+client pair serves every conversation on the page. Lazily
// created on first use so importing this module never eagerly spins a server.
let sessionPromise: Promise<{ client: Client }> | null = null;

function getSession(getContext: () => ToolContext): Promise<{ client: Client }> {
  sessionPromise ??= createInPageMcpSession({ getContext });
  return sessionPromise;
}

function textOf(result: CallToolResult): string {
  return (result.content as Array<{ type: string; text?: string }>)
    .filter(c => c.type === 'text')
    .map(c => c.text ?? '')
    .join('\n');
}

function resultToOutcome(result: CallToolResult): ToolOutcome {
  const structured = result.structuredContent as
    | Record<string, unknown>
    | undefined;
  const mutation = structured?.[MUTATION_STRUCTURED_KEY] as
    | MutationStructuredContent
    | undefined;
  if (mutation) {
    return { kind: 'mutation', ...mutation };
  }
  const content = textOf(result);
  return result.isError
    ? { kind: 'error', content }
    : { kind: 'result', content };
}

/**
 * Build the executor the agent loop uses. `getContext` must resolve the LIVE
 * tool context (deferred, like AgentPage's refs) — the server re-reads it on
 * every call, so an approved change mid-conversation is visible immediately.
 */
export function createMcpToolExecutor(
  getContext: () => ToolContext,
): McpToolExecutor {
  return async (call) => {
    const { client } = await getSession(getContext);
    const result = await client.callTool({
      name: call.name,
      arguments: call.args ?? {},
    }) as CallToolResult;
    return resultToOutcome(result);
  };
}

/** Test seam: drop the shared session (next executor call reconnects). */
export async function closeSharedMcpSession(): Promise<void> {
  const pending = sessionPromise;
  sessionPromise = null;
  if (pending) {
    const session = await pending.catch(() => null);
    await session?.client.close().catch(() => undefined);
  }
}
