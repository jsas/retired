import { cls } from '../design/tokens';

const DONATE_URL = 'https://github.com/sponsors/jsas';

// The Support page body (BetaPage owns the page title — no heading here):
// a few quiet paragraphs and one ink button. Kept tiny on purpose.
export function DonateCard() {
  return (
    <div className="max-w-lg">
      <div className="space-y-3 text-[13px] leading-relaxed text-slate-600">
        <p>RE: tired is a free, open-source side project that runs entirely in your browser, sans servers, accounts, or data harvesting. Your privacy — and mine! — are maximally important.</p>
        <p>It’s also mostly built with the help of an AI pair-programmer, which costs a few bucks. But really, I just want all Canadians to think about their money and do something about it!</p>
        <p>Anything left over from donations, after I pay for tokens et al., goes into the accounts this app was built to help optimize.</p>
        <p>So if RE: tired saves you some money, or helps you get a clearer picture of where you’re headed and what you might need to do to get there, I’m blessed to receive a few bucks to that end.</p>
        <p>Maybe you’ll help <em>me</em> retire a few days early. :)</p>
      </div>
      <div className="mt-6">
        <a href={DONATE_URL} target="_blank" rel="noreferrer" className={`${cls.primaryBtn} inline-flex items-center`}>
          Sponsor on GitHub
        </a>
      </div>
    </div>
  );
}
