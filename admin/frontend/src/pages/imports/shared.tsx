// Tipos, consultas e peças comuns do módulo de importação de vendas.
import { Badge, card, Column, DataTable, Tabs, type Tone, useList } from "@/shared/components/kit";
import { api, competence, formatDate, num, useAuth } from "@/shared/lib/api";
import { cn } from "@/shared/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, CircleDashed, Lightbulb, Loader2, X } from "lucide-react";
import { useState } from "react";

export type BatchStatus =
  | "received"
  | "validating"
  | "with_errors"
  | "awaiting_confirmation"
  | "queued"
  | "processing"
  | "done"
  | "failed"
  | "replaced"
  | "returned";

export interface Batch {
  id: number;
  distributorId: number;
  distributorName: string;
  competence: string;
  fileName: string;
  userId: number;
  userName: string;
  status: BatchStatus;
  total: number;
  valid: number;
  invalid: number;
  duplicates: number;
  corrections: number;
  predictedPoints: number;
  creditedPoints: number;
  adjustmentPoints: number;
  newCount: number;
  skippedCount: number;
  correctedCount: number;
  reprocessCount: number;
  error: string | null;
  replacesBatchId: number | null;
  confirmedByName: string | null;
  confirmedAt: string | null;
  returnReason: string | null;
  returnedByName: string | null;
  returnedAt: string | null;
  returnSeenAt: string | null;
  processedAt: string | null;
  createdAt: string;
}

export type ErrorType = { code: string; label: string; hint: string; count: number };
export type BatchDetail = Batch & { errorsByType: ErrorType[]; replacedById: number | null };

export type RowStatus = "valid" | "invalid" | "duplicate" | "already_imported" | "correction";
export interface ImportRow {
  id: number;
  line: number;
  data: Record<string, string>;
  errors: { code: string; message: string }[];
  status: RowStatus;
  externalId: string | null;
  points: number;
  previousPoints: number | null;
}

export const ROW_STATUS: Record<RowStatus, [string, Tone]> = {
  valid: ["Válida", "green"],
  correction: ["Correção", "blue"],
  invalid: ["Inválida", "red"],
  duplicate: ["Duplicada", "yellow"],
  already_imported: ["Já importada", "gray"],
};

/** em andamento: a tela fica consultando */
export const isBusy = (s?: BatchStatus) => s === "received" || s === "validating" || s === "queued" || s === "processing";

export const useBatch = (id: number | null) =>
  useQuery({
    queryKey: ["import-batch", id],
    queryFn: () => api.get<BatchDetail>(`/imports/${id}`),
    enabled: !!id,
    refetchInterval: (q) => (isBusy(q.state.data?.status) ? 1000 : false),
  });

