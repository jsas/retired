// The Markets dial — the one input promoted to the verdict hero. A single
// fader from down markets to up markets (the expected average annual return).
// Moving it reshapes the map's terrain live, because the ground depends on it.
import { Fader } from '../../design/primitives';

// Matches the f7 mock's dial. (Expected-return range is a runaway-able axis
// earmarked for a Settings pref — see BETA-MAP.md §2; these are the defaults.)
const MIN_RETURN = 0.012; // 1.2% — down markets
const MAX_RETURN = 0.045; // 4.5% — up markets

export function MarketDial({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="w-full md:w-56">
      <Fader
        label="Markets"
        value={Math.round(value * 1000) / 10}
        min={MIN_RETURN * 100}
        max={MAX_RETURN * 100}
        step={0.1}
        format={(v) => `${v.toFixed(1)}%`}
        onChange={(v) => onChange(v / 100)}
        hint="down ↔ up — the average yearly return the plan assumes"
      />
    </div>
  );
}
