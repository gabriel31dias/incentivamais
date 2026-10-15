import { Field, FormDialog, textareaClass } from "@/shared/components/kit";
import { api, formatDate, num } from "@/shared/lib/api";
import { toast } from "@/shared/lib/toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { EntryBadge, Points, type Entry } from "./shared";

/** estorno: cria lançamento inverso vinculado; o original nunca é apagado */
export function ReverseDialog({ entry, onClose }: { entry: Entry | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const close = () => {
    setReason("");
    setError("");
    onClose();
  };
  const reverse = useMutation({
    mutationFn: () => api.post<{ balanceBefore: number; balanceAfter: number }>(`/points/${entry!.id}/reverse`, { reason: reason.trim() }),
    onSuccess: (r) => {
      toast.success(`Lançamento #${entry!.id} estornado`, { description: `Saldo de ${entry!.sellerName}: ${num(r.balanceBefore)} → ${num(r.balanceAfter)} pts` });
      qc.invalidateQueries({ queryKey: ["ledger"] });
      qc.invalidateQueries({ queryKey: ["balance"] });
      close();
    },
    onError: (e) => setError((e as Error).message),
  });
  return (
    <FormDialog
      open={!!entry}
      onOpenChange={(o) => !o && close()}
      title={`Estornar lançamento #${entry?.id ?? ""}`}
      submitLabel="Confirmar estorno"
      busy={reverse.isPending}
      onSubmit={() => {
        if (reason.trim().length < 15) return setError("Justificativa obrigatória (mínimo 15 caracteres)");
        reverse.mutate();
      }}
    >
      {entry && (
        <div className="grid gap-1 rounded-xl bg-[#00E6A0]/[0.06] p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <EntryBadge type={entry.type} />
            <Points value={entry.points} /> pts · {entry.sellerName}
          </div>
          <span className="text-xs text-[#73737D] dark:text-muted-foreground">
            {entry.origin} · {formatDate(entry.createdAt)} · {entry.actorName}
          </span>
          <span className="text-xs font-semibold">
            Será lançado: <Points value={-entry.points} /> pts (estorno)
          </span>
        </div>
      )}
      <Field label="Justificativa" error={error} hint={`${reason.trim().length}/15 caracteres mínimos`}>
        <textarea className={textareaClass} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} autoFocus />
      </Field>
      <p className="flex items-start gap-2 text-xs text-[#73737D] dark:text-muted-foreground">
        <ShieldCheck className="h-4 w-4 shrink-0 text-[#00A876] dark:text-[#00E6A0]" />
        O lançamento original é preservado. O estorno fica registrado no extrato e na auditoria com seu nome.
      </p>
    </FormDialog>
  );
}
