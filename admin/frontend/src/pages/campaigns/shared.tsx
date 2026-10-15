// Peças compartilhadas das telas de campanhas, regras e pontos.
import { Badge, card, iconButton, type Tone } from "@/shared/components/kit";
import { cents, formatDay, num, type Lookups } from "@/shared/lib/api";
import { toast } from "@/shared/lib/toast";
import { cn } from "@/shared/lib/utils";
import { Calculator, Coins, History, Pencil, Power, Sparkles, Trophy } from "lucide-react";
import type { ReactNode } from "react";

export type CampaignStatus = "draft" | "scheduled" | "active" | "paused" | "ended";

export interface Campaign {
  id: number;
  name: string;
  description: string;
  startDate: string;
  endDate: string;
  status: CampaignStatus;
  distributorIds: number[];
  audience: string[];
  productIds: number[];
  rewards: string[];
  goalCents: number;
  banner: string | null;
}

export type CalcType = "per_unit" | "per_amount" | "goal_bonus" | "multiplier";

export interface Rule {
  id: number;
  ruleKey: string;
  version: number;
  name: string;
  campaignId: number;
  productId: number | null;
  distributorId: number | null;
  calcType: CalcType;
  value: number;
  amountStepCents: number | null;
  startDate: string;
  endDate: string;
  priority: number;
  status: "active" | "inactive" | "superseded";
  createdByName: string;
  createdAt: string;
  versions?: number;
  entries?: number;
}

export type EntryType = "credit" | "debit" | "reversal" | "adjustment" | "bonus";

export interface Entry {
  id: number;
  sellerId: number;
  sellerName: string;
  distributorId: number | null;
  campaignId: number | null;
  type: EntryType;
  points: number;
  origin: string;
  ruleLabel: string | null;
  saleExternalId: string | null;
  batchId: number | null;
  relatedEntryId: number | null;
  reason: string | null;
  actorName: string;
  createdAt: string;
}

export const ENTRY: Record<EntryType, [string, Tone]> = {
  credit: ["Crédito", "green"],
  debit: ["Débito", "red"],
  reversal: ["Estorno", "purple"],
  adjustment: ["Ajuste administrativo", "blue"],
  bonus: ["Bônus", "yellow"],
};

export const EntryBadge = ({ type }: { type: EntryType }) => <Badge tone={ENTRY[type][1]}>{ENTRY[type][0]}</Badge>;

export const Points = ({ value, className }: { value: number; className?: string }) => (
  <span className={cn("font-bold tabular-nums", value > 0 ? "text-[#047857] dark:text-[#34D399]" : value < 0 ? "text-destructive" : "", className)}>
    {value > 0 ? "+" : ""}
    {num(value)}
  </span>
);

export const CALC: Record<CalcType, { label: string; icon: typeof Coins }> = {
  per_unit: { label: "Pontos por unidade", icon: Coins },
  per_amount: { label: "Pontos por valor vendido", icon: Calculator },
  goal_bonus: { label: "Bônus por meta atingida", icon: Trophy },
  multiplier: { label: "Multiplicador (pontuação turbinada)", icon: Sparkles },
};

const day = (d: string) => d.slice(8, 10) + "/" + d.slice(5, 7);

/** frase legível da regra: "Produto A · 10 pts por unidade" */
export function describeRule(r: Rule, lookups?: Lookups) {
  const found = r.productId ? lookups?.products.find((p) => p.id === r.productId) : null;
  const product = r.productId ? (found ? `${found.sku} · ${found.name}` : `Produto #${r.productId}`) : "Todos os produtos";
  const amount = r.calcType === "per_amount" ? cents(r.amountStepCents ?? 10000).replace(",00", "") : "";
  const phrase = {
    per_unit: `${num(r.value)} pts por unidade`,
    per_amount: `${num(r.value)} pts a cada ${amount}`,
    goal_bonus: `Bônus meta: ${num(r.value)} pts`,
    multiplier: `Pontuação ${(r.value / 100).toLocaleString("pt-BR")}× de ${day(r.startDate)} a ${day(r.endDate)}`,
  }[r.calcType];
  return { product, phrase };
}

