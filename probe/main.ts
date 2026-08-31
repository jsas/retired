// Elective local-model tuning probe — browser runner.
//
// NOT part of the app bundle or the deploy. `npm run probe` → open
// http://localhost:5174/probe/. For each selected web-llm model × loop-prone
// prompt × sampler profile, this generates a RAW reply (deliberately bypassing
// the streaming circuit breakers so the full degenerate tail is visible),
// scores it with repetition.ts, and records whether the production breakers
// WOULD have fired. Results persist in localStorage so a sweep survives a
// reload / crash; "Clear results" starts over.
//
// The point: replace guesswork in MODEL_SAMPLER_DEFAULTS (#104) and the
// simple-persona tier choice (#108) with measured loop rates per profile.

import { WEBLLM_MODELS, webGpuAvailable, fmtSize, fmtVram } from '../src/lib/ai/webLlmModels';
import { loadWebLlmEngine, unloadWebLlmEngine, isWebLlmModelCached, loadedWebLlmWindow, isTokenEcho, detectRepetitionCut } from '../src/lib/ai/webLlmProvider';
import { MODEL_SAMPLER_DEFAULTS } from '../src/lib/aiSettings';
import { buildSystemPrompt } from '../src/lib/ai/agentLoop';
import { toolSpecs } from '../src/lib/ai/tools';
import { buildPromptToolInstructions, extractPromptToolCalls } from '../src/lib/ai/promptTools';
import { defaultAppConfig } from '../src/lib/appConfig';
import { PROBE_SIMPLE_PERSONA } from './sweep';
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
}

const STORE_KEY = 'retirement_probe_results_v1';
const results: Cell[] = loadStored();
let abortFlag = false;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const logBox = $<HTMLElement>('logBox');
function log(msg: string) {
  logBox.textContent = `[${new Date().toLocaleTimeString()}] ${msg}\n` + (logBox.textContent ?? '');
}

function loadStored(): Cell[] {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]'); } catch { return []; }
}
function store() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(results)); } catch { log('⚠ results too big for localStorage'); }
}
const cellKey = (m: string, p: string, f: string, persona: string) => `${m}|${p}|${f}|${persona}`;
const done = (m: string, p: string, f: string, persona: string) =>
  results.some(r => cellKey(r.modelId, r.promptId, r.profile, r.persona) === cellKey(m, p, f, persona));

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
  // (No reference to #108's simplePrompt field — the probe stays self-contained
  //  against main; the persona is chosen by the checkbox, not the model list.)
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

// --- the sweep --------------------------------------------------------------

/** Build the system prompt the SAME way the app does, so what we measure is
 *  what ships: persona + prompt-mode tool mechanics + live program rules +
 *  scenario name + the fenced tool catalog. The persona rides through
 *  `basePrompt` (works on main today; once #108 lands, `tier` could replace
 *  the PROBE_SIMPLE_PERSONA copy). */
function systemFor(persona: 'full' | 'simple'): string {
  const config = defaultAppConfig();
  const base = buildSystemPrompt('Probe plan', {
    toolMode: 'prompt',
    basePrompt: persona === 'simple' ? PROBE_SIMPLE_PERSONA : undefined,
    config,
  });
  return base + '\n\n' + buildPromptToolInstructions(toolSpecs());
}

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

$('run').addEventListener('click', async () => {
  const btn = $<HTMLButtonElement>('run');
  const stopBtn = $<HTMLButtonElement>('stop');
  const models = selectedModels();
  const profiles = selectedProfiles();
  const persona: 'full' | 'simple' = ($('personaSimple') as HTMLInputElement).checked ? 'simple' : 'full';
  if (!models.length || !profiles.length) { log('pick at least one model and one profile'); return; }
  abortFlag = false;
  btn.disabled = true; stopBtn.disabled = false;
  $('progress').hidden = false;

  const total = models.length * SWEEP_PROMPTS.length * profiles.length;
  let n = 0;
  try {
    for (const modelId of models) {
      if (abortFlag) break;
      const sys = systemFor(persona);
      // One engine load per model; the provider reuses it across turns.
      const engine = await loadWebLlmEngine(modelId, p => {
        setBar(n / total, `${WEBLLM_MODELS.find(m => m.id === modelId)?.label}: ${p.text.slice(0, 80)}`);
      }) as unknown as Engine;
      for (const prompt of SWEEP_PROMPTS) {
        for (const profile of profiles) {
          if (abortFlag) break;
          n++;
          if (done(modelId, prompt.id, profile.label, persona)) { setBar(n / total, `skip ${profile.label}/${prompt.id} (cached)`); continue; }
          setBar(n / total, `${WEBLLM_MODELS.find(m => m.id === modelId)?.label} · ${prompt.label} · ${profile.label}`);
          try {
            const { text, seconds } = await generate(engine, sys, prompt.user, profile);
            const tokens = tokenize(text);
            const cell: Cell = {
              modelId, promptId: prompt.id, profile: profile.label, persona, text, seconds,
              score: repetitionScore(text),
              ttr: ttr(tokens),
              maxRepeat: maxWordRepeat(tokens),
              onset: loopOnset(tokens),
              breakerEcho: isTokenEcho(text),
              breakerBlock: detectRepetitionCut(text) !== -1,
            };
            results.push(cell);
            store();
            log(`${modelId} ${prompt.id}/${profile.label}: score ${cell.score.toFixed(2)}${cell.breakerEcho ? ' ⚑echo' : ''}${cell.breakerBlock ? ' ⚑block' : ''} (${seconds.toFixed(1)}s)`);
          } catch (err) {
            log(`FAILED ${modelId} ${prompt.id}/${profile.label}: ${String(err).slice(0, 200)}`);
          }
          render();
        }
      }
    }
  } finally {
    btn.disabled = false; stopBtn.disabled = true;
    $('progress').hidden = true;
    if (abortFlag) log(`stopped (partial results kept; resume with Run to skip completed cells)`);
    render();
  }
});

