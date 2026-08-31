# Spike #112 — fine-tune a small open-weight model for this app's tool protocol

Status: **scoping / pre-training.** This doc answers the two questions the spike
opened with — *what can we train?* and *how do we do it?* — and lands the
reusable groundwork (a protocol contract + corpus builder skeleton) that both
the data generator and the eval gate build on. **No model is trained in this
repo**; training is an off-repo, elective effort. The only thing that would ever
merge to `main` is a verified `WEBLLM_MODELS` entry + an eval gate, on its own
branch/PR, per the workflow rules and the ROADMAP non-goals.

> **Guardrail (unchanged, governs the whole effort).** The app is a
> **calculator, not a planner**. The corpus teaches *consequence-explaining and
> tool-driving*, never recommendations. Weights would live on a public
> HuggingFace mirror and run **client-side on the user's GPU** via
> `@mlc-ai/web-llm` — no server, no proxying, fully offline once cached, exactly
> like every local model today. Nothing about training is on the deploy path.

---

## 1. The goal, in one line

Today's **tool-capability floor is ~3.8B params / a 2.5 GB download / ~3.4 GB
VRAM** (`WEBLLM_MODELS`, `src/lib/ai/webLlmModels.ts`). Everything smaller
mangles the `TOOL_CALL:` line and is forced into a tools-off "answer questions
only" mode (Gemma 2 2B is `toolCapable: false`). The spike asks: can a
**fine-tuned small** model drive the protocol reliably and fit in a **sub-GB
download**, so a genuinely tool-capable assistant runs on weak hardware?

> **Steer (2026-08-30): the smaller the better — target MOBILE.** The real win
> is a tuned model that runs *well on a phone's WebGPU*, not just a weak laptop
> GPU. So we optimize for the **smallest base that still clears the
> protocol-validity bar**, benchmark genuinely tiny bases (0.5–1.7B) rather than
> assuming 1.5B is the floor, and weight download size / VRAM / wasm memory /
> sustained-inference thermals alongside raw capability. Mobile WebGPU is
> stricter than desktop: tighter memory, no guaranteed fp16 everywhere, and
> battery/thermal throttling on long generations — all reasons to keep both the
> weights *and* the required context budget small.

The unfair advantage (from the issue): the engine is **deterministic and fully
client-side**, so we can mint near-unlimited, *correct* supervision for free —
enumerate the tool catalog, generate a question → the exact `TOOL_CALL` → run it
through the real engine → record the real result. No human labeling.

---

## 2. What we can train (the two targets)

### 2a. The tool protocol, natively — *the whole point*

