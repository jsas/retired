# Usage — fine-tune the tool-calling model

Everything in `training/` is **elective and off the deploy path**. Nothing here
ships to GitHub Pages; the only thing that would ever merge to `main` is a
verified `WEBLLM_MODELS` entry on its own PR. This doc is the operator's guide:
mint the corpus, convert it for LLaMA-Factory, train, and score the result.

> Why the data is shaped this way: [METHODOLOGY.md](./METHODOLOGY.md).
> The repeatable "main changed → retrain" loop: [UPDATING.md](./UPDATING.md).
> Background + guardrails: [SPIKE.md](./SPIKE.md).

---

## TL;DR

```bash
npx tsx training/generate.ts                  # 1. mint corpus → training/data/corpus.{train,eval}.jsonl
npx tsx training/toLlamaFactory.ts            # 2. convert → lf_train/lf_eval.json + dataset_info.json
npx vitest run -c training/vitest.config.ts   # 3. toolkit tests green
npx tsx training/runGate.ts                   # 4. corpus self-check (must be 100%)

# 5. train (pick one — see §4):
training/train.sh training/lf_lora.yaml       # fast validation pass (~15h)
training/train.sh training/lf_sft.yaml        # full SFT (~40h, the ship candidate)

# 6. score a checkpoint against the frozen eval split:
npx tsx training/runGate.ts --replies data/bakeoff/<id>.replies.json --model <id>
```

---

## 1. Mint the corpus

```bash
npx tsx training/generate.ts
```

Runs the **real tool executor against the real deterministic engine** across the
plan sweep and writes `training/data/corpus.train.jsonl` +
`corpus.eval.jsonl` (+ `corpus.eval.sha256`, the frozen benchmark hash).
Assistant turns carry **Qwen3-native `<tool_call>` blocks** (see
`training/protocol.ts`); the runtime parser accepts both those and the legacy
`TOOL_CALL:` line. `training/data/` is gitignored — regenerate, never hand-edit.

## 2. Convert for LLaMA-Factory

```bash
npx tsx training/toLlamaFactory.ts
```

Converts the OpenAI-style corpus into LLaMA-Factory's **sharegpt** format
(`function_call` / `observation` roles) and writes:

```
training/data/lf_train.json        # train split (sharegpt)
training/data/lf_eval.json         # eval split
training/data/dataset_info.json    # LLaMA-Factory dataset registry
```

The converter emits a **slim tool manifest** (~2.1k tokens for 29 tools — name,
short description, arg names/types/required, enum values). The full JSON schemas
ran ~6.2k tokens — larger than the training window — so every example was being
truncated mid-manifest and the model never saw the conversations. Slimming keeps
what the model needs to emit a valid call; the full schemas stay in
`src/lib/ai/tools.ts` for runtime validation. **Regenerate this after any change
to the tool catalog or `toLlamaFactory.ts`.**

## 3. Test + self-check

```bash
npx vitest run -c training/vitest.config.ts   # toolkit suites (protocol, mint, eval)
npx tsx training/runGate.ts                   # corpus self-check — MUST be 100%
```

The self-check feeds each eval record's own assistant target back through the
gate; a correct corpus scores 100%. If it's lower, the corpus or gate is broken
— don't train on it.

---

## 4. Train with LLaMA-Factory

