// Elective local-model tuning probe — browser runner.
//
// NOT part of the app bundle or the deploy. `npm run probe` → open
// http://localhost:5174/probe/. For each web-llm model × loop-prone prompt ×
// sampler profile, this generates a RAW reply (deliberately bypassing the
// streaming circuit breakers so the full degenerate tail is visible), scores
// it with repetition.ts, and records whether the production breakers WOULD
// have fired. Persona is no longer a dimension: the app standardized on the
// single full system prompt (#109 closed unmerged; #120 pruned the weak
// models), and the probe measures exactly what ships.
//
// Everything shares ONE store: results persist in localStorage and completed
// cells are skipped, so any run resumes after a stop / reload / crash. "Run
// everything" walks the whole 8-profile sampler grid at once. The grid shows
// planned / running / done per cell; click a filled cell to clear just that
// one and re-measure it.
//
// The point: replace guesswork in MODEL_SAMPLER_DEFAULTS (#104) with measured
// loop rates per profile — and serve as the before/after harness for the
// fine-tune work (#112/#117): the pre-training grid is committed at
// probe/results/baseline-*.json, so a trained checkpoint can be diffed
// against it cell by cell.

import { WEBLLM_MODELS, webGpuAvailable, fmtSize, fmtVram } from '../src/lib/ai/webLlmModels';
import { loadWebLlmEngine, unloadWebLlmEngine, isWebLlmModelCached, loadedWebLlmWindow, isTokenEcho, detectRepetitionCut } from '../src/lib/ai/webLlmProvider';
import { MODEL_SAMPLER_DEFAULTS } from '../src/lib/aiSettings';
import { buildSystemPrompt } from '../src/lib/ai/agentLoop';
import { toolSpecs } from '../src/lib/ai/tools';
import { buildPromptToolInstructions, extractPromptToolCalls } from '../src/lib/ai/promptTools';
import { defaultAppConfig } from '../src/lib/appConfig';
import { SWEEP_PROMPTS, SWEEP_PROFILES, SWEEP_MAX_TOKENS } from './sweep';
import {
  repetitionScore, ttr, maxWordRepeat, loopOnset, tokenize,
  toSamplerDefaults, type ModelTuning, type SamplerProfile,
} from './repetition';

/** Engine handle surface we need (structural — mirrors webLlmProvider's). */
interface Engine {
  chat: { completions: { create(req: Record<string, unknown>): Promise<AsyncIterable<any>> } };
  interruptGenerate?(): Promise<void>;
  resetChat?(keepStats?: boolean): Promise<void>;
}

/** Stored cells keep the persona field (the pre-#127 sweeps used it); the
 *  v3 store maps any 'simple' cell to 'full' on load so old runs still count
 *  as coverage for the single prompt that now ships. New cells always read
 *  'full'. */
interface Cell {
  modelId: string;
  promptId: string;
  profile: string;
  persona: 'full' | 'simple';
  text: string;
  score: number;
  ttr: number;
  maxRepeat: number;
  onset: number;
  breakerEcho: boolean;
  breakerBlock: boolean;
  seconds: number;
  /** Only on imported rows whose text wasn't kept (see importRaw): the
   *  original reply length, used for the floor marker. */
  textLen?: number;
  /** Old exports carry a persona field; harmless — always folded to full. */
}

// v3 = v2 with the persona dimension collapsed: every stored cell is 'full'
// (the one prompt the app ships now; #109's simple tier never landed). Old
// simple-persona cells upgrade to 'full' as coverage for that single prompt —
// same model, same prompt text, same sampler; the only difference was the
// system preamble, and treating them as full keeps the 262-cell fine-tune
// baseline usable instead of forcing a re-run. v2/v1 still migrate forward
// on first load, so no run is ever lost.
// (Declared before the loadStored() call below — everything here runs at
// module init, in source order.)
const STORE_KEY = 'retirement_probe_results_v3';
const V2_STORE_KEY = 'retirement_probe_results_v2';
const LEGACY_STORE_KEY = 'retirement_probe_results_v1';
const cellKey = (m: string, p: string, f: string, persona: string) => `${m}|${p}|${f}|${persona}`;
const pendingLogs: string[] = [];

