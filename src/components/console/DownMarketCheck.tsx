// The down-market check — the stress test, demoted from the header to one calm
// line. It re-runs the plan at a low "down market" return and reports whether
// the plan still holds. Blue dot = holds even in a down market; rose = it
// doesn't. The map above uses your market dial — move it and the bands change;
// this line is the fixed pessimistic floor under it.
import { useMemo } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import type { RetirementInputs } from '@retired/engine-core/retirementEngine';
import type { AppConfig } from '@retired/engine-core/appConfig';
import { calculateHousehold } from '@retired/engine-core/retirementEngine';
import { BLUE, RED_DOT } from '../../design/tokens';
import { HelpHint } from '../../design/primitives';

/** The down-market return the check stress-tests against (1.2%). */
export const DOWN_MARKET_RETURN = 0.012;

export function DownMarketCheck({ inputs, config }: { inputs: RetirementInputs; config: AppConfig }) {
  const { t } = useTranslation('pages');
  const check = useMemo(() => {
    const r = calculateHousehold({ ...inputs, investmentReturn: DOWN_MARKET_RETURN }, config);
    const holds = r.status === 'ON_TRACK';
    return { holds, depletionAge: r.depletionAge };
    // Recompute when any plan input changes (the whole plan feeds the verdict).
  }, [inputs, config]);

  const pct = (DOWN_MARKET_RETURN * 100).toFixed(1);
  const dial = (inputs.investmentReturn * 100).toFixed(1);
  const dot = check.holds ? BLUE : RED_DOT;

  return (
    <div className="border-l-2 border-slate-200 pl-4">
      <div className="flex items-center gap-2">
        <span className="inline-block h-2 w-2" style={{ backgroundColor: dot }} />
        <span className="text-[13px] font-medium text-slate-700">
          {check.holds ? t('dash.downCheck') : t('dash.downWarn')}
        </span>
        <HelpHint topic="down-market-check" />
      </div>
      <p className="num mt-1.5 text-[11.5px] leading-relaxed text-slate-500">
        {check.holds
          ? <Trans i18nKey="dash.downHolds" ns="pages" values={{ pct, age: inputs.maxAge }} components={{ b: <b /> }} />
          : <Trans i18nKey="dash.downFails" ns="pages" values={{ pct, runsTo: check.depletionAge ?? '—', dial }} components={{ b: <b /> }} />}
      </p>
    </div>
  );
}
