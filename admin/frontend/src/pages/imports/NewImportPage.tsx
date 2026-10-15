// Fluxo de importação em 5 etapas: Selecionar → Validar → Prévia → Confirmar → Processar.
import {
  card,
  Field,
  fieldClass,
  Panel,
  primaryButton,
  secondaryButton,
  useConfirm,
} from "@/shared/components/kit";
import { api, ApiError, competence, num, useAuth, useCan, useLookups } from "@/shared/lib/api";
import { toast } from "@/shared/lib/toast";
import { cn } from "@/shared/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CloudUpload,
  Download,
  FileSpreadsheet,
  FileWarning,
  Loader2,
  RefreshCcw,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useState, type DragEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  BatchHeading,
  downloadErrors,
  ErrorReport,
  fetchBlob,
  isBusy,
  lastCompetence,
  RowsTable,
  SummaryGrid,
  Timeline,
  useBatch,
  type BatchDetail,
} from "./shared";

const STEPS = ["Selecionar", "Validar", "Prévia", "Confirmar", "Processar"];
const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = [".xlsx", ".xls", ".csv"];

/** o que o backend confere em cada linha (exibido na etapa 2) */
const CHECKS = [
  "Layout e colunas obrigatórias",
  "Campos obrigatórios",
  "CPF válido",
  "Vendedor existe e pertence à distribuidora",
  "Vendedor ativo",
  "Produto (SKU) existe",
  "Data válida e dentro da competência",
  "Quantidade e valor válidos",
  "Documento duplicado no arquivo",
  "Venda já importada ou correção de venda pontuada",
  "Cálculo dos pontos previstos",
];

