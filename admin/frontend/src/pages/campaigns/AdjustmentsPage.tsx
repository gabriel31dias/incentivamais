import {
  card,
  DataTable,
  Field,
  fieldClass,
  iconButton,
  Panel,
  primaryButton,
  Strong,
  Sub,
  textareaClass,
  useConfirm,
  useList,
  type Column,
} from "@/shared/components/kit";
import { api, formatDate, num, useLookups } from "@/shared/lib/api";
import { toast } from "@/shared/lib/toast";
import { cn } from "@/shared/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RotateCcw, Search, ShieldCheck, SlidersHorizontal, UserRound, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ReverseDialog } from "./ReverseDialog";
import { EntryBadge, Group, Points, type Entry } from "./shared";

type Seller = { id: number; name: string; email: string; distributorId: number | null; status: string };
type Balance = { sellerId: number; name: string; balance: number; credits: number; debits: number; entries: number };
type Kind = "adjustment" | "bonus" | "debit";

const KINDS: { value: Kind; label: string; hint: string }[] = [
  { value: "adjustment", label: "Ajuste administrativo", hint: "Corrige o saldo para mais (+) ou para menos (−)" },
  { value: "bonus", label: "Bônus", hint: "Sempre credita pontos" },
  { value: "debit", label: "Débito", hint: "Sempre debita pontos (não deixa o saldo negativo)" },
];