function loadStored(): Cell[] {
  const v3 = localStorage.getItem(STORE_KEY);
  if (v3 !== null) {
    try { return JSON.parse(v3); } catch { return []; }
  }
  // No v3 yet — fold the newest older store into v3, deduping by key: where a
  // cell was measured under BOTH personas keep the full copy; a simple-only
  // cell survives as full per the comment above.
  const older = loadOlder();
  if (!older.length) return [];
  const byKey = new Map<string, { cell: Cell; simple: boolean }>();
  for (const c of older) {
    if (!c || typeof c.modelId !== 'string' || typeof c.promptId !== 'string') continue;
    const profile = c.profile ?? 'baseline';
    const simple = c.persona === 'simple';
    const k = cellKey(c.modelId, c.promptId, profile, 'full');
    const existing = byKey.get(k);
    if (!existing || (existing.simple && !simple)) {
      byKey.set(k, { cell: { ...c, profile, persona: 'full' }, simple });
    }
  }
  const upgraded = [...byKey.values()].map(v => v.cell);
  const simples = [...byKey.values()].filter(v => v.simple).length;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(upgraded));
    pendingLogs.push(`migrated ${upgraded.length} stored cell(s) to the single-prompt v3 store (${simples} simple-persona row(s) folded to full)`);
  } catch { /* too big — the array still serves this session */ }
  return upgraded;
}

/** Read the newest pre-v3 store present (v2 preferred, else v1 raw rows —
 *  field-defaulting for v1 rows happens in loadStored's dedup loop, so this
 *  doesn't need the old migrateLegacy write side effects). */
function loadOlder(): Cell[] {
  for (const key of [V2_STORE_KEY, LEGACY_STORE_KEY]) {
    const raw = localStorage.getItem(key);
    if (raw === null) continue;
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) return arr;
    } catch { /* try the next older key */ }
  }
  return [];
}

const results: Cell[] = loadStored();
let abortFlag = false;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const logBox = $<HTMLElement>('logBox');
function log(msg: string) {
  logBox.textContent = `[${new Date().toLocaleTimeString()}] ${msg}\n` + (logBox.textContent ?? '');
}
function store() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(results)); } catch { log('⚠ results too big for localStorage'); }
}
// Anything migration queued before the log box existed:
while (pendingLogs.length) log(pendingLogs.shift()!);

/** Marker for imported rows whose raw text was never kept (the dashboard
 *  export and the JSONL cell events both drop it). The metrics still ride
 *  along; only re-scoring from the text is impossible. */
const IMPORT_PREFIX = '[imported';
const hasRealText = (c: Cell) => !c.text.startsWith(IMPORT_PREFIX);

/** "Too short to be a loop" (repetitionScore's <60-token floor). For
 *  text-keeping cells this is exact; for import placeholders it's estimated
 *  from chars (≈5 chars/token, so 60 tok ≈ 300 chars) — good enough for the
 *  grid's ° marker, which is advisory either way. */
function isFloorCell(c: Cell): boolean {
  if (!hasRealText(c)) return (c.textLen ?? 0) < 300;
  return tokenize(c.text).length < 60;
}

/** Import scraped/exported sweep JSON into the store so past runs survive:
 *  accepts the dashboard "Copy JSON" array (carries textLen, no text), the
 *  driver's triage-*.jsonl (PROBE_EVENT cell lines), or any array of cells
 *  WITH text (those get properly re-scored). Deduped by cell key; a real
 *  cell is never downgraded to a placeholder import. Returns [rows, cells]. */
function importRaw(raw: string): [number, number] {
  type Loose = Partial<Cell> & { type?: string; textLen?: number; chars?: number };
  const rows: Loose[] = [];
  let parsedWhole: unknown;
  try { parsedWhole = JSON.parse(raw); } catch { parsedWhole = null; }
  if (Array.isArray(parsedWhole)) {
    rows.push(...(parsedWhole as Loose[]));
  } else {
    for (const line of raw.split(/\r?\n/)) {
      const s = line.trim();
      if (!s) continue;
      try {
        const o = JSON.parse(s.replace(/^PROBE_EVENT /, '')) as Loose;
        // PROBE_EVENT 'cell' lines carry metrics at top level with label/tool
        // noise mixed in — project them onto the Cell shape.
        if (o.type === 'cell' || (o.modelId && o.promptId)) {
          if (o.type && o.type !== 'cell') continue;
          rows.push(o);
        }
      } catch { /* not a JSON line */ }
    }
  }
  const byKey = new Map<string, Cell>();
  for (const r of results) byKey.set(cellKey(r.modelId, r.promptId, r.profile, r.persona), r);
  let touched = 0;
  for (const r of rows) {
    if (!r || typeof r.modelId !== 'string' || typeof r.promptId !== 'string') continue;
    const profile = typeof r.profile === 'string' && r.profile ? r.profile : 'baseline';
    // Persona is collapsed to full everywhere (v3 store, single shipped prompt);
    // imports of pre-#127 exports with persona:'simple' merge as full too.
    const persona = 'full' as const;
    const key = cellKey(r.modelId, r.promptId, profile, persona);
    let cell: Cell;
    if (typeof r.text === 'string' && r.text) {
      const tokens = tokenize(r.text);
      cell = {
        modelId: r.modelId, promptId: r.promptId, profile, persona, text: r.text, seconds: r.seconds ?? 0,
        score: r.score ?? repetitionScore(r.text), ttr: r.ttr ?? ttr(tokens),
        maxRepeat: r.maxRepeat ?? maxWordRepeat(tokens), onset: r.onset ?? loopOnset(tokens),
        breakerEcho: r.breakerEcho ?? isTokenEcho(r.text),
        breakerBlock: r.breakerBlock ?? detectRepetitionCut(r.text) !== -1,
      };
    } else if (typeof r.score === 'number') {
      const textLen = r.textLen ?? r.chars;
      cell = {
        modelId: r.modelId, promptId: r.promptId, profile, persona,
        text: `${IMPORT_PREFIX} ${textLen ?? '?'} chars, text not kept]`,
        textLen, seconds: r.seconds ?? 0,
        score: r.score, ttr: r.ttr ?? 1, maxRepeat: r.maxRepeat ?? 0, onset: r.onset ?? 1,
        breakerEcho: !!r.breakerEcho, breakerBlock: !!r.breakerBlock,
      };
    } else continue;   // no text and no score — nothing to record
    const existing = byKey.get(key);
    if (existing && hasRealText(existing) && !hasRealText(cell)) continue;  // never downgrade
    byKey.set(key, cell);
    touched++;
  }
  results.length = 0;
  results.push(...byKey.values());
  store();
  render();
  return [rows.length, touched];
}