Training runs through [LLaMA-Factory](https://github.com/hiyouga/LlamaFactory),
configured by a single YAML. Two recipes ship:

| recipe | file | method | time (5070 Ti) | when |
|---|---|---|---|---|
| **LoRA** | `training/lf_lora.yaml` | rank-16 adapters (~1.7% of params) | ~15h | fast validation of the whole pipeline |
| **Full SFT** | `training/lf_sft.yaml` | all 596M params | ~40h | the ship candidate |

**Launch (from the worktree root):**

```bash
DISABLE_VERSION_CHECK=1 PYTHONIOENCODING=utf-8 PYTHONUTF8=1 \
  llamafactory-cli train training/lf_lora.yaml
```

Or use the wrapper that sets those env vars for you: `training/train.sh <yaml>`.
The three env vars are **required** on this machine (see Troubleshooting).

Both recipes share: `Qwen/Qwen3-0.6B` base, the `qwen3_nothink` chat template
(renders `<tool_call>` natively, no empty `<think>` block), the slim-manifest
corpus, `cutoff_len 3584` (fits every example whole), `packing: true`, bf16,
`plot_loss: true`.

**Watch it live:**

```bash
python training/watch_train.py        # tail the log's progress bar + GPU stats
tensorboard --logdir training/saves/qwen3-0.6b-lora   # loss curves on :6006
```

Checkpoints and the loss log (`trainer_log.jsonl`) land in
`training/saves/<run>/`.

## 5. Merge the adapter + export

LoRA produces a base + adapter; merge before MLC compile or Ollama import
(web-llm loads a single merged model):

```bash
DISABLE_VERSION_CHECK=1 PYTHONIOENCODING=utf-8 PYTHONUTF8=1 \
  llamafactory-cli export training/lf_merge.yaml   # see §5 note below
```

Full SFT already yields a standalone model in `training/saves/qwen3-0.6b-sft/`.

## 6. Score the result

```bash
node training/driver/runBakeoff.mjs --only <modelId>        # capture replies on the eval set
npx tsx training/runGate.ts --replies data/bakeoff/<id>.replies.json --model <id>
```

Prints protocol-validity %, the four strictness tiers (parseable → in-catalog →
args-valid → tool-match), failure triage, and PASS/FAIL vs the 95% ship bar.

---

## Where things live

```
training/
  protocol.ts        protocol contract — imports the LIVE catalog + parser (can't drift)
  buildCorpus.ts     record shapes + kind taxonomy + tool coverage matrix
  plans.ts           the 24-household plan sweep (all 13 provinces + couples/RM/RDSP/bands)
  domain.ts          domain-knowledge facts read live from appConfig
  mint.ts            the corpus generator
  generate.ts        CLI: mint → corpus.{train,eval}.jsonl (+ eval sha256)
  toLlamaFactory.ts  CLI: corpus → sharegpt JSON + dataset_info.json (slim manifest)
  eval.ts            the gate: scoreReply tiers, follow-up/mutation graders
  runGate.ts         CLI: self-check (default) or score --replies
  bakeoff.ts         base manifest + CANDIDATES_SMALLEST_FIRST + THRESHOLDS
  lf_lora.yaml       LoRA training recipe (validation)
  lf_sft.yaml        full-SFT training recipe (ship candidate)
  train.sh           launcher: sets the 3 required env vars, runs llamafactory-cli
  watch_train.py     live progress + GPU monitor
  driver/            WebGPU bake-off harness (CDP client, harness.html, runBakeoff.mjs)
  SPIKE.md           background + guardrails
  METHODOLOGY.md     why the data is shaped this way
  UPDATING.md        the repeatable retrain loop
  USAGE.md           this file
```

---

## Troubleshooting

| symptom | cause | fix |
|---|---|---|
| `llamafactory-cli: command not found` | Scripts dir not on PATH | call it by full path: `C:/Users/mrsas/AppData/Roaming/Python/Python314/Scripts/llamafactory-cli.exe` |
| `Pickler._batch_setitems() takes 2 positional arguments` | `datasets` dill bug on Python 3.14 | `pip install "datasets==4.8.5"` |
| version-check aborts (datasets/transformers cap) | llamafactory 0.9.5 caps | set `DISABLE_VERSION_CHECK=1` |
| `UnicodeEncodeError` (`\u2192`) on data example | Windows cp1252 console | set `PYTHONIOENCODING=utf-8 PYTHONUTF8=1` |
| `Your setup doesn't support bf16/gpu` | CPU torch crept in | reinstall CUDA torch: `pip install --force-reinstall torch --index-url https://download.pytorch.org/whl/cu128` |
| training ~400s/step, ETA days | full tool manifest truncating every example | regenerate with `toLlamaFactory.ts` (slim manifest) — fixed |
| self-check < 100% | corpus or gate regression | `npx vitest run -c training/vitest.config.ts` to find it; don't train |
