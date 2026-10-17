// Shared GPU-memory helpers for the two in-browser engines (web-llm and Bonsai).
// They cannot share VRAM — loading one while the other is resident is a usual
// cause of web-llm WebGPU OOM. ONNX `std::bad_alloc` / ERROR_CODE 6 is different:
// that is the 32-bit WASM heap dying while compiling the graph, often with the
// discrete GPU still idle.

export function isOrtSessionAlloc(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /bad_alloc|ERROR_CODE:\s*6/i.test(msg);
}

export function isGpuOom(err: unknown): boolean {
  if (isOrtSessionAlloc(err)) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return /out of memory|oom|device.?lost|mapAsync|was unmapped|GPUBuffer|maxBufferSize|maxStorageBufferBindingSize|context window/i.test(msg);
}

export const BONSAI_ORT_HEAP_MESSAGE =
  "This Bonsai pack is too big for the browser's ONNX compiler (a ~2 GB WASM heap — Task Manager can still show the GPU idle). Use Bonsai 1.7B. 8B is the custom-kernel Hugging Face demo, not this engine.";

export const BONSAI_GPU_OOM_MESSAGE =
  'Not enough graphics memory to load this Bonsai model. The other on-computer model has been unloaded — try Bonsai 1.7B, or close other GPU apps and retry.';

/** Drop the sibling engine so only `keep` occupies the GPU. */
export async function unloadSiblingLocalEngine(keep: 'webllm' | 'bonsai'): Promise<void> {
  if (keep === 'bonsai') {
    const { unloadWebLlmEngine } = await import('./webLlmProvider.js');
    await unloadWebLlmEngine();
  } else {
    const { unloadBonsaiEngine } = await import('./bonsaiProvider.js');
    await unloadBonsaiEngine();
  }
}
