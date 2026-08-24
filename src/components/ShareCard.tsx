import { useState } from 'react';
import { X, Copy, Check, Share2 } from 'lucide-react';

interface ShareCardProps {
  url: string;
  onClose: () => void;
}

// Closable card showing the shareable link for the active plan. The link
// encodes the plan's inputs in the URL fragment (no server) and is built from
// the current origin + path, so it works for anyone who can reach this same
// host:port/path — a hosted deployment, a LAN IP, or localhost on this machine.
export function ShareCard({ url, onClose }: ShareCardProps) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(url).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => {
        // Clipboard blocked (permissions / non-secure context): select for manual copy.
        const el = document.getElementById('share-url-input') as HTMLInputElement | null;
        el?.select();
      },
    );
  };

  return (
    <div className="mb-4 bg-white border border-slate-200 rounded">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <Share2 size={15} className="text-slate-500" />
          <h3 className="text-sm font-semibold text-slate-800">Share this plan</h3>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded" title="Close">
          <X size={15} className="text-slate-500" />
        </button>
      </div>

      <div className="p-4">
        <div className="flex items-center gap-2">
          <input
            id="share-url-input"
            readOnly
            value={url}
            onFocus={(e) => e.target.select()}
            className="flex-1 min-w-0 px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded text-xs text-slate-700 font-mono focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={copy}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded hover:bg-blue-700 shrink-0"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>

        <p className="mt-2.5 text-[11px] text-slate-500 leading-snug">
          The plan's inputs are encoded directly in the link (after the <code>#</code>) — nothing is
          uploaded. Opening it imports a copy as a new "Shared plan" scenario. The link uses the
          current host and path, so it works for anyone who can reach this same address (a hosted
          deployment, a LAN IP, or this machine).
        </p>
      </div>
    </div>
  );
}
