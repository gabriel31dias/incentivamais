import {
  Badge,
  DataTable,
  fieldClass,
  Field,
  FormDialog,
  iconButton,
  SearchInput,
  StatCard,
  StatusBadge,
  Strong,
  Sub,
  Tabs,
  Toolbar,
  useList,
  ViewDialog,
  type Column,
} from "@/shared/components/kit";
import { api, formatDate, formatDay, num, useCan } from "@/shared/lib/api";
import { toast } from "@/shared/lib/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, CheckCircle2, Gift, History, PackageCheck, Truck } from "lucide-react";
import { useState } from "react";
import { KINDS } from "./config";
import { type Rec } from "./RecordForm";
import { HistoryList, RecordsList } from "./RecordsPage";

const NEXT: Record<string, { status: string; label: string; icon: typeof CheckCircle2; danger?: boolean }[]> = {
  requested: [
    { status: "approved", label: "Aprovar (baixa estoque)", icon: CheckCircle2 },
    { status: "rejected", label: "Recusar", icon: Ban, danger: true },
  ],
  approved: [
    { status: "shipped", label: "Marcar como enviado", icon: Truck },
    { status: "rejected", label: "Recusar", icon: Ban, danger: true },
  ],
  shipped: [{ status: "delivered", label: "Confirmar entrega", icon: PackageCheck }],
};

function Redemptions() {
  const qc = useQueryClient();
  const canEdit = useCan("CONTENT_MANAGE");
  const list = useList<Rec>("records", "/records/redemption");
  const [action, setAction] = useState<{ rec: Rec; status: string; label: string } | null>(null);
  const [note, setNote] = useState("");
  const [history, setHistory] = useState<Rec | null>(null);
  const counts = useQuery({
    queryKey: ["records", "redemption-counts"],
    queryFn: async () => {
      const statuses = ["requested", "approved", "shipped", "delivered"];
      const pages = await Promise.all(statuses.map((s) => api.get<{ pagination: { total: number } }>("/records/redemption", { status: s, per_page: 1 })));
      return Object.fromEntries(statuses.map((s, i) => [s, pages[i].pagination.total]));
    },
  });

  const move = useMutation({
    mutationFn: () => api.post<Rec>(`/records/redemption/${action!.rec.id}/status`, { status: action!.status, note: note || undefined }),
    onSuccess: () => {
      toast.success("Resgate atualizado.");
      qc.invalidateQueries({ queryKey: ["records"] });
      setAction(null);
      setNote("");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const columns: Column<Rec>[] = [
    {
      header: "Resgate",
      width: "minmax(240px,2fr)",
      cell: (r) => (
        <>
          <Strong>{r.data.reward}</Strong>
          <Sub>{r.title.split(" — ")[1] ?? r.title}</Sub>
        </>
      ),
    },
    { header: "Pontos", width: "100px", cell: (r) => <Strong>{num(r.data.points)}</Strong> },
    { header: "Solicitado em", width: "130px", cell: (r) => formatDay(r.data.requestedAt) },
    { header: "Status", width: "130px", cell: (r) => <StatusBadge status={r.status} /> },
    { header: "Atualizado", width: "140px", cell: (r) => formatDate(r.updatedAt) },
    {
      header: "Ações",
      width: "150px",
      className: "flex justify-end gap-1",
      cell: (r) => (
        <>
          {canEdit &&
            (NEXT[r.status] ?? []).map((n) => (
              <button key={n.status} className={iconButton} title={n.label} aria-label={n.label} onClick={() => setAction({ rec: r, status: n.status, label: n.label })}>
                <n.icon className={n.danger ? "h-4 w-4 text-destructive" : "h-4 w-4"} />
              </button>
            ))}
          <button className={iconButton} title="Histórico" aria-label="Histórico" onClick={() => setHistory(r)}>
            <History className="h-4 w-4" />
          </button>
        </>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={<Gift className="h-5 w-5" />} label="Solicitados" value={num(counts.data?.requested)} tone="warning" />
        <StatCard icon={<CheckCircle2 className="h-5 w-5" />} label="Aprovados" value={num(counts.data?.approved)} />
        <StatCard icon={<Truck className="h-5 w-5" />} label="Enviados" value={num(counts.data?.shipped)} />
        <StatCard icon={<PackageCheck className="h-5 w-5" />} label="Entregues" value={num(counts.data?.delivered)} />
      </div>
      <Toolbar>
        <SearchInput value={list.filters.search} onChange={(search) => list.patch({ search })} placeholder="Buscar prêmio ou vendedor..." />
        <select aria-label="Status" className={`${fieldClass} w-auto`} value={list.filters.status ?? ""} onChange={(e) => list.patch({ status: e.target.value })}>
          <option value="">Todos os status</option>
          {["requested", "approved", "shipped", "delivered", "rejected"].map((s) => (
            <option key={s} value={s}>
              {{ requested: "Solicitado", approved: "Aprovado", shipped: "Enviado", delivered: "Entregue", rejected: "Recusado" }[s]}
            </option>
          ))}
        </select>
      </Toolbar>
      <DataTable columns={columns} page={list.data} isLoading={list.isLoading} isError={list.isError} onPageChange={list.setPage} empty="Nenhuma solicitação de resgate." />
      <FormDialog
        open={!!action}
        onOpenChange={(o) => !o && setAction(null)}
        title={action?.label ?? ""}
        description={action && `${action.rec.data.reward} · ${num(action.rec.data.points)} pts`}
        submitLabel="Confirmar"
        onSubmit={() => move.mutate()}
        busy={move.isPending}
      >
        {action?.status === "approved" && <p className="rounded-xl bg-warning/10 px-3 py-2 text-xs font-semibold text-[#B76E00] dark:text-warning">Aprovar reduz em 1 o estoque do prêmio. Sem estoque, a aprovação é recusada.</p>}
        <Field label="Observação (opcional)" hint="Fica registrada no histórico e na auditoria.">
          <input className={fieldClass} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
        </Field>
      </FormDialog>
      <ViewDialog open={!!history} onOpenChange={(o) => !o && setHistory(null)} title="Histórico do resgate">
        {history && <HistoryList history={history.history} />}
      </ViewDialog>
    </div>
  );
}

export function RewardsPage() {
  const [tab, setTab] = useState<"catalog" | "redemptions">("catalog");
  return (
    <div className="space-y-5">
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "catalog", label: "Catálogo de prêmios" },
          { value: "redemptions", label: "Solicitações de resgate" },
        ]}
      />
      {tab === "catalog" ? (
        <RecordsList
          def={KINDS.reward}
          extraColumns={[
            {
              header: "Estoque",
              width: "100px",
              cell: (r) => (Number(r.data.stock) > 0 ? <Strong>{num(r.data.stock)}</Strong> : <Badge tone="red">Esgotado</Badge>),
            },
          ]}
        />
      ) : (
        <Redemptions />
      )}
    </div>
  );
}
