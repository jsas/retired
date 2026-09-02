// The provider adapters moved to @retired/ai-bridge — the shared
// model-selection + chat surface both the web assistant and the markup
// assistant consume. This shim re-exports so existing imports keep working.
// New code should import from '@retired/ai-bridge'.
export * from '@retired/ai-bridge/providers';
