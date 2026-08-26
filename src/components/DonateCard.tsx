import { Heart } from 'lucide-react';

const DONATE_URL = 'https://github.com/sponsors/jsas';

// Donate page (was a closable card): one blurb, one button. Kept tiny on purpose.
export function DonateCard() {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Heart size={18} className="text-rose-500" />
        <h2 className="text-lg font-bold text-slate-900">Support RE: tired</h2>
      </div>

      <div>
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
