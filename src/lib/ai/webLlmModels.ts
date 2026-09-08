// Moved to @retired/ai-bridge. See providers.ts for the note.
export * from '@retired/ai-bridge/webLlmModels';
import { WEBLLM_MODELS, type WebLlmModelChoice } from '@retired/ai-bridge/webLlmModels';

/** Catalog rows the UI should offer. Dev-only fine-tunes (0.6B) stay in
 *  WEBLLM_MODELS so local Vite can load them, but they are hidden from
 *  pickers / Settings in a production build. */
export function visibleWebLlmModels(includeDevOnly = import.meta.env.DEV): WebLlmModelChoice[] {
  if (includeDevOnly) return WEBLLM_MODELS;
  return WEBLLM_MODELS.filter(m => !m.localDevOnly);
}
