# Landing CTAs + Data page merge — handoff

**Repo:** `jsas/retired` · **Branch/worktree:** `issue/real-beta` (work in this worktree, commit normally) · **Draft PR:** #137 (stays draft — do NOT merge or mark ready without the user's explicit sign-off) · **Plan of record:** `ux-proposals/BETA-MAP.md`.

Two user-directed changes, researched and ready to implement. Both are small.

---

## Task 1 — Landing CTAs: "Go to dashboard" / "Keep chatting" (both navigate)

**User's final word (supersedes the earlier wordy-two-doors design and the interim "install model card" idea):**
> "rather than all that complexity, the go to dashboard and keep chatting calls to action just go to the dashboard with or without the assistant open."

So: after the five questions, the landing offers two buttons that both call `onBuild(plan)` (which navigates to the projection dashboard). The only difference: **"Keep chatting" opens the assistant dock on arrival; "Go to dashboard" closes it.**

### The mechanism (verified)

- The assistant dock's open state lives in prefKV under key **`wealthconsole_dock_open`** — `'1'` open / `'0'` closed. `BetaPage` (`src/components/beta/BetaPage.tsx:16-20, 61-65`) reads it via `readDockOpen()` on every mount, and the header Assistant button toggles it. Default (missing key) = **open**.
- `prefKV()` from `src/lib/prefKv.ts` is the write path: synchronous localStorage mirror + write-through to the store kv table. Safe to call from the landing (it degrades to plain localStorage before the store attaches).
- **Important:** the pref also gates the header Assistant *button's* usefulness — if closed, the user can still reopen the dock with the header button. Closing is not destructive.

### Changes

**`src/components/beta/LandingPage.tsx`**

1. New prop: `onBuild: (inputs: RetirementInputs, opts?: { openAssistant?: boolean }) => void;` (optional second arg — no call-site breakage).
2. Import `prefKV` from `../../lib/prefKv` (adjust depth — file lives at `src/components/beta/`, so `../../lib/prefKv`).
3. Replace the "two doors" grid (currently ~lines 202–219, the `grid gap-3 sm:grid-cols-2` block with the "Open the dashboard →" button and "Tune the details" Link) with two flat buttons side by side:

```tsx
<div className="flex flex-wrap gap-3">
  <button
    onClick={() => {
      try { prefKV().setItem('wealthconsole_dock_open', '0'); } catch { /* storage blocked */ }
      plan && onBuild(plan, { openAssistant: false });
    }}
    className="bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-700"
  >
    Go to dashboard
  </button>
  <button
    onClick={() => {
      try { prefKV().setItem('wealthconsole_dock_open', '1'); } catch { /* storage blocked */ }
      plan && onBuild(plan, { openAssistant: true });
    }}
    className="border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-900 hover:border-slate-900"
  >
    Keep chatting
  </button>
</div>
```

Match the surrounding flat style (no radius/shadows — f7). The short "runs short" verdict copy one block up (LandingPage ~line 190) mentions "the dashboard lets you drag the levers, the details let you tune everything" — simplify to something like "The dashboard lets you drag the levers and watch the answer change; the assistant can answer questions about the plan." (user disliked wordy CTAs; keep it one line.)

4. Footer Dashboard button (currently `Dashboard →`, both the `plan ?` button and the fallback Link): rename label to **`Go to dashboard →`** for consistency. The fallback Link (no plan yet) keeps plain navigation with no pref write. Consider setting the dock pref to `'1'` on the footer button too when a plan exists — optional; default dock-open already covers fresh users.
5. Delete the now-unused `Link` import if nothing else in the file uses it (the footer Help/Support links still use `Link` — check before removing). The "Tune the details" Link goes away with the two-door grid; Details remains reachable from the dashboard header, so nothing is orphaned.

**`src/App.tsx`** — welcome case (~line 891): extend `onBuild` to honor the option (belt-and-braces — the pref write in the click handler already does the job because `setView` triggers a BetaPage mount that reads the pref; the option exists mainly for testability and to document intent):

```tsx
onBuild={(plan, opts) => {
  setInputs(JSON.parse(JSON.stringify(plan)));
  setHasUnsavedChanges(true);
  if (opts?.openAssistant !== undefined) {
    try { prefKV().setItem('wealthconsole_dock_open', opts.openAssistant ? '1' : '0'); } catch { /* ignore */ }
  }
  setView('projection');
}}
```

