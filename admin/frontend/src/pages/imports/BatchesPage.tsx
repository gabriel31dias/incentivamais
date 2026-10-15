import {
  DataTable,
  Field,
  FilterPanel,
  fieldClass,
  iconButton,
  PeriodFields,
  primaryButton,
  SearchInput,
  STATUS,
  StatusBadge,
  Strong,
  Sub,
  Toolbar,
  useList,
  type Column,
} from "@/shared/components/kit";
import { competence, formatDate, num, useCan, useLookups } from "@/shared/lib/api";
import { CloudUpload, Download, Eye } from "lucide-react";
import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { downloadErrors, isBusy, type Batch } from "./shared";

const STATUSES = ["with_errors", "awaiting_confirmation", "queued", "processing", "done", "failed", "replaced", "returned"];

export function BatchesPage() {
  const navigate = useNavigate();
  const lookups = useLookups();
  const canImport = useCan("SALES_IMPORT");
  const list = useList<Batch>("imports", "/imports");

  const columns: Column<Batch>[] = [
    { header: "Lote", width: "70px", sort: "id", cell: (b) => <Strong>#{b.id}</Strong> },
    {
      header: "Distribuidora",
      width: "minmax(180px,1.3fr)",
      sort: "distributorName",
      cell: (b) => (
        <>
          <Strong>{b.distributorName}</Strong>
          <Sub>{b.fileName}</Sub>
        </>
      ),
    },
    { header: "Competência", width: "110px", sort: "competence", cell: (b) => competence(b.competence) },
    { header: "Responsável", width: "minmax(130px,1fr)", cell: (b) => b.userName },
    { header: "Envio", width: "130px", sort: "createdAt", cell: (b) => formatDate(b.createdAt) },
    { header: "Registros", width: "88px", sort: "total", className: "text-right", cell: (b) => num(b.total) },
    { header: "Válidos", width: "76px", className: "text-right", cell: (b) => num(b.valid + b.corrections) },
    {
      header: "Inválidos",
      width: "82px",
      sort: "invalid",
      className: "text-right",
      cell: (b) => <span className={b.invalid ? "font-bold text-destructive" : undefined}>{num(b.invalid)}</span>,
    },
    { header: "Status", width: "190px", sort: "status", cell: (b) => <StatusBadge status={b.status} /> },
    {
      header: "Ações",
      width: "80px",
      cell: (b) => (
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          <Link to={`/importacao/lotes/${b.id}`} className={iconButton} aria-label={`Ver lote ${b.id}`} title="Ver lote">
            <Eye className="h-4 w-4" />
          </Link>
          {b.invalid + b.duplicates > 0 && (
            <button className={iconButton} onClick={() => downloadErrors(b.id)} aria-label="Baixar erros" title="Baixar erros (CSV)">
              <Download className="h-4 w-4" />
            </button>
          )}
        </div>
      ),
    },
  ];

  const busy = list.data?.data.some((b) => isBusy(b.status));
  const { refetch } = list;
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => refetch(), 2000);
    return () => clearInterval(t);
  }, [busy, refetch]);

  return (
    <div className="space-y-5">
      <Toolbar
        actions={
          canImport && (
            <Link to="/importacao/nova" className={primaryButton}>
              <CloudUpload className="h-4 w-4" /> Nova importação
            </Link>
          )
        }
      >
        <SearchInput value={list.filters.search} onChange={(search) => list.patch({ search })} placeholder="Buscar lote, arquivo, responsável..." />
        <FilterPanel onApply={list.applyPanel}>
          <Field label="Distribuidora">
            <select name="distributorId" className={fieldClass} defaultValue="">
              <option value="">Todas</option>
              {lookups.data?.distributors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Competência">
            <input type="month" name="competence" className={fieldClass} />
          </Field>
          <Field label="Status">
            <select name="status" className={fieldClass} defaultValue="">
              <option value="">Todos</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS[s][0]}
                </option>
              ))}
            </select>
          </Field>
          <PeriodFields />
        </FilterPanel>
        {busy && <span className="text-xs font-semibold text-[#1D6FD1] dark:text-[#60A5FA]">Há lotes em processamento</span>}
      </Toolbar>
      <DataTable
        columns={columns}
        page={list.data}
        isLoading={list.isLoading}
        isError={list.isError}
        onPageChange={list.setPage}
        onRowClick={(b) => navigate(`/importacao/lotes/${b.id}`)}
        sort={list.sort}
        onSort={list.onSort}
        minWidth={1180}
        empty="Nenhum lote encontrado com esses filtros."
      />
    </div>
  );
}
