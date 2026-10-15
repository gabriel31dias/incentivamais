import {
  Badge,
  DataTable,
  EmptyState,
  Field,
  fieldClass,
  FilterPanel,
  FormDialog,
  iconButton,
  primaryButton,
  SearchInput,
  Skeleton,
  StatCard,
  StatusBadge,
  Strong,
  Sub,
  Tabs,
  Toolbar,
  useList,
  useSelection,
  ViewDialog,
  type Column,
} from "@/shared/components/kit";
import { api, cents, competence, num, useAuth, useCan, useLookups, type Page } from "@/shared/lib/api";
import { toast } from "@/shared/lib/toast";
import { cn } from "@/shared/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRightLeft, Medal, Pencil, Plus, Target, UserPlus, Users, UsersRound, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { GoalBar, Info, Sparkbars, toastError, useManagers, type UserRow } from "./shared";

export interface TeamRow {
  id: number;
  name: string;
  distributorId: number;
  distributorName: string | null;
  managerId: number | null;
  managerName: string | null;
  goalCents: number;
  monthGoalCents: number;
  status: "active" | "inactive";
  members: number;
  activeMembers: number;
  salesCents: number;
  points: number;
  monthCents: number;
  goalPct: number;
  evolution: { competence: string; salesCents: number }[];
}

type Summary = { currentCompetence: string; teams: number; members: number; salesCents: number; onTarget: number };

type RankRow = { position: number; id: number; name: string; status: string; salesCents: number; monthCents: number; points: number; count: number };

