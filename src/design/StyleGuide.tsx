/**
 * The living style guide. Renders every token and primitive from
 * ./tokens and ./primitives so the documentation can never drift from the
 * code — the swatches ARE the constants, the examples ARE the components.
 * Reachable in dev at #/styleguide (beta only). See STYLEGUIDE.md for prose.
 */
import { useState } from 'react';
import * as T from './tokens';
import {
  Fader, Chip, VerdictHero, Panel, Stat, AccountBars, Legend, Dropdown, Footnote,
  HelpHint, Dot, Progress, Modal,
} from './primitives';
import { ProjectionTimeline } from './ProjectionTimeline';

// A plausible-looking demo plan for the ProjectionTimeline example: a saver
// who retires at 65 and depletes at 94. Straight-line shapes — enough to show
// the area, axis, pins, and overlays; the engine draws the real ones.
const demoSeries = Array.from({ length: 50 }, (_, i) => {
  const a = 45 + i;
  const v = a < 65 ? 300_000 + ((a - 45) / 20) * 800_000 : 1_100_000 * ((94 - a) / 29);
  return { age: a, value: Math.max(0, v) };
});
const demoSpend = demoSeries.map(p => ({ age: p.age, value: 72_000 }));

function Swatch({ name, value, note }: { name: string; value: string; note?: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-slate-100 py-2">
      <span className="h-8 w-8 shrink-0 border border-slate-200" style={{ backgroundColor: value }} />
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-slate-900">{name}</div>
        <div className="num text-[11px] text-slate-500">{value}{note ? ` — ${note}` : ''}</div>
      </div>
    </div>
  );
}

function Rule({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-slate-100 py-3">
      <div className="flex items-baseline gap-3">
        <span className="num text-[11px] font-semibold text-slate-400">{String(n).padStart(2, '0')}</span>
        <h3 className="text-[14px] font-semibold text-slate-900">{title}</h3>
      </div>
      <p className="mt-1 pl-8 text-[12.5px] leading-relaxed text-slate-600">{children}</p>
    </div>
  );
}

