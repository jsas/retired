// In-page wiring: stand up the retirement MCP server and a client that talks
// to it inside the same tab. This is how the web app consumes the server —
// a linked pair of in-memory transports, zero network, zero serialization
// beyond the JSON-RPC the protocol mandates. Because the boundary is real
// MCP, swapping the transport for Streamable HTTPS (hosting the server
// elsewhere) touches nothing above this file.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createRetirementMcpServer } from './server';
import type { RetirementServerCapabilities } from './capabilities';

export interface RetirementMcpSession {
  /** The connected MCP client — listTools/callTool against the server. */
  client: Client;
  /** The server, in case the host wants to introspect registrations. */
  server: McpServer;
  /** Tear down both ends of the transport. */
  close(): Promise<void>;
}

/**
 * Create the server + an already-connected client over an in-memory linked
 * pair. `capabilities.getContext()` is resolved per tool call, so the client
 * always operates on the live plan.
 */
export async function createInPageMcpSession(
  capabilities: RetirementServerCapabilities,
  clientInfo: { name: string; version: string } = { name: 'retired-web', version: '1.0.0' },
): Promise<RetirementMcpSession> {
  const server = createRetirementMcpServer(capabilities);
  const client = new Client(clientInfo);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);

  return {
    client,
    server,
    async close() {
      await Promise.allSettled([client.close(), server.close()]);
    },
  };
}
