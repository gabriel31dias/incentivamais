// Peças do módulo de gestão comercial (usuários, distribuidoras, equipes).
import {
  Badge,
  card,
  CheckGroup,
  EmptyState,
  Field,
  fieldClass,
  FormDialog,
  secondaryButton,
  Skeleton,
  ViewDialog,
} from "@/shared/components/kit";
import { api, ApiError, cents, competence, formatDate, PROFILE_LABEL, useAuth, useLookups, type Page, type ProfileKey } from "@/shared/lib/api";
import { toast } from "@/shared/lib/toast";
import { cn } from "@/shared/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Download, FileUp } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface UserRow {
  id: number;
  name: string;
  email: string;
  cpf: string;
  profiles: ProfileKey[];
  distributorId: number | null;
  distributorName: string | null;
  managerId: number | null;
  managerName: string | null;
  teamId: number | null;
  teamName: string | null;
  status: "active" | "inactive" | "blocked";
  blocked: boolean;
  lastAccessAt: string | null;
  /** app autenticador já cadastrado */
  mfaEnabled?: boolean;
  createdAt: string;
}

export interface AuditRow {
  id: number;
  action: string;
  actorName: string;
  description: string;
  before: unknown;
  after: unknown;
  createdAt: string;
}

const PROFILE_TONE: Record<ProfileKey, "purple" | "blue" | "green" | "gray" | "yellow"> = {
  super_admin: "purple",
  admin: "blue",
  manager: "green",
  seller: "gray",
  focal: "yellow",
};

export function ProfileBadges({ profiles }: { profiles: ProfileKey[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {profiles.map((p) => (
        <Badge key={p} tone={PROFILE_TONE[p]}>
          {PROFILE_LABEL[p]}
        </Badge>
      ))}
    </span>
  );
}

/** erro da API → toast (com a primeira linha de erros de planilha, se houver) */
export const toastError = (e: unknown) => toast.error((e as Error).message || "Não foi possível concluir.");

/** gerentes de uma distribuidora (para selects) */
export function useManagers(distributorId?: number | null) {
  return useQuery({
    queryKey: ["managers", distributorId ?? "all"],
    queryFn: () =>
      api.get<Page<UserRow>>("/users", { profile: "manager", distributor_id: distributorId ?? undefined, per_page: 200, sort: "name" }),
    staleTime: 30_000,
  });
}

/** senha temporária: aparece uma única vez */
export function TempPasswordDialog({ password, onClose, who }: { password: string | null; onClose: () => void; who?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <ViewDialog open={!!password} onOpenChange={(o) => !o && onClose()} title="Senha temporária">
      <div className="space-y-4">
        <p className="text-sm text-[#73737D] dark:text-muted-foreground">
          {who ? `Entregue esta senha para ${who}.` : "Entregue esta senha ao usuário."} Ela aparece <b>só agora</b>; depois, só redefinindo de novo.
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 rounded-xl bg-[#00E6A0]/10 px-4 py-3 text-center font-mono text-xl font-bold tracking-wider text-[#1F1F24] dark:text-white">
            {password}
          </code>
          <button
            className={secondaryButton}
            onClick={() => {
              void navigator.clipboard?.writeText(password ?? "");
              setCopied(true);
            }}
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copiada" : "Copiar"}
          </button>
        </div>
        <p className="text-xs text-[#8C8C96]">Ambiente de demonstração: nenhum e-mail é enviado.</p>
      </div>
    </ViewDialog>
  );
}

/** histórico de alterações (auditoria) de um usuário */
export function HistoryDialog({ user, onClose }: { user: UserRow | null; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["user-history", user?.id],
    queryFn: () => api.get<AuditRow[]>(`/users/${user!.id}/history`),
    enabled: !!user,
  });
  return (
    <ViewDialog open={!!user} onOpenChange={(o) => !o && onClose()} title={`Histórico · ${user?.name ?? ""}`} wide>
      {q.isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : !q.data?.length ? (
        <EmptyState title="Sem alterações registradas" />
      ) : (
        <ol className="relative space-y-4 border-l border-[#E5E7EB] pl-5 dark:border-border/40">
          {q.data.map((a) => (
            <li key={a.id} className="relative">
              <span className="absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full bg-[#00E6A0]" />
              <p className="text-sm font-semibold text-[#1F1F24] dark:text-white">{a.description}</p>
              <p className="text-xs text-[#8C8C96]">
                {formatDate(a.createdAt)} · {a.actorName} · <code>{a.action}</code>
              </p>
              {(a.before != null || a.after != null) && <Diff before={a.before} after={a.after} />}
            </li>
          ))}
        </ol>
      )}
    </ViewDialog>
  );
}

/** valores anteriores → novos, só dos campos que mudaram */
function Diff({ before, after }: { before: unknown; after: unknown }) {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]));
  if (!keys.length || keys.length > 8) return null;
  const show = (v: unknown) => (v == null ? "—" : Array.isArray(v) ? v.join(", ") || "—" : typeof v === "object" ? "…" : String(v));
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {keys.map((k) => (
        <span key={k} className="rounded-lg bg-[#F5F5F7] px-2 py-1 text-xs dark:bg-white/[0.05]">
          <b>{k}</b>: <span className="text-destructive line-through">{show(b[k])}</span> → <span className="text-[#047857] dark:text-[#34D399]">{show(a[k])}</span>
        </span>
      ))}
    </div>
  );
}

