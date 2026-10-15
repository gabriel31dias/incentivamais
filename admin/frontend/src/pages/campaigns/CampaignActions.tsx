import { dangerButton, primaryButton, secondaryButton, useConfirm } from "@/shared/components/kit";
import { api } from "@/shared/lib/api";
import { toast } from "@/shared/lib/toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Copy, Pause, Pencil, Play, Square, Undo2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { fail, type Campaign } from "./shared";

type Action = "schedule" | "pause" | "resume" | "end" | "draft";

const ACTIONS: Record<Action, { label: string; icon: typeof Play; title: string; text: string; danger?: boolean; from: Campaign["status"][] }> = {
  schedule: { label: "Agendar", icon: CalendarClock, from: ["draft"], title: "Agendar campanha?", text: "Ela fica ativa automaticamente na data de início e passa a pontuar as vendas elegíveis." },
  draft: { label: "Voltar a rascunho", icon: Undo2, from: ["scheduled"], title: "Voltar para rascunho?", text: "A campanha deixa de estar agendada." },
  pause: { label: "Pausar", icon: Pause, from: ["active"], title: "Pausar campanha?", text: "Vendas com data no período continuam sendo pontuadas; a campanha some das telas do app até ser retomada." },
  resume: { label: "Retomar", icon: Play, from: ["paused"], title: "Retomar campanha?", text: "A campanha volta a ficar ativa." },
  end: { label: "Encerrar", icon: Square, danger: true, from: ["active", "paused", "scheduled"], title: "Encerrar campanha?", text: "O término passa a ser hoje e a campanha não pode mais ser editada. Os pontos já creditados são mantidos." },
};

/** botões de ação conforme o status (detalhe da campanha e cards da lista) */
export function CampaignActions({ campaign, onEdit, compact }: { campaign: Campaign; onEdit: () => void; compact?: boolean }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["campaigns"] });
    qc.invalidateQueries({ queryKey: ["campaign"] });
    qc.invalidateQueries({ queryKey: ["lookups"] });
  };
  const status = useMutation({
    mutationFn: (action: Action) => api.post<Campaign>(`/campaigns/${campaign.id}/status`, { action }),
    onSuccess: (c, action) => {
      toast.success(`${ACTIONS[action].label}: ${c.name}`);
      refresh();
    },
    onError: fail,
  });
  const duplicate = useMutation({
    mutationFn: () => api.post<Campaign>(`/campaigns/${campaign.id}/duplicate`),
    onSuccess: (c) => {
      toast.success("Campanha duplicada como rascunho", { description: "As regras vigentes foram copiadas junto." });
      refresh();
      navigate(`/campanhas/${c.id}`);
    },
    onError: fail,
  });
  const size = compact ? "h-9 px-3 text-xs" : "";
  return (
    <div className="flex flex-wrap gap-2">
      {campaign.status !== "ended" && (
        <button className={`${secondaryButton} ${size}`} onClick={onEdit}>
          <Pencil className="h-4 w-4" /> Editar
        </button>
      )}
      <button
        className={`${secondaryButton} ${size}`}
        disabled={duplicate.isPending}
        onClick={() => confirm.ask({ title: "Duplicar campanha?", description: "Cria um rascunho com os mesmos dados e as regras vigentes (como versão 1 de regras novas).", run: () => duplicate.mutate() })}
      >
        <Copy className="h-4 w-4" /> Duplicar
      </button>
      {(Object.keys(ACTIONS) as Action[])
        .filter((a) => ACTIONS[a].from.includes(campaign.status))
        .map((a) => {
          const { label, icon: Icon, title, text, danger } = ACTIONS[a];
          return (
            <button
              key={a}
              disabled={status.isPending}
              className={`${danger ? dangerButton : a === "schedule" || a === "resume" ? primaryButton : secondaryButton} ${size}`}
              onClick={() => confirm.ask({ title, description: text, danger, confirmLabel: label, run: () => status.mutate(a) })}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          );
        })}
      {confirm.dialog}
    </div>
  );
}
