import { useState } from 'react';

/**
 * Single-series daily bars (sign-ups, sales). Follows the dataviz guide: one brand hue (a single
 * series needs no legend — the title names it), thin bars with 4px rounded tops anchored to the
 * baseline, a 2px gap between bars, recessive baseline, hover tooltip with a hit target larger
 * than the mark, and a table view for screen readers.
 */
export interface DailyPoint {
  day: string; // YYYY-MM-DD
  value: number;
}

const dayLabel = (iso: string) => {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
};

/** Fills missing days with zero so the time axis is continuous. */
export function lastDays(points: DailyPoint[], days: number, today = new Date()): DailyPoint[] {
  const byDay = new Map(points.map((p) => [p.day, p.value]));
  const result: DailyPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86_400_000);
    const key = d.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    result.push({ day: key, value: byDay.get(key) ?? 0 });
  }
  return result;
}

export function DailyBars({
  title,
  points,
  format = (v) => v.toLocaleString('pt-BR'),
}: {
  title: string;
  points: DailyPoint[];
  format?: (value: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 600;
  const height = 160;
  const pad = { top: 8, bottom: 22 };
  const plotH = height - pad.top - pad.bottom;
  const max = Math.max(1, ...points.map((p) => p.value));
  const slot = width / Math.max(1, points.length);
  const barW = Math.max(2, slot - 2); // 2px surface gap between bars
  const total = points.reduce((a, p) => a + p.value, 0);
  const active = hover !== null ? points[hover] : null;

  return (
    <figure className="m-0">
      <figcaption className="mb-2 flex items-baseline justify-between gap-2">
        <span className="font-semibold">{title}</span>
        <span className="text-sm text-muted">
          {active ? `${dayLabel(active.day)}: ${format(active.value)}` : `Total: ${format(total)}`}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-40 w-full"
        role="img"
        aria-label={`${title}, últimos ${points.length} dias`}
      >
        {points.map((p, i) => {
          const h = p.value === 0 ? 0 : Math.max(3, (p.value / max) * plotH);
          const x = i * slot + 1;
          const y = pad.top + plotH - h;
          const r = Math.min(4, barW / 2, h);
          return (
            <g key={p.day} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              {/* Hit target: the whole column, larger than the bar. */}
              <rect
                x={i * slot}
                y={0}
                width={slot}
                height={height - pad.bottom}
                fill="transparent"
              />
              {h > 0 && (
                <path
                  d={`M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + barW - r} Q${x + barW},${y} ${x + barW},${y + r} V${y + h} Z`}
                  fill="var(--primary)"
                  opacity={hover === null || hover === i ? 1 : 0.45}
                />
              )}
            </g>
          );
        })}
        <line
          x1={0}
          x2={width}
          y1={pad.top + plotH}
          y2={pad.top + plotH}
          stroke="var(--border)"
          strokeWidth={1}
        />
        {points.length > 0 && (
          <>
            <text x={0} y={height - 6} fontSize={11} fill="var(--muted)">
              {dayLabel(points[0]!.day)}
            </text>
            <text x={width} y={height - 6} fontSize={11} fill="var(--muted)" textAnchor="end">
              {dayLabel(points.at(-1)!.day)}
            </text>
          </>
        )}
      </svg>
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Dia</th>
            <th scope="col">Valor</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.day}>
              <td>{dayLabel(p.day)}</td>
              <td>{format(p.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** Headline number (the "not a chart" form for a single figure). */
export function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-ui border border-border bg-surface p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      {hint && <p className="text-sm text-muted">{hint}</p>}
    </div>
  );
}

/** Usage against a plan limit; text carries the numbers, the bar only reinforces. */
export function UsageBar({
  label,
  used,
  limit,
}: {
  label: string;
  used: number;
  limit: number | null;
}) {
  const pct = limit === null || limit === 0 ? 0 : Math.min(100, Math.round((used / limit) * 100));
  const full = limit !== null && used >= limit;
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted">
          {used} de {limit === null ? 'ilimitado' : limit}
          {full && <span className="ml-2 font-semibold text-danger">limite atingido</span>}
        </span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-surface-2" aria-hidden>
        {limit !== null && (
          <div
            className={`h-2 rounded-full ${full ? 'bg-danger' : 'bg-primary'}`}
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
    </div>
  );
}
