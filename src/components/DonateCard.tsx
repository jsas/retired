import { X, Heart } from 'lucide-react';

const DONATE_URL = 'https://github.com/sponsors/jsas';

// Closable card explaining what donations support, opened from the top-bar
// Donate button. Kept tiny on purpose: one blurb, one button.
export function DonateCard({ onClose }: { onClose: () => void }) {
  return (
    <div className="mb-4 bg-white border border-slate-200 rounded">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <Heart size={15} className="text-rose-500" />
          <h3 className="text-sm font-semibold text-slate-800">Support RE: tired</h3>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded" title="Close">
          <X size={15} className="text-slate-500" />
        </button>
      </div>

      <div className="p-4">
        <p className="text-xs text-slate-600 leading-relaxed max-w-xl">
          RE: tired is a free, open-source side project that runs entirely in your browser — no
          server, no accounts, no data harvesting. It's also largely built by an AI pair-programmer,
          and those tokens aren't free. So, full honesty: donations pay for more tokens to keep the
          features coming, cover the domain and hosting, keep the tax tables current each year… and
          if there's anything left over, it goes into the very RRSP this app was built to optimize.
          Help me retire a few days earlier — the irony is included at no extra charge.
        </p>
        <div className="mt-3">
          <a
            href={DONATE_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 text-white text-xs font-semibold rounded hover:bg-rose-700"
          >
            <Heart size={13} /> Sponsor on GitHub
          </a>
        </div>
      </div>
    </div>
  );
}
