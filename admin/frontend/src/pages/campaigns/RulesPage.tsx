import {
  Badge,
  card,
  EmptyState,
  Field,
  fieldClass,
  FormDialog,
  Panel,
  primaryButton,
  SearchInput,
  Skeleton,
  Toolbar,
  useConfirm,
  ViewDialog,
} from "@/shared/components/kit";
import { api, cents, formatDate, formatDay, num, useCan, useLookups, type Lookups } from "@/shared/lib/api";
import { toast } from "@/shared/lib/toast";
import { cn } from "@/shared/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Calculator, Info as InfoIcon, Plus, Scale } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CALC, describeRule, fail, fromCents, RuleCard, toCents, type CalcType, type Rule } from "./shared";

const today = new Date().toISOString().slice(0, 10);

export function RulesPage() {
  const [params, setParams] = useSearchParams();
  const lookups = useLookups().data;
  const canManage = useCan("POINT_RULES_MANAGE");
  const qc = useQueryClient();
  const confirm = useConfirm();
  const campaignId = params.get("campaignId") ?? "";
  const calcType = params.get("calcType") ?? "";
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<{ open: boolean; rule: Rule | null }>({ open: false, rule: null });
  const [history, setHistory] = useState<Rule | null>(null);

  const rules = useQuery({
    queryKey: ["rules", campaignId, calcType, search],
    queryFn: () => api.get<Rule[]>("/rules", { campaignId, calcType, search }),
    placeholderData: (p) => p,
  });

  const toggle = useMutation({
    mutationFn: (r: Rule) => api.post<Rule>(`/rules/${r.id}/status`, { status: r.status === "active" ? "inactive" : "active" }),
    onSuccess: (r) => {
      toast.success(`Regra ${r.status === "active" ? "ativada" : "desativada"} (v${r.version})`);
      qc.invalidateQueries({ queryKey: ["rules"] });
    },
    onError: fail,
  });

  const setFilter = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    v ? next.set(k, v) : next.delete(k);
    setParams(next, { replace: true });
  };

  const campaignName = (id: number) => lookups?.campaigns.find((c) => c.id === id)?.name ?? `Campanha #${id}`;
  const groups = new Map<number, Rule[]>();
  for (const r of rules.data ?? []) groups.set(r.campaignId, [...(groups.get(r.campaignId) ?? []), r]);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 space-y-5">
        <div className={cn(card, "flex gap-3 p-4 text-sm text-[#73737D] dark:text-muted-foreground")}>
          <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-[#00A876] dark:text-[#00E6A0]" />
          <p>
            Editar uma regra <b className="text-[#1F1F24] dark:text-white">cria uma nova versão</b>; a anterior fica guardada como substituída.
            Pontos já creditados apontam para a versão usada no cálculo e <b className="text-[#1F1F24] dark:text-white">nunca são recalculados</b>.
          </p>
        </div>

        <Toolbar
          actions={
            canManage && (
              <button className={primaryButton} onClick={() => setForm({ open: true, rule: null })}>
                <Plus className="h-4 w-4" /> Nova regra
              </button>
            )
          }
        >
          <SearchInput value={search} onChange={setSearch} placeholder="Buscar regra..." />
          <select aria-label="Campanha" className={cn(fieldClass, "w-auto")} value={campaignId} onChange={(e) => setFilter("campaignId", e.target.value)}>
            <option value="">Todas as campanhas</option>
            {lookups?.campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select aria-label="Tipo de cálculo" className={cn(fieldClass, "w-auto")} value={calcType} onChange={(e) => setFilter("calcType", e.target.value)}>
            <option value="">Todos os tipos</option>
            {(Object.keys(CALC) as CalcType[]).map((t) => (
              <option key={t} value={t}>
                {CALC[t].label}
              </option>
            ))}
          </select>
        </Toolbar>

        {rules.isLoading ? (
          <div className="grid gap-3 md:grid-cols-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-40" />)}</div>
        ) : !groups.size ? (
          <div className={card}>
            <EmptyState title={rules.isError ? "Não foi possível carregar as regras" : "Nenhuma regra encontrada"}>
              {rules.isError ? "Verifique se o backend está rodando." : "Ajuste os filtros ou crie uma regra."}
            </EmptyState>
          </div>
        ) : (
          [...groups.entries()].map(([cid, list]) => (
            <Panel key={cid} title={campaignName(cid)} icon={<Scale className="h-4 w-4" />} actions={<Badge tone="gray">{list.length} regra(s)</Badge>}>
              <div className="grid gap-3 md:grid-cols-2">
                {list.map((r) => (
                  <RuleCard
                    key={r.id}
                    rule={r}
                    lookups={lookups}
                    onHistory={() => setHistory(r)}
                    onEdit={canManage ? () => setForm({ open: true, rule: r }) : undefined}
                    onToggle={
                      canManage
                        ? () =>
                            confirm.ask({
                              title: r.status === "active" ? "Desativar regra?" : "Ativar regra?",
                              description: `Será criada a versão v${(r.versions ?? r.version) + 1} com status ${r.status === "active" ? "inativa" : "ativa"}. Pontos já creditados não mudam.`,
                              run: () => toggle.mutate(r),
                            })
                        : undefined
                    }
                  />
                ))}
              </div>
            </Panel>
          ))
        )}
      </div>

      <Simulator lookups={lookups} defaultCampaign={campaignId} />

      <RuleForm open={form.open} rule={form.rule} lookups={lookups} defaultCampaign={campaignId} onOpenChange={(open) => setForm((f) => ({ ...f, open }))} />
      <VersionsDialog rule={history} lookups={lookups} onClose={() => setHistory(null)} />
      {confirm.dialog}
    </div>
  );
}