function Stepper({ step }: { step: number }) {
  return (
    <ol className="grid grid-cols-5 gap-1 sm:gap-2" aria-label="Etapas da importação">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const state = n < step ? "done" : n === step ? "current" : "todo";
        return (
          <li key={label} aria-current={state === "current" ? "step" : undefined} className="flex flex-col items-center gap-1.5 text-center">
            <div className="flex w-full items-center">
              <span className={cn("h-0.5 flex-1", i === 0 ? "bg-transparent" : n <= step ? "bg-[#00E6A0]" : "bg-[#E5E7EB] dark:bg-border/50")} />
              <span
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold",
                  state === "done" && "border-[#00E6A0] bg-[#00E6A0] text-[#03261A]",
                  state === "current" && "border-[#00E6A0] text-[#00A876] shadow-[0_0_14px_rgba(0,230,160,0.35)] dark:text-[#00E6A0]",
                  state === "todo" && "border-[#E5E7EB] text-[#8C8C96] dark:border-border/60",
                )}
              >
                {state === "done" ? <Check className="h-4 w-4" /> : n}
              </span>
              <span className={cn("h-0.5 flex-1", i === STEPS.length - 1 ? "bg-transparent" : n < step ? "bg-[#00E6A0]" : "bg-[#E5E7EB] dark:bg-border/50")} />
            </div>
            <span className={cn("text-[11px] font-semibold sm:text-xs", state === "todo" ? "text-[#8C8C96]" : "text-[#1F1F24] dark:text-white")}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function NewImportPage() {
  const [params, setParams] = useSearchParams();
  const user = useAuth((s) => s.user);
  const canApprove = useCan("SALES_APPROVE");
  const lookups = useLookups();
  const qc = useQueryClient();
  const confirm = useConfirm();

  const [step, setStep] = useState(1);
  const [distributorId, setDistributorId] = useState(params.get("distributorId") ?? (user?.scope !== "organization" ? String(user?.distributorId ?? "") : ""));
  const [comp, setComp] = useState(params.get("competence") ?? lastCompetence());
  const replaces = params.get("replaces");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [batchId, setBatchId] = useState<number | null>(null);
  const [checked, setChecked] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [sampling, setSampling] = useState("");
  const batch = useBatch(batchId);
  const b = batch.data;

  const distributors = (lookups.data?.distributors ?? []).filter(
    (d) => d.status === "active" && (user?.scope === "organization" || d.id === user?.distributorId),
  );

  const pick = (f?: File | null) => {
    setFileError("");
    if (!f) return;
    if (!ACCEPT.some((ext) => f.name.toLowerCase().endsWith(ext))) return setFileError("Formato não aceito. Use .xlsx, .xls ou .csv.");
    if (f.size > MAX_BYTES) return setFileError("Arquivo maior que 10 MB.");
    setFile(f);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    pick(e.dataTransfer.files[0]);
  };

  /** gera a planilha de exemplo no backend e já anexa (também baixa uma cópia) */
  const sample = async (kind: "valid" | "errors" | "correction") => {
    if (!distributorId) return toast.error("Escolha a distribuidora antes de gerar o exemplo");
    setSampling(kind);
    try {
      const f = await fetchBlob(`/imports/sample?distributorId=${distributorId}&competence=${comp}&kind=${kind}`);
      setFile(f);
      setFileError("");
      const url = URL.createObjectURL(f);
      const a = document.createElement("a");
      a.href = url;
      a.download = f.name;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Planilha de exemplo anexada", { description: f.name });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSampling("");
    }
  };

  const send = async () => {
    if (!distributorId || !comp || !file) return;
    const form = new FormData();
    form.append("file", file);
    form.append("distributorId", distributorId);
    form.append("competence", comp);
    if (replaces) form.append("replaces", replaces);
    setStep(2);
    setChecked(0);
    setUploading(true);
    try {
      const res = await api.post<BatchDetail>("/imports", form);
      qc.setQueryData(["import-batch", res.id], res);
      setBatchId(res.id);
      qc.invalidateQueries({ queryKey: ["imports"] });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Falha no envio");
      setStep(1);
    } finally {
      setUploading(false);
    }
  };

  // etapa 2: marca as validações uma a uma; avança quando o backend respondeu
  useEffect(() => {
    if (step !== 2) return;
    if (checked < CHECKS.length) {
      const t = setTimeout(() => setChecked((c) => c + 1), 160);
      return () => clearTimeout(t);
    }
    if (!uploading && b) {
      const t = setTimeout(() => setStep(3), 400);
      return () => clearTimeout(t);
    }
  }, [step, checked, uploading, b]);

  const doConfirm = async () => {
    if (!b) return;
    try {
      await api.post(`/imports/${b.id}/confirm`);
      qc.invalidateQueries({ queryKey: ["import-batch", b.id] });
      qc.invalidateQueries({ queryKey: ["imports"] });
      toast.success(`Lote #${b.id} confirmado e enviado para a fila`);
      setStep(5);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const restart = (keepReplaces?: number) => {
    setStep(1);
    setFile(null);
    setBatchId(null);
    const next = new URLSearchParams();
    if (keepReplaces) {
      next.set("distributorId", distributorId);
      next.set("competence", comp);
      next.set("replaces", String(keepReplaces));
    }
    setParams(next, { replace: true });
  };

  const apt = b ? b.valid + b.corrections : 0;
  const failed = b?.status === "failed";
  const distName = distributors.find((d) => String(d.id) === distributorId)?.name;

  return (
    <div className="space-y-6">
      <div className={cn(card, "p-4 sm:p-5")}>
        <Stepper step={step} />
      </div>

      {/* ---------- 1. selecionar ---------- */}
      {step === 1 && (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-5">
            {replaces && (
              <p className="flex items-center gap-2 rounded-xl border border-info/40 bg-info/10 px-4 py-3 text-sm font-semibold text-[#1D6FD1] dark:text-[#60A5FA]">
                <RefreshCcw className="h-4 w-4 shrink-0" />
                Reenvio corrigido do lote #{replaces}: ao confirmar, o lote anterior fica como "Substituído/corrigido" no histórico.
              </p>
            )}
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              <Field label="Distribuidora">
                <select
                  className={fieldClass}
                  value={distributorId}
                  onChange={(e) => setDistributorId(e.target.value)}
                  disabled={user?.scope !== "organization" && distributors.length <= 1}
                >
                  <option value="">Selecione...</option>
                  {distributors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.code})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Competência (mês das vendas)">
                <input type="month" className={fieldClass} value={comp} onChange={(e) => setComp(e.target.value)} />
              </Field>
            </div>

            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={cn(
                "flex cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-5 py-10 text-center transition-colors",
                dragging || file
                  ? "border-[#00E6A0] bg-[#00E6A0]/[0.06]"
                  : "border-[#00E6A0]/35 bg-white hover:border-[#00E6A0] hover:bg-[#00E6A0]/[0.04] dark:bg-white/[0.02]",
              )}
            >
              <input type="file" accept={ACCEPT.join(",")} className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
              <FileSpreadsheet className="mb-1 h-14 w-14 text-[#13A35A]" />
              {file ? (
                <>
                  <b className="break-all text-lg text-[#1F1F24] dark:text-white">{file.name}</b>
                  <span className="text-sm text-[#73737D] dark:text-muted-foreground">{(file.size / 1024).toFixed(1)} KB · clique para trocar</span>
                </>
              ) : (
                <>
                  <b className="text-lg text-[#1F1F24] dark:text-white">Arraste o arquivo aqui</b>
                  <span className="text-sm text-[#73737D] dark:text-muted-foreground">ou clique para selecionar</span>
                </>
              )}
              <small className="text-xs text-[#8C8C96] dark:text-muted-foreground">Formatos aceitos: .xlsx, .xls, .csv | Tamanho máximo: 10 MB</small>
              {fileError && (
                <span role="alert" className="text-sm font-semibold text-destructive">
                  {fileError}
                </span>
              )}
            </label>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              {file && (
                <button type="button" className={secondaryButton} onClick={() => setFile(null)}>
                  <X className="h-4 w-4" /> Remover arquivo
                </button>
              )}
              <button className={primaryButton} disabled={!distributorId || !comp || !file} onClick={send}>
                <CloudUpload className="h-4 w-4" /> Enviar e validar
              </button>
            </div>
          </div>

          <div className="space-y-5">
            <Panel title="Modelo de planilha" icon={<Download className="h-4 w-4" />}>
              <p className="mb-3 text-sm text-[#73737D] dark:text-muted-foreground">
                Colunas: documento, item, cpf_vendedor, sku, data, quantidade, valor. Use o modelo oficial para evitar divergência de layout.
              </p>
              <button className={cn(secondaryButton, "w-full")} onClick={() => api.download("/imports/template", "modelo-importacao-vendas.xlsx")}>
                <Download className="h-4 w-4" /> Baixar modelo
              </button>
            </Panel>
            <Panel title="Planilha de exemplo" icon={<Sparkles className="h-4 w-4" />}>
              <p className="mb-3 text-sm text-[#73737D] dark:text-muted-foreground">
                Gera um arquivo com vendedores reais da distribuidora e competência escolhidas e já anexa para envio.
              </p>
              <div className="grid gap-2">
                {(
                  [
                    ["valid", "Válida", "Só linhas corretas"],
                    ["errors", "Com inconsistências", "Uma linha para cada tipo de erro"],
                    ["correction", "Correção", "Reenvia vendas já pontuadas com mudanças"],
                  ] as const
                ).map(([kind, label, hint]) => (
                  <button
                    key={kind}
                    disabled={!!sampling}
                    onClick={() => sample(kind)}
                    className="flex items-center justify-between gap-3 rounded-xl border border-[#E5E7EB] px-3 py-2.5 text-left transition-colors hover:border-[#00E6A0] disabled:opacity-60 dark:border-border/40"
                  >
                    <span>
                      <b className="block text-sm text-[#1F1F24] dark:text-white">{label}</b>
                      <span className="text-xs text-[#73737D] dark:text-muted-foreground">{hint}</span>
                    </span>
                    {sampling === kind ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 text-[#00A876] dark:text-[#00E6A0]" />}
                  </button>
                ))}
              </div>
            </Panel>
          </div>
        </div>
      )}

      {/* ---------- 2. validar ---------- */}
      {step === 2 && (
        <Panel title={`Validando ${file?.name ?? "arquivo"}`} icon={<Loader2 className="h-4 w-4 animate-spin" />}>
          <p className="mb-4 text-sm text-[#73737D] dark:text-muted-foreground">
            {distName} · {competence(comp)}
          </p>
          <ul className="grid gap-2 sm:grid-cols-2" aria-live="polite">
            {CHECKS.map((c, i) => (
              <li key={c} className={cn("flex items-center gap-2 text-sm transition-opacity", i < checked ? "opacity-100" : "opacity-40")}>
                {i < checked ? (
                  <Check className="h-4 w-4 shrink-0 text-[#00A876] dark:text-[#00E6A0]" />
                ) : (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#8C8C96]" />
                )}
                {c}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {/* ---------- 3. prévia ---------- */}
      {step === 3 && b && (
        <div className="space-y-5">
          <BatchHeading batch={b} />
          {failed ? (
            <Panel title="Arquivo recusado" icon={<FileWarning className="h-4 w-4" />}>
              <p className="mb-4 rounded-xl bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive">{b.error}</p>
              <ErrorReport types={b.errorsByType} />
              <div className="mt-4 flex flex-wrap gap-2">
                <button className={secondaryButton} onClick={() => api.download("/imports/template", "modelo-importacao-vendas.xlsx")}>
                  <Download className="h-4 w-4" /> Baixar modelo
                </button>
                <button className={primaryButton} onClick={() => restart(b.id)}>
                  <RefreshCcw className="h-4 w-4" /> Reenviar arquivo corrigido
                </button>
              </div>
            </Panel>
          ) : (
            <>
              <SummaryGrid batch={b} />
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
                <RowsTable batch={b} />
                <Panel
                  title="Relatório de inconsistências"
                  icon={<FileWarning className="h-4 w-4" />}
                  actions={
                    b.invalid + b.duplicates > 0 && (
                      <button className={secondaryButton} onClick={() => downloadErrors(b.id)}>
                        <Download className="h-4 w-4" /> Erros (CSV)
                      </button>
                    )
                  }
                >
                  <ErrorReport types={b.errorsByType} empty="Todas as linhas passaram nas validações." />
                </Panel>
              </div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                <button className={secondaryButton} onClick={() => restart(b.id)}>
                  <RefreshCcw className="h-4 w-4" /> Reenviar arquivo corrigido
                </button>
                <button className={primaryButton} disabled={!apt} onClick={() => setStep(4)}>
                  Revisar e confirmar <ArrowRight className="h-4 w-4" />
                </button>
              </div>
              {!apt && (
                <p className="text-right text-sm font-semibold text-[#B76E00] dark:text-warning">
                  Nenhuma linha apta: {b.duplicates ? "as vendas já foram importadas ou estão duplicadas" : "corrija a planilha e reenvie"}.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* ---------- 4. confirmar ---------- */}
      {step === 4 && b && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Panel title="Resumo do lote" icon={<FileSpreadsheet className="h-4 w-4" />}>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              {(
                [
                  ["Distribuidora", b.distributorName],
                  ["Competência", competence(b.competence)],
                  ["Arquivo", b.fileName],
                  ["Registros", num(b.total)],
                  ["Vendas novas", num(b.valid)],
                  ["Correções", num(b.corrections)],
                  ["Pontos previstos (líquido)", num(b.predictedPoints)],
                  ["Ignoradas", num(b.invalid + b.duplicates)],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <dt className="text-xs font-semibold text-[#73737D] dark:text-muted-foreground">{k}</dt>
                  <dd className="truncate font-bold text-[#1F1F24] dark:text-white">{v}</dd>
                </div>
              ))}
            </dl>
          </Panel>
          <Panel title="Avisos" icon={<AlertTriangle className="h-4 w-4" />}>
            <ul className="space-y-2 text-sm text-[#73737D] dark:text-muted-foreground">
              {b.invalid + b.duplicates > 0 && (
                <li className="flex gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#B76E00] dark:text-warning" />
                  {num(b.invalid + b.duplicates)} linha(s) inválidas, duplicadas ou já importadas NÃO serão processadas. Corrija e reenvie depois, se necessário.
                </li>
              )}
              {b.corrections > 0 && (
                <li className="flex gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#1D6FD1] dark:text-[#60A5FA]" />
                  {num(b.corrections)} venda(s) já pontuada(s) serão corrigidas: a original fica preservada e a diferença vira ajuste (+) ou estorno (−) no extrato.
                </li>
              )}
              <li className="flex gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#00A876] dark:text-[#00E6A0]" />
                O processamento é idempotente: a chave distribuidora:documento:item impede pontuar a mesma venda duas vezes.
              </li>
              <li className="flex gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#00A876] dark:text-[#00E6A0]" />
                Pontos usam a versão da regra vigente na data de cada venda; mudanças futuras de regra não alteram estes créditos.
              </li>
            </ul>
          </Panel>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between lg:col-span-2">
            <button className={secondaryButton} onClick={() => setStep(3)}>
              <ArrowLeft className="h-4 w-4" /> Voltar à prévia
            </button>
            {canApprove ? (
              <button
                className={primaryButton}
                onClick={() =>
                  confirm.ask({
                    title: `Confirmar o lote #${b.id}?`,
                    description: (
                      <p>
                        {num(b.valid)} vendas novas e {num(b.corrections)} correções de {b.distributorName} ({competence(b.competence)}) entrarão na fila de processamento.
                        {b.invalid + b.duplicates > 0 && ` ${num(b.invalid + b.duplicates)} linhas serão ignoradas.`}
                      </p>
                    ),
                    confirmLabel: "Confirmar lote",
                    run: doConfirm,
                  })
                }
              >
                <Check className="h-4 w-4" /> Confirmar lote
              </button>
            ) : (
              <p className="rounded-xl bg-warning/10 px-4 py-3 text-sm font-semibold text-[#B76E00] dark:text-warning">
                Lote validado. A confirmação exige a permissão SALES_APPROVE: um administrador vai aprovar em{" "}
                <Link className="underline" to={`/importacao/lotes/${b.id}`}>
                  Lote #{b.id}
                </Link>
                .
              </p>
            )}
          </div>
        </div>
      )}

      {/* ---------- 5. processar ---------- */}
      {step === 5 && b && (
        <div className="grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
          <Panel title="Andamento" icon={isBusy(b.status) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}>
            <Timeline batch={b} />
          </Panel>
          <div className="space-y-5">
            <BatchHeading batch={b} />
            {b.status === "done" ? (
              <>
                <p className="flex items-center gap-2 rounded-xl bg-success/10 px-4 py-3 text-sm font-semibold text-[#047857] dark:text-[#34D399]">
                  <Check className="h-4 w-4" /> Lote processado. Os créditos já aparecem no extrato dos vendedores.
                </p>
                <SummaryGrid batch={b} processed />
              </>
            ) : b.status === "failed" ? (
              <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive">{b.error}</p>
            ) : (
              <p className="flex items-center gap-2 rounded-xl bg-info/10 px-4 py-3 text-sm font-semibold text-[#1D6FD1] dark:text-[#60A5FA]">
                <Loader2 className="h-4 w-4 animate-spin" />
                {b.status === "queued" ? "Na fila de processamento..." : "Processando vendas e lançando pontos..."}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Link to={`/extrato?batchId=${b.id}`} className={primaryButton}>
                Ver créditos no extrato
              </Link>
              <Link to={`/importacao/lotes/${b.id}`} className={secondaryButton}>
                Detalhes do lote
              </Link>
              <button className={secondaryButton} onClick={() => restart()}>
                <CloudUpload className="h-4 w-4" /> Nova importação
              </button>
            </div>
          </div>
        </div>
      )}
      {confirm.dialog}
    </div>
  );
}
