// Elective local-model tuning probe — repetition scoring.
//
// NOT part of the app bundle and NOT run by the deploy test suite (`npm test`
// only includes src/**). This module is imported by both the probe page
// (probe/index.html via vite) and probe/repetition.test.ts (vitest.probe.config.ts),
// so the exact metrics that decide a sampler profile are unit-tested without
// a GPU.
//
// Why continuous metrics: the shipped breakers (isTokenEcho,
// detectRepetitionCut) are binary tripwires tuned by eyeball. To tune sampler
// defaults empirically we need a SCORE — how degenerate is this reply, and
// how far into it did the model start to loop — so a grid sweep can rank
// profiles and calibrate the breaker thresholds against real output.

/** Tokenize like the production breaker: lowercase word chars + apostrophes,
 *  drop fillers shorter than 3 letters. Kept identical to isTokenEcho's
 *  splitter so scores and breaker verdicts describe the same tokens. */
export function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z']+/).filter(w => w.length > 2);
}

/** Type-token ratio over the trailing window: unique/total. Healthy English
 *  prose sits ~0.55-0.7; a collapsed loop falls under 0.3 (the production
 *  breaker's threshold). Returns 1 for windows too short to judge. */
export function ttr(tokens: string[], window = 220): number {
  if (tokens.length < window) return 1;
  const w = tokens.slice(-window);
  return new Set(w).size / w.length;
}

/** Longest verbatim n-gram (n = `n` tokens) repeated at least twice, as a
 *  fraction of the token stream: how much of the reply is a recycled block.
 *  Catches the sentence-loop detectRepetitionCut looks for, continuously.
 *  0 = no repetition at this n. */
export function phraseRepeatRatio(tokens: string[], n = 8): number {
  if (tokens.length < n * 2) return 0;
  const seen = new Set<string>();
  let repeated = 0;
  for (let i = 0; i + n <= tokens.length; i++) {
    const gram = tokens.slice(i, i + n).join(' ');
    if (seen.has(gram)) repeated++;
    else seen.add(gram);
  }
  const grams = tokens.length - n + 1;
  return grams > 0 ? Math.min(1, repeated / grams) : 0;
}

/** The single most over-repeated CONTENT word in the trailing window, as a
 *  fraction of the window. The stopword list mirrors webLlmProvider's so the
 *  probe measures what the breaker measures — "explicitly" 60× in the Phi-4
 *  report is exactly this signal. */
