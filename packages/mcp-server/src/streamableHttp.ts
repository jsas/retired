// OPTIONAL hosting adapter: the same retirement MCP server, mounted on the
// SDK's Streamable HTTP transport so the tool surface can be served from
// anywhere (a Node process, a container, a VM). The web app does NOT use
// this — it connects in-page over InMemoryTransport — and GitHub Pages can't
// run it. It exists so "host the engine elsewhere later" is a deployment
// decision, not new code: the catalog, validation, and confirm-before-apply
// semantics are identical either way.
//
// Lifecycle model: one McpServer + one transport PER session. MCP sessions
// are stateful (the initialize handshake binds a session id), so the adapter
// creates a fresh pair for each new session and asks the host how to resolve
// the tool context for that session.

import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createRetirementMcpServer } from './server';
import type { RetirementServerCapabilities } from './capabilities';

export interface StreamableHttpHost {
  /** Resolve the capabilities for ONE session. Called once per new MCP
   *  session (a client with no/unknown session id completing `initialize`).
   *  `sessionId` is the id the transport is about to assign — use it to key
   *  per-session plan state in a real deployment. */
  capabilitiesForSession(sessionId: string): RetirementServerCapabilities;
  /** Extra response headers (e.g. CORS) merged into every response. */
  corsHeaders?: Record<string, string>;
}

interface SessionEntry {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
}

/**
 * A minimal request handler for Node's `http` module (or any framework that
 * hands you IncomingMessage/ServerResponse). Wire it to a route, e.g.:
 *
 *   import { createServer } from 'node:http';
 *   const handler = createStreamableHttpHandler({ capabilitiesForSession });
 *   createServer((req, res) => handler(req, res)).listen(8080);
 *
 * POST carries JSON-RPC; GET opens the SSE stream; DELETE ends a session.
 */
export function createStreamableHttpHandler(host: StreamableHttpHost) {
  const sessions = new Map<string, SessionEntry>();

  function applyCors(res: ServerResponse) {
    for (const [k, v] of Object.entries(host.corsHeaders ?? {})) res.setHeader(k, v);
  }

  async function closeSession(sessionId: string) {
    const entry = sessions.get(sessionId);
    if (!entry) return;
    sessions.delete(sessionId);
    await Promise.allSettled([entry.server.close(), entry.transport.close()]);
  }

  return async function handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
    parsedBody?: unknown,
  ): Promise<void> {
    applyCors(res);
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    // Existing session: hand the request to its transport.
    if (sessionId && sessions.has(sessionId)) {
      await sessions.get(sessionId)!.transport.handleRequest(req, res, parsedBody);
      return;
    }

    // Session teardown.
    if (sessionId && req.method === 'DELETE') {
      await closeSession(sessionId);
      res.writeHead(200).end();
      return;
    }

    // Anything other than an initialize POST without a valid session is a
    // protocol error.
    if (req.method !== 'POST') {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        jsonrpc: '2.0', id: null,
        error: { code: -32000, message: 'Bad Request: no valid session id' },
      }));
      return;
    }

    // New session: a fresh server + transport pair. `onsessioninitialized`
    // fires when the handshake assigns the id; we register the pair then.
    let entry: SessionEntry | undefined;
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (newId: string) => {
        if (entry) sessions.set(newId, entry);
      },
    });
    // The capabilities resolve once the session id is known. The session id
    // is assigned during the initialize request we're about to handle, so
    // defer the lookup to the first context resolution after that: by then
    // `transport.sessionId` is set. Until then getContext would race the
    // handshake — so build the server with a lazy sessionId read.
    const server = createRetirementMcpServer({
      getContext: () => {
        const id = transport.sessionId;
        if (!id) throw new Error('MCP session not initialized');
        return host.capabilitiesForSession(id).getContext();
      },
    });
    entry = { server, transport };

    transport.onclose = () => {
      const id = transport.sessionId;
      if (id) void closeSession(id);
    };

    await server.connect(transport);
    await transport.handleRequest(req, res, parsedBody);
  };
}