export function AdjustmentsPage() {
  const lookups = useLookups().data;
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [seller, setSeller] = useState<Seller | null>(null);
  const [kind, setKind] = useState<Kind>("adjustment");
  const [points, setPoints] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [reversing, setReversing] = useState<Entry | null>(null);

  const balance = useQuery({
    queryKey: ["balance", seller?.id],
    queryFn: () => api.get<Balance>(`/points/balance/${seller!.id}`),
    enabled: !!seller,
  });
  const recent = useList<Entry>("ledger", "/points", { manual: "1", type: "adjustment,reversal,bonus,debit" }, 10);

  const raw = Math.trunc(Number(points.replace(",", ".")));
  const signed = kind === "debit" ? -Math.abs(raw) : kind === "bonus" ? Math.abs(raw) : raw;

  const adjust = useMutation({
    mutationFn: () => api.post<{ balanceBefore: number; balanceAfter: number }>("/points/adjust", { sellerId: seller!.id, points: signed, type: kind, reason: reason.trim(), campaignId: campaignId ? Number(campaignId) : undefined }),
    onSuccess: (r) => {
      toast.success("Lançamento registrado", { description: `${seller!.name}: ${num(r.balanceBefore)} → ${num(r.balanceAfter)} pts` });
      setPoints("");
      setReason("");
      qc.invalidateQueries({ queryKey: ["balance"] });
      qc.invalidateQueries({ queryKey: ["ledger"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const submit = () => {
    const e: Record<string, string> = {};
    if (!seller) e.seller = "Escolha o vendedor";
    if (!Number.isFinite(raw) || raw === 0) e.points = "Informe uma quantidade diferente de zero";
    if (reason.trim().length < 15) e.reason = "Justificativa obrigatória (mínimo 15 caracteres)";
    const before = balance.data?.balance ?? 0;
    if (!e.points && seller && balance.data && before + signed < 0) e.points = `Saldo insuficiente (${num(before)} pts)`;
    setErrors(e);
    if (Object.keys(e).length) return;
    confirm.ask({
      title: "Confirmar lançamento?",
      confirmLabel: "Registrar lançamento",
      description: (
        <div className="space-y-2 text-sm">
          <p>
            <b>{KINDS.find((k) => k.value === kind)!.label}</b> de <Points value={signed} /> pts para <b>{seller!.name}</b>.
          </p>
          <p>
            Saldo: <b>{num(before)}</b> → <b>{num(before + signed)}</b> pts
          </p>
          <p className="text-xs">“{reason.trim()}”</p>
          <p className="text-xs">O lançamento fica no extrato e na auditoria com seu nome e não pode ser excluído (só estornado).</p>
        </div>
      ),
      run: () => adjust.mutate(),
    });
  };

  const columns: Column<Entry>[] = [
    { header: "ID", width: "70px", cell: (e) => <span className="font-mono text-xs">#{e.id}</span> },
    { header: "Data", width: "130px", cell: (e) => formatDate(e.createdAt) },
    { header: "Vendedor", width: "minmax(140px,1fr)", cell: (e) => <Strong>{e.sellerName}</Strong> },
    { header: "Tipo", width: "150px", cell: (e) => <EntryBadge type={e.type} /> },
    { header: "Pontos", width: "80px", className: "text-right", cell: (e) => <Points value={e.points} /> },
    {
      header: "Justificativa",
      width: "minmax(200px,2fr)",
      cell: (e) => (
        <span title={e.reason ?? ""}>
          <span className="block truncate">{e.reason ?? "—"}</span>
          <Sub>{e.origin}</Sub>
        </span>
      ),
    },
    { header: "Responsável", width: "minmax(120px,1fr)", cell: (e) => e.actorName },
    {
      header: "",
      width: "44px",
      cell: (e) =>
        e.type !== "reversal" ? (
          <button className={iconButton} onClick={() => setReversing(e)} title="Estornar" aria-label={`Estornar lançamento ${e.id}`}>
            <RotateCcw className="h-4 w-4" />
          </button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Panel title="Novo lançamento manual" icon={<SlidersHorizontal className="h-4 w-4" />}>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <SellerPicker value={seller} onChange={setSeller} error={errors.seller} />
            {seller && (
              <div className="grid grid-cols-3 gap-2 rounded-xl bg-[#00E6A0]/[0.06] p-3 text-center text-sm" aria-live="polite">
                {balance.isLoading ? (
                  <span className="col-span-3 text-xs">Carregando saldo...</span>
                ) : (
                  <>
                    <span>
                      <span className="block text-xs text-[#73737D] dark:text-muted-foreground">Saldo atual</span>
                      <b className="text-lg">{num(balance.data?.balance)}</b>
                    </span>
                    <span>
                      <span className="block text-xs text-[#73737D] dark:text-muted-foreground">Créditos</span>
                      <Points value={balance.data?.credits ?? 0} />
                    </span>
                    <span>
                      <span className="block text-xs text-[#73737D] dark:text-muted-foreground">Débitos</span>
                      <Points value={balance.data?.debits ?? 0} />
                    </span>
                  </>
                )}
              </div>
            )}
            <div role="radiogroup" aria-label="Tipo de lançamento" className="grid gap-2 sm:grid-cols-3">
              {KINDS.map((k) => (
                <label key={k.value} className={cn(card, "cursor-pointer p-3 text-sm transition-colors", kind === k.value && "border-[#00E6A0] ring-1 ring-[#00E6A0]")}>
                  <input type="radio" name="kind" className="sr-only" checked={kind === k.value} onChange={() => setKind(k.value)} />
                  <span className="block font-bold text-[#1F1F24] dark:text-white">{k.label}</span>
                  <span className="block text-xs text-[#73737D] dark:text-muted-foreground">{k.hint}</span>
                </label>
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={kind === "adjustment" ? "Pontos (use − para debitar)" : "Pontos"} error={errors.points}>
                <input className={fieldClass} inputMode="numeric" value={points} onChange={(e) => setPoints(e.target.value)} placeholder={kind === "adjustment" ? "Ex.: 50 ou -50" : "Ex.: 100"} />
              </Field>
              <Field label="Campanha (opcional)">
                <select className={fieldClass} value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
                  <option value="">Nenhuma</option>
                  {lookups?.campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {seller && Number.isFinite(raw) && raw !== 0 && balance.data && (
              <p className="text-sm">
                Resultado: <b>{num(balance.data.balance)}</b> → <b>{num(balance.data.balance + signed)}</b> pts (<Points value={signed} />)
              </p>
            )}
            <Field label="Justificativa" error={errors.reason} hint={`${reason.trim().length}/15 caracteres mínimos · fica registrada na auditoria`}>
              <textarea className={textareaClass} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Ex.: Venda de 12/08 lançada com quantidade menor pela distribuidora" />
            </Field>
            <button type="submit" className={primaryButton} disabled={adjust.isPending}>
              {adjust.isPending ? "Registrando..." : "Revisar e confirmar"}
            </button>
          </form>
        </Panel>

        <Panel title="Regras do ajuste" icon={<ShieldCheck className="h-4 w-4" />}>
          <ul className="space-y-3 text-sm text-[#73737D] dark:text-muted-foreground">
            <li>• Justificativa obrigatória e confirmação antes de gravar.</li>
            <li>• Cada lançamento registra quem fez, quando e o saldo antes/depois na auditoria.</li>
            <li>
              • <b className="text-[#1F1F24] dark:text-white">Lançamentos históricos não são excluídos.</b> Para desfazer, use o estorno: ele cria um lançamento inverso
              vinculado ao original, que continua no extrato.
            </li>
            <li>• Um lançamento só pode ser estornado uma vez, e estornos não podem ser estornados.</li>
            <li>• Débitos não podem deixar o saldo do vendedor negativo.</li>
            <li>
              • Para estornar qualquer lançamento (inclusive créditos de vendas), use o{" "}
              <Link to="/extrato" className="font-semibold text-[#00A876] hover:underline dark:text-[#00E6A0]">
                Extrato de Pontos
              </Link>
              .
            </li>
          </ul>
        </Panel>
      </div>

      <div className="space-y-3">
        <h2 className="text-base font-bold text-[#1F1F24] dark:text-white">Últimos ajustes e estornos manuais</h2>
        <DataTable columns={columns} page={recent.data} isLoading={recent.isLoading} isError={recent.isError} onPageChange={recent.setPage} minWidth={1000} empty="Nenhum ajuste manual ainda." />
      </div>

      <ReverseDialog entry={reversing} onClose={() => setReversing(null)} />
      {confirm.dialog}
    </div>
  );
}

/** busca de vendedor com lista de sugestões (debounce 300 ms) */
function SellerPicker({ value, onChange, error }: { value: Seller | null; onChange: (s: Seller | null) => void; error?: string }) {
  const [text, setText] = useState("");
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setTerm(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);
  const results = useQuery({
    queryKey: ["sellers", term],
    queryFn: () => api.get<Seller[]>("/points/sellers", { search: term }),
    enabled: term.length >= 2,
  });

  if (value)
    return (
      <Group label="Vendedor">
        <div className="flex items-center gap-3 rounded-xl border border-[#00E6A0]/50 px-3 py-2">
          <UserRound className="h-5 w-5 text-[#00A876] dark:text-[#00E6A0]" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold text-[#1F1F24] dark:text-white">{value.name}</span>
            <span className="block truncate text-xs text-[#8C8C96]">
              #{value.id} · {value.email}
            </span>
          </span>
          <button type="button" className={iconButton} onClick={() => onChange(null)} aria-label="Trocar vendedor">
            <X className="h-4 w-4" />
          </button>
        </div>
      </Group>
    );

  return (
    <div className="relative">
      <Field label="Vendedor" error={error} hint="Busque por nome, e-mail, CPF ou ID">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8C8C96]" />
          <input
            className={cn(fieldClass, "pl-9")}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            placeholder="Ex.: vendedor12 ou Ana"
            role="combobox"
            aria-expanded={open}
            aria-controls="seller-options"
          />
          {results.isFetching && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-[#8C8C96]" />}
        </div>
      </Field>
      {open && term.length >= 2 && results.data && (
        <ul id="seller-options" role="listbox" className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-[#E5E7EB] bg-white p-1 shadow-lg dark:border-border/40 dark:bg-[#071E24]">
          {results.data.length ? (
            results.data.map((s) => (
              <li key={s.id} role="option" aria-selected={false}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onChange(s);
                    setText("");
                    setOpen(false);
                  }}
                  className="flex w-full flex-col rounded-lg px-3 py-2 text-left hover:bg-[#00E6A0]/10"
                >
                  <span className="text-sm font-bold text-[#1F1F24] dark:text-white">
                    {s.name} {s.status !== "active" && <span className="text-xs font-normal text-destructive">(inativo)</span>}
                  </span>
                  <span className="text-xs text-[#8C8C96]">
                    #{s.id} · {s.email}
                  </span>
                </button>
              </li>
            ))
          ) : (
            <li className="px-3 py-2 text-sm text-[#8C8C96]">Nenhum vendedor encontrado no seu escopo.</li>
          )}
        </ul>
      )}
    </div>
  );
}