export function TeamsPage() {
  const lookups = useLookups();
  const list = useList<TeamRow, Summary>("teams", "/teams");
  const canManage = useCan("TEAMS_MANAGE");
  const [editing, setEditing] = useState<TeamRow | null | "new">(null);
  const [open, setOpen] = useState<TeamRow | null>(null);
  const s = list.data?.summary;

  const columns: Column<TeamRow>[] = [
    {
      header: "Equipe",
      width: "minmax(180px,1.4fr)",
      sort: "name",
      cell: (t) => (
        <>
          <Strong>{t.name}</Strong>
          <Sub>{t.distributorName}</Sub>
        </>
      ),
    },
    { header: "Gerente", width: "minmax(130px,1fr)", cell: (t) => t.managerName ?? <span className="text-destructive">sem gerente</span> },
    { header: "Membros", width: "90px", sort: "members", className: "text-right", cell: (t) => num(t.members) },
    { header: "Vendas acumuladas", width: "140px", sort: "salesCents", className: "text-right", cell: (t) => <Strong>{cents(t.salesCents)}</Strong> },
    { header: "Pontos", width: "100px", sort: "points", className: "text-right", cell: (t) => num(t.points) },
    {
      header: `Meta ${s ? competence(s.currentCompetence) : "do mês"}`,
      width: "minmax(150px,1fr)",
      sort: "goalPct",
      cell: (t) => (
        <span title={`${cents(t.monthCents)} de ${cents(t.monthGoalCents)}`}>
          <GoalBar pct={t.monthGoalCents ? t.goalPct : null} />
        </span>
      ),
    },
    { header: "Evolução", width: "90px", cell: (t) => <Sparkbars points={t.evolution} /> },
    {
      header: "",
      width: "44px",
      cell: (t) =>
        canManage && (
          <button
            className={iconButton}
            aria-label={`Editar ${t.name}`}
            onClick={(e) => {
              e.stopPropagation();
              setEditing(t);
            }}
          >
            <Pencil className="h-4 w-4" />
          </button>
        ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={<UsersRound className="h-5 w-5" />} label="Equipes" value={s ? num(s.teams) : "—"} />
        <StatCard icon={<Users className="h-5 w-5" />} label="Membros" value={s ? num(s.members) : "—"} />
        <StatCard icon={<Wallet className="h-5 w-5" />} label="Vendas acumuladas" value={s ? cents(s.salesCents) : "—"} />
        <StatCard
          icon={<Target className="h-5 w-5" />}
          label={`Bateram a meta (${s ? competence(s.currentCompetence) : "—"})`}
          value={s ? `${s.onTarget} de ${s.teams}` : "—"}
        />
      </div>

      <Toolbar
        actions={
          canManage && (
            <button className={primaryButton} onClick={() => setEditing("new")}>
              <Plus className="h-4 w-4" /> Nova equipe
            </button>
          )
        }
      >
        <SearchInput placeholder="Nome da equipe" value={list.filters.search} onChange={(search) => list.patch({ search })} />
        <FilterPanel onApply={list.applyPanel}>
          <Field label="Distribuidora">
            <select name="distributor_id" className={fieldClass} defaultValue="">
              <option value="">Todas</option>
              {lookups.data?.distributors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
        </FilterPanel>
      </Toolbar>

      <DataTable
        columns={columns}
        page={list.data}
        isLoading={list.isLoading}
        isError={list.isError}
        onPageChange={list.setPage}
        sort={list.sort}
        onSort={list.onSort}
        onRowClick={setOpen}
        minWidth={1050}
        empty="Nenhuma equipe sob sua responsabilidade."
      />

      <TeamFormDialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} team={editing === "new" ? null : editing} />
      <TeamDialog team={open} onClose={() => setOpen(null)} />
    </div>
  );
}

type Form = { name: string; distributorId: string; managerId: string; goal: string; status: string };

export function TeamFormDialog({
  open,
  onOpenChange,
  team,
  distributorId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  team: TeamRow | null;
  distributorId?: number;
}) {
  const qc = useQueryClient();
  const lookups = useLookups();
  const me = useAuth((s) => s.user);
  const [form, setForm] = useState<Form>({ name: "", distributorId: "", managerId: "", goal: "", status: "active" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const managers = useManagers(form.distributorId ? Number(form.distributorId) : null);
  const isManagerOnly = me?.scope === "team";

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setForm(
      team
        ? { name: team.name, distributorId: String(team.distributorId), managerId: team.managerId ? String(team.managerId) : "", goal: String(team.goalCents / 100), status: team.status }
        : { name: "", distributorId: distributorId ? String(distributorId) : me?.distributorId ? String(me.distributorId) : "", managerId: "", goal: "50000", status: "active" },
    );
  }, [open, team]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (p: Partial<Form>) => setForm((f) => ({ ...f, ...p }));

  const submit = async () => {
    const e: Record<string, string> = {};
    if (form.name.trim().length < 3) e.name = "Informe o nome";
    if (!form.distributorId) e.distributorId = "Escolha a distribuidora";
    const goal = Number(form.goal.replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(goal) || goal < 0) e.goal = "Valor inválido";
    setErrors(e);
    if (Object.keys(e).length) return;
    const body = {
      name: form.name,
      distributorId: Number(form.distributorId),
      managerId: form.managerId ? Number(form.managerId) : null,
      goalCents: Math.round(goal * 100),
      status: form.status,
    };
    setBusy(true);
    try {
      if (team) await api.patch(`/teams/${team.id}`, body);
      else await api.post("/teams", body);
      toast.success(team ? "Equipe atualizada" : "Equipe criada");
      void qc.invalidateQueries({ queryKey: ["teams"] });
      void qc.invalidateQueries({ queryKey: ["team"] });
      void qc.invalidateQueries({ queryKey: ["distributor"] });
      void qc.invalidateQueries({ queryKey: ["lookups"] });
      onOpenChange(false);
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={team ? `Editar ${team.name}` : "Nova equipe"} onSubmit={submit} busy={busy}>
      <Field label="Nome" error={errors.name}>
        <input className={fieldClass} value={form.name} onChange={(e) => set({ name: e.target.value })} autoFocus />
      </Field>
      <Field label="Distribuidora" error={errors.distributorId}>
        <select className={fieldClass} value={form.distributorId} disabled={isManagerOnly && !!team} onChange={(e) => set({ distributorId: e.target.value, managerId: "" })}>
          <option value="">— escolha —</option>
          {lookups.data?.distributors.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Gerente" hint={isManagerOnly ? "Gerentes não trocam o gerente da equipe." : "Os membros passam a responder a este gerente."}>
        <select className={fieldClass} value={form.managerId} disabled={!form.distributorId || isManagerOnly} onChange={(e) => set({ managerId: e.target.value })}>
          <option value="">{isManagerOnly ? "— você —" : "— sem gerente —"}</option>
          {managers.data?.data.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Meta padrão (R$)" hint="Sugerida ao definir a meta de um mês novo em Metas" error={errors.goal}>
          <input className={fieldClass} inputMode="decimal" value={form.goal} onChange={(e) => set({ goal: e.target.value })} />
        </Field>
        <Field label="Status">
          <select className={fieldClass} value={form.status} onChange={(e) => set({ status: e.target.value })}>
            <option value="active">Ativa</option>
            <option value="inactive">Inativa</option>
          </select>
        </Field>
      </div>
    </FormDialog>
  );
}

/** detalhe da equipe: indicadores, ranking, vincular e transferir vendedores */
export function TeamDialog({ team, onClose }: { team: TeamRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const canManage = useCan("TEAMS_MANAGE");
  const [tab, setTab] = useState<"ranking" | "add">("ranking");
  const [transfer, setTransfer] = useState(false);
  const members = useSelection<number>();
  const detail = useQuery({
    queryKey: ["team", team?.id],
    queryFn: () => api.get<TeamRow & { ranking: RankRow[] }>(`/teams/${team!.id}`),
    enabled: !!team,
  });
  useEffect(() => {
    setTab("ranking");
    members.clear();
  }, [team?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["team"] });
    void qc.invalidateQueries({ queryKey: ["teams"] });
    void qc.invalidateQueries({ queryKey: ["users"] });
    void qc.invalidateQueries({ queryKey: ["distributor"] });
  };

  const d = detail.data;
  return (
    <ViewDialog open={!!team} onOpenChange={(o) => !o && onClose()} title={team?.name} wide>
      {!d ? (
        <div className="space-y-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-64" />
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Info label="Distribuidora">{d.distributorName}</Info>
            <Info label="Gerente">{d.managerName}</Info>
            <Info label="Membros">
              {num(d.members)} ({num(d.activeMembers)} ativos)
            </Info>
            <Info label="Pontos">{num(d.points)}</Info>
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold text-[#8C8C96]">
              Meta do mês: {cents(d.monthCents)} de {cents(d.monthGoalCents)}
            </p>
            <GoalBar pct={d.monthGoalCents ? d.goalPct : null} />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Tabs
              value={tab}
              onChange={setTab}
              tabs={[
                { value: "ranking", label: <><Medal className="h-4 w-4" /> Ranking e membros</> },
                ...(canManage ? [{ value: "add" as const, label: <><UserPlus className="h-4 w-4" /> Vincular vendedores</> }] : []),
              ]}
            />
            {tab === "ranking" && canManage && members.selected.size > 0 && (
              <button className={primaryButton} onClick={() => setTransfer(true)}>
                <ArrowRightLeft className="h-4 w-4" /> Transferir {members.selected.size}
              </button>
            )}
          </div>

          {tab === "ranking" ? (
            d.ranking.length === 0 ? (
              <EmptyState title="Equipe sem vendedores">Use “Vincular vendedores” para montar a equipe.</EmptyState>
            ) : (
              <div className="max-h-[420px] overflow-auto rounded-xl border border-[#E5E7EB] dark:border-border/40">
                <table className="w-full min-w-[560px] text-sm">
                  <thead className="sticky top-0 bg-[#FBFBFC] text-xs uppercase text-[#73737D] dark:bg-[#071E24] dark:text-muted-foreground">
                    <tr>
                      {canManage && (
                        <th className="w-10 px-3 py-2">
                          <input
                            type="checkbox"
                            aria-label="Selecionar todos"
                            className="h-4 w-4 accent-[#00E6A0]"
                            checked={d.ranking.every((r) => members.selected.has(r.id))}
                            onChange={(e) => members.setAll(d.ranking.map((r) => r.id), e.target.checked)}
                          />
                        </th>
                      )}
                      <th className="px-3 py-2 text-left">#</th>
                      <th className="px-3 py-2 text-left">Vendedor</th>
                      <th className="px-3 py-2 text-right">No mês</th>
                      <th className="px-3 py-2 text-right">Acumulado</th>
                      <th className="px-3 py-2 text-right">Pontos</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E5E7EB] dark:divide-border/40">
                    {d.ranking.map((r) => (
                      <tr key={r.id} className={cn(members.selected.has(r.id) && "bg-[#00E6A0]/[0.07]")}>
                        {canManage && (
                          <td className="px-3 py-2">
                            <input type="checkbox" aria-label={`Selecionar ${r.name}`} className="h-4 w-4 accent-[#00E6A0]" checked={members.selected.has(r.id)} onChange={() => members.toggle(r.id)} />
                          </td>
                        )}
                        <td className="px-3 py-2 font-bold">{r.position <= 3 ? <Badge tone={r.position === 1 ? "yellow" : "gray"}>{r.position}º</Badge> : `${r.position}º`}</td>
                        <td className="px-3 py-2">
                          <span className="font-semibold text-[#1F1F24] dark:text-white">{r.name}</span> {r.status !== "active" && <StatusBadge status={r.status} />}
                        </td>
                        <td className="px-3 py-2 text-right">{cents(r.monthCents)}</td>
                        <td className="px-3 py-2 text-right font-semibold">{cents(r.salesCents)}</td>
                        <td className="px-3 py-2 text-right">{num(r.points)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            <Candidates team={d} onDone={refresh} />
          )}
        </div>
      )}
      {d && (
        <TransferDialog
          open={transfer}
          onOpenChange={setTransfer}
          from={d}
          ids={[...members.selected]}
          onDone={() => {
            members.clear();
            refresh();
          }}
        />
      )}
    </ViewDialog>
  );
}

/** vendedores da distribuidora fora da equipe (primeiro os sem equipe) */
function Candidates({ team, onDone }: { team: TeamRow; onDone: () => void }) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const sel = useSelection<number>();
  const [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ["team-candidates", team.id, search, page],
    queryFn: () => api.get<Page<UserRow>>(`/teams/${team.id}/candidates`, { search, page, per_page: 10 }),
    placeholderData: (p) => p,
  });

  const link = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ linked: number; transferred: number }>(`/teams/${team.id}/members`, { userIds: [...sel.selected] });
      toast.success(`${r.linked} vendedor(es) vinculado(s)` + (r.transferred ? `, ${r.transferred} transferido(s) de outra equipe` : ""));
      sel.clear();
      void q.refetch();
      onDone();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SearchInput
          placeholder="Buscar vendedor da distribuidora"
          value={search}
          onChange={(s) => {
            setSearch(s);
            setPage(1);
          }}
        />
        <button className={primaryButton} disabled={!sel.selected.size || busy} onClick={link}>
          <UserPlus className="h-4 w-4" /> Vincular {sel.selected.size || ""}
        </button>
      </div>
      <DataTable
        columns={[
          { header: "Vendedor", width: "minmax(180px,1.5fr)", cell: (u) => <><Strong>{u.name}</Strong><Sub>{u.email}</Sub></> },
          { header: "Equipe atual", width: "minmax(140px,1fr)", cell: (u) => u.teamName ?? <Badge tone="yellow">sem equipe</Badge> },
          { header: "Status", width: "100px", cell: (u) => <StatusBadge status={u.status} /> },
        ]}
        page={q.data}
        isLoading={q.isLoading}
        isError={q.isError}
        onPageChange={setPage}
        selection={sel}
        minWidth={520}
        empty="Todos os vendedores da distribuidora já estão nesta equipe."
      />
      <p className="text-xs text-[#8C8C96]">Vendedor que já está em outra equipe é transferido (fica registrado na auditoria).</p>
    </div>
  );
}

function TransferDialog({ open, onOpenChange, from, ids, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; from: TeamRow; ids: number[]; onDone: () => void }) {
  const lookups = useLookups();
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const options = (lookups.data?.teams ?? []).filter((t) => t.id !== from.id);
  const submit = async () => {
    if (!target) return toast.error("Escolha a equipe de destino");
    setBusy(true);
    try {
      await api.post(`/teams/${target}/members`, { userIds: ids });
      toast.success(`${ids.length} vendedor(es) transferido(s)`);
      onOpenChange(false);
      onDone();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Transferir ${ids.length} vendedor(es)`}
      description={`Saem de ${from.name}. Equipe de outra distribuidora também muda a distribuidora do vendedor.`}
      onSubmit={submit}
      busy={busy}
      submitLabel="Transferir"
    >
      <Field label="Equipe de destino">
        <select className={fieldClass} value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">— escolha —</option>
          {options
            .slice()
            .sort((a, b) => Number(b.distributorId === from.distributorId) - Number(a.distributorId === from.distributorId))
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} {t.distributorId === from.distributorId ? "(mesma distribuidora)" : `(${lookups.data?.distributors.find((d) => d.id === t.distributorId)?.name ?? ""})`}
              </option>
            ))}
        </select>
      </Field>
    </FormDialog>
  );
}
