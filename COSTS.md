# COSTS.md

Per-ticket token usage and estimated spend for AI-assisted work on RE:tired.

The point is per-ticket visibility — roughly what each feature or fix cost in
tokens and dollars — not audit-grade accounting. Approximate numbers are fine.

## How to fill this in

1. Each ticket = one GitHub Issue (and its PR). Group multi-session tickets
   under the same issue number and sum the sessions.
2. At the end of a ticket's work, read the session's token totals (Claude
   Code: the `/cost` command or the session-usage readout) and record:
   - **Session tokens** — input + output tokens for the session(s).
   - **Est. cost** — estimated USD for the model used, at that model's rates.
3. One row per issue/PR. Keep the newest at the top of the table.

## Log

| Date | Issue/PR | Summary | Session tokens (in+out) | Est. cost (USD) | Model |
|------|----------|---------|--------------------------|-----------------|-------|
| 2026-08-24 | #3 / PR — | Print timeline: show portfolio & home equity like on-screen chart; title drops equity when RM off | — | — | claude-k3 |
| 2026-08-24 | #2 / PR — | Add CLAUDE.md + COSTS.md tracking workflow | — | — | claude-k3 |
| 2026-08-24 | #1 / PR — | Reverse-mortgage LTV ceiling clamp + pension-split equalization + regression tests | — | — | claude-k3 |

> Backfill the "Session tokens" and "Est. cost" columns from `/cost` at the
> end of each session; the three seed rows above mark the first tracked
> tickets. Earlier work (pre-tracking) is intentionally not estimated.
