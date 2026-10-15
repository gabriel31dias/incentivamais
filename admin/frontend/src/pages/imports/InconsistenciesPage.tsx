import { DataTable, iconButton, Panel, Skeleton, StatCard, StatusBadge, Strong, Sub, type Column } from "@/shared/components/kit";
import { api, competence, formatDate, num, useCan } from "@/shared/lib/api";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Building2, Download, Eye, FileWarning, RefreshCcw, XCircle } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { downloadErrors, ErrorReport, resendUrl, type Batch, type ErrorType } from "./shared";

type Row = Batch & { errorRows: number };

export function InconsistenciesPage() {
  const navigate = useNavigate();
  const canImport = useCan("SALES_IMPORT");
  const { data, isLoading, isError } = useQuery({
    queryKey: ["imports", "inconsistencies"],
    queryFn: () => api.get<{ byType: ErrorType[]; batches: Row[] }>("/imports/inconsistencies"),
  });
  const batches = data?.batches ?? [];
  const problemRows = batches.reduce((s, b) => s + b.invalid + b.duplicates, 0);

  const columns: Column<Row>[] = [
    { header: "Lote", width: "70px", cell: (b) => <Strong>#{b.id}</Strong> },
    {
      header: "Distribuidora",
      width: "minmax(180px,1.3fr)",
      cell: (b) => (
        <>
          <Strong>{b.distributorName}</Strong>
          <Sub>{b.fileName}</Sub>
        </>
      ),
    },
    { header: "Competência", width: "110px", cell: (b) => competence(b.competence) },
    { header: "Envio", width: "130px", cell: (b) => formatDate(b.createdAt) },
    {
      header: "Problemas",
      width: "minmax(160px,1fr)",
      cell: (b) =>
        b.status === "failed" ? (
          <span className="text-destructive" title={b.error ?? ""}>
            {b.error ?? "Arquivo recusado"}
          </span>
        ) : (
          <span>
            <b className="text-destructive">{num(b.invalid)}</b> inválidas · {num(b.duplicates)} duplicadas
          </span>
        ),
    },
    { header: "Status", width: "180px", cell: (b) => <StatusBadge status={b.status} /> },
    {
      header: "Ações",
      width: "110px",
      cell: (b) => (
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          <Link to={`/importacao/lotes/${b.id}`} className={iconButton} title="Ver lote" aria-label={`Ver lote ${b.id}`}>
            <Eye className="h-4 w-4" />
          </Link>
          <button className={iconButton} onClick={() => downloadErrors(b.id)} title="Baixar erros (CSV)" aria-label="Baixar erros">
            <Download className="h-4 w-4" />
          </button>
          {canImport && (
            <Link to={resendUrl(b)} className={iconButton} title="Reenviar arquivo corrigido" aria-label="Reenviar arquivo corrigido">
              <RefreshCcw className="h-4 w-4" />
            </Link>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard icon={<FileWarning className="h-5 w-5" />} label="Lotes com inconsistências" value={num(batches.filter((b) => b.status === "with_errors").length)} tone="warning" />
        <StatCard icon={<XCircle className="h-5 w-5" />} label="Arquivos recusados (layout)" value={num(batches.filter((b) => b.status === "failed").length)} tone="danger" />
        <StatCard icon={<Building2 className="h-5 w-5" />} label="Linhas com problema" value={num(problemRows)} caption={`${num(new Set(batches.map((b) => b.distributorId)).size)} distribuidora(s)`} />
      </div>
      <div className="grid gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
        <Panel title="Inconsistências por tipo" icon={<AlertTriangle className="h-4 w-4" />}>
          {isLoading ? <Skeleton className="h-64" /> : <ErrorReport types={data?.byType ?? []} empty="Nenhuma inconsistência pendente." />}
        </Panel>
        <div className="space-y-3">
          <p className="text-sm text-[#73737D] dark:text-muted-foreground">
            Lotes que ainda não foram confirmados por causa de inconsistências. Linhas inválidas nunca são pontuadas: corrija e reenvie, ou confirme apenas as válidas.
          </p>
          <DataTable
            columns={columns}
            page={{ data: batches, pagination: { page: 1, perPage: batches.length, total: batches.length, lastPage: 1 } }}
            isLoading={isLoading}
            isError={isError}
            onPageChange={() => null}
            onRowClick={(b) => navigate(`/importacao/lotes/${b.id}`)}
            minWidth={980}
            empty="Nenhum lote com inconsistências no seu escopo."
          />
        </div>
      </div>
    </div>
  );
}