const done = (m: string, p: string, f: string, persona: string) =>
  results.some(r => cellKey(r.modelId, r.promptId, r.profile, r.persona) === cellKey(m, p, f, persona));

// --- the run plan -------------------------------------------------------------
//
// A plan cell is one (model, prompt, sampler profile) measurement, always at
// the single full system prompt. The production shape of each cell mirrors
// the app: tool mode from the model's toolCapable flag, sampler from
// MODEL_SAMPLER_DEFAULTS (#104) when present or the generic baseline
// otherwise.

function autoToolMode(modelId: string): 'prompt' | 'off' {
  return WEBLLM_MODELS.find(m => m.id === modelId)?.toolCapable ? 'prompt' : 'off';
}

/** The sampler profile the app would ship for this model today (#104's
 *  MODEL_SAMPLER_DEFAULTS when present, generic baseline otherwise). */
function shippedProfile(modelId: string): SamplerProfile {
  const d = MODEL_SAMPLER_DEFAULTS[modelId];
  if (d) {
    return {
      label: 'shipped',
      temperature: d.temperature ?? 0.3,
      repetitionPenalty: d.repetitionPenalty ?? 1.15,
      presencePenalty: d.presencePenalty ?? 0.3,
      frequencyPenalty: d.frequencyPenalty ?? 0.3,
    };
  }
  return SWEEP_PROFILES[0]; // 'baseline'
}

/** System prompt built the SAME way the app does, so what we measure is what
 *  ships: the full persona + prompt-mode tool mechanics + live program rules
 *  + plan name + the fenced tool catalog. */
function sysFor(modelId: string): string {
  const toolMode = autoToolMode(modelId);
  const base = buildSystemPrompt('Probe plan', {
    toolMode,
    config: defaultAppConfig(),
  });
  return base + (toolMode === 'prompt' ? '\n\n' + buildPromptToolInstructions(toolSpecs()) : '');
}

interface PlanCell {
  modelId: string;
  promptId: string;
  profile: SamplerProfile;
  /** Always 'full' for new cells — the field stays only because the stored
   *  Cell type carries it (v3 maps old simple rows forward). */
  persona: 'full';
}

interface PlanOpts {
  models?: string[];
}

/** Build the work list.
 *  'triage': one production-shaped pass (shipped profile, what the app would
 *            actually send).
 *  'all':    the whole 8-profile sampler grid — the shipped/baseline cells
 *            the grid shares with triage dedup by key, so 'all' never
 *            measures the same thing twice. */
function buildPlan(scope: 'triage' | 'all', opts: PlanOpts = {}): PlanCell[] {
  const modelIds = opts.models ?? WEBLLM_MODELS.map(m => m.id);
  const byKey = new Map<string, PlanCell>();
  const add = (c: PlanCell) => {
    const k = cellKey(c.modelId, c.promptId, c.profile.label, c.persona);
    if (!byKey.has(k)) byKey.set(k, c);
  };
  for (const modelId of modelIds) {
    const ship = shippedProfile(modelId);
    for (const prompt of SWEEP_PROMPTS) {
      if (scope === 'triage') {
        add({ modelId, promptId: prompt.id, profile: ship, persona: 'full' });
      } else {
        for (const profile of SWEEP_PROFILES) {
          add({ modelId, promptId: prompt.id, profile, persona: 'full' });
        }
      }
    }
  }
  return [...byKey.values()];
}

/** The canonical full-coverage cell set — what the grid colours as "planned". */
const PLANNED_KEYS = new Set(
  buildPlan('all').map(c => cellKey(c.modelId, c.promptId, c.profile.label, c.persona)),
);

