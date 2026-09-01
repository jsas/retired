# SFT runner (RE:tire fine-tune)

Self-contained TRL scaffold that does what `training/SPIKE.md` calls for:
assistant-token-masked full-SFT, in this case against the corpus your
`npx tsx training/generate.ts` already minted. Goal: ship the smallest
bake-off winner that clears 95% protocol-validity on the frozen eval split.

## Prerequisites

```bash
# 1. Pick your base from the bake-off (e.g. Qwen3 0.6B at no-think=70.9%).
export BASE_MODEL=Qwen/Qwen3-0.6B
export OUTPUT=training/sft/out/retire-0.6B
export HF_REPO=jsas/RE:tire-0.6B   # only if you want --push-to-hub

# 2. Install (conda or venv)
pip install -r training/sft/requirements.txt

# 3. (Optional) Freeze the corpus so the eval split doesn't drift under you.
npx tsx training/generate.ts   # re-mint the corpus (to refresh the eval hash)
```

## Run the trainer

```bash
python training/sft/train.py \
  --model $BASE_MODEL \
  --output $OUTPUT \
  --lr 1e-5 \
  --epochs 3 \
  --batch-size 4 \
  --grad-accum 8 \
  --max-length 4096
```

Defaults: full-SFT (per SPIKE), `assistant_only_loss=True` mask, bf16, no
sequence-packing, gradient checkpointing on. Evaluation runs whenever
`training/data/corpus.eval.jsonl` exists — a per-step `eval_loss` decides
which checkpoint gets promoted if `--load-best` (default true).

## Outputs

```
$OUTPUT/
  checkpoint-<>/         # best by eval_loss when --load-best
  final/                 # last-save target — merge/distribute this one
  runs/                  # tensorboard
```

## Once it's done

1. **Check eval protocol-validity locally** (in this repo):

   ```bash
   node training/driver/extractEvalSet.ts > /tmp/eval.json

   # Inference your fine-tuned model on the eval split and write replies:
   node training/driver/runGate.ts \
       --replies /path/to/your/replies.json \
       --model "$BASE_MODEL@$OUTPUT/final"
   ```

   The protocol-validity should now be ≥ the bake-off stock number
   (70.9% → 95%+).

2. **Export → HuggingFace** (public; attach attribution per Qwen license):

   ```bash
   python training/sft/train.py \
       --push-to-hub --hub-id $HF_REPO \
       --model $OUTPUT/final
   ```

3. **MLC compile for WebGPU** (we already have the pipeline in-tree; add the
   curated `WEBLLM_MODELS` entry in a follow-up PR after the weights live
   on HF).

## Common edits

- **QLoRA instead of full-SFT**: leave `--packing` on (it's disabled by
  default), and add `--lr 1e-4` with `--batch-size 64` if VRAM is tight. The
  SPIKE table calls full-SFT the default for structured-output reliability —
  QLoRA is the cheaper iterate-only fallback.
- **Smaller eval interval**: `--eval-steps 100` if the corpus is tiny.
- **Bigger eval**: `--max-length 8192` (matches your max-window).

## Watch for

- `assistant_only_loss=True` requires a tokenizer that supports
  `apply_chat_template` with `return_assistant_tokens_mask=True`. Qwen3 does.
  On other bases you may get the full-text-loss fallback — the gate still
  tells you which.
- If you see `Unknown tool "…"` in eval but the corpus-mint passed tests,
  you likely re-generated the corpus between points 1 and 2 — re-frozen hash.
- Never commit `training/sft/out/` or `training/data/` — both are gitignored.
