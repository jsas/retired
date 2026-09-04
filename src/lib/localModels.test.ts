import { describe, it, expect } from 'vitest';
import { rewriteResolveMain } from './localModels.js';

describe('rewriteResolveMain (web-llm HF-suffix strip for local model folders)', () => {
  it('strips resolve/main from a local model URL, keeping the file path', () => {
    expect(rewriteResolveMain('/retired/models/ft-MLC/resolve/main/mlc-chat-config.json'))
      .toBe('/retired/models/ft-MLC/mlc-chat-config.json');
    expect(rewriteResolveMain('/models/ft-MLC/resolve/main/params_shard_0.bin'))
      .toBe('/models/ft-MLC/params_shard_0.bin');
    expect(rewriteResolveMain('/models/ft-MLC/resolve/main/tensor-cache.json'))
      .toBe('/models/ft-MLC/tensor-cache.json');
  });

  it('passes the config-directory URL itself through (trailing slash, no file)', () => {
    expect(rewriteResolveMain('/models/ft-MLC/resolve/main/'))
      .toBe('/models/ft-MLC/');
  });

  it('leaves real HuggingFace URLs alone (they carry /resolve/<branch>/ after a repo path, not /models/)', () => {
    expect(rewriteResolveMain('https://huggingface.co/mlc-ai/Qwen3-0.6B-q4f16_1-MLC/resolve/main/mlc-chat-config.json'))
      .toBeNull();
  });

  it('ignores URLs that are not the resolve/main shape at all', () => {
    expect(rewriteResolveMain('/retired/models/ft-MLC/mlc-chat-config.json')).toBeNull();
    expect(rewriteResolveMain('/retired/src/App.tsx')).toBeNull();
    expect(rewriteResolveMain('/')).toBeNull();
    expect(rewriteResolveMain('')).toBeNull();
  });

  it('refuses path traversal out of the models folder', () => {
    expect(rewriteResolveMain('/retired/models/../secrets/resolve/main/x.json')).toBeNull();
    expect(rewriteResolveMain('/retired/models/ft-MLC/resolve/main/../../../.env')).toBeNull();
  });
});
