import {
  Badge,
  card,
  DataTable,
  EmptyState,
  Panel,
  primaryButton,
  SearchInput,
  secondaryButton,
  Skeleton,
  StatCard,
  StatusBadge,
  Strong,
  Sub,
  Tabs,
  useList,
} from "@/shared/components/kit";
import { api, cents, competence, formatDate, formatDay, num, useCan } from "@/shared/lib/api";
import { cn } from "@/shared/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Coins, Megaphone, Pencil, Plus, Target, Users, UsersRound, Wallet } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { DistributorFormDialog, type DistributorRow } from "./DistributorsPage";
import { GoalBar, Info, MonthlyPointsChart, MonthlySalesChart, UserFormDialog, TempPasswordDialog, type UserRow } from "./shared";
import { TeamDialog, TeamFormDialog, type TeamRow } from "./TeamsPage";

type TeamOverview = TeamRow & { monthCents: number; goalPct: number | null };

interface Overview {
  distributor: DistributorRow;
  currentCompetence: string;
  kpis: { salesCents: number; points: number; sellers: number; activeSellers: number; teams: number; monthCents: number; goalCents: number; goalPct: number | null };
  monthly: { competence: string; salesCents: number; points: number; count: number }[];
  teams: TeamOverview[];
  campaigns: { id: number; name: string; description: string; status: string; startDate: string; endDate: string; distributorIds: number[] }[];
  imports: { id: number; competence: string; fileName: string; userName: string; status: string; total: number; valid: number; invalid: number; creditedPoints: number; createdAt: string }[];
  lastSales: { id: number; document: string; date: string; quantity: number; amountCents: number; points: number; sellerName: string; productName: string }[];
}

type Tab = "dashboard" | "teams" | "sellers" | "goals" | "sales" | "imports" | "campaigns";

export function DistributorDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const canEdit = useCan("USERS_EDIT");
  const [tab, setTab] = useState<Tab>("dashboard");
  const [editing, setEditing] = useState(false);
  const q = useQuery({ queryKey: ["distributor", id], queryFn: () => api.get<Overview>(`/distributors/${id}/overview`) });

  if (q.isError)
    return (
      <div className={card}>
        <EmptyState title="Distribuidora não encontrada">Ela não existe ou está fora do seu escopo de acesso.</EmptyState>
      </div>
    );
  const o = q.data;
  const d = o?.distributor;

  return (
    <div className="space-y-5">
      <button className={secondaryButton} onClick={() => navigate("/distribuidoras")}>
        <ArrowLeft className="h-4 w-4" /> Distribuidoras
      </button>

      <section className={cn(card, "p-5")}>
        {!d ? (
          <Skeleton className="h-16" />
        ) : (
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-bold text-[#1F1F24] dark:text-white">{d.name}</h2>
                <Badge tone="gray">{d.code}</Badge>
                <StatusBadge status={d.status} />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Info label="CNPJ">{d.cnpj}</Info>
                <Info label="Região">{d.region}</Info>
                <Info label="Responsável">{d.responsible}</Info>
                <Info label="Ponto focal">{d.focal?.name ?? "não definido"}</Info>
              </div>
            </div>
            {canEdit && (
              <button className={secondaryButton} onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4" /> Editar
              </button>
            )}
          </div>
        )}
      </section>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "dashboard", label: "Dashboard" },
          { value: "teams", label: "Equipes" },
          { value: "sellers", label: "Vendedores" },
          { value: "goals", label: "Metas" },
          { value: "sales", label: "Vendas" },
          { value: "imports", label: "Importações" },
          { value: "campaigns", label: "Campanhas" },
        ]}
      />

      {!o ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
        </div>
      ) : tab === "dashboard" ? (
        <Dashboard o={o} />
      ) : tab === "teams" ? (
        <Teams o={o} />
      ) : tab === "sellers" ? (
        <Sellers id={Number(id)} />
      ) : tab === "goals" ? (
        <Goals o={o} />
      ) : tab === "sales" ? (
        <Sales o={o} />
      ) : tab === "imports" ? (
        <Imports o={o} />
      ) : (
        <Campaigns o={o} />
      )}

      {d && <DistributorFormDialog open={editing} onOpenChange={setEditing} distributor={d} />}
    </div>
  );
}

