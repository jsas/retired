# Spike #112 — fine-tune a small open-weight model for this app's tool protocol

> **Companion docs:** [USAGE.md](./USAGE.md) — operator's guide (generate, test,
> bake off, score). [METHODOLOGY.md](./METHODOLOGY.md) — how the input data +
> training method make the model understand a person, lay out their options,
> and stay in the calculator-not-planner lane. [UPDATING.md](./UPDATING.md) —
> the repeatable loop for re-grounding the corpus + retraining when `main`
> lands a feature.

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
- **The 24-tool catalog** (`src/lib/ai/tools.ts`): 9 pure reads
  (`get_scenario`, `run_projection`, `compare_scenarios`, `run_strategies`,
  `solve_spending`, `run_monte_carlo`, `get_schedule`, `recall`,
  `list_scenarios`), 12 mutation proposals (incl. `propose_fhsa`, added with
  the income-register/FHSA feature #123), 3 direct writes (`remember`,
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
| `option-framing` | "what can I optimize?" → `run_strategies` + survey the levers with real deltas, frame the trade-off, hand the choice back | ~9% |
| `domain-knowledge` | Canadian tax/benefit/market-history fact in three shapes — canonical recall, paraphrase, and per-scenario applied (real household numbers) — answered from the app's OWN shipped tables + offer to ground | ~2% |

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

**Sizing.** The minter currently produces **~2,600 records** (2,117 train / 478
eval) across a 24-household sweep: all 13 provinces/territories **plus** the
structural situations that change a plan's shape — couples (two CPP/OAS
timelines), a reverse-mortgage household, an RDSP beneficiary, and
go-go/slow-go/no-go spending bands. For format-behavior SFT at ≤2B that's a
workable first rung — the paraphrase bank (many phrasings → one canonical call)
is what teaches the muscle memory. If the eval gate shows protocol-validity
hasn't saturated after the first SFT rung, scale by widening the paraphrase
banks and the scenario sweep, not by adding noise. Kind mix: tool-call 792,
tool-followup 504, mutation-confirm 864, option-framing 240, refusal 120,
clarify 72, domain-explain 3 — all 23 catalog tools covered.

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
the bar — that's the whole mobile thesis. §5 adds a parallel **large-bracket
reference run** (a 7B–14B-class base fine-tuned on the same corpus) to measure
whether the small tier leaves real accuracy on the table — if it doesn't, the
mobile thesis holds and the bottleneck is data, not params.

**Full fine-tune vs LoRA.** At ≤2B, **full-parameter SFT is cheap** (a 16 GB
GPU handles even 2B) and tends to beat LoRA for *structured-output reliability*
— which is the entire goal. **QLoRA is the documented cheaper option** (~4–6 GB
VRAM, faster steps) for iterating or when VRAM is tight; see the method
comparison table in §5. Default plan: **full SFT, bf16, ~2–3 epochs**,
early-stop on the protocol-validity eval, falling back to QLoRA only if the
gate shows it doesn't cost protocol reliability.

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

**Two training methods — full-SFT (default) or QLoRA (the cheaper option):**

| | **Full-parameter SFT** (default) | **QLoRA** (the cheaper path) |
|---|---|---|
| **VRAM** | ~16 GB for ≤2B (w/ grad ckpt) | ~4–6 GB — fits a laptop card |
| **Cost** | a few $ of electricity, hours | ~3–4× less memory + faster steps |
| **Structured-output reliability** | best — updates every weight | slightly worse (only adapters train) |
| **Output** | a standalone model | a base + a small adapter (merged at export) |
| **When to use** | the goal is *protocol reliability*, so start here | iterate cheaply, or VRAM is tight |

**Default to full-SFT** because the entire goal is a clean `TOOL_CALL:` line —
structured-output reliability is exactly what full-FT buys over adapters. Reach
for **QLoRA** (4-bit, `r=16`, `lora_alpha=32`, `lora_dropout=0.05`,
`learning_rate ~1e-4`) when you want to iterate fast/cheap or the GPU can't fit
full-FT. Either way: **mask loss to assistant tokens**, early-stop on the eval
gate, and merge the adapter into the base before the MLC compile (web-llm loads
a single merged model, not a base + LoRA). If QLoRA's protocol-validity comes
back materially worse on the gate, that's the signal to spend the extra VRAM on
full-SFT — decide on the number, not vibes.

