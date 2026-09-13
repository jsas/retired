// Curated 1-bit Bonsai models for the in-browser Transformers.js WebGPU path.
//
// This is NOT web-llm / MLC. Prism's 1-bit Bonsai packs run in the browser via
// @huggingface/transformers with device: "webgpu" and dtype: "q1" — the same
// stack as Hugging Face space webml-community/bonsai-webgpu.
//
// That space only ships 1.7B. 8B/27B need the custom-WGSL kernels demo
// (webml-community/bonsai-webgpu-kernels), which is a one-file app, not a
// library. Listing 8B here made ONNX Runtime die in the 32-bit WASM heap
// (std::bad_alloc / ERROR_CODE 6) with the discrete GPU still idle.
// GGUF / MLX / AWQ weights are also absent — those need llama.cpp / mlx.
//
// Every id below is an onnx-community ONNX pack of prism-ml/Bonsai-*-unpacked.

export interface BonsaiModelChoice {
  /** Hugging Face model id (onnx-community/Bonsai-*-ONNX). */
  id: string;
  label: string;
  /** Approximate runtime VRAM in MB at q1. */
  vramMB: number;
  /** Approximate one-time download in GB. */
  sizeGB: number;
  /** 1-bit Bonsai is chat-first; small packs mangle tool JSON. */
  toolCapable: boolean;
  maxWindow: number;
  blurb: string;
}

export const BONSAI_MODELS: BonsaiModelChoice[] = [
  {
    id: 'onnx-community/Bonsai-1.7B-ONNX',
    label: 'Bonsai 1.7B (1-bit)',
    vramMB: 900,
    sizeGB: 0.4,
    toolCapable: false,
    maxWindow: 32768,
    blurb: 'Tiny 1-bit download. Questions only — pick Qwen3.5 4B for plan tools.',
  },
];

export function bonsaiModel(id: string): BonsaiModelChoice | undefined {
  return BONSAI_MODELS.find(m => m.id === id);
}
