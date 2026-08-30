// Live one-line preview of a streaming chain-of-thought, shown in the
// ReasoningBlock's COLLAPSED header while the model is still thinking.
//
// Reasoning arrives in two shapes depending on the model:
//   - line-per-step (DeepSeek-R1, gpt-oss): many short lines, the last one
//     is the current step;
//   - prose paragraphs (OpenRouter z-ai/glm-*, some Qwen): long unbroken
//     paragraphs, so the "last line" is a whole paragraph — pinned at its
//     first words for minutes, or far longer than the header can show.
//
// The preview is therefore the TAIL of the stream (not the last line):
// whitespace-collapsed, clipped to the last `max` characters on a word
// boundary. Line-per-step models are unaffected (their last line is short);
// prose models get the same live-scrolling header thinking shows.

/** Trailing preview of a reasoning stream, fit for a one-line header. */
export function reasoningTail(reasoning: string, max = 90): string {
  // Prefer the LAST LINE when it fits: line-per-step models then preview their
  // current step exactly as before, instead of a jumble of recent steps.
  const lines = reasoning.split('\n');
  const lastLine = (lines[lines.length - 1] ?? '').replace(/\s+/g, ' ').trim();
  const source = lastLine && lastLine.length <= max
    ? lastLine
    // Last line empty (mid-stream newline) or a prose paragraph too long to
    // show whole: fall back to the tail of the flattened stream.
    : reasoning.replace(/\s+/g, ' ').trimEnd();
  if (source.length <= max) return source;
  // Prefer starting after a space so the preview doesn't open mid-word.
  const window = source.slice(-max);
  const space = window.indexOf(' ');
  const tail = space > 0 && space < window.length - 1 ? window.slice(space + 1) : window;
  return `…${tail}`;
}
