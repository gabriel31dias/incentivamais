// Gráficos do dashboard/relatórios (Recharts) com a paleta Incentiva+ validada
// pelo dataviz (scripts/validate_palette.js): claro e escuro passam em todos os checks.
import { cents, competence, num } from "@/shared/lib/api";
import { useThemeStore } from "@/shared/stores/theme.store";
import type { ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/** slots categóricos em ordem fixa (série 1 = verde da marca, escurecido p/ contraste) */
const SERIES = {
  light: ["#0f9e73", "#2a78d6", "#eb6834", "#6250d6", "#e87ba4"],
  dark: ["#0fae7e", "#3987e5", "#d95926", "#9085e9", "#d55181"],
};
const INK = {
  light: { grid: "#ECEDEF", axis: "#73737D", surface: "#ffffff" },
  dark: { grid: "rgba(255,255,255,0.07)", axis: "#A2A5B3", surface: "#071E24" },
};

export function useChartTheme() {
  const theme = useThemeStore((s) => s.theme);
  return { series: SERIES[theme], ...INK[theme] };
}

export type ValueType = "cents" | "int" | "pct" | "text" | "competence" | "date" | "datetime" | "status";

const compact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });

/** valor completo (tooltip, tabela) */
export const fmt = (v: unknown, type: ValueType = "int") => {
  if (v === null || v === undefined || v === "") return "—";
  if (type === "cents") return cents(Number(v));
  if (type === "pct") return `${(Number(v) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
  if (type === "int") return num(Number(v));
  if (type === "competence") return competence(String(v));
  return String(v);
};

/** valor curto (eixos) */
export const fmtAxis = (v: number, type: ValueType = "int") =>
  type === "cents" ? `R$ ${compact.format(v / 100)}` : type === "pct" ? `${Math.round(v * 100)}%` : compact.format(v);

function TooltipBox({ title, rows }: { title: ReactNode; rows: { label: string; value: string; color?: string }[] }) {
  return (
    <div className="rounded-xl border border-[#E5E7EB] bg-white px-3 py-2 text-xs shadow-lg dark:border-border/40 dark:bg-[#071E24]">
      <p className="mb-1 font-bold text-[#1F1F24] dark:text-white">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="flex items-center gap-2 text-[#52525B] dark:text-[#C9CCD6]">
          {r.color && <span className="h-2 w-2 rounded-full" style={{ background: r.color }} />}
          {r.label}: <b className="text-[#1F1F24] dark:text-white">{r.value}</b>
        </p>
      ))}
    </div>
  );
}

type Series = { key: string; label: string; type?: ValueType };
type Datum = Record<string, unknown>;

const axisProps = (color: string) => ({
  tick: { fill: color, fontSize: 11 },
  axisLine: false,
  tickLine: false,
});

function tooltipContent(series: Series[], colors: string[], xType: ValueType) {
  return ({ active, payload, label }: { active?: boolean; payload?: { payload: Datum }[]; label?: unknown }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    return (
      <TooltipBox
        title={fmt(label ?? d.name, xType)}
        rows={series.map((s, i) => ({ label: s.label, value: fmt(d[s.key], s.type), color: series.length > 1 ? colors[i] : undefined }))}
      />
    );
  };
}

/** legenda só com 2+ séries; série única é nomeada pelo título do painel */
function Legend({ series, colors }: { series: Series[]; colors: string[] }) {
  if (series.length < 2) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-4 text-xs font-semibold text-[#52525B] dark:text-[#C9CCD6]">
      {series.map((s, i) => (
        <span key={s.key} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: colors[i] }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

/** evolução no tempo: área com linha de 2px e crosshair */
export function AreaTrend({ data, x, series, xType = "competence", height = 260, label }: { data: Datum[]; x: string; series: Series[]; xType?: ValueType; height?: number; label: string }) {
  const t = useChartTheme();
  return (
    <div role="img" aria-label={label}>
      <Legend series={series} colors={t.series} />
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 8, right: 24, left: 0, bottom: 0 }}>
          <defs>
            {series.map((s, i) => (
              <linearGradient key={s.key} id={`fill-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={t.series[i]} stopOpacity={0.28} />
                <stop offset="100%" stopColor={t.series[i]} stopOpacity={0.02} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid vertical={false} stroke={t.grid} />
          <XAxis dataKey={x} {...axisProps(t.axis)} tickFormatter={(v) => fmt(v, xType)} />
          <YAxis {...axisProps(t.axis)} width={84} tickFormatter={(v) => fmtAxis(v, series[0].type)} />
          <Tooltip content={tooltipContent(series, t.series, xType) as never} cursor={{ stroke: t.axis, strokeDasharray: "3 3" }} />
          {series.map((s, i) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              stroke={t.series[i]}
              strokeWidth={2}
              fill={`url(#fill-${s.key})`}
              dot={false}
              activeDot={{ r: 5, stroke: t.surface, strokeWidth: 2 }}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** magnitude por categoria no tempo: barras verticais finas, topo arredondado */
export function Bars({ data, x, series, xType = "competence", height = 260, label }: { data: Datum[]; x: string; series: Series[]; xType?: ValueType; height?: number; label: string }) {
  const t = useChartTheme();
  return (
    <div role="img" aria-label={label}>
      <Legend series={series} colors={t.series} />
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 8, right: 24, left: 0, bottom: 0 }} barGap={2}>
          <CartesianGrid vertical={false} stroke={t.grid} />
          <XAxis dataKey={x} {...axisProps(t.axis)} tickFormatter={(v) => fmt(v, xType)} />
          <YAxis {...axisProps(t.axis)} width={84} tickFormatter={(v) => fmtAxis(v, series[0].type)} />
          <Tooltip content={tooltipContent(series, t.series, xType) as never} cursor={{ fill: t.grid }} />
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} fill={t.series[i]} radius={[4, 4, 0, 0]} maxBarSize={32} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** ranking: barras horizontais, rótulo de categoria à esquerda */
export function HBars({
  data,
  x,
  series,
  label,
  reference,
  labelWidth = 150,
}: {
  data: Datum[];
  x: string;
  series: Series[];
  label: string;
  /** linha de referência (ex.: 1 = 100% da meta) */
  reference?: number;
  labelWidth?: number;
}) {
  const t = useChartTheme();
  const height = Math.max(160, data.length * 30 + 30);
  const short = (v: string) => String(v).replace(/^Distribuidora /, "").slice(0, 24);
  return (
    <div role="img" aria-label={label}>
      <Legend series={series} colors={t.series} />
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 28, left: 0, bottom: 0 }} barCategoryGap={6}>
          <CartesianGrid horizontal={false} stroke={t.grid} />
          <XAxis type="number" {...axisProps(t.axis)} tickFormatter={(v) => fmtAxis(v, series[0].type)} />
          <YAxis type="category" dataKey={x} {...axisProps(t.axis)} width={labelWidth} tickFormatter={short} interval={0} />
          <Tooltip content={tooltipContent(series, t.series, "text") as never} cursor={{ fill: t.grid }} />
          {reference !== undefined && <ReferenceLine x={reference} stroke={t.axis} strokeDasharray="4 4" label={{ value: "Meta", fill: t.axis, fontSize: 11, position: "top" }} />}
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} fill={t.series[i]} radius={[0, 4, 4, 0]} maxBarSize={20} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
