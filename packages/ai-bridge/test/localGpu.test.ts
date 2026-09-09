import { describe, expect, it } from 'vitest';
import { isGpuOom, isOrtSessionAlloc } from '../src/localGpu.js';

describe('isOrtSessionAlloc', () => {
  it('matches ONNX session WASM-heap failure', () => {
    expect(isOrtSessionAlloc(new Error("Can't create a session. ERROR_CODE: 6, ERROR_MESSAGE: std::bad_alloc"))).toBe(true);
    expect(isGpuOom(new Error("Can't create a session. ERROR_CODE: 6, ERROR_MESSAGE: std::bad_alloc"))).toBe(false);
  });
});

describe('isGpuOom', () => {
  it('treats web-llm WebGPU dumps as OOM', () => {
    expect(isGpuOom(new Error("Failed to execute 'mapAsync' on 'GPUBuffer': Buffer was unmapped"))).toBe(true);
    expect(isGpuOom(new Error('WebGPU device was lost while loading the model (OOM)'))).toBe(true);
  });

  it('does not treat dtype / catalog errors as OOM', () => {
    expect(isGpuOom(new Error('Invalid dtype: q1. Should be one of: auto, fp32, fp16, q8'))).toBe(false);
    expect(isGpuOom(new Error('Unknown Bonsai model "nope"'))).toBe(false);
  });
});
