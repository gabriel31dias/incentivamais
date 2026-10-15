import {
  card,
  EmptyState,
  fieldClass,
  Panel,
  primaryButton,
  secondaryButton,
  Skeleton,
  STATUS,
  StatusBadge,
  Tabs,
} from "@/shared/components/kit";
import { Pagination } from "@/shared/components/Pagination";
import { api, competence, downloadCsv, formatDate, formatDay, num, useLookups } from "@/shared/lib/api";
import { toast } from "@/shared/lib/toast";
import { cn } from "@/shared/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ArrowUpDown, BarChart3, Download, ExternalLink, FileSpreadsheet, Table2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AreaTrend, Bars, fmt, HBars, type ValueType } from "../dashboard/charts";

type Row = Record<string, string | number | null>;
type Col = { key: string; label: string; type: ValueType };
export interface Report {
  title: string;
  views?: { key: string; label: string }[];
  view?: string;
  columns: Col[];
  rows: Row[];
  chart?: { type: "area" | "bar" | "hbar"; x: string; series: { key: string; label: string; type: ValueType }[] };
  filters: ("period" | "distributor" | "campaign")[];
  truncated?: boolean;
}

const MONTHS = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12"];
const PER_PAGE = 25;

/** texto exportado: mesmo formato da tela (status traduzido, valores em pt-BR) */
const exportValue = (v: Row[string], type: ValueType) =>
  type === "status" ? STATUS[String(v)]?.[0] ?? v : type === "datetime" ? formatDate(String(v ?? "")) : type === "date" ? formatDay(String(v ?? "")) : fmt(v, type);

export const toCsvRows = (r: Report) => r.rows.map((row) => Object.fromEntries(r.columns.map((c) => [c.label, exportValue(row[c.key], c.type)])));

function Cell({ value, type }: { value: Row[string]; type: ValueType }) {
  if (type === "status") return value ? <StatusBadge status={String(value)} /> : <>—</>;
  if (type === "datetime") return <>{formatDate(value ? String(value) : null)}</>;
  if (type === "date") return <>{formatDay(value ? String(value) : null)}</>;
  return <>{fmt(value, type)}</>;
}

const numeric = (t: ValueType) => t === "int" || t === "cents" || t === "pct";

