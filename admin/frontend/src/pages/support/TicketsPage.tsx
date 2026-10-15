import {
  Badge,
  DataTable,
  Field,
  FilterPanel,
  fieldClass,
  primaryButton,
  secondaryButton,
  SearchInput,
  StatusBadge,
  Strong,
  Sub,
  textareaClass,
  Toolbar,
  useConfirm,
  useList,
  type Column,
  type Tone,
} from "@/shared/components/kit";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/shared/components/ui/sheet";
import { api, formatDate, useAuth, useCan, useLookups } from "@/shared/lib/api";
import { toast } from "@/shared/lib/toast";
import { cn } from "@/shared/lib/utils";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, RotateCcw, Send, UserCheck } from "lucide-react";
import { useState } from "react";
import { HistoryList } from "../content/RecordsPage";
import type { Rec } from "../content/RecordForm";

export const CATEGORIES = ["Pontuação", "Importação", "Treinamentos", "Premiações", "Acesso", "Chatbot", "Outros"];
const PRIORITY: Record<string, [string, Tone]> = { high: ["Alta", "red"], medium: ["Média", "yellow"], low: ["Baixa", "gray"] };

export function PriorityBadge({ value }: { value?: string }) {
  const [label, tone] = PRIORITY[value ?? ""] ?? ["—", "gray"];
  return <Badge tone={tone}>{label}</Badge>;
}

type Message = { from: "user" | "agent" | "bot"; name?: string; text: string; at: string };