export function maxWordRepeat(tokens: string[], window = 220): number {
  if (tokens.length === 0) return 0;
  const w = tokens.slice(-window);
  const counts = new Map<string, number>();
  for (const t of w) {
    if (STOPWORDS.has(t)) continue;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  let max = 0;
  for (const c of counts.values()) if (c > max) max = c;
  return w.length > 0 ? max / w.length : 0;
}

/** Fraction of the trailing window that is long (≥9 char) tokens — the
 *  jargon-dump signal isTokenEcho uses (>0.55 = degenerate). */
export function longTokenRatio(tokens: string[], window = 220): number {
  if (tokens.length === 0) return 0;
  const w = tokens.slice(-window);
  const long = w.filter(t => t.length >= 9).length;
  return long / w.length;
}

/** Index (0..1) where degeneration begins: the first token position after
 *  which the trailing-window TTR collapses below `floor` and stays there.
 *  1 = never looped (the whole reply is healthy); 0.2 = it went bad 20% in.
 *  Lets the summary distinguish "clean then looped" from "looped throughout". */
export function loopOnset(tokens: string[], floor = 0.30, window = 120): number {
  if (tokens.length < window * 2) return 1;
  // Scan from the end backwards while the local window stays degenerate; the
  // first healthy window from the right is the onset.
  for (let end = tokens.length; end - window >= window; end--) {
    const w = new Set(tokens.slice(end - window, end));
    if (w.size / window >= floor) {
      return (end - window) / tokens.length;
    }
  }
  return 0; // degenerate from the very start
}

/** Composite 0..1 degeneracy score for a reply. Weights are judgement calls
 *  the sweep is meant to validate; the raw metrics are exported too so a
 *  profile can be ranked on any single axis. */
export function repetitionScore(text: string): number {
  const tokens = tokenize(text);
  if (tokens.length < 60) return 0; // too short to be a loop
  const t = ttr(tokens);
  const p = phraseRepeatRatio(tokens);
  const m = maxWordRepeat(tokens);
  const l = longTokenRatio(tokens);
  // TTR inverted (low = bad), plus the three positive-degeneracy signals.
  const inv = Math.max(0, Math.min(1, (0.5 - t) / 0.5)); // 0 at TTR≥0.5, 1 at TTR≤0
  return Math.max(inv, 0.6 * p + 0.4 * Math.min(1, m * 6) + 0.3 * Math.min(1, l * 1.8));
}

/** Shared STOPWORDS — duplicated from webLlmProvider deliberately: the probe
 *  must not import app runtime code (which pulls in web-llm), and this list is
 *  small, stable, and unit-checked against the provider's copy below. */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'your', 'yours', 'all',
  'can', 'could', 'will', 'would', 'should', 'may', 'might', 'must', 'shall',
  'has', 'have', 'had', 'was', 'were', 'been', 'being', 'is', 'be', 'am',
  'do', 'does', 'did', 'done', 'a', 'an', 'as', 'at', 'by', 'from', 'in',
  'into', 'of', 'on', 'onto', 'or', 'so', 'to', 'too', 'up', 'upon', 'with',
  'within', 'without', 'it', 'its', 'itself', 'this', 'that', 'these',
  'those', 'there', 'their', 'theirs', 'them', 'they', 'he', 'she', 'his',
  'her', 'hers', 'him', 'we', 'our', 'ours', 'us', 'i', 'me', 'my', 'mine',
  'if', 'then', 'than', 'when', 'while', 'where', 'which', 'who', 'whom',
  'what', 'how', 'why', 'because', 'since', 'until', 'before', 'after',
  'about', 'above', 'below', 'between', 'under', 'over', 'again', 'once',
  'also', 'just', 'only', 'very', 'more', 'most', 'less', 'least', 'much',
  'many', 'few', 'each', 'every', 'any', 'some', 'such', 'no', 'nor', 'own',
  'same', 'other', 'another', 'both', 'either', 'neither', 'one', 'two',
  'out', 'off', 'per', 'via', 'etc', 'age', 'year', 'years',
]);

/** A sampler profile the probe sweeps. Mirrors AiGenerationSettings' local
 *  fields; kept structural so the probe doesn't import aiSettings. */
export interface SamplerProfile {
  label: string;
  temperature: number;
  repetitionPenalty: number;
  presencePenalty: number;
  frequencyPenalty: number;
}

/** Per-model loop report: the score of each profile, best (lowest) first. */
export interface ModelTuning {
  modelId: string;
  profiles: Array<{ profile: SamplerProfile; avgScore: number; worstScore: number; samples: number }>;
}

/** Rank a model's profiles by average degeneracy (lower = cleaner). */
export function rankProfiles(model: ModelTuning): ModelTuning['profiles'] {
  return [...model.profiles].sort((a, b) => a.avgScore - b.avgScore);
}

/** Emit the winning profile per model as a MODEL_SAMPLER_DEFAULTS snippet the
 *  user can paste straight into aiSettings.ts. Only models whose best profile
 *  is meaningfully cleaner than the shipped baseline are listed. */
export function toSamplerDefaults(
  models: ModelTuning[],
  opts?: { improvementThreshold?: number },
): string {
  const THRESH = opts?.improvementThreshold ?? 0.1;
  const lines: string[] = [];
  for (const m of models) {
    const ranked = rankProfiles(m);
    const best = ranked[0];
    const baseline = m.profiles.find(p => p.profile.label === 'baseline');
    if (!best || !baseline) continue;
    if (baseline.avgScore - best.avgScore < THRESH) continue; // not worth a profile
    const p = best.profile;
    lines.push(
      `  ${JSON.stringify(m.modelId)}: {`,
      `    temperature: ${p.temperature},`,
      `    repetitionPenalty: ${p.repetitionPenalty},`,
      `    presencePenalty: ${p.presencePenalty},`,
      `    frequencyPenalty: ${p.frequencyPenalty},`,
      `  },`,
    );
  }
  return lines.length
    ? `// From probe sweep ${new Date().toISOString().slice(0, 10)}:\n` +
        `export const MODEL_SAMPLER_DEFAULTS: Record<string, {...}> = {\n${lines.join('\n')}\n};`
    : '// No model beat the baseline by the threshold — keep generic defaults.';
}
