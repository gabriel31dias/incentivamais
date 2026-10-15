import { DataTable, iconButton, Panel, SearchInput, StatusBadge, Strong, Sub, Tabs, Toolbar, useConfirm, useList, type Column } from "@/shared/components/kit";
import { api, competence, formatDate, num, useCan } from "@/shared/lib/api";
import { toast } from "@/shared/lib/toast";
import { useQueryClient } from "@tanstack/react-query";
import { Eye, KeyRound, Loader2, RefreshCcw, RotateCw, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { isBusy, resendUrl, type Batch } from "./shared";

export function ReprocessPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const canImport = useCan("SALES_IMPORT");
  const [tab, setTab] = useState("done,failed,queued,processing");
  const list = useList<Batch>("imports", "/imports", { status: "done,failed,queued,processing" });

  const busy = list.data?.data.some((b) => isBusy(b.status));
  const { refetch } = list;
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => refetch(), 1500);
    return () => clearInterval(t);
  }, [busy, refetch]);

  const reprocess = async (b: Batch) => {
    try {
      await api.post(`/imports/${b.id}/reprocess`);
      toast.success(`Lote #${b.id} reenfileirado`, { description: "Acompanhe o resultado nesta lista." });
      qc.invalidateQueries({ queryKey: ["imports"] });
      qc.invalidateQueries({ queryKey: ["import-batch", b.id] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const columns: Column<Batch>[] = [
    { header: "Lote", width: "70px", sort: "id", cell: (b) => <Strong>#{b.id}</Strong> },
    {
      header: "Distribuidora",
      width: "minmax(170px,1.2fr)",
      sort: "distributorName",
      cell: (b) => (
        <>
          <Strong>{b.distributorName}</Strong>
          <Sub>
            {competence(b.competence)} · {b.fileName}
          </Sub>
        </>
      ),
    },
    { header: "Processado", width: "130px", cell: (b) => formatDate(b.processedAt) },
    {
      header: "Último resultado",
      width: "minmax(260px,1.4fr)",
      cell: (b) =>
        isBusy(b.status) ? (
          <span className="inline-flex items-center gap-1.5 text-[#1D6FD1] dark:text-[#60A5FA]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> processando...
          </span>
        ) : b.status === "failed" ? (
          <span className="text-destructive">{b.error}</span>
        ) : (
          <span>
            <b className="text-[#1F1F24] dark:text-white">{num(b.newCount)}</b> novas · <b className="text-[#1F1F24] dark:text-white">{num(b.skippedCount)}</b> já
            existentes ignoradas · <b className="text-[#1F1F24] dark:text-white">{num(b.correctedCount)}</b> corrigidas
          </span>
        ),
    },
    { header: "Reproc.", width: "70px", className: "text-right", cell: (b) => num(b.reprocessCount) },
    { header: "Status", width: "130px", sort: "status", cell: (b) => <StatusBadge status={b.status} /> },
    {
      header: "Ações",
      width: "110px",
      cell: (b) => (
        <div className="flex gap-1">
          <Link to={`/importacao/lotes/${b.id}`} className={iconButton} title="Ver lote" aria-label={`Ver lote ${b.id}`}>
            <Eye className="h-4 w-4" />
          </Link>
          <button
            className={iconButton}
            disabled={isBusy(b.status) || !b.total}
            title="Reprocessar"
            aria-label={`Reprocessar lote ${b.id}`}
            onClick={() =>
              confirm.ask({
                title: `Reprocessar o lote #${b.id}?`,
                description: "Vendas já pontuadas (mesma chave e mesmos dados) serão ignoradas; nada é creditado em dobro.",
                confirmLabel: "Reprocessar",
                run: () => reprocess(b),
              })
            }
          >
            <RotateCw className="h-4 w-4" />
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
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Chave única por venda" icon={<KeyRound className="h-4 w-4" />}>
          <p className="text-sm text-[#73737D] dark:text-muted-foreground">
            Cada venda é identificada por <code className="rounded bg-[#00E6A0]/10 px-1 font-mono text-xs">distribuidora:documento:item</code>. O banco só aceita uma
            venda ativa por chave.
          </p>
        </Panel>
        <Panel title="Reprocessar não duplica" icon={<ShieldCheck className="h-4 w-4" />}>
          <p className="text-sm text-[#73737D] dark:text-muted-foreground">
            Rodar o mesmo lote de novo só credita o que ainda não existe. Vendas idênticas são ignoradas e contadas como "já existentes".
          </p>
        </Panel>
        <Panel title="Arquivo corrigido" icon={<RefreshCcw className="h-4 w-4" />}>
          <p className="text-sm text-[#73737D] dark:text-muted-foreground">
            Reenviar uma venda já pontuada com dados diferentes preserva a original, cria a nova e lança só a diferença como ajuste ou estorno, com o responsável
            registrado.
          </p>
        </Panel>
      </div>
      <Toolbar>
        <Tabs
          tabs={[
            { value: "done,failed,queued,processing", label: "Todos" },
            { value: "done", label: "Concluídos" },
            { value: "failed", label: "Com falha" },
          ]}
          value={tab}
          onChange={(v) => {
            setTab(v);
            list.patch({ status: v });
          }}
        />
        <SearchInput value={list.filters.search} onChange={(search) => list.patch({ search })} placeholder="Buscar lote, distribuidora..." />
      </Toolbar>
      <DataTable
        columns={columns}
        page={list.data}
        isLoading={list.isLoading}
        isError={list.isError}
        onPageChange={list.setPage}
        sort={list.sort}
        onSort={list.onSort}
        minWidth={1080}
        empty="Nenhum lote processado ainda."
      />
      {confirm.dialog}
    </div>
  );
}