function TicketDetail({ ticket, onUpdate }: { ticket: Rec; onUpdate: (rec: Rec) => void }) {
  const qc = useQueryClient();
  const me = useAuth((s) => s.user);
  const canEdit = useCan("CONTENT_MANAGE");
  const [text, setText] = useState("");
  const [tab, setTab] = useState<"messages" | "history">("messages");
  const confirm = useConfirm();
  const messages: Message[] = ticket.data.messages ?? [];
  const closed = ticket.status === "closed";

  const refresh = (rec: Rec, msg: string) => {
    toast.success(msg);
    onUpdate(rec);
    qc.invalidateQueries({ queryKey: ["records"] });
  };

  const reply = useMutation({
    mutationFn: () => api.post<Rec>(`/records/ticket/${ticket.id}/messages`, { text }),
    onSuccess: (rec) => {
      setText("");
      refresh(rec, "Resposta enviada.");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const patch = useMutation({
    mutationFn: ({ status, data, msg }: { status?: string; data?: Record<string, unknown>; msg: string }) =>
      api.patch<Rec>(`/records/ticket/${ticket.id}`, { status, data: data ? { ...ticket.data, ...data } : undefined }).then((rec) => ({ rec, msg })),
    onSuccess: ({ rec, msg }) => refresh(rec, msg),
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-3 border-b border-[#E5E7EB] px-6 py-4 text-sm dark:border-border/40">
        <div className="flex flex-wrap gap-2">
          <StatusBadge status={ticket.status} />
          <PriorityBadge value={ticket.data.priority} />
          <Badge tone="blue">{ticket.data.category ?? "—"}</Badge>
        </div>
        <p className="text-[#73737D] dark:text-muted-foreground">
          <b className="text-[#1F1F24] dark:text-white">{ticket.data.requester}</b>
          {ticket.data.distributor && ` · ${ticket.data.distributor}`} · aberto em {formatDate(ticket.createdAt)}
        </p>
        {canEdit && (
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Atendente">
              <div className="flex gap-2">
                <input
                  className={fieldClass}
                  defaultValue={ticket.data.assignee ?? ""}
                  placeholder="Sem atendente"
                  onBlur={(e) =>
                    e.target.value !== (ticket.data.assignee ?? "") &&
                    patch.mutate({ data: { assignee: e.target.value || null }, msg: "Atendente atualizado." })
                  }
                />
                <button
                  type="button"
                  title="Atribuir a mim"
                  aria-label="Atribuir a mim"
                  className={cn(secondaryButton, "px-3")}
                  onClick={() => patch.mutate({ data: { assignee: me?.name }, status: ticket.status === "open" ? "in_progress" : undefined, msg: "Chamado atribuído a você." })}
                >
                  <UserCheck className="h-4 w-4" />
                </button>
              </div>
            </Field>
            <Field label="Prioridade">
              <select
                className={fieldClass}
                value={ticket.data.priority ?? "medium"}
                onChange={(e) => patch.mutate({ data: { priority: e.target.value }, msg: "Prioridade alterada." })}
              >
                <option value="high">Alta</option>
                <option value="medium">Média</option>
                <option value="low">Baixa</option>
              </select>
            </Field>
          </div>
        )}
        <div className="flex gap-1 text-xs font-semibold">
          {(["messages", "history"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn("rounded-lg px-3 py-1", tab === t ? "bg-[#00E6A0]/15 text-[#00A876] dark:text-[#00E6A0]" : "text-[#73737D]")}
            >
              {t === "messages" ? `Mensagens (${messages.length})` : "Histórico"}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
        {tab === "history" ? (
          <HistoryList history={ticket.history} />
        ) : (
          messages.map((m, i) => (
            <div key={i} className={cn("flex", m.from === "agent" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm",
                  m.from === "agent" ? "bg-[#00E6A0] text-[#03261A]" : "bg-[#F1F3F5] text-[#1F1F24] dark:bg-white/[0.06] dark:text-white",
                )}
              >
                <p className="mb-1 text-[11px] font-bold opacity-70">
                  {m.from === "agent" ? m.name ?? "Atendente" : ticket.data.requester} · {formatDate(m.at)}
                </p>
                {m.text}
              </div>
            </div>
          ))
        )}
      </div>

      {canEdit && (
        <div className="space-y-2 border-t border-[#E5E7EB] px-6 py-4 dark:border-border/40">
          {closed ? (
            <button className={cn(secondaryButton, "w-full")} onClick={() => patch.mutate({ status: "in_progress", msg: "Chamado reaberto." })}>
              <RotateCcw className="h-4 w-4" />
              Reabrir chamado
            </button>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (text.trim()) reply.mutate();
              }}
              className="space-y-2"
            >
              <textarea
                aria-label="Resposta"
                className={cn(textareaClass, "min-h-[72px]")}
                placeholder="Escreva a resposta ao usuário..."
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  className={secondaryButton}
                  onClick={() =>
                    confirm.ask({
                      title: "Encerrar chamado?",
                      description: "O chamado vai para o Histórico de Atendimentos. Dá para reabrir depois.",
                      confirmLabel: "Encerrar",
                      run: () => patch.mutate({ status: "closed", msg: "Chamado encerrado." }),
                    })
                  }
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Encerrar
                </button>
                <button type="submit" className={primaryButton} disabled={reply.isPending || !text.trim()}>
                  <Send className="h-4 w-4" />
                  Responder
                </button>
              </div>
            </form>
          )}
        </div>
      )}
      {confirm.dialog}
    </div>
  );
}

export function TicketsPage({ history }: { history?: boolean }) {
  const lookups = useLookups();
  const list = useList<Rec>("records", "/records/ticket", history ? { status: "closed" } : { status_not: "closed" });
  const [current, setCurrent] = useState<Rec | null>(null);

  const columns: Column<Rec>[] = [
    {
      header: "Chamado",
      width: "minmax(260px,2fr)",
      cell: (r) => (
        <>
          <Strong>
            #{r.id} {r.title}
          </Strong>
          <Sub>
            {r.data.requester}
            {r.data.distributor && ` · ${r.data.distributor}`}
          </Sub>
        </>
      ),
    },
    { header: "Categoria", width: "130px", cell: (r) => r.data.category ?? "—" },
    { header: "Prioridade", width: "110px", cell: (r) => <PriorityBadge value={r.data.priority} /> },
    { header: "Status", width: "140px", cell: (r) => <StatusBadge status={r.status} /> },
    { header: "Atendente", width: "150px", cell: (r) => r.data.assignee ?? <span className="italic">Sem atendente</span> },
    { header: "Atualizado", width: "130px", cell: (r) => formatDate(r.updatedAt) },
  ];

  return (
    <div className="space-y-4">
      <Toolbar
        actions={
          <FilterPanel onApply={list.applyPanel}>
            {!history && (
              <Field label="Status">
                <select name="status" className={fieldClass} defaultValue="">
                  <option value="">Abertos e em atendimento</option>
                  <option value="open">Aberto</option>
                  <option value="in_progress">Em atendimento</option>
                </select>
              </Field>
            )}
            <Field label="Categoria">
              <select name="category" className={fieldClass} defaultValue="">
                <option value="">Todas</option>
                {CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="Prioridade">
              <select name="priority" className={fieldClass} defaultValue="">
                <option value="">Todas</option>
                <option value="high">Alta</option>
                <option value="medium">Média</option>
                <option value="low">Baixa</option>
              </select>
            </Field>
            <Field label="Distribuidora">
              <select name="distributor" className={fieldClass} defaultValue="">
                <option value="">Todas</option>
                {lookups.data?.distributors.map((d) => (
                  <option key={d.id} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </select>
            </Field>
          </FilterPanel>
        }
      >
        <SearchInput value={list.filters.search} onChange={(search) => list.patch({ search })} placeholder="Buscar assunto, solicitante..." />
      </Toolbar>
      <DataTable
        columns={columns}
        page={list.data}
        isLoading={list.isLoading}
        isError={list.isError}
        onPageChange={list.setPage}
        onRowClick={setCurrent}
        empty={history ? "Nenhum atendimento encerrado." : "Nenhum chamado aberto. 🎉"}
      />
      <Sheet open={!!current} onOpenChange={(o) => !o && setCurrent(null)}>
        <SheetContent className="flex w-full flex-col gap-0 border-[#E5E7EB] bg-white p-0 dark:border-border/40 dark:bg-[#071E24] sm:max-w-[520px]">
          <SheetHeader className="border-b border-[#E5E7EB] px-6 py-5 pr-12 dark:border-border/40">
            <SheetTitle className="text-left text-base font-bold text-[#1F1F24] dark:text-white">
              #{current?.id} {current?.title}
            </SheetTitle>
          </SheetHeader>
          {current && <TicketDetail key={current.id + current.updatedAt} ticket={current} onUpdate={setCurrent} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}
