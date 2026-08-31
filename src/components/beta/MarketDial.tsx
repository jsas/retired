// The Markets dial — the one input promoted to the verdict hero. A single
// fader from down markets to up markets (the expected average annual return).
// Moving it reshapes the map's terrain live, because the ground depends on it.
// The range is a user preference (Settings → Lever ranges); the defaults are
// the engine's own constraint range.
import { Fader } from '../../design/primitives';
import { getRangePrefs } from '../../lib/rangePrefs';

export function MarketDial({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const ranges = getRangePrefs();
  return (
    <div className="w-full md:w-56">
      <Fader
        label="Markets"
        value={Math.round(value * 1000) / 10}
        min={ranges.returnMin * 100}
        max={ranges.returnMax * 100}
        step={0.1}
        format={(v) => `${v.toFixed(1)}%`}
        onChange={(v) => onChange(v / 100)}
        hint="down ↔ up — the average yearly return the plan assumes"
      />
    </div>
  );
}
