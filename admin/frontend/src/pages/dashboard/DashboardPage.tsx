import { card, EmptyState, fieldClass, Panel, Skeleton, StatCard, StatusBadge } from "@/shared/components/kit";
import { api, cents, competence, formatDate, formatDay, num, useCan, useLookups } from "@/shared/lib/api";
import { cn } from "@/shared/lib/utils";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Building2,
  CalendarClock,
  ClipboardCheck,
  CloudUpload,
  Coins,
  DollarSign,
  FileWarning,
  Megaphone,
  PackageSearch,
  Target,
  Trophy,
  UserCog,
  Users,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { AreaTrend, Bars, HBars } from "./charts";

type Batch = { id: number; distributorName: string; competence: string; fileName?: string; status: string; total?: number; valid?: number; invalid: number; error?: string | null; createdAt: string };

export interface Overview {
  period: { from: string; to: string };
  cards: {
    sellers: number;
    managers: number;
    activeDistributors: number;
    monthSales: { competence: string | null; amountCents: number; previousCents: number; variation: number | null };
    points: number;
    activeCampaigns: number;
    pendingFiles: number;
    goals: { competence: string; hit: number; total: number };
  };
  salesByMonth: { competence: string; amountCents: number; quantity: number; sales: number; points: number }[];
  distributorRanking: { id: number; name: string; amountCents: number; points: number }[];
  salesByProduct: { id: number; name: string; amountCents: number; quantity: number }[];
  campaignPerformance: { id: number; name: string; status: string; amountCents: number; goalCents: number }[];
  lastImports: Batch[];
  alerts: Batch[];
  activities: { id: number; actorName: string; description: string; createdAt: string }[];
  endingCampaigns: { id: number; name: string; endDate: string; daysLeft: number }[];
  missingDistributors: { competence: string; items: { id: number; name: string; code: string; region: string; lastCompetence: string | null }[] };
}

const MONTHS = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12"];

function Variation({ value }: { value: number | null }) {
  if (value === null) return <>sem mês anterior</>;
  const up = value >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn("inline-flex items-center gap-0.5 font-bold", up ? "text-[#047857] dark:text-[#34D399]" : "text-destructive")}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {up ? "+" : ""}
      {(value * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% vs mês anterior
    </span>
  );
}

const linkClass = "inline-flex items-center gap-1 text-xs font-bold text-[#00A876] hover:underline dark:text-[#00E6A0]";

function ListRow({ to, children }: { to?: string; children: React.ReactNode }) {
  const cls = "flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors hover:bg-[#00E6A0]/5";
  return to ? (
    <Link to={to} className={cls}>
      {children}
    </Link>
  ) : (
    <div className={cls}>{children}</div>
  );
}

