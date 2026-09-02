// The shared model-selection + chat surface. The bridge owns the provider
// stack; consumers get selection, streaming chat, and one-shot chat from one
// place. See bridge.ts for the design note.
//
// webLlmProvider is deliberately NOT re-exported here: it carries the heavy
// @mlc-ai/web-llm payload and must stay a lazy dynamic import (the app code-
// splits it out of the main bundle). Import it from
// '@retired/ai-bridge/webLlmProvider' when you need local-model control.
export * from './types.js'
export * from './connections.js'
export * from './registry.js'
export * from './providers.js'
export * from './bridge.js'
export * from './webLlmModels.js'
export * from './machineGuide.js'
export * from './browserDetect.js'