const knownTools = new Set(toolSpecs().map(s => s.name));

// --- generation ---------------------------------------------------------------

async function generate(engine: Engine, system: string, user: string, profile: SamplerProfile, maxTokens = SWEEP_MAX_TOKENS): Promise<{ text: string; seconds: number }> {
  const t0 = performance.now();
  const stream = await engine.chat.completions.create({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    stream: true,
    max_tokens: maxTokens,
    // Same clamp the provider uses: never ask for more context than the
    // engine was actually built with (auto mode can back off on OOM).
    context_window_size: loadedWebLlmWindow() || Math.min(maxTokens * 4, 32768),
    temperature: profile.temperature,
    repetition_penalty: profile.repetitionPenalty,
    presence_penalty: profile.presencePenalty,
    frequency_penalty: profile.frequencyPenalty,
  });
  let text = '';
  for await (const chunk of stream) {
    if (abortFlag) { void engine.interruptGenerate?.(); break; }
    const delta = chunk?.choices?.[0]?.delta?.content;
    if (delta) text += delta;
  }
  return { text, seconds: (performance.now() - t0) / 1000 };
}

// --- the shared runner ---------------------------------------------------------
//
// One engine load per model, every plan cell for that model against it
// (persona is just a different system string; profiles are request params).
// Completed cells are SKIPPED and results PERSIST — this same function backs
// the interactive buttons and the unattended ?auto triage, so a stopped sweep
// resumes wherever it left off and the two modes share one dataset.

let runningCell: string | null = null;   // cellKey currently generating
let runActive = false;

function setRunning(on: boolean) {
  runActive = on;
  for (const id of ['run', 'runAll', 'cacheAll']) $<HTMLButtonElement>(id).disabled = on;
  $<HTMLButtonElement>('stop').disabled = !on;
}

interface RunOpts {
  maxTokens: number;
  /** Emit PROBE_EVENT console lines for probe/drive.mjs (unattended mode). */
  streamEvents: boolean;
}

async function runPlan(cells: PlanCell[], opts: RunOpts) {
  if (runActive) { log('a run is already going — Stop it first'); return; }
  setRunning(true);
  abortFlag = false;
  const byModel = new Map<string, PlanCell[]>();
  for (const c of cells) {
    const bucket = byModel.get(c.modelId);
    if (bucket) bucket.push(c); else byModel.set(c.modelId, [c]);
  }
  const total = cells.length;
  let n = 0;
  let skipped = 0;
  $('progress').hidden = false;
  const t0 = performance.now();
  try {
    for (const [modelId, planCells] of byModel) {
      if (abortFlag) break;
      const label = WEBLLM_MODELS.find(m => m.id === modelId)?.label ?? modelId;
      try {
        if (opts.streamEvents) emit('load-start', { modelId, cached: await isWebLlmModelCached(modelId) });
        let lastPct = -1;
        const engine = await loadWebLlmEngine(modelId, p => {
          const pct = Math.floor((p.progress ?? 0) * 20);
          if (pct !== lastPct) {
            lastPct = pct;
            if (opts.streamEvents) emit('load-progress', { modelId, progress: p.progress, text: p.text.slice(0, 90) });
            setBar(n / total, `${label}: loading ${(p.progress ?? 0) * 100}% — ${p.text.slice(0, 60)}`);
          }
        }) as unknown as Engine;
        const toolMode = autoToolMode(modelId);
        if (opts.streamEvents) emit('load-done', { modelId, window: loadedWebLlmWindow(), toolMode });
        log(`loaded ${label} (window ${loadedWebLlmWindow()}, tools ${toolMode})`);
        // One system prompt per model now (persona is gone as a dimension).
        const sys = sysFor(modelId);
        for (const pc of planCells) {
          n++;
          const key = cellKey(modelId, pc.promptId, pc.profile.label, pc.persona);
          if (done(modelId, pc.promptId, pc.profile.label, pc.persona)) {
            skipped++;
            setBar(n / total, `skip ${pc.profile.label}/${pc.promptId} (stored)`);
            continue;
          }
          if (abortFlag) break;
          runningCell = key;
          if (opts.streamEvents) emit('cell-start', { modelId, promptId: pc.promptId, profile: pc.profile.label, persona: pc.persona });
          setBar(n / total, `${label} · ${pc.promptId} · ${pc.profile.label} — ${n - skipped}/${total - skipped} this run`);
          render();
          try {
            const user = SWEEP_PROMPTS.find(p => p.id === pc.promptId)!.user;
            const { text, seconds } = await generate(engine, sys, user, pc.profile, opts.maxTokens);
            const tokens = tokenize(text);
            const parsed = extractPromptToolCalls(text, knownTools);
            const cell: Cell = {
              modelId, promptId: pc.promptId, profile: pc.profile.label, persona: pc.persona, text, seconds,
              score: repetitionScore(text),
              ttr: ttr(tokens),
              maxRepeat: maxWordRepeat(tokens),
              onset: loopOnset(tokens),
              breakerEcho: isTokenEcho(text),
              breakerBlock: detectRepetitionCut(text) !== -1,
            };
            results.push(cell);
            store();
            if (opts.streamEvents) {
              emit('cell', {
                modelId, label, promptId: pc.promptId, profile: cell.profile, persona: cell.persona, toolMode,
                score: cell.score, ttr: cell.ttr, maxRepeat: cell.maxRepeat, onset: cell.onset,
                breakerEcho: cell.breakerEcho, breakerBlock: cell.breakerBlock,
                seconds, chars: text.length, tokens: tokens.length,
                toolCalls: parsed.calls.map(c => c.name),
                toolErrors: parsed.errors.length,
                rawHead: text.slice(0, 140),
              });
            }
            log(`${label} ${pc.promptId}/${pc.profile.label}: score ${cell.score.toFixed(2)}` +
              `${cell.breakerEcho ? ' ⚑echo' : ''}${cell.breakerBlock ? ' ⚑block' : ''}` +
              `${parsed.calls.length ? ` calls[${parsed.calls.map(x => x.name).join(',')}]` : ' no-calls'} (${seconds.toFixed(1)}s)`);
          } catch (err) {
            if (opts.streamEvents) emit('cell-fail', { modelId, promptId: pc.promptId, profile: pc.profile.label, persona: pc.persona, error: String(err).slice(0, 200) });
            log(`FAILED ${label} ${pc.promptId}/${pc.profile.label}: ${String(err).slice(0, 120)}`);
          }
          runningCell = null;
          try { await engine.resetChat?.(true); } catch { /* best effort between cells */ }
          render();
        }
      } catch (err) {
        if (opts.streamEvents) emit('model-fail', { modelId, error: String(err).slice(0, 300) });
        log(`MODEL FAILED ${label}: ${String(err).slice(0, 120)}`);
      }
      // Free this model's VRAM before loading the next one.
      await unloadWebLlmEngine().catch(() => undefined);
      if (opts.streamEvents) emit('model-done', { modelId });
    }
  } finally {
    runningCell = null;
    setRunning(false);
    $('progress').hidden = true;
    if (abortFlag) log(`stopped — everything completed is kept; Run again to resume`);
    render();
  }
  if (opts.streamEvents) emit('done', { totalSeconds: ((performance.now() - t0) / 1000).toFixed(0) });
}

