/**
 * Step 3. Before any change: the model's order times next to the measured
 * ones, on orders it did not learn from, and the error as one number.
 */
import { describeTrustError, formatPercent, type TrustResult } from "../../core";
import { firstRunProblem, trust } from "../state/derive";
import { palette } from "../theme/tokens";

const ROW = 30;
const LEFT = 52;
const WIDTH = 440;

function niceMax(v: number): number {
  const step = v > 60 ? 20 : v > 30 ? 10 : 5;
  return Math.ceil(v / step) * step;
}

function Pairs(props: { readonly result: TrustResult }) {
  const r = props.result;
  const index = new Map(r.run.orders.map((o, i) => [o.orderId, i + 1] as const));
  const max = niceMax(Math.max(1, ...r.pairs.flatMap((p) => [p.measuredS, p.modelS])));
  const x = (s: number) => LEFT + (s / max) * (WIDTH - LEFT - 12);
  const height = r.pairs.length * ROW + 34;
  const step = max > 60 ? 20 : max > 30 ? 10 : 5;
  const ticks = Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step);
  return (
    <div class="st-pairs" data-testid="trust-pairs">
      <svg viewBox={`0 0 ${WIDTH} ${height}`} role="img" aria-label="Order times, measured and model, for each checked order">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={4} y2={height - 26} stroke={palette.floorLine} stroke-width="1.5" />
            <text x={x(t)} y={height - 6} text-anchor="middle" font-size="15" font-weight="700" fill={palette.inkSoft}>
              {t} s
            </text>
          </g>
        ))}
        {r.pairs.map((p, i) => {
          const y = 18 + i * ROW;
          return (
            <g key={p.orderId}>
              <text x={0} y={y + 5} font-size="16" font-weight="800" fill={palette.ink}>
                #{index.get(p.orderId) ?? "?"}
              </text>
              <line x1={x(p.measuredS)} x2={x(p.modelS)} y1={y} y2={y} stroke={palette.inkSoft} stroke-width="2" />
              <circle cx={x(p.measuredS)} cy={y} r="8" fill={palette.ink} />
              <circle cx={x(p.modelS)} cy={y} r="7" fill={palette.paper} stroke={palette.path} stroke-width="3.5" />
            </g>
          );
        })}
      </svg>
      <div class="st-legend">
        <span>
          <i style={{ background: palette.ink }} />
          Measured
        </span>
        <span>
          <i style={{ background: palette.paper, boxShadow: `inset 0 0 0 3px ${palette.path}` }} />
          Model
        </span>
      </div>
    </div>
  );
}

export function TrustRail() {
  const t = trust.value;
  if (!t) return <div class="st-card"><h1>Can we trust the model?</h1><p class="st-note">{firstRunProblem.value}</p></div>;
  if (!t.ok) return <div class="st-card"><h1>Can we trust the model?</h1><p class="st-warn">{t.message}</p></div>;
  const r = t.value;
  return (
    <div class="st-card">
      <h1>Can we trust the model?</h1>
      <p class="st-lede">Time per order, for the orders the model never saw.</p>
      <div class="st-num">
        <span class="what">Model error</span>
        <span class="value">
          <span data-testid="trust-error">{r.errorPct === null ? "—" : formatPercent(r.errorPct)}</span>
        </span>
        <p class="st-say" data-testid="trust-words">
          {describeTrustError(r.errorPct)}
        </p>
      </div>
      {r.pairs.length > 0 ? <Pairs result={r} /> : null}
      <p class="st-small">
        Learned from every other order, checked on the rest ({r.calibratedOn.length} learned, {r.checkedOn.length} checked).
      </p>
      {r.caveat ? <p class="st-note">{r.caveat}</p> : null}
    </div>
  );
}
