import { useState } from 'react';
import { Save, AlertTriangle } from 'lucide-react';

interface SavePromptModalProps {
  scenarioName: string;
  /** Save the edits, then switch. */
  onSave: (dontAskAgain: boolean) => void;
  /** Discard the edits and switch. */
  onDiscard: (dontAskAgain: boolean) => void;
  /** Stay on the current plan (no switch). */
  onCancel: () => void;
}

/**
 * Shown when the user tries to switch plans with unsaved edits. Offers
 * save-and-switch / discard-and-switch / stay, plus a "don't ask again" box
 * that flips the General setting off (the opt-out the setting controls).
 */
export function SavePromptModal({ scenarioName, onSave, onDiscard, onCancel }: SavePromptModalProps) {
  const [dontAskAgain, setDontAskAgain] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" role="dialog" aria-modal="true" aria-labelledby="save-prompt-title">
      <div className="bg-white rounded-lg shadow-xl border border-slate-200 w-full max-w-sm mx-4 p-5">
        <div className="flex items-start gap-3 mb-3">
          <AlertTriangle size={20} className="text-amber-500 shrink-0 mt-0.5" />
          <div>
            <h2 id="save-prompt-title" className="text-sm font-bold text-slate-900">Unsaved changes</h2>
            <p className="text-[13px] text-slate-600 mt-1 leading-snug">
              <span className="font-medium text-slate-800">{scenarioName}</span> has edits you haven't saved. Save them before switching?
            </p>
          </div>
        </div>

        <label className="flex items-center gap-2 text-[12px] text-slate-600 cursor-pointer mb-4 ml-1">
          <input type="checkbox" checked={dontAskAgain} onChange={e => setDontAskAgain(e.target.checked)} />
          Don't ask again (turn this off in Settings → General)
        </label>

        <div className="flex flex-col gap-2">
          <button
            onClick={() => onSave(dontAskAgain)}
            className="flex items-center justify-center gap-2 w-full px-3 py-2 bg-blue-600 text-white text-sm font-semibold rounded-md hover:bg-blue-700"
          >
            <Save size={15} /> Save &amp; switch
          </button>
          <button
            onClick={() => onDiscard(dontAskAgain)}
            className="w-full px-3 py-2 text-sm font-medium text-red-600 border border-red-200 rounded-md hover:bg-red-50"
          >
            Discard &amp; switch
          </button>
          <button
            onClick={onCancel}
            className="w-full px-3 py-2 text-sm text-slate-600 hover:text-slate-900"
          >
            Stay here
          </button>
        </div>
      </div>
    </div>
  );
}
