import { card, EmptyState, FilterPanel, Field, fieldClass, Panel, PeriodFields, SearchInput, Skeleton, StatusBadge, Toolbar, useList } from "@/shared/components/kit";
import { Pagination } from "@/shared/components/Pagination";
import { api, competence, formatDate, num } from "@/shared/lib/api";
import { cn } from "@/shared/lib/utils";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowRight,
  Building2,
  ClipboardList,
  CloudUpload,
  Coins,
  Gift,
  KeyRound,
  ListTree,
  Megaphone,
  MessageSquare,
  Newspaper,
  Scale,
  ShieldCheck,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router-dom";

type Log = { id: number; action: string; actorName: string; targetType: string; targetId: string; description: string; createdAt: string };
type Pending = {
  batches: { id: number; distributorName: string; competence: string; status: string; invalid: number; valid: number; createdAt: string }[];
  tickets: { id: number; title: string; status: string; data: { requester?: string; priority?: string; category?: string }; createdAt: string }[];
  redemptions: { id: number; title: string; status: string; data: { points?: number; requestedAt?: string }; createdAt: string }[];
};

/** ícone e rótulo por tipo de entidade da auditoria (tipos desconhecidos caem no padrão) */
const TYPES: Record<string, [LucideIcon, string]> = {
  campaign: [Megaphone, "Campanhas"],
  point_rule: [Scale, "Regras de pontuação"],
  profile: [ShieldCheck, "Perfis e permissões"],
  user: [Users, "Usuários"],
  distributor: [Building2, "Distribuidoras"],
  team: [UsersRound, "Equipes"],
  import_batch: [CloudUpload, "Importações"],
  batch: [CloudUpload, "Importações"],
  menu: [ListTree, "Menus"],
  menu_template: [ListTree, "Modelos de menus"],
  point_entry: [Coins, "Pontos"],
  points: [Coins, "Pontos"],
  session: [KeyRound, "Sessões"],
  ticket: [MessageSquare, "Chamados"],
  reward: [Gift, "Premiações"],
  redemption: [Gift, "Resgates"],
  news: [Newspaper, "Notícias"],
};
const typeOf = (t: string): [LucideIcon, string] => TYPES[t] ?? [Activity, t];

const rtf = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
function relative(value: string) {
  const date = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  const minutes = Math.round((date.getTime() - Date.now()) / 60000);
  if (Math.abs(minutes) < 60) return rtf.format(minutes, "minute");
  if (Math.abs(minutes) < 1440) return rtf.format(Math.round(minutes / 60), "hour");
  if (Math.abs(minutes) < 1440 * 45) return rtf.format(Math.round(minutes / 1440), "day");
  return formatDate(value);
}

const PRIORITY: Record<string, string> = { high: "Alta", medium: "Média", low: "Baixa" };

function PendingList({ title, icon, to, children, empty }: { title: string; icon: React.ReactNode; to: string; children: React.ReactNode[]; empty: string }) {
  return (
    <Panel
      title={`${title} (${children.length})`}
      icon={icon}
      actions={
        <Link to={to} className="inline-flex items-center gap-1 text-xs font-bold text-[#00A876] hover:underline dark:text-[#00E6A0]">
          Abrir <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      }
    >
      {children.length ? <ul className="-mx-3 max-h-72 space-y-0.5 overflow-y-auto">{children}</ul> : <p className="text-sm text-[#73737D] dark:text-muted-foreground">{empty}</p>}
    </Panel>
  );
}

const rowClass = "flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors hover:bg-[#00E6A0]/5";

