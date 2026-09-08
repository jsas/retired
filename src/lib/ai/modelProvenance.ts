/** Who actually answered a chat turn — asked vs served, for OpenRouter's free router. */

export function provenanceLine(asked?: string, served?: string): string {
  const a = asked?.trim() ?? '';
  const s = served?.trim() ?? '';
  if (!a && !s) return '';
  if (a && s && a !== s) return `${a} → ${s}`;
  return s || a;
}

export function provenanceDetail(asked?: string, served?: string): { asked: string; served: string; routed: boolean } | null {
  const a = asked?.trim() ?? '';
  const s = served?.trim() ?? '';
  if (!a && !s) return null;
  return { asked: a || s, served: s || a, routed: Boolean(a && s && a !== s) };
}
