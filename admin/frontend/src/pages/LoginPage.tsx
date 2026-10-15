// Layout e campos do LoginPage do ~/sistema-pg, com atalhos de demonstração
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { api, PROFILE_LABEL, useAuth, type ProfileKey, type User } from "@/shared/lib/api";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Eye, EyeOff, FlaskConical, Loader2, ShieldCheck } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";

const inputClass =
  "h-12 rounded-xl border-[#E5E7EB] bg-[#FBFBFC] px-4 text-sm font-medium text-[#1F1F24] placeholder:text-[#8C8C96] focus-visible:ring-[#00E6A0] dark:border-border/40 dark:bg-[#020F14] dark:text-white";

const DEMO_PASSWORD = "demo123";

export function LoginPage() {
  const { user, setAuth } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const form = useRef<HTMLFormElement>(null);
  // 2ª etapa: o backend só entrega o token depois do código do app autenticador
  const [mfa, setMfa] = useState<{ challenge: string; qr?: string; secret?: string } | null>(null);
  const [code, setCode] = useState("");
  const demo = useQuery({
    queryKey: ["demo-users"],
    queryFn: () => api.get<{ name: string; email: string; profiles: ProfileKey[] }[]>("/auth/demo-users"),
  });

  if (user) return <Navigate to="/dashboard" replace />;

  type LoginResult = { token: string; user: User; mfa?: undefined } | { mfa: "setup" | "required"; challenge: string; qr?: string; secret?: string };

  const run = async (fn: () => Promise<void>) => {
    setLoading(true);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
      // desafio expirado ou tentativas esgotadas: volta para e-mail e senha
      if ((err as { status?: number }).status === 401) setMfa(null);
    } finally {
      setLoading(false);
    }
  };

  const login = (email: string, password: string) =>
    run(async () => {
      const res = await api.post<LoginResult>("/auth/login", { email, password });
      if (res.mfa) {
        setCode("");
        setMfa({ challenge: res.challenge, qr: res.qr, secret: res.secret });
      } else setAuth(res.token, res.user);
    });

  const verify = (value: string) =>
    run(async () => {
      const res = await api.post<{ token: string; user: User }>("/auth/mfa", { challenge: mfa!.challenge, code: value });
      setAuth(res.token, res.user);
    });

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (mfa) {
      if (!/^\d{6}$/.test(code)) return setError("Digite os 6 dígitos do código.");
      return void verify(code);
    }
    const data = new FormData(e.currentTarget);
    void login(String(data.get("email")), String(data.get("password")));
  };

  return (
    <div className="min-h-screen bg-[#F7F7FA] text-[#1F1F24] dark:bg-[#020F14] dark:text-white lg:grid lg:grid-cols-[minmax(0,1.08fr)_minmax(440px,0.92fr)]">
      <div className="relative hidden min-h-screen overflow-hidden bg-[#020F14] lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(0,230,160,0.35),transparent_55%),radial-gradient(circle_at_80%_80%,rgba(0,230,160,0.18),transparent_50%)]" />
        <div className="absolute left-12 top-10 flex items-center gap-3">
          <img src="/logo.png" alt="" className="h-12 w-auto" />
          <span className="text-2xl font-bold text-white">
            Incentiva<span className="text-[#00E6A0]">+</span>
          </span>
        </div>
        <div className="absolute bottom-12 left-12 max-w-[540px]">
          <h1 className="text-5xl font-bold leading-tight text-white">Painel administrativo da campanha</h1>
          <p className="mt-5 max-w-[460px] text-base font-medium leading-7 text-white/70">
            Distribuidoras, equipes, campanhas, regras de pontuação, importação de vendas e menus do app em um só lugar.
          </p>
        </div>
      </div>

      <div className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-8 lg:px-12">
        <div className="w-full max-w-[460px] animate-fade-in">
          <div className="mb-8">
            <span className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-3 py-1 text-xs font-bold text-[#B76E00] dark:text-warning">
              <FlaskConical className="h-3.5 w-3.5" />
              Ambiente de demonstração · dados fictícios
            </span>
            <h1 className="text-3xl font-bold leading-tight sm:text-4xl">Faça login</h1>
            <p className="mt-3 text-sm font-medium leading-6 text-[#73737D] dark:text-muted-foreground">
              Escolha um usuário de demonstração ou entre com e-mail e senha.
            </p>
          </div>

          <form
            ref={form}
            onSubmit={submit}
            className="space-y-6 rounded-2xl border border-[#E5E7EB] bg-white p-6 shadow-[0_18px_60px_rgba(31,31,36,0.08)] dark:border-border/40 dark:bg-[#071E24] sm:p-8"
          >
            {mfa ? (
              <div className="space-y-4">
                <h2 className="flex items-center gap-2 text-lg font-bold">
                  <ShieldCheck className="h-5 w-5 text-[#00E6A0]" /> Verificação em duas etapas
                </h2>
                {mfa.qr ? (
                  <>
                    <p className="text-sm leading-6 text-[#73737D] dark:text-muted-foreground">
                      Primeiro acesso com MFA: escaneie o QR code com o <b>Google Authenticator</b> (ou outro app autenticador) e digite o código gerado.
                    </p>
                    <img src={mfa.qr} alt="QR code para cadastrar no app autenticador" className="mx-auto h-48 w-48 rounded-xl bg-white p-2" />
                    <p className="break-all text-center font-mono text-xs text-[#73737D] dark:text-muted-foreground">{mfa.secret}</p>
                  </>
                ) : (
                  <p className="text-sm leading-6 text-[#73737D] dark:text-muted-foreground">Abra o seu app autenticador e digite o código de 6 dígitos da conta Incentiva+.</p>
                )}
                <div className="space-y-2">
                  <Label htmlFor="code">Código de verificação</Label>
                  <Input
                    id="code"
                    autoFocus
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="000000"
                    value={code}
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                      setCode(v);
                      if (v.length === 6) void verify(v);
                    }}
                    className={`${inputClass} text-center text-2xl font-bold tracking-[0.5em]`}
                  />
                </div>
              </div>
            ) : (
              <>
            <div className="space-y-2">
                <Label htmlFor="email">E-mail</Label>
                <Input id="email" name="email" type="email" required autoComplete="username" defaultValue="admin@incentiva.demo" className={inputClass} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Senha</Label>
                <div className="relative">
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    required
                    autoComplete="current-password"
                    defaultValue={DEMO_PASSWORD}
                    className={`${inputClass} pr-12`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8C8C96]"
                  >
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>
              </>
            )}
            {error && (
              <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" disabled={loading} className="h-12 w-full rounded-2xl bg-[#00E6A0] text-base font-semibold text-[#03261A] hover:bg-[#00C98C]">
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {mfa ? "Verificar e entrar" : "Entrar"}
            </Button>
            {mfa && (
              <button type="button" onClick={() => { setMfa(null); setError(""); }} className="mx-auto flex items-center gap-1.5 text-sm font-semibold text-[#00A876] hover:underline dark:text-[#00E6A0]">
                <ArrowLeft className="h-4 w-4" /> Voltar e usar outro usuário
              </button>
            )}
          </form>

          {!!demo.data?.length && (
            <div className="mt-6">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#73737D] dark:text-muted-foreground">
                Entrar como (senha {DEMO_PASSWORD})
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {demo.data.map((u) => (
                  <button
                    key={u.email}
                    disabled={loading}
                    onClick={() => login(u.email, DEMO_PASSWORD)}
                    className="rounded-xl border border-[#E5E7EB] bg-white px-4 py-3 text-left transition-colors hover:border-[#00E6A0] dark:border-border/40 dark:bg-white/[0.03]"
                  >
                    <span className="block text-sm font-bold">{u.name}</span>
                    <span className="block text-xs text-[#73737D] dark:text-muted-foreground">
                      {u.profiles.map((p) => PROFILE_LABEL[p]).join(" + ")}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
