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
        <p className="text-xs text-slate-600 leading-relaxed">
          <p>RE: tired is a free, open-source side project that runs entirely in your browser, sans servers, accounts, or data harvesting. Your privacy — and mine! — are maximally important.</p>
          <p>It’s also mostly built with the help of an AI pair-programmer, which costs a few bucks. But really, I just want all Canadians to think about their money and do something about it!</p>
          <p>Anything left over from donations, after I pay for tokens et al., goes into the accounts this app was built to help optimize.</p>
          <p>So if RE: tired saves you some money, or helps you get a clearer picture of where you’re headed and what you might need to do to get there, I’m blessed to receive a few bucks to that end.</p>
          <p>Maybe you’ll help <em>me</em> retire a few days early. :)</p>
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