**Two size brackets — small vs very-large (decided with the user).** The mobile
thesis says "smallest that clears the bar," but that begs a question we can
answer with data instead of assuming it: **does a much larger base fine-tune to
materially higher accuracy on our gate?** So the experiment runs the SAME
corpus + eval across two brackets:

| bracket | what it is | why run it |
|---|---|---|
| **Small** (the shipping candidates) | the ≤2B redistributable set in §4, smallest-first | the actual phone targets — this is what could ship |
| **Large** (a capability ceiling) | one strong open-weight large base (e.g. a 7B–14B-class instruct, picked at run time for license + availability) | an *upper bound* on what fine-tuning this corpus can reach — the "best of the best" reference point |

How to read the result:

- **If the large base's fine-tuned protocol-validity ≈ the best small base's**
  (within a couple of points), the small tier isn't the bottleneck — the corpus
  is. That's a strong signal the mobile thesis holds: ship the smallest that
  clears the bar, and spend effort on data, not params.
- **If the large base clearly beats every small base**, there's headroom the
  tiny tier can't reach. Then we decide on the number: is the gap worth
  abandoning the phone-size ceiling (a bigger model needs more download +
  WebGPU memory), or do we close it with more/better data at small size?

The large base is a **reference, not a ship candidate** — it never goes in
`WEBLLM_MODELS` (too heavy for a phone), it exists to tell us how much accuracy
we're leaving on the table by staying small. One large rung is enough; we're
measuring the *ceiling*, not benchmarking the whole size curve. Cost note: a
7B-class full-SFT needs ~40+ GB VRAM (or QLoRA at ~12–16 GB); if that's out of
reach, run the large bracket under QLoRA and note the method difference when
comparing — the *ceiling* reading stays valid either way.

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

## 6. Eval gate + pre-training baseline (how we know the tune worked)

**The gate now exists** (`training/eval.ts` + `training/runGate.ts`) and is
CI-gateable. `scoreReply` grades one assistant reply across four tiers of
increasing strictness:

| tier | meaning |
|---|---|
| `parseable` | the app parser extracts a call with no error |
| `inCatalog` | the call names a real tool (not a hallucinated name) |
| `argsValid` | the args satisfy the tool's **Zod schema** — the executor would accept it, not just the parser |
| `toolMatch` | the model picked the *expected* tool for the question (precision on tool choice) |

`valid` (the strictest) = exactly one call ∧ in-catalog ∧ args-valid ∧
tool-match. `gateReport` aggregates a model's replies over the frozen eval
split into **protocol-validity** + per-failure-reason triage, and passes/fails
vs `THRESHOLDS.postSftShipBar` (95%). **Corpus self-check = 100%, exit 0** — the
sanity floor that must hold before any real model is measured. Run it:
`npx tsx training/runGate.ts` (self-check) or `--replies replies.json --model
<id>` to score an actual base.

**How the bake-off uses it.** For each base in `CANDIDATES_SMALLEST_FIRST`
(smallest-first): load it in a WebGPU browser, feed each eval record's question
(+ the production system prompt), capture the reply, write `replies.json`, and
run the gate. Stop at the **first base that clears the bar** — that's the
smallest viable mobile base.

**The browser driver is built and smoke-tested** (`training/driver/`). The
original plan was to reuse the #106 probe's CDP plumbing, but those scripts
weren't on disk — so the driver is a fresh, dependency-free CDP client
(`cdp.mjs`, raw WebSocket, no puppeteer) driving a WebGPU harness page
(`harness.html`) that loads web-llm from the CDN and exposes a `BAKEOFF`
channel. `runBakeoff.mjs` walks the candidates smallest-first, extracts the
exact eval set + production system prompt via `extractEvalSet.ts` (so the
questions are byte-for-byte what the gate scores), and writes
`training/data/bakeoff/<modelId>.replies.json`. Smoke test (`smoke.mjs`)
confirms the plumbing + a live WebGPU adapter with **no model download**. Run a
real bake-off:

```bash
node training/driver/runBakeoff.mjs --only Qwen3-0.6B --limit 20   # smoke one base
node training/driver/runBakeoff.mjs                                 # full smallest-first sweep
npx tsx training/runGate.ts --replies data/bakeoff/<id>.replies.json --model <id>
```

- **Golden the corpus hash** so the shipped model is always scored against the
  same frozen set (rule-2 analogue; determinism proven by `generate.test.ts`).

### Pre-training baseline (the probe grid, 2026-08-31)

The "before" numbers already exist — no extra bake-off needed for them. The
#106 probe swept every tool-capable model in the catalog at the **single full
system prompt** (the short-persona variant was dropped: #108/#109 closed
unmerged, the probe's persona dimension removed in #127): 5 models × 4 prompts
× 8 sampler profiles + fill = **262 cells**, committed at
`probe/results/baseline-262-2026-08-31.json` (lands on `main` with #128). That
file is the frozen pre-training reference — diff any checkpoint against it
with the same probe, the way `goldenMaster.test.ts` locks engine output.

What it says:

- **Reference model: Qwen3-4B.** Median output-token/word ratio 0.136, max
  0.236, **zero cells ≥ 0.3** across the whole grid, and it already emits a
  correct `propose_rdsp` call in the propose-rdsp row. This is the "before" a
  custom model must approach **at its size/VRAM** — without regressing
  out-of-domain sanity (the #104 breaker suite) or crossing
  calculator-not-planner (refusals must stay refusals).
- **Regression canary: Qwen3.5-4B.** Worst single cell in the dataset:
  `year-walkthrough` × cold profile, **0.591** (plus `tax-rules-dump` × cold at
  0.322). If a checkpoint starts to fall apart anywhere, cold × walkthrough is
  where it shows first — always include it in a before/after spot-check.
- **Profile shape:** aggressive repetition penalty isn't what buys clean
  output — `pf-pair` (0.135) and `baseline` (0.137) average best; `shipped`
  (0.184) and `cold` (0.170) worst. The failures are verbosity/looping, not
  sampling temperature.
- **Decision input:** if a *stock* 4B at the full prompt already clears the
  gate's ship bar (95% protocol-validity), a custom tiny model may not be
  worth the pipeline — score Qwen3-4B's replies through `runGate.ts` before
  committing training compute. (The baseline JSON is probe grid data, not
  gate replies; running Qwen3-4B through the gate is still one bake-off step.)

**Gap status vs the #106 probe** (from the probe-harness map):

1. **Arg-schema validation** ✅ done — `scoreReply` applies
   `TOOL_SCHEMAS[name].safeParse(args)` per call. (Honest edge: free-string
   fields like `set_scenario_value.field` are schema-valid even when not in
   `EDITABLE_FIELDS` — that's executor-side, documented in the test.)
2. **Expected-call ground truth** ✅ done — `CorpusRecord.expect.toolName`.
3. **Pass/fail aggregation** ✅ done — `gateReport` + threshold + exit code.
4. **Scenario injection** ✅ done (for the single-turn gate) — the corpus is
   built *from* injected scenarios (`scenarios.ts`), each deterministically
   requiring its tool.
5. **Multi-turn + execution** ✅ done — `scoreFollowup` / `scoreMutationConfirm`
   grade the continuation after a fed-back `[OK]` result or an APPROVED/REJECTED
   message: grounded (references a figure from the result), non-advisory, and —
   for mutations — never re-proposing after a confirm. The full corpus
   (follow-ups + mutation confirms) is scoreable.

All five probe gaps are now closed. **Corpus minter, eval gate, and browser
driver are all built** — the remaining work is the off-repo effort: run the
bake-off (the driver above), SFT the winner, MLC compile, and verify on a real
phone browser.

---

## 7. Four surfaces (only if it ships)

- **Engine** — one new `WEBLLM_MODELS` entry. The app ships a single system
  prompt now (#108's reduced-persona tier never landed, and #127 removed the
  probe's persona dimension), so a well-tuned model targets the full prompt
  like every other catalog entry — no per-model prompt fork.
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
