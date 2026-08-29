// Where to get an API key for each cloud provider, and what it costs — shown
// in the ADVANCED section of the setup panel. The local (webllm) path needs
// none of this, which is exactly why it's the default for non-savvy users.

import type { AiProviderId } from '../aiSettings';

export interface ProviderHelp {
  name: string;
  /** Where to sign up / get a key. */
  keyUrl: string;
  /** Plain-English "how to get a key". */
  howTo: string;
  /** Cost framing, one short line. */
  cost: string;
  /** True when this is a reasonable first cloud pick (free tier / easy). */
  easiest?: boolean;
}

export const PROVIDER_HELP: Partial<Record<AiProviderId, ProviderHelp>> = {
  gemini: {
    name: 'Google Gemini',
    keyUrl: 'https://aistudio.google.com/app/apikey',
    howTo: 'Open Google AI Studio, sign in with a Google account, click "Get API key" → "Create API key", and paste it here.',
    cost: 'Free tier available with daily limits — the cheapest way to try cloud AI.',
    easiest: true,
  },
  openrouter: {
    name: 'OpenRouter',
    keyUrl: 'https://openrouter.ai/keys',
    howTo: 'Create an OpenRouter account, go to Keys → "Create key", and paste it here. One key reaches many models (Claude, GPT, Llama, …).',
    cost: 'Pay-as-you-go; also hosts some free models (ids ending in ":free").',
    easiest: true,
  },
  anthropic: {
    name: 'Anthropic (Claude)',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    howTo: 'Sign in to the Anthropic Console, go to Settings → API Keys → "Create key", and paste it here.',
    cost: 'Pay-as-you-go; you add a small credit balance first.',
  },
  openai: {
    name: 'OpenAI (ChatGPT models)',
    keyUrl: 'https://platform.openai.com/api-keys',
    howTo: 'Sign in to the OpenAI platform, go to API keys → "Create new secret key", and paste it here.',
    cost: 'Pay-as-you-go; separate from a ChatGPT subscription.',
  },
  ollama: {
    name: 'Ollama (your own server)',
    keyUrl: 'https://ollama.com/download',
    howTo: 'Install Ollama on your computer, run "ollama pull <model>" then "ollama serve". No key — just the local address (default http://localhost:11434/v1).',
    cost: 'Free; runs on your hardware.',
  },
  'openai-compatible': {
    name: 'Any OpenAI-compatible endpoint',
    keyUrl: '',
    howTo: 'For any service that speaks the OpenAI API (LM Studio, Together, Groq, a company proxy…). Paste its base URL and key.',
    cost: 'Depends on the service.',
  },
};