/** baixa um arquivo autenticado como Blob (para anexar o exemplo direto no envio) */
export async function fetchBlob(path: string) {
  const token = useAuth.getState().token;
  const res = await fetch(`/api${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message ?? `Erro ${res.status}`);
  }
  const name = res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ?? "arquivo.xlsx";
  return new File([await res.blob()], name, { type: res.headers.get("Content-Type") ?? "" });
}

export const downloadErrors = (id: number) => api.download(`/imports/${id}/errors.csv`, `erros-lote-${id}.csv`);

/** competência anterior ao mês atual (o envio normal é do mês fechado) */
export const lastCompetence = () => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

/** "Reenviar arquivo corrigido": volta ao wizard com distribuidora/competência e o lote substituído */
export const resendUrl = (b: Pick<Batch, "id" | "distributorId" | "competence">) =>
  `/importacao/nova?distributorId=${b.distributorId}&competence=${b.competence}&replaces=${b.id}`;

// ---------- linha do tempo ----------

type Step = { label: string; state: "done" | "current" | "todo" | "error" | "replaced"; at?: string | null; note?: string };

export function timelineOf(b: Batch): Step[] {
  const order: BatchStatus[] = ["received", "validating", "awaiting_confirmation", "queued", "processing", "done"];
  const pos = order.indexOf(b.status === "with_errors" ? "awaiting_confirmation" : b.status);
  const reached = (s: BatchStatus) => (b.status === "failed" || b.status === "replaced" ? true : order.indexOf(s) < pos);
  const steps: Step[] = [
    { label: "Recebido", state: "done", at: b.createdAt, note: b.fileName },
    { label: "Validando", state: b.status === "validating" ? "current" : "done" },
  ];
  if (b.status === "failed" && !b.total) {
    steps.push({ label: "Falhou", state: "error", note: b.error ?? undefined });
    return steps;
  }
  const problems = b.invalid + b.duplicates;
  steps.push({
    label: b.invalid ? "Com inconsistências" : "Sem inconsistências",
    state: b.invalid ? "error" : "done",
    note: `${num(b.valid)} válidas · ${num(b.corrections)} correções · ${num(problems)} ignoradas/inválidas`,
  });
  const confirmed = !!b.confirmedAt;
  steps.push({
    label: "Aguardando confirmação",
    state: confirmed ? "done" : b.status === "replaced" || b.status === "returned" ? "todo" : "current",
    at: b.confirmedAt,
    note: b.confirmedByName ? `Confirmado por ${b.confirmedByName}` : undefined,
  });
  if (confirmed || b.status === "queued") {
    steps.push({ label: "Na fila", state: b.status === "queued" ? "current" : reached("queued") ? "done" : "todo" });
    steps.push({ label: "Processando", state: b.status === "processing" ? "current" : reached("processing") ? "done" : "todo" });
  }
  if (b.status === "done") steps.push({ label: "Concluído", state: "done", at: b.processedAt });
  else if (b.status === "failed") steps.push({ label: "Falhou", state: "error", note: b.error ?? undefined });
  else if (b.status === "returned")
    steps.push({
      label: "Devolvido para correção",
      state: "error",
      at: b.returnedAt,
      note: `${b.returnedByName}: ${b.returnReason}${b.returnSeenAt ? " · visto por quem enviou" : " · aguardando quem enviou ver"}`,
    });
  else if (b.status === "replaced") steps.push({ label: "Substituído/corrigido", state: "replaced", note: "Preservado no histórico; um reenvio corrigido assumiu o lugar" });
  else steps.push({ label: "Concluído", state: "todo" });
  return steps;
}

export function Timeline({ batch }: { batch: Batch }) {
  return (
    <ol className="space-y-0" aria-label="Etapas do lote">
      {timelineOf(batch).map((s, i, all) => (
        <li key={s.label} className="relative flex gap-3 pb-5 last:pb-0">
          {i < all.length - 1 && <span className="absolute left-[13px] top-7 h-[calc(100%-1.5rem)] w-px bg-[#E5E7EB] dark:bg-border/60" />}
          <span
            className={cn(
              "z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs",
              s.state === "done" && "border-[#00E6A0] bg-[#00E6A0] text-[#03261A]",
              s.state === "current" && "border-[#00E6A0] text-[#00A876] dark:text-[#00E6A0]",
              s.state === "todo" && "border-[#E5E7EB] text-[#8C8C96] dark:border-border/60",
              s.state === "error" && "border-destructive bg-destructive text-white",
              s.state === "replaced" && "border-[#8B5CF6] bg-[#8B5CF6] text-white",
            )}
          >
            {s.state === "done" ? (
              <Check className="h-4 w-4" />
            ) : s.state === "current" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : s.state === "error" ? (
              <X className="h-4 w-4" />
            ) : (
              <CircleDashed className="h-4 w-4" />
            )}
          </span>
          <div className="min-w-0 pt-0.5">
            <p className={cn("text-sm font-bold text-[#1F1F24] dark:text-white", s.state === "todo" && "font-medium text-[#8C8C96] dark:text-muted-foreground")}>
              {s.label}
              {s.at && <span className="ml-2 text-xs font-medium text-[#8C8C96] dark:text-muted-foreground">{formatDate(s.at)}</span>}
            </p>
            {s.note && <p className="break-words text-xs text-[#73737D] dark:text-muted-foreground">{s.note}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

// ---------- relatório de inconsistências ----------

export function ErrorReport({ types, empty = "Nenhuma inconsistência." }: { types: ErrorType[]; empty?: string }) {
  if (!types.length)
    return (
      <p className="flex items-center gap-2 rounded-xl bg-success/10 px-4 py-3 text-sm font-semibold text-[#047857] dark:text-[#34D399]">
        <Check className="h-4 w-4" /> {empty}
      </p>
    );
  const max = Math.max(...types.map((t) => t.count));
  return (
    <ul className="space-y-3">
      {types.map((t) => (
        <li key={t.code} className="rounded-xl border border-[#E5E7EB] p-3 dark:border-border/40">
          <div className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2 text-sm font-bold text-[#1F1F24] dark:text-white">
              <AlertTriangle className={cn("h-4 w-4 shrink-0", t.code === "already_imported" ? "text-[#8C8C96]" : "text-destructive")} />
              <span className="truncate">{t.label ?? t.code}</span>
            </span>
            <Badge tone={t.code === "already_imported" ? "gray" : "red"}>{num(t.count)}</Badge>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#E5E7EB] dark:bg-white/[0.06]">
            <div
              className={cn("h-full rounded-full", t.code === "already_imported" ? "bg-[#8C8C96]" : "bg-destructive")}
              style={{ width: `${(t.count / max) * 100}%` }}
            />
          </div>
          {t.hint && (
            <p className="mt-2 flex gap-1.5 text-xs text-[#73737D] dark:text-muted-foreground">
              <Lightbulb className="mt-px h-3.5 w-3.5 shrink-0 text-[#00A876] dark:text-[#00E6A0]" />
              {t.hint}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

// ---------- linhas do lote ----------

const ROW_COLUMNS: Column<ImportRow>[] = [
  { header: "Linha", width: "64px", cell: (r) => <span className="font-mono">{r.line}</span> },
  {
    header: "Documento",
    width: "minmax(150px,1fr)",
    cell: (r) => (
      <span className="text-[#1F1F24] dark:text-white">
        {r.data.documento || "—"}
        <span className="text-xs text-[#8C8C96]"> · item {r.data.item || "1"}</span>
      </span>
    ),
  },
  { header: "CPF vendedor", width: "130px", cell: (r) => r.data.cpf_vendedor || "—" },
  { header: "SKU", width: "80px", cell: (r) => r.data.sku || "—" },
  { header: "Data", width: "96px", cell: (r) => r.data.data || "—" },
  { header: "Qtd", width: "52px", className: "text-right", cell: (r) => r.data.quantidade || "—" },
  { header: "Valor", width: "96px", className: "text-right", cell: (r) => r.data.valor || "—" },
  {
    header: "Pontos",
    width: "96px",
    className: "text-right",
    cell: (r) =>
      r.status === "correction" ? (
        <span title="pontos atuais → pontos corrigidos">
          {num(r.previousPoints)} → <b className="text-[#1F1F24] dark:text-white">{num(r.points)}</b>
        </span>
      ) : r.status === "valid" ? (
        <b className="text-[#1F1F24] dark:text-white">{num(r.points)}</b>
      ) : (
        "—"
      ),
  },
  {
    header: "Situação",
    width: "minmax(220px,1.4fr)",
    cell: (r) => (
      <div className="flex min-w-0 items-center gap-2">
        <Badge tone={ROW_STATUS[r.status][1]}>{ROW_STATUS[r.status][0]}</Badge>
        {r.errors.length > 0 && (
          <span className="truncate text-xs text-destructive" title={r.errors.map((e) => e.message).join("\n")}>
            {r.errors.map((e) => e.message).join(" · ")}
          </span>
        )}
      </div>
    ),
  },
];

/** abas por situação + tabela paginada das linhas */
export function RowsTable({ batch }: { batch: Batch }) {
  const [status, setStatus] = useState("");
  const list = useList<ImportRow>(`import-rows-${batch.id}`, `/imports/${batch.id}/rows`, {}, 15);
  const tabs = [
    { value: "", label: `Todas (${num(batch.total)})` },
    { value: "valid", label: `Válidas (${num(batch.valid)})` },
    { value: "correction", label: `Correções (${num(batch.corrections)})` },
    { value: "invalid", label: `Inválidas (${num(batch.invalid)})` },
    { value: "duplicate", label: "Duplicadas" },
    { value: "already_imported", label: "Já importadas" },
  ];
  return (
    <div className="space-y-3">
      <Tabs
        tabs={tabs}
        value={status}
        onChange={(v) => {
          setStatus(v);
          list.patch({ status: v });
        }}
      />
      <DataTable
        columns={ROW_COLUMNS}
        page={list.data}
        isLoading={list.isLoading}
        isError={list.isError}
        onPageChange={list.setPage}
        minWidth={1080}
        empty="Nenhuma linha nesta situação."
      />
    </div>
  );
}

// ---------- cartões de resumo ----------

export function SummaryGrid({ batch, processed }: { batch: Batch; processed?: boolean }) {
  const items: [string, string, string?][] = processed
    ? [
        ["Vendas novas", num(batch.newCount)],
        ["Corrigidas", num(batch.correctedCount)],
        ["Já existentes (ignoradas)", num(batch.skippedCount)],
        ["Pontos creditados", num(batch.creditedPoints), "text-[#00A876] dark:text-[#00E6A0]"],
        ["Ajustes/estornos", `${batch.adjustmentPoints > 0 ? "+" : ""}${num(batch.adjustmentPoints)}`, batch.adjustmentPoints < 0 ? "text-destructive" : undefined],
      ]
    : [
        ["Total de registros", num(batch.total)],
        ["Válidos", num(batch.valid), "text-[#00A876] dark:text-[#00E6A0]"],
        ["Inválidos", num(batch.invalid), batch.invalid ? "text-destructive" : undefined],
        ["Duplicidades / já importadas", num(batch.duplicates), batch.duplicates ? "text-[#B76E00] dark:text-warning" : undefined],
        ["Correções", num(batch.corrections), batch.corrections ? "text-[#1D6FD1] dark:text-[#60A5FA]" : undefined],
        ["Pontos previstos", num(batch.predictedPoints)],
      ];
  return (
    <div className={cn("grid gap-3 sm:grid-cols-3", processed ? "lg:grid-cols-5" : "lg:grid-cols-6")}>
      {items.map(([label, value, color]) => (
        <div key={label} className={cn(card, "p-4")}>
          <p className="text-xs font-semibold text-[#73737D] dark:text-muted-foreground">{label}</p>
          <p className={cn("mt-1 text-2xl font-bold text-[#1F1F24] dark:text-white", color)}>{value}</p>
        </div>
      ))}
    </div>
  );
}

/** cabeçalho do lote: id, distribuidora, competência, arquivo */
export function BatchHeading({ batch }: { batch: Batch }) {
  return (
    <p className="text-sm text-[#73737D] dark:text-muted-foreground">
      <b className="text-[#1F1F24] dark:text-white">Lote #{batch.id}</b> · {batch.distributorName} · {competence(batch.competence)} · {batch.fileName} · enviado
      por {batch.userName} em {formatDate(batch.createdAt)}
    </p>
  );
}

