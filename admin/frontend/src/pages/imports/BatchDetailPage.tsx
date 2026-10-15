import { EmptyState, Panel, primaryButton, secondaryButton, Skeleton, StatusBadge, useConfirm } from "@/shared/components/kit";
import { api, num, useCan } from "@/shared/lib/api";
import { toast } from "@/shared/lib/toast";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Download, FileWarning, History, RefreshCcw, RotateCw, Undo2 } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ReturnDialog } from "./ReturnDialog";
import { BatchHeading, downloadErrors, ErrorReport, resendUrl, RowsTable, SummaryGrid, Timeline, useBatch } from "./shared";

export function BatchDetailPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const canApprove = useCan("SALES_APPROVE");
  const canReprocess = useCan("SALES_REPROCESS", "SALES_APPROVE");
  const canImport = useCan("SALES_IMPORT");
  const { data: b, isLoading, isError } = useBatch(id);
  const [returning, setReturning] = useState(false);

  const act = async (action: "confirm" | "reprocess") => {
    try {
      await api.post(`/imports/${id}/${action}`);
      toast.success(action === "confirm" ? `Lote #${id} confirmado` : `Lote #${id} reenfileirado para reprocessamento`);
      qc.invalidateQueries({ queryKey: ["import-batch", id] });
      qc.invalidateQueries({ queryKey: ["imports"] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  if (isLoading) return <Skeleton className="h-96" />;
  if (isError || !b)
    return (
      <EmptyState title="Lote não encontrado">
        <Link to="/importacao/lotes" className="underline">
          Voltar ao histórico
        </Link>
      </EmptyState>
    );

  const returnable = canApprove && (b.status === "awaiting_confirmation" || b.status === "with_errors");
  const canConfirm = canApprove && (b.status === "awaiting_confirmation" || b.status === "with_errors") && b.valid + b.corrections > 0;
  const reprocessable = canReprocess && (b.status === "done" || b.status === "failed") && b.total > 0;
  const resendable = canImport && b.status !== "done" && b.status !== "replaced" && b.status !== "queued" && b.status !== "processing";
  const processed = b.status === "done" || b.newCount + b.skippedCount + b.correctedCount > 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <button className={secondaryButton} onClick={() => navigate(-1)} aria-label="Voltar">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <StatusBadge status={b.status} />
        </div>
        <div className="flex flex-wrap gap-2">
          {b.invalid + b.duplicates > 0 && (
            <button className={secondaryButton} onClick={() => downloadErrors(b.id)}>
              <Download className="h-4 w-4" /> Erros (CSV)
            </button>
          )}
          {resendable && (
            <Link to={resendUrl(b)} className={secondaryButton}>
              <RefreshCcw className="h-4 w-4" /> Reenviar corrigido
            </Link>
          )}
          {reprocessable && (
            <button
              className={secondaryButton}
              onClick={() =>
                confirm.ask({
                  title: `Reprocessar o lote #${b.id}?`,
                  description: "O processamento é idempotente: vendas já pontuadas são ignoradas, só o que faltar é creditado e correções viram ajustes.",
                  confirmLabel: "Reprocessar",
                  run: () => act("reprocess"),
                })
              }
            >
              <RotateCw className="h-4 w-4" /> Reprocessar
            </button>
          )}
          {returnable && (
            <button className={secondaryButton} onClick={() => setReturning(true)}>
              <Undo2 className="h-4 w-4" /> Devolver para correção
            </button>
          )}
          {canConfirm && (
            <button
              className={primaryButton}
              onClick={() =>
                confirm.ask({
                  title: `Confirmar o lote #${b.id}?`,
                  description: `${num(b.valid)} vendas novas e ${num(b.corrections)} correções entram na fila. ${num(b.invalid + b.duplicates)} linhas serão ignoradas.`,
                  confirmLabel: "Confirmar lote",
                  run: () => act("confirm"),
                })
              }
            >
              <Check className="h-4 w-4" /> Confirmar lote
            </button>
          )}
        </div>
      </div>

      <BatchHeading batch={b} />
      {(b.replacesBatchId || b.replacedById) && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-[#73737D] dark:text-muted-foreground">
          <History className="h-4 w-4" />
          {b.replacesBatchId && (
            <span>
              Substitui o{" "}
              <Link className="font-semibold text-[#00A876] underline dark:text-[#00E6A0]" to={`/importacao/lotes/${b.replacesBatchId}`}>
                lote #{b.replacesBatchId}
              </Link>
              .
            </span>
          )}
          {b.replacedById && (
            <span>
              Substituído pelo{" "}
              <Link className="font-semibold text-[#00A876] underline dark:text-[#00E6A0]" to={`/importacao/lotes/${b.replacedById}`}>
                lote #{b.replacedById}
              </Link>
              .
            </span>
          )}
        </p>
      )}
      {b.status === "returned" && (
        <div className="rounded-xl border border-[#F5B52A]/40 bg-[#F5B52A]/10 px-4 py-3 text-sm">
          <p className="font-bold text-[#1F1F24] dark:text-white">
            Devolvido para {b.userName} por {b.returnedByName}
            {b.returnSeenAt ? " · visto" : " · ainda não visto"}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-[#52525B] dark:text-muted-foreground">{b.returnReason}</p>
        </div>
      )}
      {b.status === "failed" && b.error && <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive">{b.error}</p>}

      <SummaryGrid batch={b} />
      {processed && (
        <div className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-wide text-[#73737D] dark:text-muted-foreground">
            Último processamento{b.reprocessCount > 0 && ` · reprocessado ${b.reprocessCount}x`}
          </p>
          <SummaryGrid batch={b} processed />
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-5">
          <Panel title="Linha do tempo" icon={<History className="h-4 w-4" />}>
            <Timeline batch={b} />
          </Panel>
          <Panel title="Inconsistências" icon={<FileWarning className="h-4 w-4" />}>
            <ErrorReport types={b.errorsByType} />
          </Panel>
        </div>
        {b.total > 0 ? <RowsTable batch={b} /> : <EmptyState title="Arquivo sem linhas lidas">{b.error}</EmptyState>}
      </div>
      {confirm.dialog}
      <ReturnDialog batch={returning ? b : null} onClose={() => setReturning(false)} />
    </div>
  );
}
