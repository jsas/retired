import { RefreshCw } from 'lucide-react';

interface ExternalUpdateBannerProps {
  /** Adopt the other tab's version (discards this tab's unsaved edits). */
  onReload: () => void;
  /** Keep this tab's edits; the next Save here overwrites the other tab's. */
  onKeepMine: () => void;
}

/**
 * Shown when the storage-event sync reports another tab persisted changes
 * while THIS tab holds unsaved edits. (When this tab is clean the app just
 * reloads silently — no banner.) The two exits are deliberately asymmetric:
 * Reload is the safe default (their data wins, your unsaved edits go), Keep
 * mine means your next Save overwrites what the other tab did.
 */
export function ExternalUpdateBanner({ onReload, onKeepMine }: ExternalUpdateBannerProps) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5">
      <p className="flex-1 min-w-56 text-xs text-amber-900 leading-snug">
        <span className="font-semibold">This plan was edited in another tab.</span>{' '}
        Your unsaved changes here conflict with it — reloading shows their version;
        keeping yours will overwrite theirs when you next Save.
      </p>
      <div className="flex items-center gap-2">
        <button
          onClick={onReload}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded hover:bg-blue-700"
        >
          <RefreshCw size={13} /> Reload their version
        </button>
        <button
          onClick={onKeepMine}
          className="px-3 py-1.5 border border-amber-400 text-amber-800 text-xs font-semibold rounded hover:bg-amber-100"
        >
          Keep mine
        </button>
      </div>
    </div>
  );
}