function Dashboard({ o }: { o: Overview }) {
  const k = o.kpis;
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={<Wallet className="h-5 w-5" />} label="Vendas acumuladas" value={cents(k.salesCents)} caption={`${cents(k.monthCents)} em ${competence(o.currentCompetence)}`} />
        <StatCard icon={<Coins className="h-5 w-5" />} label="Pontos distribuídos" value={num(k.points)} />
        <StatCard icon={<Users className="h-5 w-5" />} label="Vendedores" value={num(k.sellers)} caption={`${num(k.activeSellers)} ativos · ${k.teams} equipe(s)`} />
        <StatCard
          icon={<Target className="h-5 w-5" />}
          label={`Meta ${competence(o.currentCompetence)}`}
          value={k.goalPct == null ? "—" : `${k.goalPct}%`}
          caption={`${cents(k.monthCents)} de ${cents(k.goalCents)}`}
          tone={k.goalPct != null && k.goalPct < 70 ? "warning" : undefined}
        />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Vendas por mês" icon={<Wallet className="h-4 w-4" />}>
          {o.monthly.length ? <MonthlySalesChart data={o.monthly} /> : <EmptyState title="Sem vendas processadas" />}
        </Panel>
        <Panel title="Pontos creditados por mês" icon={<Coins className="h-4 w-4" />}>
          {o.monthly.length ? <MonthlyPointsChart data={o.monthly} /> : <EmptyState title="Sem pontos" />}
        </Panel>
      </div>
    </div>
  );
}

function Teams({ o }: { o: Overview }) {
  const canManage = useCan("TEAMS_MANAGE");
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<TeamRow | null>(null);
  return (
    <Panel
      title={`Equipes (${o.teams.length})`}
      icon={<UsersRound className="h-4 w-4" />}
      actions={
        canManage && (
          <button className={primaryButton} onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Nova equipe
          </button>
        )
      }
    >
      {!o.teams.length ? (
        <EmptyState title="Nenhuma equipe">Crie uma equipe e vincule os vendedores da distribuidora.</EmptyState>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {o.teams.map((t) => (
            <button key={t.id} onClick={() => setOpen(t)} className={cn(card, "space-y-3 p-4 text-left transition-colors hover:border-[#00E6A0]/50")}>
              <div>
                <Strong>{t.name}</Strong>
                <Sub>Gerente: {t.managerName ?? "—"}</Sub>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <Info label="Membros">{num(t.members)}</Info>
                <Info label="Vendas">{cents(t.salesCents)}</Info>
                <Info label="Pontos">{num(t.points)}</Info>
              </div>
              <GoalBar pct={t.goalPct} />
            </button>
          ))}
        </div>
      )}
      <TeamFormDialog open={creating} onOpenChange={setCreating} team={null} distributorId={o.distributor.id} />
      <TeamDialog team={open} onClose={() => setOpen(null)} />
    </Panel>
  );
}

type SellerRow = UserRow & { salesCents: number; points: number };

function Sellers({ id }: { id: number }) {
  const list = useList<SellerRow>("users", `/distributors/${id}/sellers`);
  const canCreate = useCan("USERS_CREATE");
  const [creating, setCreating] = useState(false);
  const [password, setPassword] = useState<{ value: string; who: string } | null>(null);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SearchInput placeholder="Nome ou e-mail" value={list.filters.search} onChange={(search) => list.patch({ search })} />
        {canCreate && (
          <button className={primaryButton} onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Novo vendedor
          </button>
        )}
      </div>
      <DataTable
        columns={[
          { header: "Vendedor", width: "minmax(180px,1.5fr)", cell: (u) => <><Strong>{u.name}</Strong><Sub>{u.email}</Sub></> },
          { header: "Equipe", width: "minmax(120px,1fr)", cell: (u) => u.teamName ?? <Badge tone="yellow">sem equipe</Badge> },
          { header: "Gerente", width: "minmax(120px,1fr)", cell: (u) => u.managerName ?? "—" },
          { header: "Vendas", width: "130px", className: "text-right", cell: (u) => <Strong>{cents(u.salesCents)}</Strong> },
          { header: "Pontos", width: "90px", className: "text-right", cell: (u) => num(u.points) },
          { header: "Status", width: "100px", cell: (u) => <StatusBadge status={u.status} /> },
        ]}
        page={list.data}
        isLoading={list.isLoading}
        isError={list.isError}
        onPageChange={list.setPage}
        minWidth={860}
      />
      <UserFormDialog open={creating} onOpenChange={setCreating} defaultProfiles={["seller"]} defaultDistributorId={id} onCreated={(value, who) => setPassword({ value, who })} />
      <TempPasswordDialog password={password?.value ?? null} who={password?.who} onClose={() => setPassword(null)} />
    </div>
  );
}