function ReportTable({ report }: { report: Report }) {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const rows = useMemo(() => {
    if (!sort) return report.rows;
    return [...report.rows].sort((a, b) => {
      const x = a[sort.key] ?? "";
      const y = b[sort.key] ?? "";
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "pt-BR")) * sort.dir;
    });
  }, [report.rows, sort]);
  const last = Math.max(1, Math.ceil(rows.length / PER_PAGE));
  const shown = rows.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  if (!rows.length) return <EmptyState title="Sem dados para os filtros escolhidos" />;
  return (
    <div className={cn(card, "overflow-hidden")}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-[#E5E7EB] bg-[#FBFBFC] text-left text-xs font-bold uppercase tracking-wide text-[#73737D] dark:border-border/40 dark:bg-white/[0.02] dark:text-muted-foreground">
              {report.columns.map((c) => (
                <th key={c.key} scope="col" className={cn("px-4 py-3.5", numeric(c.type) && "text-right")} aria-sort={sort?.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
                  <button
                    className="inline-flex items-center gap-1 uppercase hover:text-[#00A876] dark:hover:text-[#00E6A0]"
                    onClick={() => {
                      setSort({ key: c.key, dir: sort?.key === c.key && sort.dir === -1 ? 1 : -1 });
                      setPage(1);
                    }}
                  >
                    {c.label}
                    {sort?.key === c.key ? sort.dir === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" /> : <ArrowUpDown className="h-3 w-3 opacity-50" />}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E5E7EB] dark:divide-border/40">
            {shown.map((row, i) => (
              <tr key={String(row.id ?? i)} className="text-[#52525B] transition-colors hover:bg-[#00E6A0]/5 dark:text-[#C9CCD6]">
                {report.columns.map((c, ci) => (
                  <td
                    key={c.key}
                    className={cn("whitespace-nowrap px-4 py-3", numeric(c.type) && "text-right tabular-nums", ci === 0 && "font-bold text-[#1F1F24] dark:text-white", c.key === "name" && "font-bold text-[#1F1F24] dark:text-white")}
                  >
                    <Cell value={row[c.key]} type={c.type} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#E5E7EB] px-4 py-1 dark:border-border/40">
        <span className="text-xs font-medium text-[#73737D] dark:text-muted-foreground">
          {num(rows.length)} linha(s){report.truncated && " · limitado a 5.000"}
        </span>
        {last > 1 && <Pagination currentPage={page} totalPages={last} onPageChange={setPage} />}
      </div>
    </div>
  );
}

function ReportChart({ report }: { report: Report }) {
  const ch = report.chart;
  if (!ch || !report.rows.length) return null;
  const label = `${report.title}: ${ch.series.map((s) => s.label).join(", ")}`;
  // ranking: só os 15 primeiros no gráfico; a tabela tem todos
  const data = ch.type === "hbar" ? [...report.rows].sort((a, b) => Number(b[ch.series[0].key] ?? 0) - Number(a[ch.series[0].key] ?? 0)).slice(0, 15) : report.rows;
  const xType: ValueType = report.columns.find((c) => c.key === ch.x)?.type ?? "text";
  return (
    <Panel title={ch.type === "hbar" ? `${ch.series[0].label} — top ${data.length}` : ch.series[0].label} icon={<BarChart3 className="h-4 w-4" />}>
      {ch.type === "area" && <AreaTrend label={label} data={data} x={ch.x} xType={xType} series={ch.series} />}
      {ch.type === "bar" && <Bars label={label} data={data} x={ch.x} xType={xType} series={ch.series} />}
      {ch.type === "hbar" && <HBars label={label} data={data} x={ch.x} series={ch.series} labelWidth={180} reference={ch.series[0].type === "pct" ? 1 : undefined} />}
    </Panel>
  );
}

function ReportView({ kind }: { kind: string }) {
  const lookups = useLookups();
  const [f, setF] = useState({ view: "", from: "2026-01", to: "2026-09", distributorId: "", campaignId: "" });
  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ["report", kind, f],
    queryFn: () => api.get<Report>(`/reports/${kind}`, f),
    placeholderData: (p) => p,
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const has = (x: Report["filters"][number]) => data?.filters.includes(x);

  if (isError) return <EmptyState title="Não foi possível carregar o relatório.">{(error as Error).message}</EmptyState>;
  if (isLoading || !data)
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 rounded-2xl" />
        <Skeleton className="h-72 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    );

  return (
    <div className={cn("space-y-5 transition-opacity", isFetching && "opacity-70")}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-wrap items-end gap-3">
          {data.views && (
            <Tabs tabs={data.views.map((v) => ({ value: v.key, label: v.label }))} value={data.view ?? data.views[0].key} onChange={(view) => setF({ ...f, view })} />
          )}
          {has("period") && (
            <>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-[#73737D] dark:text-muted-foreground">De</span>
                <select className={cn(fieldClass, "w-36")} value={f.from} onChange={set("from")}>
                  {MONTHS.filter((m) => m <= f.to).map((m) => (
                    <option key={m} value={m}>{competence(m)}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-[#73737D] dark:text-muted-foreground">Até</span>
                <select className={cn(fieldClass, "w-36")} value={f.to} onChange={set("to")}>
                  {MONTHS.filter((m) => m >= f.from).map((m) => (
                    <option key={m} value={m}>{competence(m)}</option>
                  ))}
                </select>
              </label>
            </>
          )}
          {has("distributor") && (
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-[#73737D] dark:text-muted-foreground">Distribuidora</span>
              <select className={cn(fieldClass, "w-56")} value={f.distributorId} onChange={set("distributorId")}>
                <option value="">Todas</option>
                {lookups.data?.distributors.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </label>
          )}
          {has("campaign") && (
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-[#73737D] dark:text-muted-foreground">Campanha</span>
              <select className={cn(fieldClass, "w-52")} value={f.campaignId} onChange={set("campaignId")}>
                <option value="">Todas</option>
                {lookups.data?.campaigns.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        <button
          className={primaryButton}
          disabled={!data.rows.length}
          onClick={() => {
            downloadCsv(`relatorio-${kind}${data.view ? `-${data.view}` : ""}.csv`, toCsvRows(data));
            toast.success(`${num(data.rows.length)} linha(s) exportadas em CSV`);
          }}
        >
          <Download className="h-4 w-4" />
          Exportar CSV
        </button>
      </div>

      <ReportChart report={data} />
      <section aria-label={`Tabela: ${data.title}`} className="space-y-2">
        <h2 className="flex items-center gap-2 text-base font-bold text-[#1F1F24] dark:text-white">
          <Table2 className="h-4 w-4 text-[#00A876] dark:text-[#00E6A0]" />
          {data.title}
        </h2>
        <ReportTable key={`${kind}-${data.view}`} report={data} />
      </section>
    </div>
  );
}

/** catálogo de exportações: cada item baixa o CSV direto da API */
const EXPORTS: { kind: string; view?: string; label: string; description: string; page?: string }[] = [
  { kind: "vendas", view: "periodo", label: "Vendas por período", description: "Valor, unidades, notas e pontos por competência.", page: "/relatorios/vendas" },
  { kind: "vendas", view: "distribuidora", label: "Vendas por distribuidora", description: "Totais de 2026 por distribuidora.", page: "/relatorios/vendas" },
  { kind: "vendas", view: "vendedor", label: "Vendas por vendedor", description: "Até 5.000 vendedores, ordenados por valor.", page: "/relatorios/vendas" },
  { kind: "desempenho", view: "gerentes", label: "Desempenho dos gerentes", description: "Vendas da equipe vs meta no último mês.", page: "/relatorios/desempenho" },
  { kind: "desempenho", view: "metas", label: "Metas atingidas", description: "Situação da meta de cada equipe.", page: "/relatorios/desempenho" },
  { kind: "pontuacao", view: "mensal", label: "Pontos creditados e estornados", description: "Créditos, bônus, ajustes, estornos e débitos por mês.", page: "/relatorios/pontuacao" },
  { kind: "pontuacao", view: "lancamentos", label: "Estornos, ajustes e bônus", description: "Lançamentos não automáticos com justificativa.", page: "/relatorios/pontuacao" },
  { kind: "distribuidoras", label: "Distribuidoras", description: "Vendedores, equipes, vendas, pontos e último envio.", page: "/relatorios/distribuidoras" },
  { kind: "campanhas", label: "Campanhas", description: "Vendas no período de cada campanha vs meta.", page: "/relatorios/campanhas" },
  { kind: "rankings", view: "vendedores", label: "Ranking de vendedores", description: "Top 100 por pontos.", page: "/relatorios/rankings" },
  { kind: "rankings", view: "equipes", label: "Ranking de equipes", description: "Top 100 equipes por pontos.", page: "/relatorios/rankings" },
  { kind: "importacoes", label: "Importações", description: "Lotes enviados, válidos, inválidos e status." },
  { kind: "treinamentos", label: "Treinamentos", description: "Inscritos, concluintes e taxa de conclusão." },
  { kind: "premiacoes", label: "Premiações", description: "Catálogo de prêmios e solicitações de resgate." },
];

function ExportsView() {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (e: (typeof EXPORTS)[number]) => {
    const id = `${e.kind}-${e.view ?? ""}`;
    setBusy(id);
    try {
      const report = await api.get<Report>(`/reports/${e.kind}`, { view: e.view, from: "2026-01", to: "2026-12" });
      if (!report.rows.length) return toast.info("Nada para exportar.");
      downloadCsv(`relatorio-${id.replace(/-$/, "")}.csv`, toCsvRows(report));
      toast.success(`${e.label}: ${num(report.rows.length)} linha(s) exportadas`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-[#73737D] dark:text-muted-foreground">
        Exportações em CSV (separador “;”, abre direto no Excel). Respeitam o seu escopo de acesso; período padrão: 2026 inteiro.
      </p>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {EXPORTS.map((e) => {
          const id = `${e.kind}-${e.view ?? ""}`;
          return (
            <div key={id} className={cn(card, "flex flex-col gap-3 p-5")}>
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#00E6A0]/10 text-[#00A876] dark:text-[#00E6A0]">
                  <FileSpreadsheet className="h-5 w-5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <h2 className="font-bold text-[#1F1F24] dark:text-white">{e.label}</h2>
                  <p className="text-sm text-[#73737D] dark:text-muted-foreground">{e.description}</p>
                </div>
              </div>
              <div className="mt-auto flex flex-wrap gap-2">
                <button className={primaryButton} disabled={busy === id} onClick={() => run(e)}>
                  <Download className="h-4 w-4" />
                  {busy === id ? "Gerando..." : "Exportar CSV"}
                </button>
                {e.page && (
                  <Link to={e.page} className={secondaryButton}>
                    <ExternalLink className="h-4 w-4" />
                    Abrir
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ReportsPage() {
  const { kind = "vendas" } = useParams();
  return kind === "exportacoes" ? <ExportsView /> : <ReportView key={kind} kind={kind} />;
}
