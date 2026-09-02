# Usage — fine-tune spike toolkit

Everything in `training/` is **elective and off the deploy path**. Nothing here
ships to GitHub Pages; the only thing that would ever merge to `main` is a
verified `WEBLLM_MODELS` entry on its own PR. This doc is the operator's guide:
generate the corpus, sanity-check it, run the bake-off, and score a model.

> The design rationale (why the data is shaped this way) lives in
> [METHODOLOGY.md](./METHODOLOGY.md). The plan + guardrails live in
> [SPIKE.md](./SPIKE.md). This file is just the *how* — for the **repeatable
> "main changed → re-ground → retrain" loop**, see [UPDATING.md](./UPDATING.md).

---

## TL;DR

```bash
npx tsx training/generate.ts                 # 1. mint the corpus → training/data/
npx vitest run -c training/vitest.config.ts  # 2. prove the toolkit is green
npx tsx training/runGate.ts                  # 3. corpus self-check (must be 100%)
node training/driver/smoke.mjs               # 4. confirm WebGPU + driver (no download)
node training/driver/runBakeoff.mjs --only Qwen3-0.6B --limit 20   # 5. smoke one base
npx tsx training/runGate.ts --replies data/bakeoff/<id>.replies.json --model <id>  # 6. score it
```

---

## 1. Generate the corpus

```bash
npx tsx training/generate.ts
```

Mints the full corpus by running the **real tool executor against the real
deterministic engine** across the plan sweep, and writes:

```
training/data/corpus.train.jsonl     # train split
training/data/corpus.eval.jsonl      # frozen eval split (the benchmark)
training/data/corpus.eval.sha256     # 16-char hash of the eval split (golden)
```

Console output reports record count, the eval hash, and the per-kind /
per-tool breakdown. `training/data/` is gitignored (regenerable artifacts).

**When to regenerate:** after changing `mint.ts`, `plans.ts`, or the app's
tool catalog. The eval hash *will* change — that's expected. See §7.

---

## 2. Test the toolkit

```bash
npx vitest run -c training/vitest.config.ts
```

Runs the training-side suites (protocol contract, minter scale + behavior
invariants, eval-gate grading, corpus determinism). The shipped `tsconfig`/
`vitest` configs only cover `src/**`, so the training config is separate.

> **Note:** engine-running tests are slow (Monte Carlo × plans) — the full
> suite takes ~2 minutes. The app suite (`npx vitest run`) is unaffected.

---

## 3. Corpus self-check (the sanity floor)

```bash
npx tsx training/runGate.ts
```

Feeds each eval record's **own assistant target** back through the eval gate as
the "reply". A correct corpus scores **100% protocol-validity** and exits 0.
This must hold before any real model is measured — if it doesn't, the corpus or
the gate is broken, not the model. Exit code is 0 iff pass, so it's CI-gateable.

---

## 4. Confirm the driver + WebGPU (no model download)

```bash
node training/driver/smoke.mjs
```

Launches headless Chrome, serves the harness, and confirms the `BAKEOFF`
channel + a live **WebGPU adapter** come up — *without* downloading a model.
Prints `SMOKE PASS` when the plumbing works. Run this first on any new machine.

**Requirements:** a Chrome or Edge binary (auto-detected; override with
`CHROME_PATH`), and a WebGPU-capable GPU/browser. Node 22+ (uses the built-in
`WebSocket`).

---

## 5. Run the bake-off (the "confirm" step)

```bash
node training/driver/runBakeoff.mjs                                # all redistributable bases, smallest first
node training/driver/runBakeoff.mjs --only Qwen3-0.6B              # one base (substring match)
node training/driver/runBakeoff.mjs --only Qwen3-0.6B --limit 20   # smoke: first 20 eval questions
```

For each base it: serves the WebGPU harness, downloads + warms the model
(slow on first run; cached in the browser profile after), feeds every
eval-split tool-call question under the **production system prompt**, captures
the raw replies, and writes:

```
training/data/bakeoff/<modelId>.replies.json    # array aligned to the eval records
```

Flags: `--serve-port` (default 8788), `--cdp-port` (default 9222).

The driver walks `CANDIDATES_SMALLEST_FIRST` so you can **stop at the first
base that clears the bar** — the smallest viable mobile base (the whole
thesis). First real run downloads ~0.3–1.2 GB per base.

---

## 6. Score a model

```bash
npx tsx training/runGate.ts --replies data/bakeoff/<modelId>.replies.json --model <label>
```

Prints protocol-validity %, the four strictness tiers (parseable → in-catalog
→ args-valid → tool-match), a failure-reason triage, and PASS/FAIL vs the 95%
ship bar. Exit 0 iff pass.

**Reading the tiers:** a model can be parseable but pick the wrong tool
(`toolMatch` low → it understands the format but not the task), or pick the
right tool with junk args (`argsValid` low → SFT data needs more arg
diversity). The failure triage tells you *which* lever to pull.

---

## 7. The eval-hash rule (golden-master analogue)

`corpus.eval.sha256` is the **frozen benchmark**. Two rules:

1. **Never let it drift silently.** `generate.test.ts` proves the mint is
   deterministic (byte-identical re-mint). If a legitimate change (new
   plans, new kinds, a changed tool catalog) alters the eval split, the
   hash changes — that's fine, but it must be a **deliberate** event.
2. **Regenerate + re-baseline intentionally.** When the hash changes, say so in
   the commit, and treat any previously-scored model numbers as
   not-comparable until re-run against the new eval split.

---

## 8. Where things live

```
training/
  protocol.ts        protocol contract — imports the LIVE catalog + parser (can't drift)
  buildCorpus.ts     record shapes + kind taxonomy + tool coverage matrix
  plans.ts       the 24-household plan sweep (all 13 provinces + couples/RM/RDSP/bands)
  domain.ts          domain-knowledge facts (CPP/OAS/GIS/tax/history) read live from config
  mint.ts            the generator (reads, mutations, guardrails, option-framing, domain)
  generate.ts        CLI: mint → training/data/*.jsonl (+ eval sha256)
  eval.ts            the gate: scoreReply tiers, follow-up/mutation graders, gateReport
  runGate.ts         CLI: self-check (default) or score --replies
  bakeoff.ts         base manifest + CANDIDATES_SMALLEST_FIRST + THRESHOLDS
  driver/
    cdp.mjs          dependency-free Chrome DevTools client (raw WebSocket)
    harness.html     WebGPU page; loads web-llm from CDN, exposes BAKEOFF channel
    runBakeoff.mjs   the bake-off runner
    extractEvalSet.ts  emits eval records + live system prompt as JSON (drives the model)
    candidates.mjs   plain-JS mirror of the smallest-first base list
    smoke.mjs        no-download plumbing + WebGPU check
  SPIKE.md           the plan + guardrails
  METHODOLOGY.md     why the data is shaped this way (the behavior design)
  USAGE.md           this file
```

---

## Troubleshooting

| symptom | likely cause | fix |
|---|---|---|
| `No Chrome/Edge binary found` | non-standard install path | `export CHROME_PATH=/path/to/chrome.exe` |
| smoke test: `WebGPU adapter: NO` | headless GPU disabled / old Chrome | update Chrome; the launch already passes `--enable-unsafe-webgpu` |
| `/json/new` … `only PUT verb` | very old driver on new Chrome | already handled (driver uses PUT) — pull latest |
| `Execution context was destroyed` | fresh-tab navigation race | already handled (`evalWhenReady` retries) — pull latest |
| self-check < 100% | corpus or gate regression | don't score models; `npx vitest run -c training/vitest.config.ts` to find it |
| model loads but replies are empty | model too weak / OOM | try `--limit 5`; check VRAM; drop to a smaller base |