function Goals({ o }: { o: Overview }) {
  return (
    <Panel title={`Metas de ${competence(o.currentCompetence)}`} icon={<Target className="h-4 w-4" />}>
      <div className="mb-4">
        <p className="mb-1 text-sm font-semibold">
          Distribuidora: {cents(o.kpis.monthCents)} de {cents(o.kpis.goalCents)}
        </p>
        <GoalBar pct={o.kpis.goalPct} />
      </div>
      <div className="divide-y divide-[#E5E7EB] dark:divide-border/40">
        {o.teams.map((t) => (
          <div key={t.id} className="grid items-center gap-2 py-3 sm:grid-cols-[1fr_200px_minmax(160px,1fr)]">
            <div>
              <Strong>{t.name}</Strong>
              <Sub>{t.managerName ?? "sem gerente"}</Sub>
            </div>
            <span className="text-sm">
              {cents(t.monthCents)} / <b>{cents(t.monthGoalCents)}</b>
            </span>
            <GoalBar pct={t.goalPct} />
          </div>
        ))}
      </div>
      {!o.teams.length && <EmptyState title="Sem equipes, sem metas" />}
      <p className="mt-3 text-xs text-[#8C8C96]">A meta mensal é definida em cada equipe (Equipes → editar).</p>
    </Panel>
  );
}

function Sales({ o }: { o: Overview }) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <Panel title="Últimas vendas pontuadas" icon={<Wallet className="h-4 w-4" />}>
        {!o.lastSales.length ? (
          <EmptyState title="Nenhuma venda" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead className="text-xs uppercase text-[#73737D] dark:text-muted-foreground">
                <tr>
                  <th className="py-2 text-left">Data</th>
                  <th className="py-2 text-left">Documento</th>
                  <th className="py-2 text-left">Vendedor</th>
                  <th className="py-2 text-left">Produto</th>
                  <th className="py-2 text-right">Qtd</th>
                  <th className="py-2 text-right">Valor</th>
                  <th className="py-2 text-right">Pontos</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB] dark:divide-border/40">
                {o.lastSales.map((s) => (
                  <tr key={s.id}>
                    <td className="py-2">{formatDay(s.date)}</td>
                    <td className="py-2 font-mono text-xs">{s.document}</td>
                    <td className="py-2">{s.sellerName}</td>
                    <td className="max-w-[180px] truncate py-2">{s.productName}</td>
                    <td className="py-2 text-right">{s.quantity}</td>
                    <td className="py-2 text-right font-semibold">{cents(s.amountCents)}</td>
                    <td className="py-2 text-right">{num(s.points)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel title="Por competência" icon={<Coins className="h-4 w-4" />}>
        <ul className="divide-y divide-[#E5E7EB] text-sm dark:divide-border/40">
          {[...o.monthly].reverse().map((m) => (
            <li key={m.competence} className="flex justify-between py-2">
              <span>
                {competence(m.competence)} <span className="text-xs text-[#8C8C96]">({num(m.count)} vendas)</span>
              </span>
              <b>{cents(m.salesCents)}</b>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function Imports({ o }: { o: Overview }) {
  return (
    <Panel title="Histórico de importações" icon={<Wallet className="h-4 w-4" />}>
      {!o.imports.length ? (
        <EmptyState title="Nenhuma planilha enviada" />
      ) : (
        <div className="divide-y divide-[#E5E7EB] dark:divide-border/40">
          {o.imports.map((b) => (
            <Link key={b.id} to={`/importacao/lotes/${b.id}`} className="grid items-center gap-2 py-3 hover:bg-[#00E6A0]/5 sm:grid-cols-[110px_minmax(0,1fr)_180px_170px]">
              <Strong>{competence(b.competence)}</Strong>
              <span className="min-w-0">
                <span className="block truncate text-sm">
                  #{b.id} · {b.fileName}
                </span>
                <Sub>
                  {b.userName} · {formatDate(b.createdAt)}
                </Sub>
              </span>
              <span className="text-xs">
                {num(b.valid)} válidos · <span className={b.invalid ? "font-bold text-destructive" : ""}>{num(b.invalid)} inválidos</span>
                {b.creditedPoints > 0 && <> · {num(b.creditedPoints)} pts</>}
              </span>
              <StatusBadge status={b.status} />
            </Link>
          ))}
        </div>
      )}
    </Panel>
  );
}

function Campaigns({ o }: { o: Overview }) {
  return !o.campaigns.length ? (
    <div className={card}>
      <EmptyState title="Nenhuma campanha vinculada" />
    </div>
  ) : (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {o.campaigns.map((c) => (
        <Link key={c.id} to={`/campanhas/${c.id}`} className={cn(card, "space-y-2 p-4 transition-colors hover:border-[#00E6A0]/50")}>
          <div className="flex items-start justify-between gap-2">
            <span className="flex items-center gap-2 font-bold text-[#1F1F24] dark:text-white">
              <Megaphone className="h-4 w-4 text-[#00A876] dark:text-[#00E6A0]" />
              {c.name}
            </span>
            <StatusBadge status={c.status} />
          </div>
          <p className="line-clamp-2 text-sm text-[#73737D] dark:text-muted-foreground">{c.description}</p>
          <p className="text-xs text-[#8C8C96]">
            {formatDay(c.startDate)} a {formatDay(c.endDate)} · {c.distributorIds.length ? "participantes selecionadas" : "todas as distribuidoras"}
          </p>
        </Link>
      ))}
    </div>
  );
}