// --- setup UI ---------------------------------------------------------------

$('webgpu').textContent = webGpuAvailable() ? 'WebGPU ✓' : 'WebGPU ✗ — this browser can\'t run local models';
$('webgpu').classList.toggle('no', !webGpuAvailable());

const modelList = $('modelList');
for (const m of WEBLLM_MODELS) {
  const label = document.createElement('label');
  const cb = document.createElement('input');
  cb.type = 'checkbox'; cb.value = m.id;
  // Default selection: the model that misbehaved (Phi-4) + the recommended default.
  cb.checked = /Phi-4|Qwen3\.5-4B/.test(m.id);
  label.append(cb, document.createTextNode(`${m.label} `));
  const meta = document.createElement('span');
  meta.className = 'meta';
  meta.textContent = `${fmtVram(m.vramMB)} · ${fmtSize(m.sizeGB)} · ${m.toolCapable ? 'tools' : 'Q&A only'}`;
  label.append(meta);
  modelList.append(label);
}

const profileList = $('profileList');
for (const p of SWEEP_PROFILES) {
  const label = document.createElement('label');
  const cb = document.createElement('input');
  cb.type = 'checkbox'; cb.value = p.label; cb.checked = true;
  label.append(cb, document.createTextNode(`${p.label} — temp ${p.temperature}, rep ${p.repetitionPenalty}, pres ${p.presencePenalty}, freq ${p.frequencyPenalty}`));
  profileList.append(label);
}
$('allProfiles').addEventListener('change', e => {
  for (const cb of profileList.querySelectorAll('input')) (cb as HTMLInputElement).checked = (e.target as HTMLInputElement).checked;
});

const selectedModels = () => [...modelList.querySelectorAll('input:checked')].map(c => (c as HTMLInputElement).value);
const selectedProfiles = (): SamplerProfile[] => {
  const picked = [...profileList.querySelectorAll('input:checked')].map(c => (c as HTMLInputElement).value);
  return SWEEP_PROFILES.filter(p => picked.includes(p.label));
};

// --- cache all weights ------------------------------------------------------