A model that *knows* the protocol doesn't need a huge context budget or a
hand-held persona. The contract is fully specified by the app itself and locked
into `training/protocol.ts` (which imports the real catalog + parser, so the
corpus can't drift from shipped behavior):

- **Wire format** (`src/lib/ai/promptTools.ts`): the model emits **one bare
  line** — `TOOL_CALL: {"name": "<tool>", "args": {…}}`. Not fenced. Prose goes
  on other lines. The parser is case-insensitive on the marker, swallows
  wrapped-JSON continuation lines, and caps executed calls at 3/reply
  (`PROMPT_TOOL_MAX_CALLS_PER_REPLY`) and 5 round-trips/user-message
  (`PROMPT_TOOL_MAX_CALLS`).
- **Result envelope**: results come back as the **next user message** under a
  `Tool results:` header with `[OK] …` / `[ERROR] …` blocks. There is **no
  `TOOL_RESULT:` line** the model ever emits.
- **Mutation discipline**: every `propose_*` / `set_scenario_value` only
  *proposes*; the loop pauses for a user confirm card, then feeds back
  **APPROVED** ("now APPLIED … do NOT re-propose … report the resulting
  numbers") or **REJECTED** ("NOT applied … do not repeat unprompted"). The
  model must learn: approved → confirm + fresh `run_projection`; never
  re-propose after approval, never repeat after rejection.
- **The 23-tool catalog** (`src/lib/ai/tools.ts`): 9 pure reads
  (`get_scenario`, `run_projection`, `compare_scenarios`, `run_strategies`,
  `solve_spending`, `run_monte_carlo`, `get_schedule`, `recall`,
  `list_scenarios`), 11 mutation proposals, 3 direct writes (`remember`,
  `open_scenario`, `save_scenario_as`). Full arg shapes + result text templates
  are enumerated in the agent-produced spec (see `training/protocol.ts` and the
  tool-report in the spike notes).

**This is the highest-value, cheapest target.** Protocol-following is a
*format/behavior* skill, and format is exactly what small-model SFT teaches
well. A 1.5B model doesn't need to "understand retirement" to emit a clean
`TOOL_CALL:` line — it needs to have seen enough correct examples that the
format is muscle memory.

### 2b. Retirement-domain fluency — *the force multiplier*

Canadian drawdown vocabulary so the model reads a projection and explains
consequences in plain words without the machine-guide crutch: RRSP / TFSA /
FHSA / RRIF / LIF, GIS clawback, CPP/OAS timing (0.6%/month early-CPP reduction,
0.7%/month deferral bonus to 70, OAS clawback threshold), marginal-rate
meltdown, withdrawal-order effects. This is what lets a small model stop leaning
on a long system prompt and instead *explain* the numbers a tool returned.

**Domain fluency is the harder, lower-certainty target.** It risks the
"confidently wrong" failure the issue calls out, and it's where the
calculator-not-planner line lives. So the corpus weights protocol-correctness
heavily and treats domain prose as *explanation of tool-returned numbers*
(always grounded in a `Tool results:` block), never free-standing advice.

---

## 3. The corpus (what the supervision looks like)

One JSONL record per assistant turn we want to teach. `training/buildCorpus.ts`
holds the taxonomy + message-shape helpers; `training/protocol.ts` holds the
emitter/scorer wired to the live app. Record kinds:

| kind | what it teaches | share* |
|---|---|---|
| `tool-call` | question → ONE in-catalog `TOOL_CALL:` line | ~40% |
| `tool-followup` | `TOOL_CALL` → real `[OK]` result → plain-prose explanation quoting the numbers | ~25% |
| `mutation-confirm` | `propose_*` → APPROVED **and** REJECTED variants → confirm, never re-propose | ~15% |
| `refusal` | out-of-guardrail ask ("should I retire at 60?") → deflect, "I can show the consequences, not advise" | ~8% |
| `clarify` | ambiguous ask → ask a question, don't guess a tool | ~6% |
| `domain-explain` | projection digest → plain-words explanation (no tool needed) | ~6% |

\* target mix, tuned after the first eval. **Every tool gets ≥1 tool-call and
≥1 follow-up exemplar; every mutation tool gets both an APPROVED and a REJECTED
record.** That coverage matrix is `TOOL_TAXONOMY` in `buildCorpus.ts`.

**Scenario sweep** grounds it all in real engine output. `src/test/helpers.ts`
`baseInputs()` is the clean base to override per-scenario (province `'ONT'`,
`cppStartAge`/`oasStartAge` as explicit `null`, `withdrawalOrder` array,
`income: []`). Sweep these knobs: province (all 13, `'ONT'`-style codes),
income/spending bands, current/retirement/max ages, account mixes
(`rrspBalance`/`tfsaBalance`/`taxableBalance`/`cashCushionBalance` +
contributions), DB pensions (`income[]`), reverse mortgage, RDSP, spouse
present/absent. Key pitfalls the generator must respect (from CLAUDE.md):
`Pension.endAge` required-or-explicit-`null`; RM `startAge`/`durationYears` are
`number|undefined` — omit, never `null`; province is `'ONT'` never `'ON'`.

**Determinism confirmed.** `retirementEngine.ts` contains **no `Date.now` /
`Math.random` / `new Date`** — the projection is pure given inputs, so minting
correct supervision for free is sound. The one randomness boundary is Monte
Carlo (`monteCarlo.ts`): it takes an optional `seed` and uses a deterministic
`mulberry32` PRNG when set (falling back to `Math.random` only when no seed is
given). The generator must **pass a fixed seed** for any `run_monte_carlo` /
`solve_spending` exemplar so the recorded result is reproducible and the eval
set is stable.

**Guardrail voice (for refusal pairs).** The app's own framing — the assistant
"answers with your real numbers, not generic advice" and "AI replies are general
educational commentary, never personalized advice" (`HelpModal.tsx`). Refusal
records deflect recommendation-seeking ("should I…?", "which is best?") toward
*showing consequences* ("I can run both and show you the numbers — I can't tell
you which to choose"), in that exact register.

**Sizing.** For format-behavior SFT at 1.5–2B, a focused corpus of **~5–20k
high-quality, deduped, engine-grounded turns** is a sensible first rung — far
more valuable than 100k noisy ones. Start ~8k, eval, scale only if
protocol-validity hasn't saturated.

---

## 4. Base model — bake-off across the tiny tier (de-risked)

License + an existing MLC prebuilt are the two hard gates. A fine-tune of a base
that **already has an MLC `q4f16_1` prebuilt** can very likely reuse that
prebuilt's `model_lib` wasm (same architecture + quant), which collapses the
compile risk the issue flagged. **Method (decided with the user): benchmark the
stock bases size-for-size and let protocol-validity pick the smallest winner**
— don't pre-commit to 1.7B. The corpus eval split *is* the benchmark set.
Confirmed present in web-llm's `prebuiltAppConfig` (`q4f16_1-MLC` unless noted):

| base | params | ≈dl (q4f16) | license | MLC prebuilt | mobile note |
|---|---|---|---|---|---|
| **Qwen3-0.6B** | 0.6B | ~0.4 GB | **Apache-2.0** ✅ | `Qwen3-0.6B-q4f16_1-MLC` | **Phone-friendly size.** Can it hold the protocol? Exactly what the bake-off answers. |
| **Qwen2.5-0.5B-Instruct** | 0.5B | ~0.3 GB | Apache-2.0 ✅ | `Qwen2.5-0.5B-Instruct-q4f16_1-MLC` | Smallest clean-license instruct. Likely too weak — but cheap to test. |
| **Qwen3.5-0.8B** | 0.8B | ~0.5 GB | Apache-2.0 ✅ | `Qwen3.5-0.8B-q4f16_1-MLC` | Newer tiny; verify license+template. |
| **Llama-3.2-1B-Instruct** | 1B | ~0.7 GB | ⚠️ Llama Community | `Llama-3.2-1B-Instruct-q4f16_1-MLC` | Strong for 1B, but AUP attached; phone-optimized by Meta. Only if license clears. |
| **Qwen2.5-1.5B-Instruct** | 1.5B | ~0.9 GB | Apache-2.0 ✅ | `Qwen2.5-1.5B-Instruct-q4f16_1-MLC` | Mature; many tool-call fine-tunes to borrow hyperparams from. |
| **Qwen3-1.7B** | 1.7B | ~1.0 GB | Apache-2.0 ✅ | `Qwen3-1.7B-q4f16_1-MLC` | The "safe" pick if the tiny tier fails the bar. |
| **SmolLM2-1.7B-Instruct** | 1.7B | ~1.0 GB | Apache-2.0 ✅ | `SmolLM2-1.7B-Instruct-q4f16_1-MLC` | Fully open (weights+data); weaker tool-calling OOTB. |
| Qwen3.5-2B | 2B | ~1.2 GB | Apache-2.0 ✅ | `Qwen3.5-2B-q4f16_1-MLC` | Upper bound; only if nothing smaller clears. |
| Gemma 2 2B / Gemma 3 1B | 1–2B | — | ⚠️ Gemma Terms | present | **Avoid** — redistribution stricter than Apache/MIT. |
| Phi-mini | ≥3.8B | — | MIT ✅ | — | **No ≤2B Phi exists.** Out of scope for mobile. |

**Download ≈ params × 0.55 GB** (q4f16). For a phone, ~0.4–0.7 GB is the
comfortable band; ~1 GB is the ceiling. The bake-off ranks bases by
protocol-validity **per GB**, and we fine-tune the *smallest* one that clears
the bar — that's the whole mobile thesis.

**Full fine-tune vs LoRA.** At ≤2B, **full-parameter SFT is cheap** (a 16 GB
GPU handles even 2B) and tends to beat LoRA for *structured-output reliability*
— which is the entire goal. Use LoRA/QLoRA only to iterate cheaply or to keep a
base + swappable adapters. Default plan: **full SFT, bf16, ~2–3 epochs**,
early-stop on the protocol-validity eval.

---

## 5. How to do it — the pipeline (off-repo)

```
┌─ IN THIS REPO (elective, not on deploy path) ────────────────┐
│ training/protocol.ts     lock the protocol contract to the app │
│ training/buildCorpus.ts    mint scenario-grounded JSONL        │
│ training/eval/*            protocol-validity gate (replay)     │
└──────────────┬───────────────────────────────────────────────┘
               │ corpus.jsonl  (+ held-out eval split)
               ▼
┌─ OFF-REPO (your machine / a GPU box) ────────────────────────┐
│ 0. BAKE-OFF: run the eval gate on each STOCK tiny base       │
│    (0.6B→2B); rank protocol-validity per GB; pick the        │
│    SMALLEST that clears the bar (the mobile thesis)          │
│ 1. SFT  <bake-off winner> on corpus.jsonl (HF TRL SFTTrainer │
│    / Axolotl / LLaMA-Factory), bf16, full-FT, early-stop     │
│ 2. Eval vs the frozen eval split → protocol-validity %       │
│ 3. Export → HuggingFace (public)                             │
│ 4. MLC compile:  mlc_llm gen_config + convert_weight          │
│    (q4f16_1) → likely REUSE the prebuilt webgpu wasm for the │
│    same arch; else mlc_llm compile --device webgpu           │
│ 5. Verify it loads via a custom web-llm appConfig — incl.    │
│    on an actual phone browser (WebGPU, memory, thermals)     │
└──────────────┬───────────────────────────────────────────────┘
               │ verified model_id + wasm + HF URL
               ▼
┌─ BACK IN THIS REPO (its own issue/PR) ───────────────────────┐
│ ONE curated WEBLLM_MODELS entry (+ eval gate + Help note)     │
└───────────────────────────────────────────────────────────────┘
```

**Sample training config (starting point, off-repo):** HF TRL `SFTTrainer`,
`<bake-off winner>` (e.g. `Qwen3-0.6B` … `Qwen3-1.7B`), bf16, packing off,
`learning_rate ~1e-5` (full-FT) / `~1e-4` (LoRA r=16), `num_train_epochs 2–3`,
cosine schedule, `per_device_train_batch_size` sized to VRAM (16 GB → full-FT of
≤2B fits with gradient checkpointing). Mask the loss to **assistant tokens
only** so the model learns to *produce* tool calls and explanations, not to
parrot the user/system text. Smaller bases (≤1B) may want a touch more LR and
an extra epoch — tune on the eval gate, not vibes.

**MLC compile (the gating step to verify early):**
```bash
pip install --pre -U -f https://mlc.ai/wheels mlc-llm-nightly mlc-ai-nightly
mlc_llm gen_config     ./hf/<winner>-finetuned --quantization q4f16_1 -o dist/<winner>-ft-q4f16_1-MLC/
mlc_llm convert_weight ./hf/<winner>-finetuned --quantization q4f16_1 -o dist/<winner>-ft-q4f16_1-MLC/
# Prefer reusing the prebuilt <winner>-q4f16_1 webgpu wasm (same arch+quant).
# Only if that fails:  mlc_llm compile .../mlc-chat-config.json --device webgpu -o dist/libs/...wasm
```
Then load in the app via a custom `appConfig` (not `prebuiltAppConfig`) pointing
at the public HF weights + the wasm. **Spike this FIRST** with the *unmodified*
bake-off winner to confirm the custom-`appConfig` + wasm-reuse path works
end-to-end before spending any training compute — **and verify it on a real
phone browser**, since mobile WebGPU is the actual target and has tighter
memory / no guaranteed fp16 / thermal throttling that desktop testing won't
surface.

---

## 6. Eval gate + baseline (how we know it beat #108)

- **Baseline ("before"):** run the #106 probe's scoring harness
  (`probe/repetition.ts` + `drive.mjs`) on the current smallest tool-capable
  model (Qwen3 4B) *and* on the stock Qwen3-1.7B, against the frozen corpus
  eval split. The metric is **protocol-validity** = % of turns emitting a
  parseable, in-catalog `TOOL_CALL` — `training/protocol.ts#scoreToolReply`
  already computes exactly this by delegating to the app's real parser.
- **Gate:** the fine-tuned model must beat stock-1.7B by a wide margin and
  approach stock-4B protocol-validity **at its size/VRAM**, *without* regressing
  out-of-domain sanity (the #104 breaker suite) or crossing the
  calculator-not-planner line (refusal records must stay refusals).
- **Golden the corpus hash** so the shipped model is always scored against the
  same frozen set (rule 2 analogue for the spike).
- **Decision:** if a short persona (#108) on a stock 4B already gets ~95% of
  protocol-validity, a custom 1.5B may not be worth the pipeline — the baseline
  run answers this *before* committing to training.

**Probe-harness findings (what #106 already gives us, and the gaps).** The
`probe/` harness (in the main checkout, gitignored — *not* on the deploy path)
already: builds the **exact production system prompt** (`buildSystemPrompt` +
`buildPromptToolInstructions`), drives models in a WebGPU browser
(`main.ts#generate`, streamed), and scores output with `repetitionScore` +
production tripwires `isTokenEcho`/`detectRepetitionCut`. Crucially it scores
tool calls via the **same `extractPromptToolCalls`** our `training/protocol.ts`
uses — so "protocol-valid" means the same thing in the probe, the corpus, and
the app.

The gaps a protocol-validity **gate** must add (none exist in the probe today):
1. **Arg-schema validation** — the parser checks `name ∈ catalog` and that
   `args` is an object, but does *not* Zod-validate args. The gate must apply
   `TOOL_SCHEMAS[name].safeParse(args)` per call so `{"field":"bogus"}` counts
   invalid.
2. **Multi-turn + execution** — the probe is single-turn and never feeds a tool
   result back. The gate threads `formatPromptToolResults` over N turns so the
   model must read a result and continue to a final answer.
3. **Expected-call ground truth** — `SWEEP_PROMPTS` has no `expect` field, so
   there's no precision/recall on tool choice. The corpus eval split *is* that
   ground truth (`CorpusRecord.expect`).
4. **Scenario injection** — the probe uses a hardcoded `'Probe plan'`; the gate
   must inject crafted scenarios that deterministically require a specific tool.
5. **Pass/fail aggregation** — each `triage-*.jsonl` stands alone; the gate
   needs a threshold (e.g. protocol-validity ≥ X% on the frozen set) and a CI
   hookup.

These five define the build for `training/eval/`. `scoreToolReply` covers (1) in
part and the parsing core; the rest is the follow-up work below.

---

## 7. Four surfaces (only if it ships)

- **Engine** — one new `WEBLLM_MODELS` entry (+ a `simplePrompt`-style tier flag
  from #108 only if the tuned model still needs a reduced persona; a well-tuned
  model may need neither).
- **Tests** — the protocol-validity eval gate replayed against the frozen corpus
  (`training/protocol.ts` is its seed); golden the corpus hash.
- **Help** — "Which model should I pick" notes the new option + its ~1 GB /
  low-VRAM fit.
- **Assistant tools API** — **no schema change**: the fine-tune targets the
  *existing* `TOOL_CALL` protocol. A new native function-calling format would be
  its own issue.

---

## 8. What this spike is NOT doing

- Not training a model in-repo, not shipping weights, not hosting/proxying
  inference (ROADMAP non-goals — unchanged).
- Not changing the tool schema or the app's prompt path.
- Not crossing calculator-not-planner: no "do X" advice baked into weights.
- Not a near-term commit — this is a "bigger swing." A real attempt is a
  separate off-repo training effort.

---

## Hardware noted for the attempt

Local machine (where this spike was scoped): **RTX 5070 Ti, 16 GB VRAM, Python
3.14, Node 26, ~390 GB free** — comfortably enough for full-parameter SFT of a
1.5–2B model and for the MLC compile. No cloud GPU needed for a first rung.