/** 12 competências da campanha 2026 */
export const MONTHS = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`);

export function Progress({ value, className }: { value: number; className?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-[#E5E7EB] dark:bg-white/[0.08]", className)} role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn("h-full rounded-full", value >= 100 ? "bg-[#00E6A0]" : value >= 70 ? "bg-[#60A5FA]" : "bg-warning")} style={{ width: `${pct}%` }} />
    </div>
  );
}

export const fail = (e: unknown) => toast.error((e as Error).message);

/** cartão visual de uma regra (usado em Regras e no detalhe da campanha) */
export function RuleCard({
  rule,
  lookups,
  campaignName,
  onEdit,
  onToggle,
  onHistory,
}: {
  rule: Rule;
  lookups?: Lookups;
  campaignName?: string;
  onEdit?: () => void;
  onToggle?: () => void;
  onHistory?: () => void;
}) {
  const { product, phrase } = describeRule(rule, lookups);
  const Icon = CALC[rule.calcType].icon;
  const distributor = rule.distributorId ? lookups?.distributors.find((d) => d.id === rule.distributorId)?.name : null;
  return (
    <article className={cn(card, "flex flex-col gap-3 p-4", rule.status === "inactive" && "opacity-60")}>
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#00E6A0]/10 text-[#00A876] dark:text-[#00E6A0]">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-[#73737D] dark:text-muted-foreground" title={rule.name}>
            {rule.name}
          </p>
          <p className="text-base font-bold leading-snug text-[#1F1F24] dark:text-white">
            {rule.calcType === "goal_bonus" || rule.calcType === "multiplier" ? phrase : `${product} · ${phrase}`}
          </p>
        </div>
        <Badge tone={rule.status === "active" ? "green" : "gray"}>{rule.status === "active" ? "Ativa" : "Inativa"}</Badge>
      </div>
      <div className="flex flex-wrap gap-1.5 text-xs">
        {campaignName && <Badge tone="purple">{campaignName}</Badge>}
        {rule.calcType === "multiplier" && <Badge tone="gray">{product}</Badge>}
        <Badge tone="gray">{distributor ?? "Todas as distribuidoras"}</Badge>
        <Badge tone="gray">
          {formatDay(rule.startDate)} – {formatDay(rule.endDate)}
        </Badge>
        <Badge tone="blue">Prioridade {rule.priority}</Badge>
        <Badge tone="gray" title={`${rule.versions ?? 1} versão(ões)`}>
          v{rule.version}
        </Badge>
      </div>
      {(onEdit || onToggle || onHistory) && (
        <div className="mt-auto flex items-center justify-between border-t border-[#E5E7EB] pt-2 dark:border-border/40">
          <span className="text-xs text-[#8C8C96] dark:text-muted-foreground">
            {rule.entries ? `Usada em ${num(rule.entries)} lançamento(s)` : "Ainda sem lançamentos"}
          </span>
          <div className="flex gap-1">
            {onHistory && (
              <button className={iconButton} onClick={onHistory} title="Histórico de versões" aria-label="Histórico de versões">
                <History className="h-4 w-4" />
              </button>
            )}
            {onToggle && (
              <button className={iconButton} onClick={onToggle} title={rule.status === "active" ? "Desativar" : "Ativar"} aria-label={rule.status === "active" ? "Desativar" : "Ativar"}>
                <Power className="h-4 w-4" />
              </button>
            )}
            {onEdit && (
              <button className={iconButton} onClick={onEdit} title="Editar (cria nova versão)" aria-label="Editar">
                <Pencil className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

/** linha rótulo/valor em listas de detalhe */
export const Info = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex flex-col gap-0.5">
    <span className="text-xs font-semibold text-[#73737D] dark:text-muted-foreground">{label}</span>
    <span className="text-sm font-medium text-[#1F1F24] dark:text-white">{children}</span>
  </div>
);

/** reais digitados ("1.500,50") → centavos */
export const toCents = (value: string) => {
  const clean = value.replace(/[^\d,.-]/g, "");
  const n = Number(clean.lastIndexOf(",") > clean.lastIndexOf(".") ? clean.replace(/\./g, "").replace(",", ".") : clean.replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};

export const fromCents = (value: number) => (value / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 });

export const chartTooltip = {
  contentStyle: { background: "#071E24", border: "1px solid rgba(0,230,160,0.25)", borderRadius: 12, color: "#fff", fontSize: 12 },
  labelStyle: { color: "#A2A5B3" },
};

/** como Field, mas <div>: para grupos de checkbox (label dentro de label é inválido) */
export const Group = ({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) => (
  <div role="group" aria-label={label} className="flex min-w-0 flex-col gap-1.5">
    <span className="text-xs font-semibold text-[#73737D] dark:text-muted-foreground">{label}</span>
    {children}
    {hint && <span className="text-xs text-[#8C8C96] dark:text-muted-foreground">{hint}</span>}
  </div>
);
