# AGENTS.md

Guidance for AI assistants working in this repo. `CLAUDE.md` holds the build
commands, engine conventions, and product guardrails — read both.

## Task tracking lives in `tasks/`

- **`tasks/*.md` files are where we keep track of what we're doing** — active
  plans, review findings, and the work-in-progress ledger. Start at
  `tasks/active.md` (index of in-flight + queued work).
- When a task or plan is **completed**, move its file to `tasks/completed/`
  (`git mv`) and update `tasks/active.md` to reflect it. Don't delete completed
  records; they're the burn-down history.
- GitHub issues stay the source of truth for user-facing bugs/features; the
  `tasks/` files are the execution plans against them.
- Don't leave a completed plan sitting at the repo root — the root holds only
  shipped docs (README, ROADMAP, CLAUDE.md, this file).
