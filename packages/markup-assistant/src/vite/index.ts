// The plugin (node side). The beacon is a browser module shipped as source to
// the page; it's not re-exported here so the node-side vite config doesn't
// pull DOM types into its program.
export * from './plugin.js'
export { gatherSourceContext, needlesFromDomSnapshot } from './sourceContext.js'