Add the `prefKV` import to App.tsx if not already imported (check — `isWelcomeDismissed` nearby suggests panel/pref helpers may already be imported; the key string is also exported from `prefKv.ts`'s `PREF_KEYS` list if you want to reference it symbolically — note BetaPage defines its own local `DOCK_PREF_KEY` constant rather than importing from PREF_KEYS, so copying the string literal is consistent with existing code).

**Tests — `src/components/beta/LandingPage.test.tsx`** (node env, `renderToStaticMarkup`):
- Assert the completed state renders both `Go to dashboard` and `Keep chatting` (drive the component through the 5 questions — check how existing tests reach `done`; if none do, the cheapest path is `renderHook`-free: it's static markup, so either simulate via `react-dom/test-utils`/`@testing-library/react` in a jsdom test, or refactor: extract the post-questions block so it can be rendered directly. **Preferred:** add a small jsdom test file or extend the existing one to a DOM environment if the repo already has jsdom tests to copy from — `src/components/beta/BetaPage.test.tsx` uses jsdom; mirror its setup).
- Assert the old strings (`Open the dashboard`, `Tune the details`) are gone.
- If practical with a DOM test: clicking "Keep chatting" writes `'1'` to localStorage key `wealthconsole_dock_open`, "Go to dashboard" writes `'0'`, and both call `onBuild` with the plan. localStorage is available in jsdom; `prefKV()` pre-store writes to it directly.

**Do NOT:** add any model/install-card UI to the landing, touch AgentPage, or add a new route. The interim design is dead.

---

## Task 2 — Merge `#/export` (backup/restore/import) into the Data page

**Problem:** beta header Data link (`BetaPage.tsx:95`) and `MOBILE_MENU_ITEMS` (line 38) point at view `'data'` → `BetaDataPage` → `SharingPage` (share link/plan code only). The full `DataPage` (projection export + full .sqlite backup + import) renders at `#/export` (`App.tsx:851`) but **no beta navigation reaches it** — only the legacy stable-app header does (`App.tsx:983 onOpenData`).

**Plan of record supports the merge** — `ux-proposals/BETA-MAP.md` §3b: "sharing→Data · print+export→Print/Data pages" (one Data home).

### Changes

1. **`src/components/beta/pages.tsx`** — `BetaDataPage` (~line 86): render `SharingPage` and `DataPage` stacked. Its props type becomes `ComponentProps<typeof SharingPage> & ComponentProps<typeof DataPage> & { chip; assistant? }`:

```tsx
export function BetaDataPage({ chip, assistant, ...props }: ComponentProps<typeof SharingPage> & ComponentProps<typeof DataPage> & { chip: VerdictChip; assistant?: ReactNode }) {
  return (
    <BetaPage title="Data" hint="data-backup-restore" chip={chip} assistant={assistant}>
      <div className="space-y-10 pt-6">
        <SharingPage {...props} />
        <DataPage {...props} />
      </div>
    </BetaPage>
  );
}
```

(`SharingPage` and `DataPage` prop sets don't collide — verify with tsc. `DataPage` is already imported in this file for `BetaExportPage`.)

2. **`src/App.tsx`** — beta `case 'data'` (~line 840): spread in the props currently exclusive to `case 'export'`: `exportOptions={exportOptions} onExportOptionsChange={updateExportOptions} hasSpouse={!!exportResults.spouse} results={exportResults} config={config} scenarios={scenarios} activeScenarioId={activeScenarioId} onExportFull={handleExportFull} onImportFull={handleImportFull} onImportProjection={handleProjectionImport}`. (`inputs` and `scenarioName` are already passed.)
3. **`src/App.tsx`** — **delete `case 'export'`** (~lines 851–861, the `BetaExportPage` block) and **delete `BetaExportPage`** from `src/components/beta/pages.tsx` (nothing else imports it — verify with grep).
4. **`src/lib/viewRoutes.ts`** — remove `'export'` from the `View` union (line 16) and the `export: 'export'` route entry (line 42). **Leave the stable app's `onOpenData={() => setView('export')}` (App.tsx:983) and its `view === 'export'` render blocks (~1095, ~1257) working**: if those legacy blocks typecheck against the narrowed union they must be updated — the stable app still needs its Data page. Look at how the stable path renders `view === 'export'` and either (a) keep `'export'` in the union but remove only the route mapping + beta case, or (b) repoint the stable header to `'data'`. **(a) is lower-risk** — confirm which the stable app uses for its own routing before choosing. `grep -n "setView('data')\|view === 'data'" src/App.tsx` will tell you if 'data' renders anything in the stable path.
5. **Tests:**
   - `src/lib/viewRoutes.test.ts`: update line 14 (`#/export` → expect... decision: after removing the route it should fall back to the default view — assert that) and line 61 (remove `'export'` from the known-views list if present there).
   - Add a test (BetaPage.test.tsx or a pages test) that the merged beta Data page renders both the share section ("Send this plan" / "Receive a plan" — SharingPage's `Panel label`s) and the backup/import section. DataPage sections have no Panel labels; stable anchor strings to assert on: grep `DataPage.tsx` for visible headings first (e.g. the "Download" button, filename input, "Full backup" — pick two strings that actually exist).
6. **`ux-proposals/BETA-MAP.md`** — update the line at §3b/§2 that lists the beta pages (currently mentions "Print / Export" as wrapped panels): Export is now folded into Data; `#/export` is gone (or legacy-only, per 4a/4b decision).

### Explicitly out of scope
- No changes to `DataPage.tsx`, `SharingPage.tsx`, `handleExportFull/Import*` handlers — the panels are reused as-is (that's the beta pattern).
- No header/mobile-menu changes needed: the existing Data entry now reaches everything.

---

## Standing rules (apply to both tasks)

- **Tests with every feature** — extend the test files named above in the same commit.
- Gate before committing: `npx vitest run` green (was 1027/1027 at branch head) + `npx tsc -b` clean + `npm run build` ok.
- Commit plainly, trailer `Co-Authored-By: Claude <noreply@anthropic.com>`. **Never** `-c core.hooksPath=/dev/null` (denied as audit tampering).
- PR #137 stays a **draft** — push commits, don't merge, don't mark ready.
- One known pre-existing dirty file: `packages/mcp-tools/src/__snapshots__/catalog.test.ts.snap` (unstaged artifact) — leave it alone unless a test run rewrites it.
- Suggested order: Task 1 first (user asked for it first), Task 2 in a second commit.