$('stop').addEventListener('click', () => { abortFlag = true; });
$('clear').addEventListener('click', () => {
  if (!confirm('Discard all stored probe results?')) return;
  results.length = 0;
  localStorage.removeItem(STORE_KEY);
  render();
});

function setBar(frac: number, text: string) {
  $('barFill').style.width = `${Math.round(frac * 100)}%`;
  $('barText').textContent = text;
}

// --- rendering --------------------------------------------------------------

function render() {
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
  $('exportJson').onclick = () => {
    $('exportBox').hidden = false;
    $('exportBox').textContent = JSON.stringify(results.map(({ text, ...rest }) => ({ ...rest, textLen: text.length })), null, 1);
  };
}
render();

// --- unattended triage mode (?auto=1) ---------------------------------------
//
// Launched by probe/run-triage.sh in a SEPARATE visible Chrome window (its own
// profile — never touches the user's browsers). Loads EVERY curated model in
// list order — downloading each one's weights on first use — and runs all
// loop-prone prompts through it at the sampler profile the app would actually
// ship for that model, with the persona + tool mode the app would actually use
// (tool-capable models: prompt mode + full persona; Q&A models: tools off +
// simple persona). Two audiences: the human watching the window (the progress
// bar, log and results table update live as cells land, sharing the interactive
// sweep's render path), and probe/drive.mjs (one PROBE_EVENT console line per
// cell — including the head of the raw text — so the driver can grade tool-
// protocol compliance and word-salad that the numeric metrics alone miss).
// Results stay in memory only: the dashboard shows THIS run, nothing persists.

interface AutoConfig {
  models: 'all' | string;
  maxTokens: number;
}

function parseAutoParam(): AutoConfig | null {
  const raw = new URLSearchParams(location.search).get('auto');
  if (raw === null) return null;
  const cfg: AutoConfig = { models: 'all', maxTokens: SWEEP_MAX_TOKENS };
  for (const part of raw.split(',')) {
    const [k, v] = part.split('=');
    if (k === 'models' && v) cfg.models = v;
    if (k === 'maxtokens' && v) cfg.maxTokens = Math.max(64, Number(v) || cfg.maxTokens);
  }
  return cfg;
}

function emit(type: string, payload: Record<string, unknown>) {
  console.log(`PROBE_EVENT ${JSON.stringify({ type, ...payload })}`);
}

function autoToolMode(modelId: string): 'prompt' | 'off' {
  return WEBLLM_MODELS.find(m => m.id === modelId)?.toolCapable ? 'prompt' : 'off';
}

/** Simple persona for models flagged simplePrompt (#108's field, when that
 *  lands) — falling back to !toolCapable so the tiny Q&A model already gets
 *  the short persona on today's main. */
function autoPersona(modelId: string): 'full' | 'simple' {
  const m = WEBLLM_MODELS.find(x => x.id === modelId);
  if (!m) return 'full';
  return ((m as { simplePrompt?: boolean }).simplePrompt ?? !m.toolCapable) ? 'simple' : 'full';
}

/** The sampler profile the app would ship for this model today (#104's
 *  MODEL_SAMPLER_DEFAULTS when present, generic baseline otherwise), or an
 *  explicit override from the driver (?profile=<label>). */