export function DashboardPage() {
  const lookups = useLookups();
  const canImports = useCan("SALES_IMPORT", "SALES_VALIDATE", "SALES_APPROVE");
  const canActivity = useCan("REPORTS_VIEW");
  const [filters, setFilters] = useState({ from: "2026-01", to: "2026-09", distributorId: "", campaignId: "" });
  const { data, isLoading, isError } = useQuery({
    queryKey: ["dashboard", filters],
    queryFn: () => api.get<Overview>("/dashboard", filters),
    placeholderData: (p) => p,
  });
  const set = (k: keyof typeof filters) => (e: React.ChangeEvent<HTMLSelectElement>) => setFilters({ ...filters, [k]: e.target.value });
  const c = data?.cards;

  return (
    <div className="space-y-6">
      {/* filtros: sempre visíveis no topo */}
      <div className={cn(card, "grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4")}>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-[#73737D] dark:text-muted-foreground">De</span>
          <select className={fieldClass} value={filters.from} onChange={set("from")}>
            {MONTHS.filter((m) => m <= filters.to).map((m) => (
              <option key={m} value={m}>{competence(m)}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-[#73737D] dark:text-muted-foreground">Até</span>
          <select className={fieldClass} value={filters.to} onChange={set("to")}>
            {MONTHS.filter((m) => m >= filters.from).map((m) => (
              <option key={m} value={m}>{competence(m)}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-[#73737D] dark:text-muted-foreground">Distribuidora</span>
          <select className={fieldClass} value={filters.distributorId} onChange={set("distributorId")}>
            <option value="">Todas</option>
            {lookups.data?.distributors.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-[#73737D] dark:text-muted-foreground">Campanha</span>
          <select className={fieldClass} value={filters.campaignId} onChange={set("campaignId")}>
            <option value="">Todas</option>
            {lookups.data?.campaigns.map((cp) => (
              <option key={cp.id} value={cp.id}>{cp.name}</option>
            ))}
          </select>
        </label>
      </div>

      {isError && <EmptyState title="Não foi possível carregar o dashboard.">Verifique se o backend está rodando.</EmptyState>}

      {/* cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {!c ? (
          Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-[84px] rounded-2xl" />)
        ) : (
          <>
            <StatCard icon={<Users className="h-5 w-5" />} label="Vendedores ativos" value={num(c.sellers)} />
            <StatCard icon={<UserCog className="h-5 w-5" />} label="Gerentes" value={num(c.managers)} />
            <StatCard icon={<Building2 className="h-5 w-5" />} label="Distribuidoras ativas" value={num(c.activeDistributors)} />
            <StatCard
              icon={<DollarSign className="h-5 w-5" />}
              label={`Vendas de ${competence(c.monthSales.competence)}`}
              value={cents(c.monthSales.amountCents)}
              caption={<Variation value={c.monthSales.variation} />}
            />
            <StatCard icon={<Coins className="h-5 w-5" />} label="Pontos distribuídos" value={num(c.points)} caption={`${competence(data.period.from)} a ${competence(data.period.to)}`} />
            <StatCard icon={<Megaphone className="h-5 w-5" />} label="Campanhas ativas" value={num(c.activeCampaigns)} />
            <StatCard
              icon={<FileWarning className="h-5 w-5" />}
              label="Arquivos aguardando validação"
              value={num(c.pendingFiles)}
              tone={c.pendingFiles ? "warning" : undefined}
              caption={c.pendingFiles ? "com inconsistências ou sem confirmação" : "nada pendente"}
            />
            <StatCard
              icon={<Target className="h-5 w-5" />}
              label="Metas atingidas"
              value={`${c.goals.hit} de ${c.goals.total}`}
              caption={`equipes em ${competence(c.goals.competence)}`}
            />
          </>
        )}
      </div>

      {/* gráficos */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Evolução de vendas" icon={<BarChart3 className="h-4 w-4" />}>
          {data ? (
            data.salesByMonth.length ? (
              <AreaTrend label="Vendas por mês" data={data.salesByMonth} x="competence" series={[{ key: "amountCents", label: "Vendas", type: "cents" }]} />
            ) : (
              <EmptyState title="Sem vendas no período" />
            )
          ) : (
            <Skeleton className="h-[260px]" />
          )}
        </Panel>
        <Panel title="Pontos distribuídos por mês" icon={<Coins className="h-4 w-4" />}>
          {data ? (
            data.salesByMonth.length ? (
              <Bars label="Pontos por mês" data={data.salesByMonth} x="competence" series={[{ key: "points", label: "Pontos", type: "int" }]} />
            ) : (
              <EmptyState title="Sem pontos no período" />
            )
          ) : (
            <Skeleton className="h-[260px]" />
          )}
        </Panel>
        <Panel
          title="Ranking das distribuidoras"
          icon={<Trophy className="h-4 w-4" />}
          actions={<Link to="/relatorios/distribuidoras" className={linkClass}>Relatório <ArrowRight className="h-3.5 w-3.5" /></Link>}
        >
          {data ? (
            data.distributorRanking.length ? (
              <HBars label="Top 10 distribuidoras por vendas" data={data.distributorRanking} x="name" series={[{ key: "amountCents", label: "Vendas", type: "cents" }]} />
            ) : (
              <EmptyState title="Sem vendas no período" />
            )
          ) : (
            <Skeleton className="h-[320px]" />
          )}
        </Panel>
        <Panel title="Vendas por produto" icon={<PackageSearch className="h-4 w-4" />}>
          {data ? (
            data.salesByProduct.length ? (
              <HBars label="Vendas por produto" data={data.salesByProduct} x="name" labelWidth={170} series={[{ key: "amountCents", label: "Vendas", type: "cents" }]} />
            ) : (
              <EmptyState title="Sem vendas no período" />
            )
          ) : (
            <Skeleton className="h-[260px]" />
          )}
        </Panel>
      </div>

      <Panel
        title="Desempenho das campanhas"
        icon={<Megaphone className="h-4 w-4" />}
        actions={<Link to="/relatorios/campanhas" className={linkClass}>Relatório <ArrowRight className="h-3.5 w-3.5" /></Link>}
      >
        {data ? (
          data.campaignPerformance.length ? (
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <HBars
                label="Vendas no período de cada campanha em % da meta"
                data={data.campaignPerformance.map((cp) => ({ ...cp, pct: cp.goalCents ? cp.amountCents / cp.goalCents : 0 }))}
                x="name"
                reference={1}
                series={[{ key: "pct", label: "% da meta", type: "pct" }]}
              />
              <ul className="space-y-1 self-center">
                {data.campaignPerformance.map((cp) => (
                  <li key={cp.id}>
                    <ListRow to={`/campanhas/${cp.id}`}>
                      <span className="min-w-0">
                        <span className="block truncate font-bold text-[#1F1F24] dark:text-white">{cp.name}</span>
                        <span className="text-xs text-[#73737D] dark:text-muted-foreground">
                          {cents(cp.amountCents)} de {cents(cp.goalCents)}
                        </span>
                      </span>
                      <StatusBadge status={cp.status} />
                    </ListRow>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <EmptyState title="Nenhuma campanha em andamento" />
          )
        ) : (
          <Skeleton className="h-[180px]" />
        )}
      </Panel>

      {/* listas */}
      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        <Panel
          title="Últimas importações"
          icon={<CloudUpload className="h-4 w-4" />}
          actions={canImports && <Link to="/importacao/lotes" className={linkClass}>Ver todas <ArrowRight className="h-3.5 w-3.5" /></Link>}
        >
          {!data ? (
            <Skeleton className="h-40" />
          ) : data.lastImports.length ? (
            <ul className="-mx-3 space-y-0.5">
              {data.lastImports.map((b) => (
                <li key={b.id}>
                  <ListRow to={canImports ? `/importacao/lotes/${b.id}` : undefined}>
                    <span className="min-w-0">
                      <span className="block truncate font-bold text-[#1F1F24] dark:text-white">{b.distributorName}</span>
                      <span className="text-xs text-[#73737D] dark:text-muted-foreground">
                        {competence(b.competence)} · {num(b.total)} registros · {formatDate(b.createdAt)}
                      </span>
                    </span>
                    <StatusBadge status={b.status} />
                  </ListRow>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Nenhuma importação ainda" />
          )}
        </Panel>

        <Panel title="Alertas de inconsistências" icon={<AlertTriangle className="h-4 w-4" />}>
          {!data ? (
            <Skeleton className="h-40" />
          ) : data.alerts.length ? (
            <ul className="-mx-3 space-y-0.5">
              {data.alerts.map((b) => (
                <li key={b.id}>
                  <ListRow to={canImports ? `/importacao/lotes/${b.id}` : undefined}>
                    <span className="min-w-0">
                      <span className="block truncate font-bold text-[#1F1F24] dark:text-white">
                        Lote #{b.id} · {b.distributorName}
                      </span>
                      <span className="block truncate text-xs text-[#73737D] dark:text-muted-foreground">
                        {b.error ?? `${num(b.invalid)} registro(s) inválido(s) em ${competence(b.competence)}`}
                      </span>
                    </span>
                    <StatusBadge status={b.status} />
                  </ListRow>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Nenhuma inconsistência">Todos os lotes recentes foram validados.</EmptyState>
          )}
        </Panel>

        <Panel
          title={`Não enviaram ${data ? competence(data.missingDistributors.competence) : ""}`}
          icon={<Building2 className="h-4 w-4" />}
        >
          {!data ? (
            <Skeleton className="h-40" />
          ) : data.missingDistributors.items.length ? (
            <ul className="-mx-3 max-h-80 space-y-0.5 overflow-y-auto">
              {data.missingDistributors.items.map((d) => (
                <li key={d.id}>
                  <ListRow to={`/distribuidoras/${d.id}`}>
                    <span className="min-w-0">
                      <span className="block truncate font-bold text-[#1F1F24] dark:text-white">{d.name}</span>
                      <span className="text-xs text-[#73737D] dark:text-muted-foreground">
                        {d.code} · {d.region} · último envio: {competence(d.lastCompetence)}
                      </span>
                    </span>
                  </ListRow>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Todas enviaram" />
          )}
        </Panel>

        <Panel title="Campanhas próximas do encerramento" icon={<CalendarClock className="h-4 w-4" />}>
          {!data ? (
            <Skeleton className="h-24" />
          ) : data.endingCampaigns.length ? (
            <ul className="-mx-3 space-y-0.5">
              {data.endingCampaigns.map((cp) => (
                <li key={cp.id}>
                  <ListRow to={`/campanhas/${cp.id}`}>
                    <span className="min-w-0">
                      <span className="block truncate font-bold text-[#1F1F24] dark:text-white">{cp.name}</span>
                      <span className="text-xs text-[#73737D] dark:text-muted-foreground">termina em {formatDay(cp.endDate)}</span>
                    </span>
                    <span className="whitespace-nowrap rounded-full bg-warning/15 px-2.5 py-0.5 text-xs font-bold text-[#B76E00] dark:text-warning">
                      {cp.daysLeft} dia(s)
                    </span>
                  </ListRow>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Nenhuma termina nos próximos 30 dias" />
          )}
        </Panel>

        {canActivity && (
          <Panel
            title="Últimas atividades administrativas"
            icon={<ClipboardCheck className="h-4 w-4" />}
            className="lg:col-span-2 2xl:col-span-2"
            actions={<Link to="/atividades" className={linkClass}>Central de atividades <ArrowRight className="h-3.5 w-3.5" /></Link>}
          >
            {!data ? (
              <Skeleton className="h-40" />
            ) : data.activities.length ? (
              <ul className="divide-y divide-[#E5E7EB] dark:divide-border/40">
                {data.activities.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5 text-sm">
                    <span className="min-w-0">
                      <b className="text-[#1F1F24] dark:text-white">{a.actorName}</b>{" "}
                      <span className="text-[#52525B] dark:text-[#C9CCD6]">{a.description}</span>
                    </span>
                    <span className="text-xs text-[#8C8C96] dark:text-muted-foreground">{formatDate(a.createdAt)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="Sem atividades registradas" />
            )}
          </Panel>
        )}
      </div>
      {isLoading && <span className="sr-only">Carregando</span>}
    </div>
  );
}
