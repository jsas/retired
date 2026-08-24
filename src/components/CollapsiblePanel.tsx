import { useState, useEffect } from 'react';
import { ChevronRight } from 'lucide-react';

const STORAGE_KEY = 'wealthconsole_panel_state';

function loadPanelState(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {};
}

function savePanelState(state: Record<string, boolean>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* ignore */ }
}

// GCP-console style collapsible panel for the light main workspace: a subtle
// full-width header row with a rotating chevron. Open/closed state persists to
// localStorage keyed by `id`, so each panel remembers its own state.
export function CollapsiblePanel({ id, title, defaultOpen = true, children }: {
  id: string;
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState<boolean>(() => {
    const stored = loadPanelState();
    return typeof stored[id] === 'boolean' ? stored[id] : defaultOpen;
  });

  useEffect(() => {
    const stored = loadPanelState();
    stored[id] = open;
    savePanelState(stored);
  }, [id, open]);

  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-1.5 px-1 py-1 text-[11px] font-semibold text-slate-500 uppercase tracking-wider hover:text-slate-800 rounded hover:bg-slate-100 transition-colors"
        aria-expanded={open}
      >
        <ChevronRight
          size={13}
          className={`shrink-0 text-slate-400 transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
        />
        {title}
      </button>
      {open && <div className="mt-1">{children}</div>}
    </div>
  );
}