// ---------- formulário de usuário ----------

type UserForm = {
  name: string;
  email: string;
  cpf: string;
  profiles: ProfileKey[];
  distributorId: string;
  managerId: string;
  teamId: string;
};

export function UserFormDialog({
  open,
  onOpenChange,
  user,
  defaultProfiles = ["seller"],
  defaultDistributorId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user?: UserRow | null;
  defaultProfiles?: ProfileKey[];
  defaultDistributorId?: number | null;
  onCreated?: (password: string, name: string) => void;
}) {
  const qc = useQueryClient();
  const lookups = useLookups();
  const me = useAuth((s) => s.user);
  const [form, setForm] = useState<UserForm>(blank());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const managers = useManagers(form.distributorId ? Number(form.distributorId) : null);

  function blank(): UserForm {
    return { name: "", email: "", cpf: "", profiles: defaultProfiles, distributorId: defaultDistributorId ? String(defaultDistributorId) : "", managerId: "", teamId: "" };
  }

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setForm(
      user
        ? {
            name: user.name,
            email: user.email,
            cpf: "",
            profiles: user.profiles,
            distributorId: user.distributorId ? String(user.distributorId) : "",
            managerId: user.managerId ? String(user.managerId) : "",
            teamId: user.teamId ? String(user.teamId) : "",
          }
        : blank(),
    );
  }, [open, user]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch: Partial<UserForm>) => setForm((f) => ({ ...f, ...patch }));
  const teams = (lookups.data?.teams ?? []).filter((t) => String(t.distributorId) === form.distributorId);
  // só oferece perfis que o próprio usuário logado tem como conceder (o backend confere de novo)
  const grantable = (lookups.data?.profiles ?? []).filter((p) =>
    me?.profiles.includes("super_admin") ? true : p.key !== "super_admin" && (me?.scope === "organization" || !["admin"].includes(p.key)),
  );

  const submit = async () => {
    const e: Record<string, string> = {};
    if (form.name.trim().length < 3) e.name = "Informe o nome completo";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) e.email = "E-mail inválido";
    if (form.cpf && form.cpf.replace(/\D/g, "").length !== 11) e.cpf = "CPF com 11 dígitos";
    if (!form.profiles.length) e.profiles = "Escolha ao menos um perfil";
    if (form.profiles.some((p) => ["seller", "manager", "focal"].includes(p)) && !form.distributorId) e.distributorId = "Obrigatória para vendedor, gerente e ponto focal";
    setErrors(e);
    if (Object.keys(e).length) return;

    const body = {
      name: form.name,
      email: form.email,
      ...(form.cpf ? { cpf: form.cpf } : {}),
      profiles: form.profiles,
      distributorId: form.distributorId ? Number(form.distributorId) : null,
      managerId: form.managerId ? Number(form.managerId) : null,
      teamId: form.teamId ? Number(form.teamId) : null,
    };
    setBusy(true);
    try {
      if (user) {
        await api.patch(`/users/${user.id}`, body);
        toast.success("Usuário atualizado");
      } else {
        const res = await api.post<{ tempPassword: string; user: UserRow }>("/users", body);
        toast.success("Usuário criado");
        onCreated?.(res.tempPassword, res.user.name);
      }
      void qc.invalidateQueries({ queryKey: ["users"] });
      void qc.invalidateQueries({ queryKey: ["managers"] });
      onOpenChange(false);
    } catch (err) {
      const msg = (err as ApiError).message;
      if (/e-mail/i.test(msg)) setErrors({ email: msg });
      else if (/cpf/i.test(msg)) setErrors({ cpf: msg });
      else toastError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={user ? `Editar ${user.name}` : "Novo usuário"} onSubmit={submit} busy={busy} wide>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome completo" error={errors.name}>
          <input className={fieldClass} value={form.name} onChange={(e) => set({ name: e.target.value })} autoFocus />
        </Field>
        <Field label="E-mail" error={errors.email}>
          <input type="email" className={fieldClass} value={form.email} onChange={(e) => set({ email: e.target.value })} />
        </Field>
        <Field label="CPF" error={errors.cpf} hint={user ? `Atual: ${user.cpf}. Deixe em branco para manter.` : "Opcional; validado pelo dígito."}>
          <input className={fieldClass} inputMode="numeric" placeholder="000.000.000-00" value={form.cpf} onChange={(e) => set({ cpf: maskCpfInput(e.target.value) })} />
        </Field>
        <Field label="Distribuidora" error={errors.distributorId}>
          <select className={fieldClass} value={form.distributorId} onChange={(e) => set({ distributorId: e.target.value, teamId: "", managerId: "" })}>
            <option value="">— nenhuma —</option>
            {lookups.data?.distributors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.code})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Equipe" hint="Ao escolher a equipe, o gerente dela vira o responsável.">
          <select className={fieldClass} value={form.teamId} disabled={!form.distributorId} onChange={(e) => set({ teamId: e.target.value })}>
            <option value="">— sem equipe —</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Gerente responsável">
          <select className={fieldClass} value={form.managerId} disabled={!form.distributorId} onChange={(e) => set({ managerId: e.target.value })}>
            <option value="">{form.teamId ? "— o gerente da equipe —" : "— nenhum —"}</option>
            {managers.data?.data
              .filter((m) => m.id !== user?.id)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
          </select>
        </Field>
      </div>
      <Field label="Perfis (pode ter mais de um, ex.: Gerente + Ponto Focal)" error={errors.profiles}>
        <CheckGroup
          columns={3}
          options={grantable.map((p) => ({ value: p.key, label: p.name }))}
          value={form.profiles}
          onChange={(profiles) => set({ profiles })}
        />
      </Field>
    </FormDialog>
  );
}

