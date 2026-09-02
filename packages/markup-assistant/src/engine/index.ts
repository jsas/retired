export * from './engine.js'
export * from './session.js'
export * from './stub.js'
export * from './openai.js'
export * from './bridgeEngine.js'
export * from './envConfig.js'
// Re-export the wire Edit/Intent types so node-side consumers (vite config)
// can use the `/engine` subpath without needing the full browser surface.
export type { Edit, Intent } from '../core/protocol.js'
