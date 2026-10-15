import { Badge, card, EmptyState, Panel, Skeleton, StatCard, StatusBadge } from "@/shared/components/kit";
import { api, cents, competence, formatDay, num, PROFILE_LABEL, useLookups, type ProfileKey } from "@/shared/lib/api";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Building2, Coins, Gift, Megaphone, Scale, ShoppingCart, Target, Trophy, Users } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CampaignActions } from "./CampaignActions";
import { CampaignForm } from "./CampaignForm";
import { chartTooltip, Info, Progress, RuleCard, type Campaign, type Rule } from "./shared";

interface Results {
  campaign: Campaign;
  totals: { sales: number; amountCents: number; salePoints: number; points: number; participants: number; distributors: number; goalPercent: number | null };
  byMonth: { competence: string; amountCents: number; points: number }[];
  top: { sellerId: number; name: string; distributorName: string; amountCents: number; points: number }[];
  byDistributor: { distributorId: number; name: string; amountCents: number; points: number }[];
  rules: Rule[];
}

const short = (v: number) => (v >= 1e6 ? `${(v / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi` : v >= 1e3 ? `${Math.round(v / 1e3)} mil` : String(v));

export function CampaignDetailPage() {
  const { id } = useParams();
  const lookups = useLookups().data;
  const [editing, setEditing] = useState(false);
  const q = useQuery({ queryKey: ["campaign", id], queryFn: () => api.get<Results>(`/campaigns/${id}/results`) });

  if (q.isLoading)
    return (
      <div className="space-y-4">
        <Skeleton className="h-40" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-20" />)}</div>
        <Skeleton className="h-72" />
      </div>
    );
  if (!q.data)
    return (
      <div className={card}>
        <EmptyState title="Campanha não encontrada">
          <Link to="/campanhas" className="text-[#00A876] underline dark:text-[#00E6A0]">Voltar para campanhas</Link>
        </EmptyState>
      </div>
    );

  const { campaign: c, totals, byMonth, top, byDistributor, rules } = q.data;
  const distributors = c.distributorIds.length ? c.distributorIds.map((d) => lookups?.distributors.find((x) => x.id === d)?.name ?? `#${d}`) : null;
  const products = c.productIds.length ? c.productIds.map((p) => lookups?.products.find((x) => x.id === p) ?? { id: p, sku: `#${p}`, name: "", priceCents: null }) : null;

  return (
    <div className="space-y-6">
      <Link to="/campanhas" className="inline-flex items-center gap-2 text-sm font-semibold text-[#73737D] hover:text-[#00A876] dark:text-muted-foreground dark:hover:text-[#00E6A0]">
        <ArrowLeft className="h-4 w-4" /> Campanhas
      </Link>

      <section className={`${card} overflow-hidden`}>
        {c.banner ? (
          <img src={c.banner} alt="" className="h-40 w-full object-cover" />
        ) : (
          <div className="flex h-24 items-center gap-3 bg-[radial-gradient(circle_at_15%_30%,rgba(0,230,160,0.35),transparent_55%),linear-gradient(135deg,#071E24,#020F14)] px-6">
            <Megaphone className="h-8 w-8 text-[#00E6A0]" />
          </div>
        )}
        <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-2xl font-bold text-[#1F1F24] dark:text-white">{c.name}</h2>
              <StatusBadge status={c.status} />
            </div>
            <p className="text-sm font-semibold text-[#73737D] dark:text-muted-foreground">
              {formatDay(c.startDate)} – {formatDay(c.endDate)}
            </p>
            {c.description && <p className="max-w-3xl text-sm text-[#73737D] dark:text-muted-foreground">{c.description}</p>}
          </div>
          <CampaignActions campaign={c} onEdit={() => setEditing(true)} />
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard icon={<ShoppingCart className="h-5 w-5" />} label="Vendas" value={cents(totals.amountCents)} caption={`${num(totals.sales)} venda(s)`} />
        <StatCard icon={<Coins className="h-5 w-5" />} label="Pontos lançados" value={num(totals.points)} caption={`${num(totals.salePoints)} de vendas`} />
        <StatCard icon={<Users className="h-5 w-5" />} label="Participantes" value={num(totals.participants)} caption="vendedores com venda" />
        <StatCard icon={<Building2 className="h-5 w-5" />} label="Distribuidoras" value={num(totals.distributors)} caption={distributors ? `de ${distributors.length} participantes` : "todas participam"} />
        <div className={`${card} flex flex-col justify-center gap-2 p-4`}>
          <p className="flex items-center gap-2 text-sm font-medium text-[#73737D] dark:text-muted-foreground">
            <Target className="h-4 w-4 text-[#00A876] dark:text-[#00E6A0]" /> Meta {c.goalCents ? cents(c.goalCents) : "não definida"}
          </p>
          <p className="text-xl font-bold text-[#1F1F24] dark:text-white">{totals.goalPercent == null ? "—" : `${totals.goalPercent.toLocaleString("pt-BR")}%`}</p>
          {totals.goalPercent != null && <Progress value={totals.goalPercent} />}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Vendas por mês" icon={<ShoppingCart className="h-4 w-4" />}>
          {byMonth.length ? (
            <div className="h-64" role="img" aria-label={`Vendas mensais da campanha, ${byMonth.length} meses`}>
              <ResponsiveContainer>
                <AreaChart data={byMonth.map((m) => ({ ...m, mes: competence(m.competence), reais: m.amountCents / 100 }))}>
                  <defs>
                    <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor="#00E6A0" stopOpacity={0.4} />
                      <stop offset="1" stopColor="#00E6A0" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.15)" />
                  <XAxis dataKey="mes" tick={{ fontSize: 11, fill: "#8C8C96" }} />
                  <YAxis tickFormatter={short} tick={{ fontSize: 11, fill: "#8C8C96" }} width={56} />
                  <Tooltip {...chartTooltip} formatter={(v: number) => [v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }), "Vendas"]} />
                  <Area type="monotone" dataKey="reais" stroke="#00E6A0" strokeWidth={2} fill="url(#cg)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState title="Sem vendas pontuadas nesta campanha" />
          )}
        </Panel>
        <Panel title="Vendas por distribuidora (top 10)" icon={<Building2 className="h-4 w-4" />}>
          {byDistributor.length ? (
            <div className="h-64" role="img" aria-label="Ranking de vendas por distribuidora">
              <ResponsiveContainer>
                <BarChart layout="vertical" data={byDistributor.slice(0, 10).map((d) => ({ ...d, nome: d.name.replace("Distribuidora ", ""), reais: d.amountCents / 100 }))} margin={{ left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.15)" horizontal={false} />
                  <XAxis type="number" tickFormatter={short} tick={{ fontSize: 11, fill: "#8C8C96" }} />
                  <YAxis type="category" dataKey="nome" width={110} tick={{ fontSize: 11, fill: "#8C8C96" }} />
                  <Tooltip {...chartTooltip} formatter={(v: number) => [v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }), "Vendas"]} />
                  <Bar dataKey="reais" fill="#00E6A0" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState title="Sem vendas por distribuidora" />
          )}
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Panel title="Top 10 vendedores" icon={<Trophy className="h-4 w-4" />}>
          {top.length ? (
            <ol className="divide-y divide-[#E5E7EB] dark:divide-border/40">
              {top.map((s, i) => (
                <li key={s.sellerId} className="flex items-center gap-3 py-2.5">
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${i < 3 ? "bg-[#00E6A0] text-[#03261A]" : "bg-[#E5E7EB] text-[#52525B] dark:bg-white/[0.06] dark:text-white"}`}>{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-[#1F1F24] dark:text-white">{s.name}</span>
                    <span className="block truncate text-xs text-[#8C8C96]">{s.distributorName}</span>
                  </span>
                  <span className="text-right text-sm">
                    <span className="block font-bold text-[#1F1F24] dark:text-white">{num(s.points)} pts</span>
                    <span className="block text-xs text-[#8C8C96]">{cents(s.amountCents)}</span>
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState title="Ninguém pontuou ainda" />
          )}
        </Panel>
        <Panel title="Configuração" icon={<Gift className="h-4 w-4" />}>
          <div className="grid gap-4">
            <Info label="Público-alvo">
              <span className="flex flex-wrap gap-1.5">
                {c.audience.length ? c.audience.map((a) => <Badge key={a} tone="blue">{PROFILE_LABEL[a as ProfileKey] ?? a}</Badge>) : "Todos os perfis"}
              </span>
            </Info>
            <Info label="Distribuidoras participantes">{distributors ? distributors.join(", ") : "Todas"}</Info>
            <Info label="Produtos elegíveis">
              {products ? (
                <ul className="space-y-1">
                  {products.map((p) => (
                    <li key={p.id} className="flex items-center gap-2">
                      <Badge tone="gray">{p.sku}</Badge>
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      {p.priceCents != null && <span className="font-semibold text-[#1F1F24] dark:text-white">{cents(p.priceCents)}</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                "Todos"
              )}
            </Info>
            <Info label="Premiações">
              {c.rewards.length ? (
                <ul className="list-inside list-disc">
                  {c.rewards.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              ) : (
                "—"
              )}
            </Info>
          </div>
        </Panel>
      </div>

      <Panel
        title={`Regras de pontuação (${rules.length})`}
        icon={<Scale className="h-4 w-4" />}
        actions={
          <Link to={`/regras?campaignId=${c.id}`} className="text-sm font-semibold text-[#00A876] hover:underline dark:text-[#00E6A0]">
            Gerenciar regras
          </Link>
        }
      >
        {rules.length ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {rules.map((r) => (
              <RuleCard key={r.id} rule={r} lookups={lookups} />
            ))}
          </div>
        ) : (
          <EmptyState title="Nenhuma regra nesta campanha">Sem regras, as vendas da campanha não geram pontos.</EmptyState>
        )}
      </Panel>

      <CampaignForm open={editing} onOpenChange={setEditing} campaign={c} />
    </div>
  );
}