export const maskCpfInput = (v: string) =>
  v
    .replace(/\D/g, "")
    .slice(0, 11)
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/(\d{3})\.(\d{3})\.(\d{3})(\d)/, "$1.$2.$3-$4");

export const maskCnpjInput = (v: string) =>
  v
    .replace(/\D/g, "")
    .slice(0, 14)
    .replace(/(\d{2})(\d)/, "$1.$2")
    .replace(/(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/(\d{2})\.(\d{3})\.(\d{3})(\d)/, "$1.$2.$3/$4")
    .replace(/(\d{4})(\d)/, "$1-$2");

// ---------- importação de usuários ----------

export function ImportUsersDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: (password: string) => void }) {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<{ line: number; message: string }[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setFile(null);
      setErrors([]);
    }
  }, [open]);

  const submit = async () => {
    if (!file) return toast.error("Escolha a planilha");
    const data = new FormData();
    data.append("file", file);
    setBusy(true);
    setErrors([]);
    try {
      const res = await api.post<{ created: number; tempPassword: string }>("/users/import", data);
      toast.success(`${res.created} usuário(s) importado(s)`);
      void qc.invalidateQueries({ queryKey: ["users"] });
      onOpenChange(false);
      onDone(res.tempPassword);
    } catch (err) {
      const body = (err as ApiError).body as { errors?: { line: number; message: string }[] } | null;
      if (body?.errors) setErrors(body.errors);
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Importar usuários por planilha"
      description="Tudo ou nada: com qualquer linha inválida, nenhum usuário é criado."
      onSubmit={submit}
      busy={busy}
      submitLabel="Importar"
      wide
    >
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#00E6A0]/[0.06] p-3 text-sm">
        <span>
          Colunas: <code>nome, email, cpf, perfis, distribuidora_codigo, gerente_email</code>. Perfis separados por vírgula (vendedor, gerente, ponto focal, admin).
        </span>
        <button type="button" className={secondaryButton} onClick={() => api.download("/users/template", "modelo-usuarios.xlsx").catch(toastError)}>
          <Download className="h-4 w-4" /> Baixar modelo
        </button>
      </div>
      <label className={cn("flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-[#00E6A0]/40 p-8 text-center hover:border-[#00E6A0]")}>
        <FileUp className="h-8 w-8 text-[#00A876] dark:text-[#00E6A0]" />
        <span className="text-sm font-semibold">{file ? file.name : "Clique para escolher o arquivo .xlsx ou .csv"}</span>
        <input type="file" accept=".xlsx,.csv" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      {errors.length > 0 && (
        <div className="max-h-56 overflow-y-auto rounded-xl border border-destructive/30 bg-destructive/5 p-3">
          <p className="mb-2 text-sm font-bold text-destructive">{errors.length} problema(s) — corrija e envie de novo:</p>
          <ul className="space-y-1 text-sm">
            {errors.map((e, i) => (
              <li key={i}>
                <b>{e.line ? `Linha ${e.line}` : "Arquivo"}:</b> {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </FormDialog>
  );
}

// ---------- gráficos e indicadores ----------

const GREEN = "#00C98C";

/** barra de progresso da meta (cor muda com o atingimento; o número sempre aparece) */
export function GoalBar({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-xs text-[#8C8C96]">sem meta</span>;
  const color = pct >= 100 ? "bg-[#00C98C]" : pct >= 70 ? "bg-[#F5A524]" : "bg-[#EF4444]";
  return (
    <span className="flex items-center gap-2" title={`${pct}% da meta`}>
      <span className="h-2 w-full min-w-[60px] overflow-hidden rounded-full bg-[#E5E7EB] dark:bg-white/[0.08]">
        <span className={cn("block h-full rounded-full", color)} style={{ width: `${Math.min(pct, 100)}%` }} />
      </span>
      <b className="w-11 shrink-0 text-right text-xs text-[#1F1F24] dark:text-white">{pct}%</b>
    </span>
  );
}

/** mini barras da evolução mensal (com tooltip nativo por barra) */
export function Sparkbars({ points }: { points: { competence: string; salesCents: number }[] }) {
  const max = Math.max(1, ...points.map((p) => p.salesCents));
  return (
    <span className="flex h-7 items-end gap-[2px]" role="img" aria-label={`Vendas mensais: ${points.map((p) => `${competence(p.competence)} ${cents(p.salesCents)}`).join("; ")}`}>
      {points.map((p) => (
        <span
          key={p.competence}
          title={`${competence(p.competence)}: ${cents(p.salesCents)}`}
          className="w-2 rounded-t-[2px] bg-[#00C98C]/80 hover:bg-[#00C98C]"
          style={{ height: `${Math.max(8, (p.salesCents / max) * 100)}%` }}
        />
      ))}
    </span>
  );
}

const axisTick = { fontSize: 11, fill: "#8C8C96" };
const shortMoney = (v: number) => (v >= 100_000_00 ? `${(v / 100_000_00).toFixed(1)}M` : v >= 100_000 ? `${Math.round(v / 100_000)}k` : String(v / 100));

function ChartTooltip({ active, payload, label, kind }: { active?: boolean; payload?: { value: number }[]; label?: string; kind: "money" | "points" }) {
  if (!active || !payload?.length) return null;
  return (
    <div className={cn(card, "px-3 py-2 text-xs shadow-lg")}>
      <p className="font-semibold text-[#73737D] dark:text-muted-foreground">{competence(label)}</p>
      <p className="text-sm font-bold text-[#1F1F24] dark:text-white">
        {kind === "money" ? cents(payload[0].value) : `${payload[0].value.toLocaleString("pt-BR")} pts`}
      </p>
    </div>
  );
}

/** série única de vendas por mês (área) */
export function MonthlySalesChart({ data }: { data: { competence: string; salesCents: number }[] }) {
  return (
    <div className="h-64" role="img" aria-label="Vendas por mês">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="sales-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={GREEN} stopOpacity={0.3} />
              <stop offset="1" stopColor={GREEN} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.08} />
          <XAxis dataKey="competence" tickFormatter={(c) => competence(c).slice(0, 3)} tick={axisTick} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={shortMoney} tick={axisTick} axisLine={false} tickLine={false} width={44} />
          <Tooltip content={<ChartTooltip kind="money" />} cursor={{ stroke: GREEN, strokeOpacity: 0.4 }} />
          <Area type="monotone" dataKey="salesCents" stroke={GREEN} strokeWidth={2} fill="url(#sales-fill)" activeDot={{ r: 5, strokeWidth: 2 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** série única de pontos por mês (barras) */
export function MonthlyPointsChart({ data }: { data: { competence: string; points: number }[] }) {
  return (
    <div className="h-64" role="img" aria-label="Pontos creditados por mês">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.08} />
          <XAxis dataKey="competence" tickFormatter={(c) => competence(c).slice(0, 3)} tick={axisTick} axisLine={false} tickLine={false} />
          <YAxis tick={axisTick} axisLine={false} tickLine={false} width={44} tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : v)} />
          <Tooltip content={<ChartTooltip kind="points" />} cursor={{ fill: GREEN, fillOpacity: 0.08 }} />
          <Bar dataKey="points" fill={GREEN} radius={[4, 4, 0, 0]} maxBarSize={36} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** linha de definição em painéis de detalhe */
export function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold text-[#8C8C96] dark:text-muted-foreground">{label}</p>
      <p className="truncate text-sm font-semibold text-[#1F1F24] dark:text-white">{children ?? "—"}</p>
    </div>
  );
}

