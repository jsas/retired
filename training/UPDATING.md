# Updating — the repeatable "main changed → retrain" loop

The app's engine, tool catalog, and config tables grow over time (FHSA + income
register in #123, debt tools next). Each time that happens, the fine-tune corpus
must be re-grounded in the new reality and the model re-trained. This doc is the
**repeatable runbook** for that loop — the same pass we've now run twice, written
down so it isn't tribal knowledge.

> The one-time setup (bake-off, base pick, first training run) is in
> [USAGE.md](./USAGE.md); the design rationale is in
> [METHODOLOGY.md](./METHODOLOGY.md). This file is only about *keeping the corpus
> and model current as the app evolves*.

---

## The loop at a glance

```
main lands a feature
        │
        ▼
  1. REBASE the spike branch onto main          (engine changes re-derive)
        │
        ▼
  2. MAP the delta — new tools? new config?      (the only hand-work)
     new behavior? new plans?
        │
        ▼
  3. REJIG — catalog lock, mint exemplars,       (tests catch what you miss)
     domain facts, plan sweep
        │
        ▼
  4. REGENERATE + re-convert + re-gate           (hash change is intentional)
        │
        ▼
  5. RETRAIN (LLaMA-Factory) → re-score gate     (same recipe, fresh corpus)
```

Steps 1–4 are in-repo and cheap (minutes). Step 5 is the only part that costs
GPU. **The corpus is disposable** — it's gitignored and re-minted on demand, so
"updating the data" always means "edit the minter, re-run generate, re-run
toLlamaFactory," never "hand-edit the JSONL."

---

## 1. Rebase onto main

```bash
git fetch origin main
git rebase origin/main
```

