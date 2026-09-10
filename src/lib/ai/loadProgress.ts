// web-llm / Bonsai report load progress in English ("Loading model from cache[1/127]:
// 485MB loaded. 10% completed…"). The bar already shows the percent; this maps
// the engine dump onto our own copy so the dock and Models page follow the
// page language.

export type LoadProgressKind =
  | 'preparing'
  | 'cache'
  | 'download'
  | 'shaders'
  | 'compile'
  | 'file'
  | 'ready'
  | 'other';

export interface ClassifiedLoadProgress {
  kind: LoadProgressKind;
  current?: number;
  total?: number;
  mb?: number;
  file?: string;
}

const CACHE = /Loading model from cache\[(\d+)\/(\d+)\]:\s*(\d+)\s*MB/i;
const FETCH = /Fetching param cache\[(\d+)\/(\d+)\]:\s*(\d+)\s*MB/i;
const SHADERS = /Loading GPU shader modules\[(\d+)\/(\d+)\]/i;
const FILE = /Downloading\s+(.+?)(?:…|\.\.\.)?$/i;

/** Classify a provider progress string. Pure — the UI localizes from `kind`. */
export function classifyLoadProgress(text: string): ClassifiedLoadProgress {
  const t = text.trim();
  if (!t || /Preparing the local model/i.test(t)) return { kind: 'preparing' };
  if (/^Ready\.?$/i.test(t) || /^Finish loading/i.test(t)) return { kind: 'ready' };
  if (/Warming up Bonsai|Compiling/i.test(t)) return { kind: 'compile' };

  let m = t.match(CACHE);
  if (m) return { kind: 'cache', current: Number(m[1]), total: Number(m[2]), mb: Number(m[3]) };
  m = t.match(FETCH);
  if (m) return { kind: 'download', current: Number(m[1]), total: Number(m[2]), mb: Number(m[3]) };
  m = t.match(SHADERS);
  if (m) return { kind: 'shaders', current: Number(m[1]), total: Number(m[2]) };
  m = t.match(FILE);
  if (m) return { kind: 'file', file: m[1]!.replace(/…$/, '').trim() };
  if (/Loading Bonsai/i.test(t)) return { kind: 'download' };
  return { kind: 'other' };
}

/** i18next `t` for the pages namespace (assistant.load*). */
export function localizeLoadProgress(
  text: string,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const c = classifyLoadProgress(text);
  switch (c.kind) {
    case 'preparing':
      return t('assistant.loadingLocal');
    case 'cache':
      return t('assistant.loadFromCache', { current: c.current, total: c.total, mb: c.mb });
    case 'download':
      return c.current != null
        ? t('assistant.loadDownloading', { current: c.current, total: c.total, mb: c.mb })
        : t('assistant.loadGeneric');
    case 'shaders':
      return t('assistant.loadShaders', { current: c.current, total: c.total });
    case 'compile':
      return t('assistant.loadCompile');
    case 'file':
      return t('assistant.loadFile', { file: c.file });
    case 'ready':
      return t('assistant.loadReady');
    default:
      return t('assistant.loadingLocal');
  }
}