export function StyleGuide() {
  const [spend, setSpend] = useState(85000);
  const [age, setAge] = useState(62);
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen bg-white text-slate-800">
      <header className="border-b border-slate-200">
        <div className="mx-auto flex h-12 max-w-3xl items-center gap-3 px-4">
          <span className="flex h-6 w-6 items-center justify-center bg-slate-900 text-[10px] font-bold text-white">RE:</span>
          <span className="text-[13px] font-semibold text-slate-900">Style guide</span>
          <span className="text-[11px] text-slate-400">the source of truth — every swatch and example is live code</span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-24">

        <VerdictHero
          eyebrow="Principles"
          verdict="Flat, hairline, one accent."
          sub="The design gets out of the way of the number. Structure comes from thin rules and type weight, not boxes. Colour is reserved for the verdict — everything else is slate."
        />

        <Panel label="The rules">
          <Rule n={1} title="Verdict first">
            Every screen answers the question before it asks anything. One sentence,
            plain English, the largest text on the page. Controls come after the answer.
          </Rule>
          <Rule n={2} title="Flat — no shadows, no rounded corners">
            Depth is a lie the data doesn't need. Components are separated by 1px
            borders and whitespace only. Leave browser-default corner radii alone.
          </Rule>
          <Rule n={3} title="Hairlines, not cards">
            Group with a bottom border and an uppercase label (see this panel). Never
            wrap content in a filled or bordered box to make it feel "contained".
          </Rule>
          <Rule n={4} title="One accent, used semantically">
            Blue means the plan holds. Red means it runs out early. Amber appears only
            for the borderline case. Never use all three as decoration — it's not a
            traffic light, it's a verdict.
          </Rule>
          <Rule n={5} title="Numbers are tabular and right-sized">
            Any figure the user compares across states gets the <code>num</code> class
            (tabular-nums) so it doesn't jitter. Money and ages are always monospace-aligned.
          </Rule>
          <Rule n={6} title="Touch is first-class">
            Sliders get a 24px hit strip; draggable surfaces use pointer events with
            capture and <code>touch-action: none</code>. If a finger can't hit it, it ships broken.
          </Rule>
        </Panel>

        <Panel label="Colour">
          <div className="grid gap-x-8 sm:grid-cols-2">
            <div>
              <Swatch name="Blue — holds" value={T.BLUE} note="verdict, boundary, dot" />
              <Swatch name="Blue deep — wash end" value={T.BLUE_DEEP} note="contour fill" />
              <Swatch name="Red — runs out" value={T.RED_TEXT} note="short verdict text" />
              <Swatch name="Red dot" value={T.RED_DOT} note="dot / chip when short" />
              <Swatch name="Amber — borderline" value={T.AMBER_TEXT} note="only the edge case" />
            </div>
            <div>
              <Swatch name="Ink" value={T.INK} note="headings, primary buttons" />
              <Swatch name="Body" value={T.BODY} note="body text" />
              <Swatch name="Muted" value={T.MUTED} note="secondary text" />
              <Swatch name="Faint" value={T.FAINT} note="captions, axes" />
              <Swatch name="Hairline" value={T.HAIRLINE} note="1px structural border" />
            </div>
          </div>
        </Panel>

        <Panel label="Primitives — live">
          <VerdictHero
            verdict="Your money lasts to 95."
            sub="Spending $85,000 a year from 62. The dot sits below the boundary."
          />
          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <Fader label="Stop working at" value={age} min={55} max={75} step={1}
              format={(v) => `${v}`} onChange={setAge}
              hint="Working one more year moves the boundary." />
            <Fader label="Spend a year" value={spend} min={40000} max={160000} step={1000}
              format={(v) => '$' + v.toLocaleString('en-CA')} onChange={setSpend}
              hint="$5,000 less a year and it lasts past the plan." />
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <Chip tone="holds" title="Down-market check">Even at 1.2% this plan holds to 95.</Chip>
            <Chip tone="short" title="Down-market warning">At 1.2% the money runs out at 80.</Chip>
            <Chip tone="borderline" title="Borderline">Runs out at 91 — four years short of 95.</Chip>
          </div>

          <div className="mt-8 grid grid-cols-2 gap-5 border-t border-slate-100 pt-6 md:grid-cols-4">
            <Stat label="Money lasts to" value="95" note="past the plan" tone="holds" />
            <Stat label="Left at 95" value="$0" note="the pot is empty" />
            <Stat label="In the pot at work's end" value="$1.1M" note="after the saving years" />
            <Stat label="Runs out at" value="89" note="six years short" tone="short" />
          </div>

          <div className="mt-8 border-t border-slate-100 pt-6">
            <AccountBars total={850000} rows={[
              { label: 'RRSP', value: 442000 },
              { label: 'TFSA', value: 263000, active: true },
              { label: 'Taxable', value: 145000 },
            ]} />
          </div>

          <div className="mt-8 border-t border-slate-100 pt-6">
            <Legend items={[
              { swatch: 'line-blue', label: 'the boundary — where the plan stops holding' },
              { swatch: 'box-blue', label: 'below it, the money lasts past 95' },
              { swatch: 'box-rose', label: 'above it, it runs out early' },
            ]} />
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-6">
            <button className={T.cls.primaryBtn}>Save plan</button>
            <button className={T.cls.hairlineBtn}>Compare scenarios</button>
            <input className={T.cls.input} placeholder="Type an amount…" />
            <Dropdown label="Details">
              <div className="px-2 py-1 text-[12px] text-slate-600">Spouse · pensions · cash events · withdrawal order…</div>
            </Dropdown>
            <span className="text-[12px] text-slate-500">
              The small <HelpHint topic="withdrawal-order" /> sits at the end of a label — tap it for the short answer, follow through to Help.
            </span>
          </div>

          <div className="mt-8 space-y-4 border-t border-slate-100 pt-6">
            <div>
              <p className={T.cls.sectionLabel}>Square dot, progress, modal — no round corners, no shadows</p>
              <div className="mt-2 flex items-center gap-4">
                <span className="flex items-center gap-1.5 text-[12px] text-slate-600"><Dot color={T.BLUE} title="holds" /> a status dot</span>
                <span className="flex items-center gap-1.5 text-[12px] text-slate-600"><Dot color={T.RED_DOT} title="short" /> short</span>
                <span className="flex items-center gap-1.5 text-[12px] text-slate-600"><Dot color={T.AMBER_DOT} title="borderline" /> borderline</span>
              </div>
            </div>
            <Progress pct={62} />
            <div>
              <button className={T.cls.hairlineBtn} onClick={() => setOpen(true)}>open the flat modal</button>
              <Modal open={open} onClose={() => setOpen(false)} title="A flat dialog">
                <p className="text-[12.5px] text-slate-600">A hairline border, no rounded corners, no shadow — the shell every dialog composes.</p>
              </Modal>
            </div>
          </div>

          <div className="mt-8 border-t border-slate-100 pt-6">
            <p className={T.cls.sectionLabel}>ProjectionTimeline — every money-over-age chart</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-slate-600">
              One chart for the portfolio line: soft area-fill, clean axis, hairline year
              ticks, token colours, labelled pins. Dashboard, steering, projection view,
              and Compare all compose it. Legend entries toggle their line.
            </p>
            <div className="mt-3">
              <ProjectionTimeline
                series={[{ id: 'plan', label: 'portfolio', color: T.INK, area: true, points: demoSeries }]}
                overlays={[
                  { id: 'spend', label: 'spend', color: T.AMBER_DOT, points: demoSpend, dash: true },
                ]}
                pins={[
                  { age: 45, label: 'you · 45', place: 'below', anchor: 'start', color: T.INK },
                  { age: 65, label: 'work ends · 65', color: '#475569' },
                  { age: 94, label: 'runs out · 94', color: T.RED_DOT },
                ]}
                marker={{ age: 65, style: 'dot' }}
              />
            </div>
          </div>

          <Footnote>
            Educational modeling — not financial, tax, or investment advice. Data stays in this browser.
          </Footnote>
        </Panel>

        <Panel label="Type scale">
          <div className="space-y-3">
            <p className="num text-[28px] font-semibold text-slate-900">Your money runs out at 89. <span className="text-slate-400 text-[13px] font-normal">verdict · 28</span></p>
            <p className={T.cls.sectionLabel}>The ground your plan stands on <span className="normal-case tracking-normal text-slate-300">section · 11</span></p>
            <p className="text-[13.5px] text-slate-600">The boundary is the spending where the plan stops holding. <span className="text-slate-400 text-[11px]">body · 13.5</span></p>
            <p className="text-[11px] text-slate-400">Drag the dot, or use the faders. <span>caption · 11</span></p>
          </div>
        </Panel>

        <p className="mt-8 text-[11px] text-slate-400">
          This page renders only code from <code>src/design/</code>. If a rule or swatch is wrong,
          the fix belongs in tokens.ts or primitives.tsx — not here.
        </p>
      </main>
    </div>
  );
}
