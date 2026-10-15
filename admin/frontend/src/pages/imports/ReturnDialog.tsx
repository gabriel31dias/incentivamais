import { Field, FormDialog, textareaClass } from "@/shared/components/kit";
import { api } from "@/shared/lib/api";
import { toast } from "@/shared/lib/toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Radio } from "lucide-react";
import { useState } from "react";
import type { Batch } from "./shared";

/** devolve o lote para quem enviou corrigir; a pessoa recebe um modal na hora no app */
export function ReturnDialog({ batch, onClose }: { batch: Batch | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const close = () => {
    setReason("");
    setError("");
    onClose();
  };
  const send = useMutation({
    mutationFn: () => api.post(`/imports/${batch!.id}/return`, { reason: reason.trim() }),
    onSuccess: () => {
      toast.success(`Lote #${batch!.id} devolvido para ${batch!.userName}`);
      qc.invalidateQueries({ queryKey: ["import-batch", batch!.id] });
      qc.invalidateQueries({ queryKey: ["imports"] });
      close();
    },
    onError: (e) => setError((e as Error).message),
  });
  return (
    <FormDialog
      open={!!batch}
      onOpenChange={(o) => !o && close()}
      title={`Devolver o lote #${batch?.id ?? ""} para correção`}
      submitLabel="Devolver"
      busy={send.isPending}
      onSubmit={() => {
        if (reason.trim().length < 10) return setError("Justificativa obrigatória (mínimo 10 caracteres)");
        send.mutate();
      }}
    >
      <Field label={`O que ${batch?.userName ?? "quem enviou"} precisa corrigir?`} error={error} hint={`${reason.trim().length}/10 caracteres mínimos`}>
        <textarea className={textareaClass} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} autoFocus />
      </Field>
      <p className="flex items-start gap-2 text-xs text-[#73737D] dark:text-muted-foreground">
        <Radio className="h-4 w-4 shrink-0 text-[#00A876] dark:text-[#00E6A0]" />
        Quem enviou vê a justificativa na hora, num aviso no app. Se estiver offline, o aviso aparece no próximo acesso. Nenhum ponto é lançado.
      </p>
    </FormDialog>
  );
}
