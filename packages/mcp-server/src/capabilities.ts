// Host capabilities: everything the MCP server needs from its environment to
// execute the tool catalog. The tools themselves are host-agnostic (they run
// the engine against a plan and return read results or mutation PROPOSALS);
// what varies by host is WHERE the live plan and its surrounding state come
// from. The in-page web host supplies the open tab's scenario; a future
// standalone host would supply a session's plan or stubs that report the
// capability as unavailable.
//
// This is deliberately the ToolContext the catalog already executes against —
// the server resolves it fresh for every call (getContext, not a snapshot) so
// an approved change mid-conversation is visible to the next tool invocation.

import type { ToolContext } from '@retired/mcp-tools/tools';

export interface RetirementServerCapabilities {
  /** Human name advertised in the MCP handshake (serverInfo). */
  serverName?: string;
  /** Resolve the live tool context for ONE tool execution. Called per call —
   *  never cached — so the engine always reads the plan as it is right now. */
  getContext(): ToolContext;
}
