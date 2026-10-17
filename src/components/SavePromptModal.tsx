import { useState } from 'react';
import { Save, AlertTriangle } from 'lucide-react';
import { Modal, Check } from '../design/primitives';
import { cls } from '../design/tokens';

interface SavePromptModalProps {
  scenarioName: string;
  /** Save the edits, then switch. */
  onSave: (dontAskAgain: boolean) => void;
  /** Discard the edits and switch. */
  onDiscard: (dontAskAgain: boolean) => void;
  /** Stay on the current scenario (no switch). */
  onCancel: () => void;
}

/**
 * Shown when the user tries to switch scenarios with unsaved edits. Offers
 * save-and-switch / discard-and-switch / stay, plus a "don't ask again" box
 * that flips the General setting off (the opt-out the setting controls).
 */
export function SavePromptModal({ scenarioName, onSave, onDiscard, onCancel }: SavePromptModalProps) {
  const [dontAskAgain, setDontAskAgain] = useState(false);

  return (
    <Modal open onClose={onCancel} title="Unsaved changes">
      <div className="flex items-start gap-3 mb-3">
        <AlertTriangle size={20} className="text-amber-500 shrink-0 mt-0.5" />
        <p className="text-[13px] text-slate-600 leading-snug">
          <span className="font-medium text-slate-800">{scenarioName}</span> has edits you haven't saved. Save them before switching?
        </p>
      </div>

      <div className="mb-4 ml-1">
        <Check size={12} checked={dontAskAgain} onChange={setDontAskAgain}
          label={<span className="text-[12px] text-slate-600">Don't ask again (turn this off in Settings → General)</span>} />
      </div>

      <div className="flex flex-col gap-2">
        <button
          onClick={() => onSave(dontAskAgain)}
          className={`flex items-center justify-center gap-2 ${cls.primaryBtn}`}
        >
          <Save size={15} /> Save &amp; switch
        </button>
        <button
          onClick={() => onDiscard(dontAskAgain)}
          className="w-full px-3 py-2 text-sm font-medium text-rose-700 border border-slate-300 hover:border-rose-400"
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
    </Modal>
  );
}
