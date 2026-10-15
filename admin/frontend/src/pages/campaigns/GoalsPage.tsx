import {
  Badge,
  card,
  DataTable,
  EmptyState,
  Field,
  fieldClass,
  FormDialog,
  iconButton,
  primaryButton,
  SearchInput,
  secondaryButton,
  Skeleton,
  StatCard,
  StatusBadge,
  Strong,
  Sub,
  Tabs,
  Toolbar,
  useConfirm,
  useList,
  type Column,
} from "@/shared/components/kit";
import { api, cents, competence, formatDay, num, useCan, useLookups } from "@/shared/lib/api";
import { toast } from "@/shared/lib/toast";
import { cn } from "@/shared/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Gift, Pencil, Plus, Target, Trash2, Trophy, UsersRound } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { fail, fromCents, MONTHS, Progress, toCents } from "./shared";

interface TeamGoal {
  /** equipe:competência (aba "todas") ou id da equipe */
  id: string;
  teamId: number;
  competence: string;
  name: string;
  /** null = equipe sem meta nesta competência */
  goalCents: number | null;
  defaultGoalCents: number;
  goalByName: string | null;
  soldCents: number;
  distributorName: string;
  managerName: string | null;
  members: number;
  percent: number;
  reached: boolean;
  bonusLaunched: boolean;
}

interface TeamSummary {
  competence: string;
  teams: number;
  withGoal: number;
  reached: number;
  pendingBonus: number;
  goalCents: number;
  soldCents: number;
}

interface CampaignGoal {
  id: number;
  name: string;
  status: string;
  startDate: string;
  endDate: string;
  goalCents: number;
  soldCents: number;
  monthCents: number;
  percent: number;
}

const pct = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

