// Provider-neutral tool-call shapes, defined here (not in the app's
// ai/providers.ts) so the tool catalog stands alone: the MCP server, the web
// app, and any future host all speak in these terms. The app's providers.ts
// re-exports them so existing importers keep working.

/** One tool invocation requested by a model (or sent over MCP). */
export interface AgentToolCall {
  id: string;
  name: string;
  /** Parsed JSON arguments ({} when the model sent none / unparseable). */
  args: Record<string, unknown>;
}

/** A tool the model may call, described with a JSON Schema object. */
export interface ToolSpec {
  name: string;
  description: string;
  jsonSchema: Record<string, unknown>;
}
