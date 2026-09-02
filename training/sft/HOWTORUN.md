# SFT runner (RE:tire fine-tune)

End-to-end, mint → train → bf16 → GGUF → Ollama → gate. Every artifact is
reproducible; nothing here needs anything off the machine except the base
model download and (optionally) a HuggingFace push at the very end.

## 0. Pick the base

```bash
export BASE_MODEL=Qwen/Qwen3-0.6B   # bake-off winner (e.g. Qwen3 0.6B @ 70.9%)
export OUTPUT=training/sft/out      # all trainer artifacts land here
export HF_REPO=jsas/RE:tire-0.6B    # ONLY if you later opt into --push-to-hub
```

## 1. Install

Python 3.14 + these pins work; the trap is `torch>=2.9,<3` resolving to `+cpu`
(broken GPU). Install `torch` explicitly against the CUDA index after the
requirements pass:

```bash
pip install -r training/sft/requirements.txt
pip install --force-reinstall --no-cache-dir \
    --index-url https://download.pytorch.org/whl/cu128 torch==2.9.1
python -c "import torch; print(torch.__version__, torch.cuda.is_available())"
# must print '2.9.1+cu128 True'
```

## 2. Mint the corpus (refreshes the frozen eval hash)

```bash
npx tsx training/generate.ts
```

`training/data/corpus.{train,eval}.jsonl` + `corpus.eval.sha256`. Any
spec/paraphrase/scenario change must land here in the same commit (CLAUDE.md
rule 2 — don't let the eval split drift silently).

## 3. Train

```bash
python training/sft/train.py \
  --model $BASE_MODEL \
  --output $OUTPUT \
  --lr 1e-5 \
  --epochs 3 \
  --batch-size 2 \
  --grad-accum 16 \
  --max-length 2048 \
  --eval-steps 250 \
  --save-total-limit 8
```

On the RTX 5070 Ti (16 GB) that's ~4 s/step → ~90 min for the whole 1416-step
run. Resume an interrupted run with `--resume` (bare flag = newest
`checkpoint-<int>` under `--output`; non-integer-suffixed export dirs like
`checkpoint-500-bf16` are ignored on purpose).

Defaults: full-SFT (per SPIKE), assistant-token masking via Qwen3's chat
template (`{% generation %}` markers — TRL 0.14 no longer takes
`assistant_only_loss`), bf16, gradient checkpointing on, best-checkpoint on
`eval_loss` when an eval split exists.

## 4. Outputs

```
$OUTPUT/
  checkpoint-<int>/      # every eval_steps boundary; trainer keeps
                         # save_total_limit of them
  final/                 # best (or last) checkpoint — distribute THIS one
  final-bf16/            # shanded to ~1.19 GB by to_bf16.py
  runs/                  # tensorboard
```

## 5. bf16 → GGUF q8_0 (no C build)

```bash
python training/sft/to_bf16.py $OUTPUT/final $OUTPUT/final-bf16
python training/sft/fetch_llama_cpp.py   # vendors convert_hf_to_gguf.py + gguf-py + conversion/qwen
python training/sft/llama.cpp/convert_hf_to_gguf.py \
    $OUTPUT/final-bf16 \
    --outtype q8_0 \
    --outfile training/sft/quantized/retire-0.6b.q8_0.gguf
```

Only f32/f16/bf16/q8_0 are expressible in pure Python; Q4_K_M wants compiled
`llama-quantize` (skip unless you take the C route).

## 6. Serve locally with Ollama

`training/sft/quantized/Modelfile` already pins SYSTEM prompt + Qwen3 chat
template + sampling parameters:

```bash
ollama create retire-0.6b -f training/sft/quantized/Modelfile
ollama run retire-0.6b "Am I on track?"
```

## 7. Gate it

```bash
# Replays the extractEvalSet.ts questions against the Ollama model and writes
# replies. Greedy + num_predict=512 (defaults) — protocol validity should be
# deterministic.
python training/sft/ollama_eval.py \
    --model retire-0.6b \
    --out training/sft/out/replies.json

npx tsx training/driver/extractEvalSet.ts > training/sft/out/evalset.json
npx tsx training/runGate.ts \
    --replies sft/out/replies.json \
    --model retire-0.6b-q8_0
```

Protocol-validity should now be ≥ the bake-off baseline (70.9%) and close on
95% (the ship bar in `training/bakeoff.ts`).

## 8. Optional: publish (user opt-in ONLY)

Public HuggingFace push — attach Qwen attribution, and only after the gate
clears:

```bash
python training/sft/train.py \
    --push-to-hub --hub-id $HF_REPO \
    --model $OUTPUT/final
```

MLC compile for WebGPU comes after weights are public; the curated
`WEBLLM_MODELS` entry lands in a follow-up PR.

## Troubleshooting (TRL 0.14 + Python 3.14)

The runner has been bitten by all of these; the work-arounds are baked into
`sft/train.py`. This note exists so the *reasons* don't get munged on the
next library upgrade.

1. **`datasets` + Python 3.14 breaks in-process hashing.** `load_dataset('json',
   split=...)` (and `Dataset.from_list`) route through
   `datasets.utils._dill`, which on 3.14 ships a
   `save_dict(pickler, obj)` call whose signature is `(pickler, items, obj)` —
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
   **It can also silently revert to `+cpu` when anything pip-installs over it**
   (a plain `pip install torch` or a resolver pass — a requirements.txt without
   the index pin is a trap). Symptom: training sits in dataloader for minutes
   with 0% GPU, then crawls at ~1 step/min with
   `'pin_memory' ... no accelerator is found` in the log. Check with the
   torch probe from step 1 and reinstall the cu128 wheel if it says `+cpu`.

6. **`use_cache=True` warning is expected** when `gradient_checkpointing=True`;
   TRL sets `model.config.use_cache=False` on your behalf. Not a bug — it
   means activation-checkpointing is on and the KV cache is allocated only
   during generation (which we don't do in SFT).

7. **llama.cpp's GGUF converter only writes f32/f16/bf16/q8_0** (`--outtype`);
   Q4_K_M and friends need the compiled `llama-quantize` binary. The pure-
   Python ladder that works with zero C build: safetensors → bf16
   (`to_bf16.py`) → `convert_hf_to_gguf.py --outtype bf16` → `--outtype
   q8_0`. Vendoring the converter needs `gguf-py/gguf/*` AND the `conversion/`
   package (`__init__.py`, `base.py`, arch file e.g. `qwen.py`) — see
   `fetch_llama_cpp.py`.

8. **Score an Ollama-served GGUF against the gate** with
   `ollama_eval.py` (replays `extractEvalSet.ts` output through
   `localhost:11434/api/chat`, writes replies.json) then
   `runGate.ts --replies ... --limit N`. Keep `num_predict` >= 256: several
   long-args tools truncate into malformed JSON below that.

9. **`--resume auto` only matches real trainer checkpoints** (`checkpoint-<int>`).
   Export dirs like `checkpoint-500-bf16` share the prefix — the glob filters
   them out by int-parsing the suffix, so don't name exports to look int-y.
   Also: `--eval-steps` DOES change between resume and initial run — the
   mismatch is benign and the trainer logs it.

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
- Never commit `training/sft/out/`, `training/sft/llama.cpp/`,
  `training/sft/quantized/`, or `training/data/` — all are gitignored.