export function GoalsPage() {
  const [tab, setTab] = useState<"teams" | "campaigns">("teams");
  const [month, setMonth] = useState("2026-09");
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs
          tabs={[
            { value: "teams", label: "Metas das equipes" },
            { value: "campaigns", label: "Metas das campanhas" },
          ]}
          value={tab}
          onChange={setTab}
        />
        <label className="flex items-center gap-2 text-sm font-semibold text-[#73737D] dark:text-muted-foreground">
          Competência
          <select className={cn(fieldClass, "w-48")} value={tab === "teams" ? month : month === "all" ? "2026-09" : month} onChange={(e) => setMonth(e.target.value)}>
            {tab === "teams" && <option value="all">Todas as competências</option>}
            {MONTHS.map((m) => (
              <option key={m} value={m}>
                {competence(m)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {tab === "teams" ? <TeamGoals key={month} month={month} /> : <CampaignGoals month={month === "all" ? "2026-09" : month} />}
    </div>
  );
}

type Editing = { teamId?: number; name?: string; competence: string; goalCents: number | null; soldCents?: number };

function TeamGoals({ month }: { month: string }) {
  const lookups = useLookups().data;
  const all = month === "all";
  const canBonus = useCan("CAMPAIGNS_MANAGE");
  const qc = useQueryClient();
  const confirm = useConfirm();
  const list = useList<TeamGoal, TeamSummary>("team-goals", "/campaigns/goals/teams", { competence: month });
  const [editing, setEditing] = useState<Editing | null>(null);
  const s = list.data?.summary;

  const bonus = useMutation({
    mutationFn: () => api.post<{ teams: number; sellers: number; points: number; skipped: string[] }>("/campaigns/goals/bonus", { competence: month }),
    onSuccess: (r) => {
      if (r.teams) toast.success(`Bônus lançado para ${r.teams} equipe(s)`, { description: `${num(r.sellers)} vendedores · ${num(r.points)} pts` });
      else toast.info("Nenhum bônus novo para lançar", { description: r.skipped.length ? `Já lançados: ${r.skipped.join(", ")}` : undefined });
      qc.invalidateQueries({ queryKey: ["team-goals"] });
    },
    onError: fail,
  });

  const remove = useMutation({
    mutationFn: (t: TeamGoal) => api.delete(`/campaigns/goals/teams/${t.teamId}/${t.competence}`),
    onSuccess: (_, t) => {
      toast.success(`Meta de ${t.name} em ${competence(t.competence)} removida`);
      qc.invalidateQueries({ queryKey: ["team-goals"] });
    },
    onError: fail,
  });

  const edit = (t: TeamGoal) =>
    setEditing({ teamId: t.teamId, name: t.name, competence: t.competence, goalCents: t.goalCents ?? t.defaultGoalCents, soldCents: t.soldCents });

  const columns: Column<TeamGoal>[] = [
    { header: "Competência", width: "110px", sort: "competence", cell: (t) => <Strong>{competence(t.competence)}</Strong> },
    {
      header: "Equipe",
      width: "minmax(170px,1.4fr)",
      sort: "name",
      cell: (t) => (
        <>
          <Strong>{t.name}</Strong>
          <Sub>{t.managerName ?? "Sem gerente"}</Sub>
        </>
      ),
    },
    { header: "Distribuidora", width: "minmax(140px,1fr)", cell: (t) => t.distributorName },
    { header: "Membros", width: "80px", className: "text-right", cell: (t) => num(t.members) },
    {
      header: "Meta",
      width: "120px",
      className: "text-right",
      sort: "goalCents",
      cell: (t) => (t.goalCents != null ? <span title={t.goalByName ? `Definida por ${t.goalByName}` : undefined}>{cents(t.goalCents)}</span> : <Badge tone="gray">Sem meta</Badge>),
    },
    { header: "Vendido", width: "120px", className: "text-right", sort: "soldCents", cell: (t) => <Strong>{cents(t.soldCents)}</Strong> },
    {
      header: "Atingido",
      width: "minmax(130px,1fr)",
      sort: "percent",
      cell: (t) =>
        t.goalCents != null ? (
          <div className="flex items-center gap-2">
            <Progress value={t.percent} />
            <span className="w-14 shrink-0 text-right text-xs font-bold text-[#1F1F24] dark:text-white">{pct(t.percent)}</span>
          </div>
        ) : (
          <span className="text-xs">—</span>
        ),
    },
    {
      header: "Bônus",
      width: "110px",
      cell: (t) =>
        t.bonusLaunched ? (
          <Badge tone="green">
            <CheckCircle2 className="h-3 w-3" /> Lançado
          </Badge>
        ) : t.reached ? (
          <Badge tone="yellow">Pendente</Badge>
        ) : (
          <span className="text-xs">—</span>
        ),
    },
    {
      header: "Ações",
      width: "84px",
      cell: (t) =>
        t.goalCents == null ? (
          <button className={cn(iconButton, "w-auto px-2 text-xs font-semibold")} onClick={() => edit(t)} aria-label={`Definir meta de ${t.name}`}>
            <Plus className="h-4 w-4" /> Definir
          </button>
        ) : (
          <div className="flex gap-1">
            <button className={iconButton} onClick={() => edit(t)} aria-label={`Editar meta de ${t.name} em ${competence(t.competence)}`} title="Editar meta">
              <Pencil className="h-4 w-4" />
            </button>
            <button
              className={cn(iconButton, "hover:bg-destructive/10 hover:text-destructive dark:hover:text-destructive")}
              disabled={t.bonusLaunched || remove.isPending}
              title={t.bonusLaunched ? "Bônus já lançado: estorne os bônus no extrato antes de remover" : "Remover meta"}
              aria-label={`Remover meta de ${t.name} em ${competence(t.competence)}`}
              onClick={() =>
                confirm.ask({
                  title: `Remover a meta de ${t.name}?`,
                  description: (
                    <>
                      A meta de <b>{cents(t.goalCents!)}</b> em <b>{competence(t.competence)}</b> será removida e a equipe fica sem meta nesse mês (não conta
                      para bônus nem para “metas atingidas”). A remoção fica registrada na auditoria.
                    </>
                  ),
                  confirmLabel: "Remover meta",
                  danger: true,
                  run: () => remove.mutate(t),
                })
              }
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<UsersRound className="h-5 w-5" />}
          label={all ? "Metas cadastradas" : "Equipes com meta"}
          value={s ? (all ? num(s.teams) : `${num(s.withGoal)} de ${num(s.teams)}`) : "—"}
          caption={all ? "todas as competências" : competence(month)}
        />
        <StatCard icon={<Trophy className="h-5 w-5" />} label="Bateram a meta" value={s ? num(s.reached) : "—"} caption={s && s.withGoal ? pct((s.reached / s.withGoal) * 100) : undefined} />
        <StatCard icon={<Target className="h-5 w-5" />} label="Vendido / meta" value={s ? pct(s.goalCents ? (s.soldCents / s.goalCents) * 100 : 0) : "—"} caption={s ? `${cents(s.soldCents)} de ${cents(s.goalCents)}` : undefined} />
        <StatCard
          icon={<Gift className="h-5 w-5" />}
          label="Bônus pendentes"
          value={all ? "—" : s ? num(s.pendingBonus) : "—"}
          tone={!all && s?.pendingBonus ? "warning" : undefined}
          caption={all ? "escolha uma competência" : "equipes que bateram e ainda não receberam"}
        />
      </div>

      <Toolbar
        actions={
          <>
            <button className={secondaryButton} onClick={() => setEditing({ competence: all ? "2026-10" : month, goalCents: null })}>
              <Plus className="h-4 w-4" /> Nova meta
            </button>
            {canBonus && !all && (
              <button
                className={primaryButton}
                disabled={!s?.pendingBonus || bonus.isPending}
                onClick={() =>
                  confirm.ask({
                    title: `Lançar bônus de meta de ${competence(month)}?`,
                    description: (
                      <>
                        {s?.pendingBonus} equipe(s) bateram a meta e ainda não receberam. Cada vendedor ativo dessas equipes recebe os pontos da regra
                        “Bônus meta” vigente. A operação é idempotente: rodar de novo não lança duas vezes.
                      </>
                    ),
                    confirmLabel: "Lançar bônus",
                    run: () => bonus.mutate(),
                  })
                }
              >
                <Gift className="h-4 w-4" /> {bonus.isPending ? "Lançando..." : `Lançar bônus de meta${s?.pendingBonus ? ` (${s.pendingBonus})` : ""}`}
              </button>
            )}
          </>
        }
      >
        <SearchInput value={list.filters.search} onChange={(search) => list.patch({ search })} placeholder="Buscar equipe, gerente..." />
        <select aria-label="Distribuidora" className={cn(fieldClass, "w-auto max-w-[240px]")} value={list.filters.distributorId ?? ""} onChange={(e) => list.patch({ distributorId: e.target.value })}>
          <option value="">Todas as distribuidoras</option>
          {lookups?.distributors.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
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
        empty={all ? "Nenhuma meta cadastrada." : "Nenhuma equipe no seu escopo."}
      />
      <p className="text-xs text-[#8C8C96] dark:text-muted-foreground">
        A meta vale só para a competência indicada. Remover uma meta deixa a equipe sem meta naquele mês; metas com bônus já lançado não podem ser removidas.
      </p>

      <GoalDialog editing={editing} onClose={() => setEditing(null)} />
      {confirm.dialog}
    </div>
  );
}

function GoalDialog({ editing, onClose }: { editing: Editing | null; onClose: () => void }) {
  const qc = useQueryClient();
  const teams = useLookups().data?.teams ?? [];
  const [form, setForm] = useState({ teamId: "", competence: "", value: "" });
  const [error, setError] = useState("");
  const [teamSearch, setTeamSearch] = useState("");
  const [opened, setOpened] = useState<Editing | null>(null);
  if (editing && opened !== editing) {
    setOpened(editing);
    setTeamSearch("");
    setForm({ teamId: editing.teamId ? String(editing.teamId) : "", competence: editing.competence, value: editing.goalCents != null ? fromCents(editing.goalCents) : "" });
    setError("");
  }
  const isNew = !editing?.teamId;
  const fold = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  // ponytail: a equipe escolhida continua na lista mesmo se não casar com a busca
  const shownTeams = teams.filter((t) => String(t.id) === form.teamId || fold(t.name).includes(fold(teamSearch)));
  const save = useMutation({
    mutationFn: (v: { teamId: string; competence: string; goalCents: number }) => api.put(`/campaigns/goals/teams/${v.teamId}/${v.competence}`, { goalCents: v.goalCents }),
    onSuccess: (_, v) => {
      toast.success(`Meta de ${competence(v.competence)} salva`);
      qc.invalidateQueries({ queryKey: ["team-goals"] });
      setOpened(null);
      onClose();
    },
    onError: fail,
  });
  return (
    <FormDialog
      open={!!editing}
      onOpenChange={(o) => {
        if (!o) {
          setOpened(null);
          onClose();
        }
      }}
      title={isNew ? "Nova meta mensal" : `Meta de ${editing?.name ?? ""} · ${competence(editing?.competence)}`}
      description={!isNew && editing?.soldCents != null ? `Vendido nesta competência: ${cents(editing.soldCents)}` : "Se a equipe já tiver meta nesta competência, ela será substituída."}
      busy={save.isPending}
      onSubmit={() => {
        const c = toCents(form.value);
        if (!form.teamId) return setError("Escolha a equipe");
        if (!/^\d{4}-\d{2}$/.test(form.competence)) return setError("Escolha a competência");
        if (!Number.isFinite(c) || c <= 0) return setError("Informe um valor maior que zero");
        save.mutate({ teamId: form.teamId, competence: form.competence, goalCents: c });
      }}
    >
      {isNew && (
        <>
          <Field label="Equipe" hint={teamSearch ? `${shownTeams.length} de ${teams.length} equipes` : undefined}>
            <input
              type="search"
              className={cn(fieldClass, "mb-2")}
              placeholder="Buscar pelo nome da equipe..."
              aria-label="Buscar equipe"
              value={teamSearch}
              onChange={(e) => {
                const v = e.target.value;
                const hits = teams.filter((t) => fold(t.name).includes(fold(v)));
                setTeamSearch(v);
                // um único resultado já fica selecionado
                if (v && hits.length === 1) setForm({ ...form, teamId: String(hits[0].id) });
              }}
            />
            <select
              className={fieldClass}
              value={form.teamId}
              onChange={(e) => setForm({ ...form, teamId: e.target.value })}
            >
              <option value="">{shownTeams.length ? "Selecione..." : "Nenhuma equipe encontrada"}</option>
              {shownTeams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Competência">
            <input type="month" className={fieldClass} value={form.competence} onChange={(e) => setForm({ ...form, competence: e.target.value })} />
          </Field>
        </>
      )}
      <Field label="Meta do mês (R$)" error={error} hint="Vale só para esta competência">
        <input className={fieldClass} inputMode="decimal" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} autoFocus={!isNew} />
      </Field>
    </FormDialog>
  );
}

function CampaignGoals({ month }: { month: string }) {
  const q = useQuery({ queryKey: ["campaign-goals", month], queryFn: () => api.get<CampaignGoal[]>("/campaigns/goals/campaigns", { competence: month }) });
  if (q.isLoading) return <div className="grid gap-4 md:grid-cols-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-36" />)}</div>;
  if (!q.data?.length)
    return (
      <div className={card}>
        <EmptyState title="Nenhuma campanha" />
      </div>
    );
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {q.data.map((c) => (
        <Link key={c.id} to={`/campanhas/${c.id}`} className={cn(card, "flex flex-col gap-3 p-5 transition-colors hover:border-[#00E6A0]/50")}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-bold text-[#1F1F24] dark:text-white">{c.name}</p>
              <p className="text-xs text-[#8C8C96]">
                {formatDay(c.startDate)} – {formatDay(c.endDate)}
              </p>
            </div>
            <StatusBadge status={c.status} />
          </div>
          {c.goalCents ? (
            <>
              <div className="flex items-end justify-between">
                <span className="text-2xl font-bold text-[#1F1F24] dark:text-white">{pct(c.percent)}</span>
                <span className="text-right text-xs text-[#73737D] dark:text-muted-foreground">
                  {cents(c.soldCents)} de {cents(c.goalCents)}
                </span>
              </div>
              <Progress value={c.percent} />
            </>
          ) : (
            <p className="text-sm text-[#73737D] dark:text-muted-foreground">Sem meta definida.</p>
          )}
          <p className="text-xs text-[#73737D] dark:text-muted-foreground">
            Em {competence(month)}: <b className="text-[#1F1F24] dark:text-white">{cents(c.monthCents)}</b>
          </p>
        </Link>
      ))}
    </div>
  );
}
