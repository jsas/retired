# Post-train report (bake-off winner fine-tune)

Run: training/sft/out — Qwen3 0.6B full-SFT  
Start: 2026-08-31 · bs=2·accum=16 → eff 32 · max_len 2048 · bf16 · 1416 steps planned

**Training was interrupted at step 787/1416** (external kill, no error in
trace). Scored below is the salvaged `checkpoint-500` (best eval checkpoint),
quantized to q8_0 GGUF and served via Ollama as `retire-0.6b:latest`.

## Result tables

| metric | baseline (Qwen3-0.6B, no-think) | fine-tuned (checkpoint-500, q8_0, Ollama) |
| --- | --- | --- |
| Protocol validity | 70.9% | **81.1%** (900/900 eval records) |
| parseable TOOL_CALL | bake-off | 96% |
| in-catalog tool | bake-off | 96% |
| args-valid | bake-off | 92% |
| tool-match | bake-off | 83% |

Gate command used:

```
python training/sft/ollama_eval.py --model retire-0.6b --out training/sft/out/replies-ollama.json
npx tsx training/runGate.ts --replies sft/out/replies-ollama.json --model retire-0.6b-q8_0-ollama
```

Result: **FAIL vs the 95% ship bar** (+10.2 pts over baseline but short).

Failure buckets (169 invalid / 900):

- 39× malformed JSON — mostly truncation at 256 new tokens (unbalanced
  braces) plus a few `maxVariants:5` unquoted-key slips
- 32× `get_scenario` where `run_projection` wanted
- 20× `run_strategies` args fail schema
- 16× `get_scenario` args fail schema
- 16× `solve_spending` / 16× `compare_scenarios` where `run_strategies` wanted
- 14× `get_schedule` where `get_scenario` wanted
- 11× `run_projection` where `compare_scenarios` wanted
- 6× misc tool swaps

## Training curve (checkpoint-500 trainer_state)

- step 25: loss 1.2885 → step 100: 0.1111 → step 500: 0.0692
- eval_loss @500: **0.2674** (best_metric; best_model_checkpoint = checkpoint-500)

## Eval set the gate runs against

- split hash: `c57bd4fe80784504`
- rows: 3,337 (engine-correct ground truth per `training/eval.ts`)
- scored here: the 900 eval-split `tool-call` records via
  `training/driver/extractEvalSet.ts` (production `TOOL_INSTRUCTIONS` system
  prompt, 15,467 chars)

## Final model on disk

- best checkpoint: `training/sft/out/checkpoint-500/` (fp32, 6.7 GB)
- bf16 safetensors: `training/sft/out/checkpoint-500-bf16/` (1.19 GB)
- GGUF bf16: `training/sft/quantized/retire-0.6b.bf16.gguf` (1.19 GB)
- GGUF q8_0: `training/sft/quantized/retire-0.6b.q8_0.gguf` (639 MB)
- Ollama: `retire-0.6b:latest` (id 09592a4ceb8c, 639 MB) — local only,
  **not published anywhere**

## Next steps

1. Finish the interrupted run: resume from checkpoint-500
   (`--resume` flag on `training/sft/train.py`) — eval_loss was still
   falling; a full 1416-step run should lift tool-match.
2. Re-score; if the gate clears 95% protocol-validity, promote the checkpoint
   id and close out #135.
3. Consider raising eval `num_predict` past 256 for the long-args tools
   (several malformed-JSON failures were pure truncation).
4. Retrain anyway once the #141 navigation catalog lands and NAV_SPECS joins
   the corpus (new eval hash) — per plan, that retrain supersedes this one.