$('cacheAll').addEventListener('click', async () => {
  const btn = $<HTMLButtonElement>('cacheAll');
  btn.disabled = true;
  for (const m of WEBLLM_MODELS) {
    $('cacheStatus').textContent = `${m.label}: `;
    if (await isWebLlmModelCached(m.id)) { $('cacheStatus').textContent += 'cached ✓'; continue; }
    $('cacheStatus').textContent += 'downloading…';
    try {
      await loadWebLlmEngine(m.id, p => { $('cacheStatus').textContent = `${m.label}: ${Math.round(p.progress * 100)}% ${p.text.slice(0, 60)}`; });
      $('cacheStatus').textContent = `${m.label}: cached ✓`;
      log(`cached ${m.id}`);
    } catch (err) {
      $('cacheStatus').textContent = `${m.label}: FAILED — ${String(err).slice(0, 120)}`;
      log(`cache FAILED ${m.id}: ${String(err)}`);
    }
  }
  $('cacheStatus').textContent = 'done.';
  btn.disabled = false;
});

// --- buttons ------------------------------------------------------------------

$('run').addEventListener('click', () => {
  const models = selectedModels();
  const profiles = selectedProfiles();
  if (!models.length || !profiles.length) { log('pick at least one model and one profile'); return; }
  const cells: PlanCell[] = models.flatMap(modelId =>
    SWEEP_PROMPTS.flatMap(prompt =>
      profiles.map(profile => ({ modelId, promptId: prompt.id, profile, persona: 'full' as const }))));
  void runPlan(cells, { maxTokens: SWEEP_MAX_TOKENS, streamEvents: false });
});

$('runAll').addEventListener('click', () => {
  const models = selectedModels();
  if (!models.length) { log('pick at least one model'); return; }
  void runPlan(buildPlan('all', { models }), { maxTokens: SWEEP_MAX_TOKENS, streamEvents: false });
});

$('stop').addEventListener('click', () => { abortFlag = true; });
$('clear').addEventListener('click', () => {
  if (!confirm('Discard all stored probe results?')) return;
  results.length = 0;
  localStorage.removeItem(STORE_KEY);
  localStorage.removeItem(V2_STORE_KEY);      // so the migration can't resurrect them
  localStorage.removeItem(LEGACY_STORE_KEY);
  render();
});

/** Click-to-clear one grid cell: drop every stored copy of that combo so the
 *  next run re-measures exactly it. */
function clearCell(key: string) {
  for (let i = results.length - 1; i >= 0; i--) {
    if (cellKey(results[i].modelId, results[i].promptId, results[i].profile, results[i].persona) === key) {
      results.splice(i, 1);
    }
  }
  store();
  render();
  log(`cleared ${key.replace(/\|/g, ' · ')}`);
}

// Import lives in the Coverage section (past runs survive a profile wipe this
// way even when nothing else is stored). Hidden file input + button trigger.
$('importJson').addEventListener('click', () => $<HTMLInputElement>('importFile').click());
$('importFile').addEventListener('change', async () => {
  const file = ($('importFile') as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    const [rows, cells] = importRaw(await file.text());
    log(`imported ${file.name}: ${rows} row(s) → ${cells} cell(s) merged`);
  } catch (err) {
    log(`IMPORT FAILED ${file.name}: ${String(err).slice(0, 160)}`);
  }
  ($('importFile') as HTMLInputElement).value = '';   // allow re-importing the same file
});

function setBar(frac: number, text: string) {
  $('barFill').style.width = `${Math.round(frac * 100)}%`;
  $('barText').textContent = text;
}

// --- rendering --------------------------------------------------------------