function profileForModel(modelId: string, override: SamplerProfile | null): SamplerProfile {
  if (override) return override;
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

async function runAutoTriage(cfg: AutoConfig) {
  if (!webGpuAvailable()) {
    emit('fatal', { error: 'WebGPU unavailable in this browser' });
    return;
  }
  const wanted = cfg.models === 'all'
    ? WEBLLM_MODELS.map(m => m.id)
    : cfg.models.split('|').map(s => s.trim()).filter(Boolean);

  const overrideLabel = new URLSearchParams(location.search).get('profile');
  const override = overrideLabel ? SWEEP_PROFILES.find(p => p.label === overrideLabel) ?? null : null;
  const knownTools = new Set(toolSpecs().map(s => s.name));

  emit('start', { models: wanted, maxTokens: cfg.maxTokens, override: override?.label ?? 'per-model shipped' });
  const total = wanted.length * SWEEP_PROMPTS.length;
  let n = 0;
  $('progress').hidden = false;
  const t0 = performance.now();
  for (const modelId of wanted) {
    const label = WEBLLM_MODELS.find(m => m.id === modelId)?.label ?? modelId;
    try {
      emit('load-start', { modelId, cached: await isWebLlmModelCached(modelId) });
      let lastPct = -1;
      const engine = await loadWebLlmEngine(modelId, p => {
        const pct = Math.floor((p.progress ?? 0) * 20);
        if (pct !== lastPct) {
          lastPct = pct;
          emit('load-progress', { modelId, progress: p.progress, text: p.text.slice(0, 90) });
          setBar(n / total, `${label}: loading ${(p.progress ?? 0) * 100}% — ${p.text.slice(0, 60)}`);
        }
      }) as unknown as Engine;
      const toolMode = autoToolMode(modelId);
      const persona = autoPersona(modelId);
      const sys = buildSystemPrompt('Probe plan', {
        toolMode,
        basePrompt: persona === 'simple' ? PROBE_SIMPLE_PERSONA : undefined,
        config: defaultAppConfig(),
      }) + (toolMode === 'prompt' ? '\n\n' + buildPromptToolInstructions(toolSpecs()) : '');
      emit('load-done', { modelId, window: loadedWebLlmWindow(), toolMode, persona });
      log(`loaded ${label} (window ${loadedWebLlmWindow()}, tools ${toolMode}, ${persona} persona)`);
      for (const prompt of SWEEP_PROMPTS) {
        const profile = profileForModel(modelId, override);
        n++;
        emit('cell-start', { modelId, promptId: prompt.id, profile: profile.label });
        setBar(n / total, `${label} · ${prompt.label} · ${profile.label}`);
        try {
          const { text, seconds } = await generate(engine, sys, prompt.user, profile, cfg.maxTokens);
          const tokens = tokenize(text);
          const parsed = extractPromptToolCalls(text, knownTools);
          // Feed the shared render path so the watching human sees the table
          // fill in — in-memory only, the auto run never touches localStorage.
          results.push({
            modelId, promptId: prompt.id, profile: profile.label, persona, text, seconds,
            score: repetitionScore(text),
            ttr: ttr(tokens),
            maxRepeat: maxWordRepeat(tokens),
            onset: loopOnset(tokens),
            breakerEcho: isTokenEcho(text),
            breakerBlock: detectRepetitionCut(text) !== -1,
          });
          render();
          emit('cell', {
            modelId, label, promptId: prompt.id, profile: profile.label, persona, toolMode,
            score: results[results.length - 1].score,
            ttr: results[results.length - 1].ttr,
            maxRepeat: results[results.length - 1].maxRepeat,
            onset: results[results.length - 1].onset,
            breakerEcho: results[results.length - 1].breakerEcho,
            breakerBlock: results[results.length - 1].breakerBlock,
            seconds,
            chars: text.length,
            tokens: tokens.length,
            toolCalls: parsed.calls.map(c => c.name),
            toolErrors: parsed.errors.length,
            rawHead: text.slice(0, 140),
          });
          const c = results[results.length - 1];
          log(`${label} ${prompt.id}: score ${c.score.toFixed(2)}${c.breakerEcho || c.breakerBlock ? ' ⚑breaker' : ''}${parsed.calls.length ? ` calls[${parsed.calls.map(x => x.name).join(',')}]` : ' no-calls'} (${seconds.toFixed(0)}s)`);
        } catch (err) {
          emit('cell-fail', { modelId, promptId: prompt.id, error: String(err).slice(0, 200) });
          log(`FAILED ${label} ${prompt.id}: ${String(err).slice(0, 120)}`);
        }
        try { await engine.resetChat?.(true); } catch { /* best effort between cells */ }
      }
    } catch (err) {
      emit('model-fail', { modelId, error: String(err).slice(0, 300) });
      log(`MODEL FAILED ${label}: ${String(err).slice(0, 120)}`);
    }
    // Free this model's VRAM before loading the next one.
    await unloadWebLlmEngine().catch(() => undefined);
    emit('model-done', { modelId });
  }
  $('progress').hidden = true;
  emit('done', { totalSeconds: ((performance.now() - t0) / 1000).toFixed(0) });
}

const autoCfg = parseAutoParam();
if (autoCfg) void runAutoTriage(autoCfg);
