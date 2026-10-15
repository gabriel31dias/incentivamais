import {
  card,
  DataTable,
  Field,
  fieldClass,
  FilterPanel,
  iconButton,
  PeriodFields,
  SearchInput,
  secondaryButton,
  Strong,
  Sub,
  Toolbar,
  useList,
  type Column,
} from "@/shared/components/kit";
import { api, downloadCsv, formatDate, num, useCan, useLookups } from "@/shared/lib/api";
import { toast } from "@/shared/lib/toast";
import { cn } from "@/shared/lib/utils";
import { Download, RotateCcw, X } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ReverseDialog } from "./ReverseDialog";
import { ENTRY, EntryBadge, Points, type Entry, type EntryType } from "./shared";

type Summary = { byType: Record<EntryType, { count: number; points: number }>; balance: number };

export function LedgerPage() {
  const [params, setParams] = useSearchParams();
  const lookups = useLookups().data;
  const canAdjust = useCan("POINTS_ADJUST");
  const initial = Object.fromEntries(["batchId", "sellerId", "campaignId", "distributorId", "type"].flatMap((k) => (params.get(k) ? [[k, params.get(k)!]] : [])));
  const list = useList<Entry, Summary>("ledger", "/points", initial);
  const [reversing, setReversing] = useState<Entry | null>(null);
  const [exporting, setExporting] = useState(false);
  const s = list.data?.summary;
  const f = list.filters;

  const exportCsv = async () => {
    setExporting(true);
    try {
      const rows = await api.get<Record<string, unknown>[]>("/points/export", f);
      if (!rows.length) return toast.info("Nada para exportar com estes filtros");
      downloadCsv(`extrato-pontos-${new Date().toISOString().slice(0, 10)}.csv`, rows);
      toast.success(`${num(rows.length)} lançamento(s) exportado(s)${rows.length === 5000 ? " (limite de 5.000)" : ""}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setExporting(false);
    }
  };

  const clear = (key: string) => {
    const { [key]: _, ...rest } = f;
    void _;
    list.setFilters(rest);
    if (params.has(key)) {
      params.delete(key);
      setParams(params, { replace: true });
    }
  };

  const columns: Column<Entry>[] = [
    { header: "ID", width: "70px", sort: "id", cell: (e) => <span className="font-mono text-xs">#{e.id}</span> },
    { header: "Data", width: "130px", sort: "createdAt", cell: (e) => formatDate(e.createdAt) },
    { header: "Vendedor", width: "minmax(150px,1.2fr)", sort: "sellerName", cell: (e) => <Strong>{e.sellerName}</Strong> },
    { header: "Tipo", width: "150px", cell: (e) => <EntryBadge type={e.type} /> },
    {
      header: "Origem",
      width: "minmax(170px,1.4fr)",
      cell: (e) => (
        <span title={e.reason ?? e.origin}>
          <span className="block truncate text-[#1F1F24] dark:text-white">{e.origin}</span>
          {e.reason && <Sub>{e.reason}</Sub>}
        </span>
      ),
    },
    { header: "Pontos", width: "90px", className: "text-right", sort: "points", cell: (e) => <Points value={e.points} /> },
    { header: "Regra aplicada", width: "minmax(140px,1fr)", cell: (e) => e.ruleLabel ?? "—" },
    {
      header: "Ref. venda",
      width: "minmax(140px,1fr)",
      cell: (e) => (
        <>
          <span className="block truncate font-mono text-xs">{e.saleExternalId ?? "—"}</span>
          {e.batchId && (
            <Link to={`/importacao/lotes/${e.batchId}`} className="text-xs text-[#00A876] hover:underline dark:text-[#00E6A0]" onClick={(ev) => ev.stopPropagation()}>
              Lote #{e.batchId}
            </Link>
          )}
        </>
      ),
    },
    { header: "Responsável", width: "minmax(130px,1fr)", cell: (e) => e.actorName },
  ];
  if (canAdjust)
    columns.push({
      header: "",
      width: "44px",
      cell: (e) =>
        e.type !== "reversal" && e.points !== 0 ? (
          <button className={iconButton} onClick={() => setReversing(e)} title="Estornar" aria-label={`Estornar lançamento ${e.id}`}>
            <RotateCcw className="h-4 w-4" />
          </button>
        ) : null,
    });

  const chips = [
    f.batchId && ["batchId", `Lote #${f.batchId}`],
    f.sellerId && ["sellerId", `Vendedor #${f.sellerId}`],
  ].filter(Boolean) as [string, string][];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {(Object.keys(ENTRY) as EntryType[]).map((t) => (
          <button
            key={t}
            onClick={() => list.patch({ type: f.type === t ? "" : t })}
            aria-pressed={f.type === t}
            className={cn(card, "p-3 text-left transition-colors hover:border-[#00E6A0]/50", f.type === t && "border-[#00E6A0] ring-1 ring-[#00E6A0]")}
          >
            <span className="block text-xs font-semibold text-[#73737D] dark:text-muted-foreground">{ENTRY[t][0]}</span>
            <span className="block text-lg font-bold">{s ? <Points value={s.byType[t].points} /> : "—"}</span>
            <span className="block text-xs text-[#8C8C96]">{s ? `${num(s.byType[t].count)} lançamento(s)` : ""}</span>
          </button>
        ))}
        <div className={cn(card, "p-3")}>
          <span className="block text-xs font-semibold text-[#73737D] dark:text-muted-foreground">Saldo do filtro</span>
          <span className="block text-lg font-bold">{s ? <Points value={s.balance} /> : "—"}</span>
          <span className="block text-xs text-[#8C8C96]">{list.data ? `${num(list.data.pagination.total)} lançamentos` : ""}</span>
        </div>
      </div>

      <Toolbar
        actions={
          <>
            <FilterPanel onApply={list.applyPanel}>
              <Field label="Distribuidora">
                <select name="distributorId" className={fieldClass} defaultValue="">
                  <option value="">Todas</option>
                  {lookups?.distributors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Campanha">
                <select name="campaignId" className={fieldClass} defaultValue="">
                  <option value="">Todas</option>
                  {lookups?.campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Tipo de lançamento">
                <select name="type" className={fieldClass} defaultValue="">
                  <option value="">Todos</option>
                  {(Object.keys(ENTRY) as EntryType[]).map((t) => (
                    <option key={t} value={t}>
                      {ENTRY[t][0]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Vendedor (nome)">
                <input name="seller" className={fieldClass} placeholder="Ex.: Ana Lima" />
              </Field>
              <Field label="Lote de importação">
                <input name="batchId" type="number" min={1} className={fieldClass} placeholder="Nº do lote" />
              </Field>
              <PeriodFields />
            </FilterPanel>
            <button className={secondaryButton} onClick={exportCsv} disabled={exporting}>
              <Download className="h-4 w-4" /> {exporting ? "Exportando..." : "Exportar CSV"}
            </button>
          </>
        }
      >
        <SearchInput value={f.search} onChange={(search) => list.patch({ search })} placeholder="Vendedor, origem, NF ou #ID" />
        {chips.map(([k, label]) => (
          <button key={k} onClick={() => clear(k)} className="inline-flex items-center gap-1 rounded-full bg-[#00E6A0]/15 px-3 py-1 text-xs font-bold text-[#00A876] dark:text-[#00E6A0]">
            {label} <X className="h-3 w-3" />
          </button>
        ))}
      </Toolbar>

      <DataTable
        columns={columns}
        page={list.data}
        isLoading={list.isLoading}
        isError={list.isError}
        onPageChange={list.setPage}
        sort={list.sort}
        onSort={list.onSort}
        minWidth={1250}
        empty="Nenhum lançamento com estes filtros."
      />
      <p className="text-xs text-[#8C8C96] dark:text-muted-foreground">
        Lançamentos históricos não são excluídos nem editados. Correções entram como novos lançamentos (ajuste ou estorno), com justificativa e responsável.
      </p>
      <ReverseDialog entry={reversing} onClose={() => setReversing(null)} />
    </div>
  );
}