function render() {
  renderGrid();
  $('results').hidden = results.length === 0;
  if (!results.length) return;
  const models = [...new Set(results.map(r => r.modelId))];
  let html = '';
  for (const modelId of models) {
    const rows = results.filter(r => r.modelId === modelId);
    const profiles = [...new Set(rows.map(r => r.profile))];
    const prompts = [...new Set(rows.map(r => r.promptId))];
    html += `<h3>${WEBLLM_MODELS.find(m => m.id === modelId)?.label ?? modelId}</h3>`;
    html += '<table><tr><th>prompt</th>' + profiles.map(p => `<th>${p}</th>`).join('') + '</tr>';
    for (const promptId of prompts) {
      html += `<tr><td>${promptId}</td>`;
      for (const p of profiles) {
        const cells = rows.filter(r => r.promptId === promptId && r.profile === p);
        if (!cells.length) { html += '<td class="num">—</td>'; continue; }
        const c = cells[cells.length - 1];
        const flag = c.breakerEcho || c.breakerBlock ? ' <span class="flag">⚑</span>' : '';
        html += `<td class="num" title="ttr ${c.ttr.toFixed(2)} · top-word ${(c.maxRepeat * 100).toFixed(0)}% · onset ${(c.onset * 100).toFixed(0)}% · ${c.seconds.toFixed(0)}s">${c.score.toFixed(2)}${flag}</td>`;
      }
      html += '</tr>';
    }
    html += '</table>';
  }
  $('table').innerHTML = html;

  // Per-profile summary across everything measured so far.
  const byProfile = new Map<string, Cell[]>();
  for (const r of results) {
    const bucket = byProfile.get(r.profile);
    if (bucket) bucket.push(r);
    else byProfile.set(r.profile, [r]);
  }
  const tuning: ModelTuning[] = models.map(modelId => ({
    modelId,
    profiles: [...byProfile.entries()].flatMap(([label, cells]) => {
      const mine = cells.filter(c => c.modelId === modelId);
      // Auto-triage cells carry the 'shipped' profile label, which isn't in
      // SWEEP_PROFILES — skip anything the sweep grid doesn't know (it still
      // shows in the table above; only the ranked export needs a grid entry).
      const profile = SWEEP_PROFILES.find(p => p.label === label);
      if (!profile || !mine.length) return [];
      return [{
        profile,
        avgScore: mine.reduce((s, c) => s + c.score, 0) / mine.length,
        worstScore: Math.max(...mine.map(c => c.score)),
        samples: mine.length,
      }];
    }),
  }));
  const summaryRows = [...byProfile.entries()]
    .map(([label, cells]) => ({
      label,
      avg: cells.reduce((s, c) => s + c.score, 0) / cells.length,
      flagRate: cells.filter(c => c.breakerEcho || c.breakerBlock).length / cells.length,
      n: cells.length,
    }))
    .sort((a, b) => a.avg - b.avg);
  $('summary').innerHTML =
    '<table><tr><th>profile</th><th>avg score</th><th>worst</th><th>breaker-fired rate</th><th>samples</th></tr>' +
    summaryRows.map((r, i) => {
      const worst = Math.max(...byProfile.get(r.label)!.map(c => c.score));
      return `<tr><td class="${i === 0 ? 'best' : ''}">${r.label}</td><td class="num">${r.avg.toFixed(3)}</td><td class="num ${r.label === summaryRows[0].label ? '' : 'worst'}">${worst.toFixed(2)}</td><td class="num">${(r.flagRate * 100).toFixed(0)}%</td><td class="num">${r.n}</td></tr>`;
    }).join('') + '</table>';

  $<HTMLButtonElement>('exportDefaults').onclick = () => {
    $('exportBox').hidden = false;
    $('exportBox').textContent = toSamplerDefaults(tuning);
  };
  const exportPayload = () =>
    JSON.stringify(results.map(({ text, ...rest }) => ({ ...rest, textLen: text.length })), null, 1);
  $('exportJson').onclick = () => {
    $('exportBox').hidden = false;
    $('exportBox').textContent = exportPayload();
  };
  $('downloadJson').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([exportPayload()], { type: 'application/json' }));
    a.download = `probe-results-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
}

/** The coverage grid: every planned (profile) cell per model, coloured by
 *  state — filled = stored score, pulsing = running now, light = pending,
 *  dim dot = not in the plan. Click a filled cell to clear it. */
function renderGrid() {
  const storedKeys = new Set(results.map(r => cellKey(r.modelId, r.promptId, r.profile, r.persona)));
  const plannedCount = [...PLANNED_KEYS].filter(k => storedKeys.has(k)).length;
  let status = `${plannedCount} / ${PLANNED_KEYS.size} planned cells done · ${storedKeys.size} stored · clicking a cell clears it`;
  const remaining = PLANNED_KEYS.size - plannedCount;
  if (remaining > 0 && results.length) {
    const avg = results.reduce((s, r) => s + r.seconds, 0) / results.length;
    const est = avg * remaining;
    status += ` · ≈${est >= 3600 ? (est / 3600).toFixed(1) + ' h' : Math.round(est / 60) + ' min'} left at ${avg.toFixed(0)}s/cell`;
  }
  $('gridStatus').textContent = status;

  const allCols = ['shipped', ...SWEEP_PROFILES.map(p => p.label)];
  let html = '';
  for (const m of WEBLLM_MODELS) {
    const cols = allCols.filter(col => col !== 'shipped' || MODEL_SAMPLER_DEFAULTS[m.id]);
    html += `<h3>${m.label}<span class="meta">${m.toolCapable ? 'tools' : 'Q&A only'}</span></h3>`;
    html += '<table class="grid"><tr><th>prompt</th>' + cols.map(c => `<th>${c}</th>`).join('') + '</tr>';
    for (const prompt of SWEEP_PROMPTS) {
      html += `<tr><td class="rowh">${prompt.id}</td>`;
      for (const col of cols) {
        const key = cellKey(m.id, prompt.id, col, 'full');
        const mine = results.filter(r => cellKey(r.modelId, r.promptId, r.profile, r.persona) === key);
        if (mine.length) {
          const c = mine[mine.length - 1];
          const floor = isFloorCell(c);   // repetitionScore's floor: 0.00 here means "too short to judge", not "clean"
          const cls = floor ? 'sc-floor' : c.score < 0.15 ? 'sc-ok' : c.score < 0.3 ? 'sc-mid' : 'sc-bad';
          const flag = c.breakerEcho || c.breakerBlock ? '<span class="flag">⚑</span>' : '';
          const chars = hasRealText(c) ? `${c.text.length} ch` : `imported${c.textLen ? ` ${c.textLen} ch` : ''}`;
          const tip = `${c.score.toFixed(3)}${floor ? ' · under 60-token floor — not judgeable' : ''} · ttr ${c.ttr.toFixed(2)} · top-word ${(c.maxRepeat * 100).toFixed(0)}% · onset ${(c.onset * 100).toFixed(0)}% · ${c.seconds.toFixed(0)}s · ${chars}${c.breakerEcho || c.breakerBlock ? ' · breaker would fire' : ''} · click to clear`;
          html += `<td class="num ${cls}" data-clear="${key}" title="${tip.replace(/"/g, '&quot;')}">${c.score.toFixed(2)}${flag}${floor ? '°' : ''}</td>`;
        } else if (runningCell === key) {
          html += '<td class="running" title="running now">⏳</td>';
        } else if (PLANNED_KEYS.has(key)) {
          html += '<td class="pending"></td>';
        } else {
          html += '<td class="na">·</td>';
        }
      }
      html += '</tr>';
    }
    html += '</table>';
  }
  $('grid').innerHTML = html;
  for (const el of $('grid').querySelectorAll('[data-clear]')) {
    el.addEventListener('click', () => clearCell((el as HTMLElement).dataset.clear!));
  }
}

