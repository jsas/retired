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

## Troubleshooting (TRL 0.14 + Python 3.14)

The runner has been bitten by all of these; the work-arounds below are
baked into `sft/train.py`, and this note exists so the *reasons* don't get
munged on the next library upgrade.

1. **`datasets` + Python 3.14 breaks in-process hashing.** `load_dataset('json',
   split=...)` (and `Dataset.from_list`) route through
   `datasets.utils._dill`, which on 3.14 ships a
   `save_dict(pickler, obj)` call whose signature is `(pickler, items)` —
   every row crashes with `TypeError: Pickler._batch_setitems() ...`. The
   trainer sidesteps the library: read the JSONL, hand
   `tokenizer.apply_chat_template` each row, then wrap the `input_ids` in a
   plain `torch.utils.data.Dataset`. TRL's dataset-normalization pass has an
   `isinstance(datasets.Dataset)` gate that's only checked for the
   `apply_chat_template` path, so already-encoded rows sail through.

2. **TRL 0.14 renamed `max_length` → `max_seq_length` on `SFTConfig`.** The
   `--max-length` CLI flag stays human-speak; the config kw passes as
   `max_seq_length=args.max_length`. If you copy the flag name onto the config
   call, `TypeError: SFTConfig.__init__() got an unexpected keyword argument
   'max_length'` — rename it at the plumbing layer.

3. **TRL 0.14 dropped `assistant_only_loss` from `SFTConfig` entirely**; the
   mask now comes from the base model's chat template (`{% generation %}`).
   Qwen3's template ships those markers, so supervision stays focused on
   assistant turns in this repo's corpus. Don't try to pass the kwarg back —
   it just fails at init.

4. **Windows consoles are cp1252.** Any `→`, `×`, `…` in `print()` crashes
   with `UnicodeEncodeError: 'charmap' codec ...` once the program writes to
   stdout. Use ASCII (`->`, `x`, `...`) or pre-set `PYTHONIOENCODING=utf-8`.

5. **torch's pip wheel resolves to `+cpu` on a blank install** unless you
   pass an explicit CUDA index. The `requirements.txt` line `torch>=2.9,<3`
   alone got `2.13.0+cpu`; install with
   `pip install --index-url https://download.pytorch.org/whl/cu128 torch`
   (cu12x for modern cards; `nvidia-smi` reports the driver's CUDA version).

6. **`use_cache=True` warning is expected** when `gradient_checkpointing=True`;
   TRL sets `model.config.use_cache=False` on your behalf. Not a bug — it
   means activation-checkpointing is on and the KV cache is allocated only
   during generation (which we don't do in SFT).

7. **llama.cpp's GGUF converter only writes f32/f16/bf16/q8_0** (`--outtype`);
   Q4_K_M and friends need the compiled `llama-quantize` binary. The pure-
   Python ladder that works with zero C build: safetensors -> bf16
   (`to_bf16.py`) -> `convert_hf_to_gguf.py --outtype bf16` -> `--outtype
   q8_0`. Vendoring the converter needs `gguf-py/gguf/*` AND the `conversion/`
   package (`__init__.py`, `base.py`, arch file e.g. `qwen.py`) — see
   `fetch_llama_cpp.py`.

8. **Score an Ollama-served GGUF against the gate** with
   `ollama_eval.py` (replays `extractEvalSet.ts` output through
   `localhost:11434/api/chat`, writes replies.json) then
   `runGate.ts --replies ... --limit N`. Keep `num_predict` >= 256: several
   long-args tools truncate into malformed JSON below that.

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