// ---------------------------------------------------------------- formulário

type FormState = {
  name: string;
  campaignId: string;
  productId: string;
  distributorId: string;
  calcType: CalcType;
  value: string;
  step: string;
  startDate: string;
  endDate: string;
  priority: string;
  status: "active" | "inactive";
};

const VALUE_LABEL: Record<CalcType, [string, string]> = {
  per_unit: ["Pontos por unidade", "Ex.: 10 → 3 unidades geram 30 pts"],
  per_amount: ["Pontos por faixa de valor", "Ex.: 5 pts a cada R$ 100,00 vendidos"],
  goal_bonus: ["Pontos de bônus", "Creditados a cada vendedor da equipe que bater a meta (tela Metas)"],
  multiplier: ["Multiplicador (×)", "Ex.: 2 = pontuação em dobro no período; vale sobre a regra base"],
};

function RuleForm({
  open,
  onOpenChange,
  rule,
  lookups,
  defaultCampaign,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  rule: Rule | null;
  lookups?: Lookups;
  defaultCampaign: string;
}) {
  const qc = useQueryClient();
  const [f, setF] = useState<FormState | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    const campaign = lookups?.campaigns.find((c) => String(c.id) === defaultCampaign) ?? lookups?.campaigns.find((c) => c.status === "active");
    setF(
      rule
        ? {
            name: rule.name,
            campaignId: String(rule.campaignId),
            productId: rule.productId ? String(rule.productId) : "",
            distributorId: rule.distributorId ? String(rule.distributorId) : "",
            calcType: rule.calcType,
            value: rule.calcType === "multiplier" ? String(rule.value / 100).replace(".", ",") : String(rule.value),
            step: rule.amountStepCents ? fromCents(rule.amountStepCents) : "100,00",
            startDate: rule.startDate,
            endDate: rule.endDate,
            priority: String(rule.priority),
            status: rule.status === "inactive" ? "inactive" : "active",
          }
        : {
            name: "",
            campaignId: campaign ? String(campaign.id) : "",
            productId: "",
            distributorId: "",
            calcType: "per_unit",
            value: "10",
            step: "100,00",
            startDate: campaign?.startDate ?? today,
            endDate: campaign?.endDate ?? today,
            priority: "10",
            status: "active",
          },
    );
  }, [open, rule, lookups, defaultCampaign]);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => (rule ? api.put<Rule>(`/rules/${rule.id}`, body) : api.post<Rule>("/rules", body)),
    onSuccess: (r) => {
      toast.success(rule ? `Nova versão salva: ${r.name} v${r.version}` : `Regra criada: ${r.name}`);
      qc.invalidateQueries({ queryKey: ["rules"] });
      qc.invalidateQueries({ queryKey: ["campaign"] });
      onOpenChange(false);
    },
    onError: (e) => setError((e as Error).message),
  });

  if (!f) return null;
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => (s ? { ...s, [k]: v } : s));

  const submit = () => {
    const raw = Number(f.value.replace(",", "."));
    const value = f.calcType === "multiplier" ? Math.round(raw * 100) : Math.round(raw);
    const step = toCents(f.step);
    if (f.name.trim().length < 3) return setError("Dê um nome com pelo menos 3 caracteres.");
    if (!f.campaignId) return setError("Escolha a campanha.");
    if (!Number.isFinite(raw) || value < 1) return setError("Valor da pontuação inválido.");
    if (f.calcType === "multiplier" && (value < 101 || value > 1000)) return setError("Multiplicador entre 1,01 e 10.");
    if (f.calcType === "per_amount" && (!Number.isFinite(step) || step < 100)) return setError("Faixa de valor mínima: R$ 1,00.");
    if (f.endDate < f.startDate) return setError("O término deve ser igual ou posterior ao início.");
    setError("");
    save.mutate({
      name: f.name.trim(),
      campaignId: Number(f.campaignId),
      productId: f.productId ? Number(f.productId) : null,
      distributorId: f.distributorId ? Number(f.distributorId) : null,
      calcType: f.calcType,
      value,
      amountStepCents: f.calcType === "per_amount" ? step : null,
      startDate: f.startDate,
      endDate: f.endDate,
      priority: Number(f.priority) || 0,
      status: f.status,
    });
  };

  const [valueLabel, valueHint] = VALUE_LABEL[f.calcType];
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      wide
      title={rule ? `Editar regra · nova versão v${(rule.versions ?? rule.version) + 1}` : "Nova regra de pontuação"}
      description={rule ? "Salvar cria uma nova versão. Os pontos já creditados com a versão atual não são alterados." : "A regra vale para as vendas processadas a partir de agora."}
      onSubmit={submit}
      busy={save.isPending}
      submitLabel={rule ? "Salvar nova versão" : "Criar regra"}
    >
      {rule && (
        <p className="flex items-start gap-2 rounded-xl bg-warning/10 px-3 py-2 text-xs font-semibold text-[#B76E00] dark:text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Versão atual: v{rule.version} ({num(rule.entries ?? 0)} lançamento(s) já creditados com ela continuam como estão).
        </p>
      )}
      <Field label="Nome da regra">
        <input className={fieldClass} value={f.name} onChange={(e) => set("name", e.target.value)} maxLength={100} placeholder="Ex.: Produto A por unidade" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Campanha">
          <select className={fieldClass} value={f.campaignId} onChange={(e) => set("campaignId", e.target.value)}>
            <option value="">Selecione...</option>
            {lookups?.campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Tipo de cálculo">
          <select className={fieldClass} value={f.calcType} onChange={(e) => set("calcType", e.target.value as CalcType)}>
            {(Object.keys(CALC) as CalcType[]).map((t) => (
              <option key={t} value={t}>
                {CALC[t].label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Produto" hint="Vazio = vale para todos os produtos">
          <select className={fieldClass} value={f.productId} onChange={(e) => set("productId", e.target.value)}>
            <option value="">Todos os produtos</option>
            {lookups?.products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.sku} · {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Distribuidora" hint="Vazio = todas">
          <select className={fieldClass} value={f.distributorId} onChange={(e) => set("distributorId", e.target.value)}>
            <option value="">Todas as distribuidoras</option>
            {lookups?.distributors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code} · {d.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={valueLabel} hint={valueHint}>
          <input className={fieldClass} inputMode="decimal" value={f.value} onChange={(e) => set("value", e.target.value)} />
        </Field>
        {f.calcType === "per_amount" ? (
          <Field label="A cada (R$)">
            <input className={fieldClass} inputMode="decimal" value={f.step} onChange={(e) => set("step", e.target.value)} />
          </Field>
        ) : (
          <Field label="Prioridade" hint="Maior prioridade vence quando duas regras se aplicam">
            <input type="number" min={0} max={100} className={fieldClass} value={f.priority} onChange={(e) => set("priority", e.target.value)} />
          </Field>
        )}
        <Field label="Início">
          <input type="date" className={fieldClass} value={f.startDate} onChange={(e) => set("startDate", e.target.value)} />
        </Field>
        <Field label="Término">
          <input type="date" className={fieldClass} value={f.endDate} onChange={(e) => set("endDate", e.target.value)} />
        </Field>
        {f.calcType === "per_amount" && (
          <Field label="Prioridade" hint="Maior prioridade vence quando duas regras se aplicam">
            <input type="number" min={0} max={100} className={fieldClass} value={f.priority} onChange={(e) => set("priority", e.target.value)} />
          </Field>
        )}
        <Field label="Status">
          <select className={fieldClass} value={f.status} onChange={(e) => set("status", e.target.value as FormState["status"])}>
            <option value="active">Ativa</option>
            <option value="inactive">Inativa</option>
          </select>
        </Field>
      </div>
      {error && (
        <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive">
          {error}
        </p>
      )}
    </FormDialog>
  );
}

// ---------------------------------------------------------------- versões

const FIELDS: [keyof Rule, string][] = [
  ["name", "Nome"],
  ["campaignId", "Campanha"],
  ["productId", "Produto"],
  ["distributorId", "Distribuidora"],
  ["calcType", "Cálculo"],
  ["value", "Valor"],
  ["amountStepCents", "Faixa"],
  ["startDate", "Início"],
  ["endDate", "Término"],
  ["priority", "Prioridade"],
  ["status", "Status"],
];

function show(r: Rule, k: keyof Rule, lookups?: Lookups): string {
  const v = r[k];
  if (v == null) return k === "productId" ? "Todos" : k === "distributorId" ? "Todas" : "—";
  if (k === "campaignId") return lookups?.campaigns.find((c) => c.id === v)?.name ?? `#${v}`;
  if (k === "productId") return lookups?.products.find((p) => p.id === v)?.name ?? `#${v}`;
  if (k === "distributorId") return lookups?.distributors.find((d) => d.id === v)?.name ?? `#${v}`;
  if (k === "calcType") return CALC[v as CalcType].label;
  if (k === "value") return r.calcType === "multiplier" ? `${(Number(v) / 100).toLocaleString("pt-BR")}×` : `${num(Number(v))} pts`;
  if (k === "amountStepCents") return cents(Number(v));
  if (k === "startDate" || k === "endDate") return formatDay(String(v));
  if (k === "status") return { active: "Ativa", inactive: "Inativa", superseded: "Substituída" }[String(v)] ?? String(v);
  return String(v);
}

function VersionsDialog({ rule, lookups, onClose }: { rule: Rule | null; lookups?: Lookups; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["rule-versions", rule?.ruleKey],
    queryFn: () => api.get<Rule[]>(`/rules/versions/${rule!.ruleKey}`),
    enabled: !!rule,
  });
  const versions = q.data ?? [];
  return (
    <ViewDialog open={!!rule} onOpenChange={(o) => !o && onClose()} title={`Histórico de versões · ${rule?.name ?? ""}`} wide>
      {q.isLoading ? (
        <Skeleton className="h-40" />
      ) : (
        <ol className="space-y-4">
          {versions.map((v, i) => {
            const prev = versions[i + 1];
            const changed = prev ? FIELDS.filter(([k]) => k !== "status" && String(v[k]) !== String(prev[k])) : [];
            return (
              <li key={v.id} className={cn(card, "p-4")}>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Badge tone={v.status === "superseded" ? "gray" : v.status === "active" ? "green" : "yellow"}>v{v.version}</Badge>
                  <span className="text-sm font-bold text-[#1F1F24] dark:text-white">{describeRule(v, lookups).phrase}</span>
                  <span className="text-xs text-[#8C8C96]">
                    {formatDate(v.createdAt)} · {v.createdByName} · {show(v, "status")}
                  </span>
                </div>
                {prev ? (
                  changed.length ? (
                    <div className="grid gap-1 text-sm">
                      {changed.map(([k, label]) => (
                        <p key={k}>
                          <span className="font-semibold text-[#73737D] dark:text-muted-foreground">{label}: </span>
                          <span className="text-destructive line-through">{show(prev, k, lookups)}</span>
                          {" → "}
                          <span className="font-bold text-[#047857] dark:text-[#34D399]">{show(v, k, lookups)}</span>
                        </p>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-[#73737D] dark:text-muted-foreground">
                      Mesmos parâmetros da v{prev.version}: esta versão só mudou o status (ativar/desativar).
                    </p>
                  )
                ) : (
                  <div className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                    {FIELDS.map(([k, label]) => (
                      <p key={k}>
                        <span className="font-semibold text-[#73737D] dark:text-muted-foreground">{label}: </span>
                        {show(v, k, lookups)}
                      </p>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </ViewDialog>
  );
}

// ---------------------------------------------------------------- simulação

interface SimResult {
  input: { amountCents: number; date: string };
  campaign: { id: number; name: string; status: string } | null;
  points: number;
  rule: Rule | null;
  breakdown: string[];
  warnings: string[];
}

function Simulator({ lookups, defaultCampaign }: { lookups?: Lookups; defaultCampaign: string }) {
  const [s, setS] = useState({ campaignId: defaultCampaign, productId: "", distributorId: "", quantity: "3", amount: "", date: today });
  useEffect(() => setS((x) => ({ ...x, campaignId: defaultCampaign })), [defaultCampaign]);
  useEffect(() => {
    if (lookups && !s.productId) setS((x) => ({ ...x, productId: String(lookups.products[0]?.id ?? ""), distributorId: String(lookups.distributors[0]?.id ?? "") }));
  }, [lookups]); // eslint-disable-line react-hooks/exhaustive-deps
  const product = lookups?.products.find((p) => String(p.id) === s.productId);
  const sim = useMutation({
    mutationFn: () =>
      api.post<SimResult>("/rules/simulate", {
        campaignId: s.campaignId ? Number(s.campaignId) : undefined,
        productId: Number(s.productId),
        distributorId: Number(s.distributorId),
        quantity: Number(s.quantity),
        amountCents: s.amount.trim() ? toCents(s.amount) : undefined,
        date: s.date,
      }),
    onError: fail,
  });
  const set = (k: keyof typeof s, v: string) => setS((x) => ({ ...x, [k]: v }));

  return (
    <aside className="xl:sticky xl:top-6 xl:self-start">
      <Panel title="Simular pontuação" icon={<Calculator className="h-4 w-4" />}>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!s.productId || !s.distributorId || Number(s.quantity) < 1) return toast.error("Preencha produto, distribuidora e quantidade");
            sim.mutate();
          }}
        >
          <Field label="Campanha" hint="Automática = a campanha que cobre a venda">
            <select className={fieldClass} value={s.campaignId} onChange={(e) => set("campaignId", e.target.value)}>
              <option value="">Automática</option>
              {lookups?.campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Produto">
            <select className={fieldClass} value={s.productId} onChange={(e) => set("productId", e.target.value)}>
              {lookups?.products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.sku} · {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Distribuidora">
            <select className={fieldClass} value={s.distributorId} onChange={(e) => set("distributorId", e.target.value)}>
              {lookups?.distributors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code} · {d.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Quantidade">
              <input type="number" min={1} className={fieldClass} value={s.quantity} onChange={(e) => set("quantity", e.target.value)} />
            </Field>
            <Field label="Data da venda">
              <input type="date" className={fieldClass} value={s.date} onChange={(e) => set("date", e.target.value)} />
            </Field>
          </div>
          <Field label="Valor total (R$)" hint={product ? `Vazio = ${s.quantity || 0} × ${cents(product.priceCents)}` : undefined}>
            <input className={fieldClass} inputMode="decimal" placeholder="automático" value={s.amount} onChange={(e) => set("amount", e.target.value)} />
          </Field>
          <button type="submit" className={primaryButton} disabled={sim.isPending}>
            <Calculator className="h-4 w-4" /> {sim.isPending ? "Calculando..." : "Simular"}
          </button>
        </form>

        {sim.data && (
          <div className="mt-4 space-y-3 border-t border-[#E5E7EB] pt-4 dark:border-border/40" aria-live="polite">
            <div className="text-center">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#73737D] dark:text-muted-foreground">Pontos previstos</p>
              <p className="text-4xl font-bold text-[#00A876] dark:text-[#00E6A0]">{num(sim.data.points)}</p>
              <p className="text-xs text-[#8C8C96]">
                Venda de {cents(sim.data.input.amountCents)} em {formatDay(sim.data.input.date)} · {sim.data.campaign?.name ?? "sem campanha"}
              </p>
            </div>
            <ul className="space-y-1 text-sm">
              {sim.data.breakdown.map((b) => (
                <li key={b} className="rounded-lg bg-[#00E6A0]/[0.07] px-3 py-2 text-[#1F1F24] dark:text-white">
                  {b}
                </li>
              ))}
            </ul>
            {sim.data.warnings.map((w) => (
              <p key={w} className="flex gap-2 rounded-lg bg-warning/10 px-3 py-2 text-xs font-semibold text-[#B76E00] dark:text-warning">
                <AlertTriangle className="h-4 w-4 shrink-0" /> {w}
              </p>
            ))}
            <p className="text-xs text-[#8C8C96]">Simulação: nada é gravado. Bônus de meta é lançado à parte, na tela Metas.</p>
          </div>
        )}
      </Panel>
    </aside>
  );
}
