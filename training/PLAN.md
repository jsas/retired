# Fine-tune improvement plan (post-checkpoint-1000)

This turns the checkpoint-500 gate run (81.1% protocol-validity, 900 eval
records) into a ranked program. Ordered by expected gain per hour of work.

## What the gate actually lost on

169/900 invalid replies. Buckets, mapped to the fix that moves them. Updated
with `training/driver/mineFailures.ts` (index-join against ordered evalset —
same shape runGate uses):

| bucket | n/900 | root cause | fix |
| --- | --- | --- | --- |
| compare_scenarios magnet | 56+30+27+23+22 | variants/patches make it look permissive | L3 contrastive mint (negative-pair) |
| run_projection vs get_scenario | 37+19+19 | "how does my plan look" ambiguity | L3 pair-mint |
| get_scenario enum invention | — | model invents 'balances' | done: cycle real enum values |
| compare_scenarios duplicate-call | 23 | emits TOOL_CALL twice on one line | done: 'one variant, not a list' paraphrase |
| run_strategies vs compare_scenarios | 27 | lever-selection wording | pending contrastive mint |

Tool-choice confusion is ~83% of losses; grammar/blanks ~19%. **Fix choice
first, grammar second.**

## L1 — eval hygiene (done)

- `num_predict 256→512` default; truncation was real but small (~4 pts).
- Greedy (temperature 0) as the eval default; protocol validity scored
  deterministically.
- Recorded: greedy scored 80.7% vs 81.1% @ t=0.2 — within noise, and the
  right trade for reproducibility.

## L2 — finish the interrupted run (done)

- Resumed 500→1416/1416. eval_loss 0.2674 @500 → 0.2621 @1000 (best ckpt).
- `final/` = checkpoint-1000. Re-gguf'd q8_0 (633 MB), will re-gate and
  update `post-train-report.md` (expect +a few pts on tool-match; not enough
  alone for 95%).

## L3 — targeted corpus paraphrases (next big lever)

Add to `mint.ts` READ_SPECS, aimed at the confusion pairs above:

1. "compare how my plan looks under different returns" → `run_projection`
   (today: `get_scenario`).
2. "what section/page shows my balances" → `get_scenario(section=...)` with a
   VALID enum (today: invents sections).
3. "run the strategy sweep" vs "solve my spending" boundary examples —
   `run_strategies` when it's a sweep, `solve_spending` only when a target is
   named.
4. Schema-edge minting: `run_strategies` category objects (label/value/overrides)
   AND compact string lists, so both shapes reinforce.

Golden-master rule: any corpus change regenerates corpus + eval hash in the
same commit (CLAUDE.md rule 2).

## L4 — training knobs

- `--epochs 3` ran at bs2/accum16 (eff 32); loss still falling at end → run
  `--epochs 4–5` on the new corpus.
- Longer `--max-length 4096` only if corpus grows multi-turn; bs/accum scale
  down (VRAM pressure at 16 GB showed as 19.5 s/step degradation).
- Keep full-SFT (not LoRA) — structured output benefits per SPIKE.md.

## L5 — eval scoring beyond protocol-validity (fill the blind spot)

`eval.ts`'s gate checks parseable/in-catalog/args-valid/tool-match. It does
NOT score semantic reply quality (does the followup actually answer?). Plan:
add a small LLM-judge or template-scorer for `tool-followup` records so the
81%→95% climb isn't gaming the protocol while degrading prose.

## L6 — corpus tests catch regressions

`mint.test.ts` asserts each new boundary paraphrase lands on the intended
tool (same mechanism as NAV_SPECS's rank assertion). Add coverage for
`assistant_only_loss` no longer being needed (chat-template masks) — guard
against silent template regressions.

## L7 — scale-out diversity

Scenarios 79 in `scenarios.ts`; lean on them. Every new READ/MUTATION/NAV spec
multiplies through all of them. Also consider `ont/mixed-provinces` coverage
for `get_scenario` section confusion (scenario id prefix visible in tool
args).

## L8 — when #141 nav (PR 144) is merged (done for corpus)

The nav tools are now minted (`NAV_SPECS`) with ambient-page-line variation —
the corpus expects the model to key find_page's "already here" tag to the
line, not a fixed page. Golden eval hash bumped (29 tools, was 26). This is
the model for future tool additions: catalog entry + mint family + hash bump
in one commit.

## Acceptance gate

Ship when: protocol-validity ≥ 95% (bars in `training/bakeoff.ts`) AND
`mint.test.ts` green AND post-train-report updated with the new numbers.
