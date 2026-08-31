export * from './capabilities';
export * from './server';
export * from './inPageSession';
// NOTE: the Streamable HTTP adapter (`./streamableHttp`) is intentionally NOT
// re-exported here — it imports node:http/node:crypto, and this barrel is
// what the browser bundle resolves. Hosts that run on Node import
// '@retired/mcp-server/streamableHttp' directly.