export function ActivityPage() {
  const list = useList<Log>("activity", "/dashboard/activity", {}, 25);
  const types = useQuery({ queryKey: ["activity-types"], queryFn: () => api.get<{ type: string; total: number }[]>("/dashboard/activity-types") });
  const pending = useQuery({ queryKey: ["dashboard-pending"], queryFn: () => api.get<Pending>("/dashboard/pending") });
  const logs = list.data?.data ?? [];

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 space-y-4">
        <Toolbar
          actions={
            <FilterPanel onApply={list.applyPanel}>
              <Field label="Ator (quem fez)">
                <input name="actor" className={fieldClass} placeholder="Nome do usuário" />
              </Field>
              <PeriodFields />
            </FilterPanel>
          }
        >
          <SearchInput value={list.filters.search} onChange={(search) => list.patch({ search })} placeholder="Buscar na descrição..." />
          <select aria-label="Tipo de atividade" className={cn(fieldClass, "sm:w-56")} value={list.filters.type ?? ""} onChange={(e) => list.patch({ type: e.target.value })}>
            <option value="">Todos os tipos</option>
            {types.data?.map((t) => (
              <option key={t.type} value={t.type}>
                {typeOf(t.type)[1]} ({num(t.total)})
              </option>
            ))}
          </select>
        </Toolbar>

        <section className={cn(card, "overflow-hidden")} aria-label="Feed de atividades">
          {list.isLoading && !logs.length ? (
            <div className="space-y-3 p-5">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : list.isError ? (
            <EmptyState title="Não foi possível carregar." />
          ) : !logs.length ? (
            <EmptyState title="Nenhuma atividade encontrada">Ajuste os filtros ou a busca.</EmptyState>
          ) : (
            <ol className="divide-y divide-[#E5E7EB] dark:divide-border/40">
              {logs.map((log) => {
                const [Icon, label] = typeOf(log.targetType);
                return (
                  <li key={log.id} className="flex gap-3 px-5 py-4">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#00E6A0]/10 text-[#00A876] dark:text-[#00E6A0]">
                      <Icon className="h-4 w-4" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-[#52525B] dark:text-[#C9CCD6]">
                        <b className="text-[#1F1F24] dark:text-white">{log.actorName}</b> {log.description}
                      </p>
                      <p className="mt-0.5 text-xs text-[#8C8C96] dark:text-muted-foreground">
                        {label} · #{log.targetId} · <time title={formatDate(log.createdAt)}>{relative(log.createdAt)}</time>
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          {list.data && list.data.pagination.lastPage > 1 && (
            <div className="flex items-center justify-between border-t border-[#E5E7EB] px-4 dark:border-border/40">
              <span className="text-xs text-[#73737D] dark:text-muted-foreground">{num(list.data.pagination.total)} atividade(s)</span>
              <Pagination currentPage={list.data.pagination.page} totalPages={list.data.pagination.lastPage} onPageChange={list.setPage} />
            </div>
          )}
        </section>
      </div>

      <aside className="space-y-4" aria-label="Pendências">
        {!pending.data ? (
          <>
            <Skeleton className="h-40 rounded-2xl" />
            <Skeleton className="h-40 rounded-2xl" />
          </>
        ) : (
          <>
            <PendingList title="Lotes pendentes" icon={<CloudUpload className="h-4 w-4" />} to="/importacao/validacao" empty="Nenhum lote aguardando ação.">
              {pending.data.batches.map((b) => (
                <li key={b.id}>
                  <Link to={`/importacao/lotes/${b.id}`} className={rowClass}>
                    <span className="min-w-0">
                      <span className="block truncate font-bold text-[#1F1F24] dark:text-white">
                        #{b.id} · {b.distributorName}
                      </span>
                      <span className="text-xs text-[#73737D] dark:text-muted-foreground">
                        {competence(b.competence)} · {num(b.invalid)} inválido(s)
                      </span>
                    </span>
                    <StatusBadge status={b.status} />
                  </Link>
                </li>
              ))}
            </PendingList>
            <PendingList title="Chamados abertos" icon={<MessageSquare className="h-4 w-4" />} to="/atendimento/chamados" empty="Nenhum chamado aberto.">
              {pending.data.tickets.map((t) => (
                <li key={t.id}>
                  <Link to="/atendimento/chamados" className={rowClass}>
                    <span className="min-w-0">
                      <span className="block truncate font-bold text-[#1F1F24] dark:text-white">{t.title}</span>
                      <span className="text-xs text-[#73737D] dark:text-muted-foreground">
                        {t.data.requester} · prioridade {PRIORITY[t.data.priority ?? ""] ?? "—"}
                      </span>
                    </span>
                    <StatusBadge status={t.status} />
                  </Link>
                </li>
              ))}
            </PendingList>
            <PendingList title="Resgates solicitados" icon={<ClipboardList className="h-4 w-4" />} to="/premiacoes" empty="Nenhum resgate aguardando.">
              {pending.data.redemptions.map((r) => (
                <li key={r.id}>
                  <Link to="/premiacoes" className={rowClass}>
                    <span className="min-w-0">
                      <span className="block truncate font-bold text-[#1F1F24] dark:text-white">{r.title}</span>
                      <span className="text-xs text-[#73737D] dark:text-muted-foreground">{num(r.data.points)} pontos</span>
                    </span>
                    <StatusBadge status={r.status} />
                  </Link>
                </li>
              ))}
            </PendingList>
          </>
        )}
      </aside>
    </div>
  );
}
