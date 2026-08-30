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
import { loadWebLlmEngine, isWebLlmModelCached, isTokenEcho, detectRepetitionCut } from '../src/lib/ai/webLlmProvider';
import { buildSystemPrompt } from '../src/lib/ai/agentLoop';
import { toolSpecs } from '../src/lib/ai/tools';
import { buildPromptToolInstructions } from '../src/lib/ai/promptTools';
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

async function generate(engine: Engine, system: string, user: string, profile: SamplerProfile): Promise<{ text: string; seconds: number }> {
  const t0 = performance.now();
  const stream = await engine.chat.completions.create({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    stream: true,
    max_tokens: SWEEP_MAX_TOKENS,
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
    profiles: [...byProfile.entries()].map(([label, cells]) => {
      const mine = cells.filter(c => c.modelId === modelId);
      return {
        profile: SWEEP_PROFILES.find(p => p.label === label)!,
        avgScore: mine.length ? mine.reduce((s, c) => s + c.score, 0) / mine.length : 0,
        worstScore: mine.length ? Math.max(...mine.map(c => c.score)) : 0,
        samples: mine.length,
      };
    }).filter(p => p.samples > 0),
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