**Why it's usually clean.** The minter runs the *live* engine against the *live*
tool catalog (`toolSpecs()`) and *live* config (`DEFAULT_APP_CONFIG`). So a pure
engine rewrite (e.g. the `people[]` household model in #125) changes every minted
number automatically — no hand edits. The rebase only gets interesting when the
*shape* of the surface changes, which is what step 2 maps.

Expect the one **catalog-lock failure** if a tool was added/renamed — that's the
test doing its job, not a real break (see step 3a).

---

## 2. Map the delta

Before touching the minter, know exactly what changed on the surfaces the corpus
grounds in. From the worktree root:

```bash
BASE=$(git merge-base HEAD~1 origin/main)   # or the last-known-good base
git diff $BASE origin/main --stat -- src/lib/ai/tools.ts src/lib/appConfig.ts src/data/schemas.ts src/lib/retirementEngine.ts
```

The five questions to answer (and where the answer lives):

| Delta | Look at | Triggers |
|---|---|---|
| **New tool** (read or `propose_*`) | `spec('<name>'` in `src/lib/ai/tools.ts` | catalog-lock bump + mint exemplars (3a/3b) |
| **Tool args changed** | the tool's Zod schema in `tools.ts` / `schemas.ts` | fix the mint spec's `args()` (the self-check gate catches stale args) |
| **New config numbers** | `DEFAULT_APP_CONFIG` in `src/lib/appConfig.ts` | a citable domain fact (3c) |
| **New behavior** (not just a field) | a `*.test.ts` for the feature | a domain fact + maybe an applied variant (3c) |
| **New household shape** | `src/lib/householdTypes.ts` / plans | a plan in the sweep (3d) |

If the diff shows **no new tool and no new config**, the rebase alone may be all
you need — skip to step 4 and confirm the gate is still 100%.

---

## 3. Rejig (the hand-work, in order)

### 3a. Catalog lock — `training/protocol.test.ts`

`SPECS` derives live from `toolSpecs()`, so it already picked up the new tool.
Only the hardcoded count and assertions lag. Bump the number and add a presence
assertion for the new tool:

```ts
expect(SPECS.length).toBe(25);            // was 24
expect(TOOL_NAMES.has('propose_debt')).toBe(true);
```

This test exists to **force a conscious regen** — never bump it without also doing
3b/3c, or you'll have a locked catalog with no exemplars for the new tool.

### 3b. Mint exemplars for the new tool — `training/mint.ts`

Follow the existing pattern. **Reads** go in `READ_SPECS` (question paraphrases →
one canonical call + an engine-grounded follow-up). **Mutations** go in
`MUTATION_SPECS` (proposal + APPROVED/REJECTED confirms):

```ts
{
  tool: 'propose_debt',
  questions: [
    () => 'Add my mortgage — $400k at 5% with 20 years left.',
    (sc) => `I carry a loan, model it in.`,
  ],
  args: (sc) => ({ changes: { /* ...valid per the tool's Zod schema... */ } }),
  approvedReply: () => 'Debt added. Want me to show what it does to the plan?',
  rejectedReply: () => 'Okay — debt left out.',
},
```

**The args must satisfy the tool's Zod schema.** You don't have to guess — the
corpus self-check gate (step 4) runs every minted call through the real parser +
schema, so an invalid arg fails loudly at 100%-check time, not silently into the
training data. Respect the CLAUDE.md field pitfalls (`endAge` explicit `null`;
`number|undefined` fields omitted, never `null`; province `'ONT'` never `'ON'`).

### 3c. Domain facts for new config/behavior — `training/domain.ts`

If the feature adds citable numbers (limits, rates, thresholds) or a genuinely new
*behavior*, add a `FactSpec`. Ground it **live** in `DEFAULT_APP_CONFIG` — never a
hardcoded figure, so the fact can't drift when the tables are edited:

```ts
{
  id: 'debt-payoff',
  ask: 'How does carrying debt change my retirement plan?',
  phrasings: ['Should I pay off debt before I retire?', '...'],
  appliedTo: ['debt-carrying'],                      // if you add such a plan
  appliedAsk: () => 'I still have a mortgage — what does it do to my plan?',
  answer: () => `... ${money0(cfg.debt.someRate)} ... ${OFFER}`,
  appliedAnswer: (inputs) => `Your ${money0(inputs.debt?.balance ?? 0)} balance ...`,
  mustContain: ['debt', 'interest', 'plan'],
},
```

Three shapes keep the model from parroting (see METHODOLOGY §2d): **recall**
(canonical ask), **paraphrase** (same answer, different wording), **applied** (the
rule stated against a plan's real numbers). Register rotation is automatic via
`CLOSERS`. The structural tests already enforce cite-a-figure + no-advice-verbs +
offer-to-ground, so a new fact passes if it's honest.

### 3d. Plan sweep — `training/plans.ts` (only if the household shape changed)

If the feature introduces a new *kind* of household (debt-carrying, FHSA-saving,
multi-property), add one or two to `SCENARIOS` so the applied facts and the
engine-grounded exemplars have real numbers to quote. Build on `baseInputs()` and
respect the structural-block pattern (add `income`/`spouse`/`debt` whole, never as
flat overrides).

---

## 4. Regenerate + re-gate

```bash
npx tsx training/generate.ts                 # re-mint → new eval hash
npx tsx training/toLlamaFactory.ts           # re-convert → fresh lf_train/lf_eval.json
npx vitest run -c training/vitest.config.ts  # toolkit green (incl. new facts/exemplars)
npx tsx training/runGate.ts                  # self-check — MUST be 100%
npx vitest run                               # main app suite still green (rule 1)
```

**The eval hash *will* change** — that's intentional, the golden-master analogue
(rule 2). A new feature legitimately changes the corpus; the hash exists to make
that deliberate, not to prevent it. Say so in the commit message. **If the
self-check gate is <100%, stop** — a minted call is invalid against the live
schema; fix the spec (3b) before any training. **Always re-run `toLlamaFactory.ts`
after `generate.ts`** — the LLaMA-Factory JSON is derived from the corpus and goes
stale the moment the corpus changes.

---

## 5. Retrain (LLaMA-Factory, same recipe)

Nothing about the *method* changes — only the corpus is fresher. Re-convert
(step 4), then re-run the training recipe against the fresh
`training/data/lf_train.json`, and re-score against the **new** frozen eval hash:

```bash
training/train.sh training/lf_lora.yaml    # fast validation pass first
training/train.sh training/lf_sft.yaml     # then the full-SFT ship candidate
```

- Same base (`Qwen/Qwen3-0.6B`) unless the size picture changed.
- LoRA first to validate the pipeline cheaply (~15h), then full SFT (~40h) for
  the ship candidate — escalate to full SFT only if the LoRA gate score shows
  adapters underfit the format.
- Ship bar is unchanged: protocol-validity ≥ `postSftShipBar` (0.95) on the new
  eval hash.

---

## Checklist (copy into the update PR)

```
- [ ] rebased onto origin/main
- [ ] delta mapped (new tools / config / behavior / plans)
- [ ] catalog-lock bumped + new-tool assertion (protocol.test.ts)
- [ ] mint exemplars for each new tool (READ_SPECS / MUTATION_SPECS)
- [ ] domain facts for new config/behavior (live-grounded, 3 shapes)
- [ ] plan added if household shape changed
- [ ] generate.ts re-run; eval hash change noted in commit msg
- [ ] training suite green (vitest -c training/vitest.config.ts)
- [ ] self-check gate 100% (runGate.ts)
- [ ] main suite green (npx vitest run)
- [ ] retrained off-repo; protocol-validity ≥ 0.95 on the new eval hash
```

---

## Design rules that make this loop cheap

These are why the loop is minutes, not days — keep them true:

1. **The corpus is derived, never stored.** Gitignored, re-minted on demand. To
   "change the data," edit the minter and re-run — never hand-edit JSONL.
2. **Everything grounds in live sources.** Tools from `toolSpecs()`, config from
   `DEFAULT_APP_CONFIG`, numbers from the real engine. A feature that only changes
   internals needs *zero* minter edits.
3. **The catalog-lock + self-check gate are the tripwires.** They fail loudly when
   the surface drifts, so you find out in `vitest`, not in a trained model that
   hallucinates a renamed tool.
4. **Facts cite live config, never literals.** The model memorizes "the OAS
   clawback threshold is ${cfg.oas.clawbackThreshold}" — correct forever, because
   the *corpus* re-derives when the table is edited, and the eval hash forces the
   regen to be deliberate.
