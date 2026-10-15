import {

  CheckGroup,
  DataTable,
  Field,
  fieldClass,
  iconButton,
  Panel,
  primaryButton,
  SearchInput,
  Skeleton,
  Strong,
  Sub,
  Toolbar,
  useConfirm,
  useList,
  type Column,
} from "@/shared/components/kit";
import { api, formatDate, PROFILE_LABEL, useAuth, type ProfileKey } from "@/shared/lib/api";
import { toast } from "@/shared/lib/toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound, LogOut, MonitorSmartphone, ShieldAlert, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useSettings } from "./useSettings";

type Session = { id: number; userId: number; userName: string; userAgent: string | null; ip: string | null; createdAt: string };

// "Mozilla/5.0 (X11; Linux x86_64) ... Chrome/130" → "Chrome · Linux"
const device = (ua: string | null) => {
  if (!ua) return "Desconhecido";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : ua.split(" ")[0];
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} · ${os}` : browser;
};

function Sessions() {
  const qc = useQueryClient();
  const me = useAuth((s) => s.user);
  const list = useList<Session>("sessions", "/sessions");
  const confirm = useConfirm();
  const revoke = useMutation({
    mutationFn: (id: number) => api.post(`/sessions/${id}/revoke`),
    onSuccess: () => {
      toast.success("Sessão encerrada.", { description: "O usuário precisa entrar de novo." });
      qc.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const columns: Column<Session>[] = [
    {
      header: "Usuário",
      width: "minmax(180px,1.4fr)",
      cell: (s) => (
        <>
          <Strong>{s.userName}</Strong>
          {s.userId === me?.id && <Sub>você</Sub>}
        </>
      ),
    },
    { header: "Dispositivo", width: "minmax(150px,1fr)", cell: (s) => <span title={s.userAgent ?? ""}>{device(s.userAgent)}</span> },
    { header: "IP", width: "130px", cell: (s) => s.ip ?? "—" },
    { header: "Início", width: "140px", cell: (s) => formatDate(s.createdAt) },
    {
      header: "",
      width: "60px",
      className: "flex justify-end",
      cell: (s) => (
        <button
          className={iconButton}
          title="Encerrar sessão"
          aria-label={`Encerrar sessão de ${s.userName}`}
          onClick={() =>
            confirm.ask({
              title: "Encerrar sessão?",
              description: s.userId === me?.id ? "Esta é uma sessão sua; se for a atual, você será desconectado." : `${s.userName} será desconectado na próxima requisição.`,
              confirmLabel: "Encerrar",
              danger: true,
              run: () => revoke.mutate(s.id),
            })
          }
        >
          <LogOut className="h-4 w-4 text-destructive" />
        </button>
      ),
    },
  ];
  return (
    <Panel title="Sessões ativas" icon={<MonitorSmartphone className="h-4 w-4" />}>
      <div className="space-y-3">
        <Toolbar>
          <SearchInput value={list.filters.search} onChange={(search) => list.patch({ search })} placeholder="Buscar usuário..." />
        </Toolbar>
        <DataTable columns={columns} page={list.data} isLoading={list.isLoading} isError={list.isError} onPageChange={list.setPage} minWidth={680} empty="Nenhuma sessão ativa." />
        {confirm.dialog}
      </div>
    </Panel>
  );
}

const MFA_PROFILES: ProfileKey[] = ["super_admin", "admin", "manager", "focal", "seller"];

type Security = {
  /** perfis obrigados a usar MFA no login (app e admin) */
  mfaProfiles: ProfileKey[];
  passwordMinLength: number;
  passwordRequireSymbols: boolean;
  passwordExpireDays: number;
  lockAfterAttempts: number;
  sessionHours: number;
};

export function SecurityForm() {
  const settings = useSettings();
  const [form, setForm] = useState<Security | null>(null);
  useEffect(() => {
    if (settings.rec)
      setForm({
        mfaProfiles: Array.isArray(settings.data.mfaProfiles) ? settings.data.mfaProfiles : [...MFA_PROFILES],
        passwordMinLength: settings.data.passwordMinLength ?? 8,
        passwordRequireSymbols: settings.data.passwordRequireSymbols ?? true,
        passwordExpireDays: settings.data.passwordExpireDays ?? 90,
        lockAfterAttempts: settings.data.lockAfterAttempts ?? 5,
        sessionHours: settings.data.sessionHours ?? 12,
      });
  }, [settings.rec]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!form) return <Skeleton className="h-72" />;
  const set = <K extends keyof Security>(k: K, v: Security[K]) => setForm({ ...form, [k]: v });
  const check = (k: "passwordRequireSymbols", label: string) => (
    <label className="flex items-center gap-3 text-sm">
      <input type="checkbox" className="h-4 w-4 accent-[#00E6A0]" checked={form[k]} onChange={(e) => set(k, e.target.checked)} />
      {label}
    </label>
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (form.passwordMinLength < 6) return void toast.error("Senha mínima de 6 caracteres.");
        settings.save.mutate(form);
      }}
      className="grid gap-5 lg:grid-cols-2"
    >
      <Panel title="Autenticação em dois fatores (MFA)" icon={<ShieldCheck className="h-4 w-4" />}>
        <div className="space-y-4">
          <p className="text-sm text-[#73737D] dark:text-muted-foreground">
            Depois do e-mail e da senha, o login pede um código de 6 dígitos do <b>app autenticador</b> (Google Authenticator, Microsoft Authenticator...).
            No primeiro acesso o usuário cadastra o app pelo QR code. Vale para o painel admin e para o app.
          </p>
          <Field label="Exigir MFA para estes perfis" hint="Usuário com vários perfis: basta um deles estar marcado. Nenhum marcado = MFA desligado.">
            <CheckGroup
              options={MFA_PROFILES.map((p) => ({ value: p, label: PROFILE_LABEL[p] }))}
              value={form.mfaProfiles}
              onChange={(v) => set("mfaProfiles", v)}
              columns={1}
            />
          </Field>
          {!form.mfaProfiles.length && (
            <div className="flex gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-[#B76E00] dark:text-warning">
              <ShieldAlert className="h-5 w-5 shrink-0" />
              <p>Com nenhum perfil marcado, o login volta a pedir só e-mail e senha.</p>
            </div>
          )}
          <p className="text-xs text-[#8C8C96] dark:text-muted-foreground">
            Perdeu o celular? Em <b>Usuários</b>, use “Redefinir MFA” no usuário: no próximo login ele cadastra o app de novo.
          </p>
        </div>
      </Panel>
      <Panel title="Senhas e sessões" icon={<KeyRound className="h-4 w-4" />}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tamanho mínimo da senha">
            <input type="number" min={6} max={64} className={fieldClass} value={form.passwordMinLength} onChange={(e) => set("passwordMinLength", Number(e.target.value))} />
          </Field>
          <Field label="Expirar senha a cada (dias)" hint="0 = nunca">
            <input type="number" min={0} className={fieldClass} value={form.passwordExpireDays} onChange={(e) => set("passwordExpireDays", Number(e.target.value))} />
          </Field>
          <Field label="Bloquear após tentativas erradas">
            <input type="number" min={1} max={20} className={fieldClass} value={form.lockAfterAttempts} onChange={(e) => set("lockAfterAttempts", Number(e.target.value))} />
          </Field>
          <Field label="Duração da sessão (horas)">
            <input type="number" min={1} max={72} className={fieldClass} value={form.sessionHours} onChange={(e) => set("sessionHours", Number(e.target.value))} />
          </Field>
          <div className="sm:col-span-2">{check("passwordRequireSymbols", "Exigir letras, números e símbolos")}</div>
          <div className="sm:col-span-2">
            <p className="text-xs text-[#8C8C96] dark:text-muted-foreground">Política registrada; a validação de senha real fica para a integração de autenticação.</p>
          </div>
        </div>
      </Panel>
      <div className="flex justify-end lg:col-span-2">
        <button type="submit" className={primaryButton} disabled={settings.save.isPending}>
          {settings.save.isPending ? "Salvando..." : "Salvar política de segurança"}
        </button>
      </div>
    </form>
  );
}

export function SecurityPage() {
  return (
    <div className="space-y-5">
      <SecurityForm />
      <Sessions />
    </div>
  );
}