render();

// --- unattended triage mode (?auto=1) ---------------------------------------
//
// Launched by probe/run-triage.sh in a SEPARATE visible Chrome window (its own
// profile — never touches the user's browsers). Runs the same plan machinery
// (default: the quick production pass; ?auto=1,plan=all runs the whole
// 8-profile sampler grid) and streams one PROBE_EVENT console line per cell
// (including the head of the raw text) so probe/drive.mjs can grade
// tool-protocol compliance and word-salad that the numeric metrics alone
// miss. Like the interactive path, every cell persists to localStorage and is
// skipped when already done — rerunning the script after a crash resumes
// exactly where it stopped.

interface AutoConfig {
  models: 'all' | string;
  maxTokens: number;
  plan: 'triage' | 'all';
}

function parseAutoParam(): AutoConfig | null {
  const raw = new URLSearchParams(location.search).get('auto');
  if (raw === null) return null;
  const cfg: AutoConfig = { models: 'all', maxTokens: SWEEP_MAX_TOKENS, plan: 'triage' };
  for (const part of raw.split(',')) {
    const [k, v] = part.split('=');
    if (k === 'models' && v) cfg.models = v;
    if (k === 'maxtokens' && v) cfg.maxTokens = Math.max(64, Number(v) || cfg.maxTokens);
    if (k === 'plan' && (v === 'triage' || v === 'all' || v === 'everything')) {
      cfg.plan = v === 'triage' ? 'triage' : 'all';
    }
  }
  return cfg;
}

function emit(type: string, payload: Record<string, unknown>) {
  console.log(`PROBE_EVENT ${JSON.stringify({ type, ...payload })}`);
}

async function runAutoTriage(cfg: AutoConfig) {
  if (!webGpuAvailable()) {
    emit('fatal', { error: 'WebGPU unavailable in this browser' });
    return;
  }
  const wanted = cfg.models === 'all'
    ? WEBLLM_MODELS.map(m => m.id)
    : cfg.models.split('|').map(s => s.trim()).filter(Boolean);

  let cells = buildPlan(cfg.plan, { models: wanted });

  // ?profile=<label> forces one sampler profile on every cell (the override
  // collapses grid duplicates — dedup again by key).
  const overrideLabel = new URLSearchParams(location.search).get('profile');
  const override = overrideLabel ? SWEEP_PROFILES.find(p => p.label === overrideLabel) ?? null : null;
  if (override) {
    const byKey = new Map<string, PlanCell>();
    for (const c of cells) byKey.set(cellKey(c.modelId, c.promptId, override.label, c.persona), { ...c, profile: override });
    cells = [...byKey.values()];
  }

  emit('start', {
    models: wanted, plan: cfg.plan, cells: cells.length, maxTokens: cfg.maxTokens,
    override: override?.label ?? 'per-model shipped',
  });
  await runPlan(cells, { maxTokens: cfg.maxTokens, streamEvents: true });
}

const autoCfg = parseAutoParam();
if (autoCfg) void runAutoTriage(autoCfg);
