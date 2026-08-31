// The stock-small-model BAKE-OFF manifest. Per the user's steer ("the smaller
// the better, runs well on mobile"), we don't pre-commit to a 1.7B base — we
// run the protocol-validity eval gate across every credible tiny base and let
// the numbers pick the SMALLEST one that clears the bar. The corpus eval split
// (mint.ts) is the benchmark set these are scored against.
//
// Every entry already has an MLC q4f16_1 prebuilt in web-llm's
// prebuiltAppConfig, so a later fine-tune of the same architecture can likely
// REUSE that prebuilt's webgpu wasm — collapsing the compile risk the issue
// flagged. Bases without a clean redistributable license are marked but kept
// out of the recommended set.

export interface BakeoffBase {
  /** web-llm prebuilt model_id (q4f16_1). */
  modelId: string;
  /** Short label. */
  label: string;
  /** Billions of parameters. */
  paramsB: number;
  /** Approx one-time download in GB (q4f16 ≈ params × 0.55). */
  sizeGB: number;
  /** Weight license; only 'Apache-2.0' (or similarly clean) is redistributable
   *  for a first-party fine-tune mirror. */
  license: 'Apache-2.0' | 'Llama-Community' | 'Gemma-Terms' | 'MIT';
  /** Redistributable for a public first-party mirror? Hard gate. */
  redistributable: boolean;
  /** Why it's in / out of the running. */
  note: string;
}

export const BAKEOFF_BASES: BakeoffBase[] = [
  {
    modelId: 'Qwen3-0.6B-q4f16_1-MLC', label: 'Qwen3 0.6B', paramsB: 0.6, sizeGB: 0.4,
    license: 'Apache-2.0', redistributable: true,
    note: 'Phone-friendly size. The open question the bake-off answers: can 0.6B hold the protocol after SFT?',
  },
  {
    modelId: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC', label: 'Qwen2.5 0.5B', paramsB: 0.5, sizeGB: 0.3,
    license: 'Apache-2.0', redistributable: true,
    note: 'Smallest clean-license instruct. Likely too weak, but cheap to test — and "smaller the better".',
  },
  {
    modelId: 'Qwen3.5-0.8B-q4f16_1-MLC', label: 'Qwen3.5 0.8B', paramsB: 0.8, sizeGB: 0.5,
    license: 'Apache-2.0', redistributable: true,
    note: 'Newer tiny Qwen; verify license text + chat template on the card before relying on it.',
  },
  {
    modelId: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 1B', paramsB: 1.0, sizeGB: 0.7,
    license: 'Llama-Community', redistributable: false,
    note: 'Strong for 1B and phone-optimized by Meta, but the AUP/community license complicates a first-party mirror. Benchmark it as a capability reference; only ship if the license clears.',
  },
  {
    modelId: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', label: 'Qwen2.5 1.5B', paramsB: 1.5, sizeGB: 0.9,
    license: 'Apache-2.0', redistributable: true,
    note: 'Mature; many existing tool-call fine-tunes to borrow hyperparameters from.',
  },
  {
    modelId: 'Qwen3-1.7B-q4f16_1-MLC', label: 'Qwen3 1.7B', paramsB: 1.7, sizeGB: 1.0,
    license: 'Apache-2.0', redistributable: true,
    note: 'The "safe" fallback if the sub-1B tier fails the protocol bar.',
  },
  {
    modelId: 'SmolLM2-1.7B-Instruct-q4f16_1-MLC', label: 'SmolLM2 1.7B', paramsB: 1.7, sizeGB: 1.0,
    license: 'Apache-2.0', redistributable: true,
    note: 'Fully open (weights + data); weaker tool-calling out of the box. Fallback reference.',
  },
  {
    modelId: 'Qwen3.5-2B-q4f16_1-MLC', label: 'Qwen3.5 2B', paramsB: 2.0, sizeGB: 1.2,
    license: 'Apache-2.0', redistributable: true,
    note: 'Upper bound of the search. Only worth it if nothing smaller clears the bar — too big for the mobile goal otherwise.',
  },
];

/** The redistributable, phone-plausible candidates, smallest first — the order
 *  the bake-off should try so it can STOP at the first base that clears the
 *  protocol-validity bar. */
export const CANDIDATES_SMALLEST_FIRST: BakeoffBase[] = BAKEOFF_BASES
  .filter((b) => b.redistributable)
  .sort((a, b) => a.paramsB - b.paramsB);

/** Protocol-validity threshold a base must reach (stock, before SFT) to be
 *  worth fine-tuning, and the post-SFT target that would make a custom model
 *  worth shipping over the stock Qwen3-4B reference (the probe baseline's
 *  cleanest model — SPIKE.md §6). Deliberately strict: a model that can't
 *  reliably emit one clean TOOL_CALL line has no business driving the app on
 *  a phone. */
export const THRESHOLDS = {
  /** Below this stock score, SFT is unlikely to rescue the base. */
  stockFloorToAttemptSft: 0.30,
  /** Post-SFT protocol-validity needed to consider shipping. */
  postSftShipBar: 0.95,
} as const;
