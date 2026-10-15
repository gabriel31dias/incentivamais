import {
  Badge,
  DataTable,
  fieldClass,
  iconButton,
  primaryButton,
  StatusBadge,
  Strong,
  Sub,
  Tabs,
  Toolbar,
  SearchInput,
  useConfirm,
  useList,
  ViewDialog,
  type Column,
} from "@/shared/components/kit";
import { api, formatDate, PROFILE_LABEL, useCan, useLookups, type ProfileKey } from "@/shared/lib/api";
import { toast } from "@/shared/lib/toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Eye, EyeOff, History, Pencil, Plus, Power, Send } from "lucide-react";
import { useState, type ReactNode } from "react";
import { KINDS, SECTIONS, type KindDef } from "./config";
import { Markdown, RecordDialog, type Rec } from "./RecordForm";

/* eslint-disable @typescript-eslint/no-explicit-any */
const today = () => new Date().toISOString().slice(0, 10);

const TOGGLE_LABEL: Record<string, [string, "green" | "gray"]> = {
  published: ["Ativo", "green"],
  inactive: ["Inativo", "gray"],
  draft: ["Inativo", "gray"],
};

export function RecordStatus({ def, status }: { def: KindDef; status: string }) {
  if (def.flow === "toggle") {
    const [label, tone] = TOGGLE_LABEL[status] ?? [status, "gray"];
    return <Badge tone={tone}>{label}</Badge>;
  }
  return <StatusBadge status={status} />;
}

/** segmentação resumida: perfis e quantidade de distribuidoras */
export function Segment({ data }: { data: Record<string, any> }) {
  const profiles: ProfileKey[] = Array.isArray(data.profiles) ? data.profiles : [];
  const dists: number[] = Array.isArray(data.distributorIds) ? data.distributorIds : [];
  return (
    <span className="flex flex-wrap gap-1">
      {profiles.length ? profiles.map((p) => <Badge key={p} tone="blue">{PROFILE_LABEL[p] ?? p}</Badge>) : <Badge>Todos os perfis</Badge>}
      {dists.length > 0 && <Badge tone="purple">{dists.length} distrib.</Badge>}
    </span>
  );
}

/** card no estilo do app (fundo escuro, verde neon) */
export function AppPreview({ def, rec }: { def: KindDef; rec: Pick<Rec, "title" | "data"> }) {
  const d = rec.data;
  return (
    <div className="mx-auto w-full max-w-[380px] rounded-[28px] border-4 border-[#12343C] bg-[#020F14] p-4 text-white shadow-xl">
      <div className="mb-3 flex items-center gap-2 text-sm font-bold">
        <img src="/logo.png" alt="" className="h-6" /> Incentiva<span className="text-[#00E6A0]">+</span>
        <span className="ml-auto rounded-full bg-[#00E6A0]/15 px-2 py-0.5 text-[10px] text-[#00E6A0]">{def.label}</span>
      </div>
      <div className="overflow-hidden rounded-2xl border border-[#12343C] bg-[#071E24]">
        {d.image && <img src={d.image} alt="" className="h-40 w-full object-cover" />}
        <div className="space-y-2 p-4">
          <p className="text-lg font-bold leading-snug">{rec.title}</p>
          {d.summary && <p className="text-sm text-white/70">{d.summary}</p>}
          {(d.body || d.description) && (
            <div className="text-white/85">
              <Markdown text={d.body ?? d.description} />
            </div>
          )}
          {d.url && (
            <a href={d.url} target="_blank" rel="noreferrer" className="block truncate text-sm font-semibold text-[#00E6A0] underline">
              {d.url}
            </a>
          )}
          {Array.isArray(d.questions) && d.questions[0] && (
            <div className="space-y-2">
              <p className="text-sm font-semibold">{d.questions[0].q}</p>
              {(d.questions[0].options ?? []).map((o: string, i: number) => (
                <div key={i} className="rounded-xl border border-[#12343C] px-3 py-2 text-sm">
                  {String.fromCharCode(65 + i)}) {o}
                </div>
              ))}
              <p className="text-xs text-white/50">
                {d.questions.length} pergunta(s) · {d.points ?? 0} pts · {d.timeLimit ? `${d.timeLimit}s` : "sem limite"}
              </p>
            </div>
          )}
          {Array.isArray(d.options) && !d.questions && (
            <div className="space-y-2">
              {d.options.map((o: string, i: number) => (
                <div key={i} className="rounded-xl border border-[#12343C] px-3 py-2 text-sm">
                  {o}
                </div>
              ))}
            </div>
          )}
          {d.points != null && d.points !== "" && !d.questions && (
            <p className="inline-flex rounded-full bg-[#00E6A0] px-3 py-1 text-xs font-bold text-[#03261A]">
              {Number(d.points).toLocaleString("pt-BR")} pontos
            </p>
          )}
          {d.link && <p className="text-xs text-white/50">Ao tocar: {d.link}</p>}
        </div>
      </div>
    </div>
  );
}

export function HistoryList({ history }: { history: Rec["history"] }) {
  return (
    <ol className="relative space-y-4 border-l border-[#E5E7EB] pl-5 dark:border-border/40">
      {[...history].reverse().map((h, i) => (
        <li key={i} className="relative">
          <span className="absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full bg-[#00E6A0]" />
          <p className="text-sm font-semibold text-[#1F1F24] dark:text-white">{h.action}</p>
          <p className="text-xs text-[#73737D] dark:text-muted-foreground">
            {h.by} · {formatDate(h.at)}
          </p>
        </li>
      ))}
    </ol>
  );
}

// número estável a partir de um texto (relatório simulado sai igual toda vez)
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

function ProgressBar({ pct }: { pct: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#E5E7EB] dark:bg-white/10">
        <div className="h-full rounded-full bg-[#00E6A0]" style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <span className="w-10 text-right text-xs font-bold">{pct}%</span>
    </div>
  );
}

function TrainingReport({ rec }: { rec: Rec }) {
  const lookups = useLookups();
  const [tab, setTab] = useState<"distributor" | "team" | "seller">("distributor");
  const enrolled = Number(rec.data.enrolled ?? 0);
  const completed = Number(rec.data.completed ?? 0);
  const base = enrolled ? Math.round((completed / enrolled) * 100) : 0;
  // simulado: varia ±25 pontos em torno da taxa geral, determinístico por nome
  const rate = (name: string) => (enrolled ? Math.max(0, Math.min(100, base + ((hash(name + rec.id) % 51) - 25))) : 0);
  const FIRST = ["Ana", "Bruno", "Carla", "Diego", "Eduarda", "Felipe", "Gabriela", "Henrique", "Isabela", "João", "Juliana", "Lucas"];
  const rows =
    tab === "distributor"
      ? (lookups.data?.distributors ?? []).map((d) => d.name)
      : tab === "team"
        ? (lookups.data?.teams ?? []).map((t) => t.name)
        : FIRST.map((n, i) => `${n} (vendedor #${1000 + ((hash(n + rec.id) + i) % 8000)})`);
  const sorted = rows.map((name) => ({ name, pct: rate(name) })).sort((a, b) => b.pct - a.pct);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3 text-center">
        {[
          ["Inscritos", enrolled.toLocaleString("pt-BR")],
          ["Concluíram", completed.toLocaleString("pt-BR")],
          ["Taxa geral", `${base}%`],
        ].map(([l, v]) => (
          <div key={l} className="rounded-xl border border-[#E5E7EB] p-3 dark:border-border/40">
            <p className="text-xs text-[#73737D] dark:text-muted-foreground">{l}</p>
            <p className="text-lg font-bold">{v}</p>
          </div>
        ))}
      </div>
      <Badge tone="yellow">Detalhamento simulado a partir da taxa geral (demonstração)</Badge>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "distributor", label: "Por distribuidora" },
          { value: "team", label: "Por equipe" },
          { value: "seller", label: "Por vendedor" },
        ]}
      />
      <div className="max-h-[45vh] space-y-2 overflow-y-auto pr-1">
        {sorted.map((r) => (
          <div key={r.name} className="grid grid-cols-[minmax(0,1fr)_minmax(120px,40%)] items-center gap-3 text-sm">
            <span className="truncate">{r.name}</span>
            <ProgressBar pct={r.pct} />
          </div>
        ))}
      </div>
    </div>
  );
}

function PollResults({ rec }: { rec: Rec }) {
  const options: string[] = rec.data.options ?? [];
  const votes: number[] = rec.data.votes ?? [];
  const total = votes.reduce((a, b) => a + Number(b || 0), 0);
  return (
    <div className="space-y-3">
      {options.map((o, i) => {
        const v = Number(votes[i] ?? 0);
        const pct = total ? Math.round((v / total) * 100) : 0;
        return (
          <div key={i} className="space-y-1">
            <div className="flex justify-between text-sm">
              <span className="font-semibold">{o}</span>
              <span className="text-[#73737D] dark:text-muted-foreground">
                {v.toLocaleString("pt-BR")} voto(s)
              </span>
            </div>
            <ProgressBar pct={pct} />
          </div>
        );
      })}
      <p className="text-xs text-[#73737D] dark:text-muted-foreground">Total: {total.toLocaleString("pt-BR")} voto(s)</p>
    </div>
  );
}

/**
 * Listagem de um kind com criar/editar, publicar/agendar/despublicar (ou
 * ativar/desativar), pré-visualização e histórico. Reaproveitada em Premiações
 * e Configurações (modelos de mensagens).
 */
export function RecordsList({
  def,
  extraColumns = [],
  extraActions,
}: {
  def: KindDef;
  extraColumns?: Column<Rec>[];
  extraActions?: (rec: Rec) => ReactNode;
}) {
  const qc = useQueryClient();
  const canEdit = useCan("CONTENT_MANAGE");
  const list = useList<Rec>("records", `/records/${def.kind}`);
  const [editing, setEditing] = useState<Rec | null | undefined>(undefined);
  const [viewing, setViewing] = useState<{ rec: Rec; mode: "preview" | "history" | "report" | "poll" } | null>(null);
  const confirm = useConfirm();

  const setStatus = useMutation({
    mutationFn: ({ rec, status }: { rec: Rec; status: string }) => api.patch<Rec>(`/records/${def.kind}/${rec.id}`, { status }),
    onSuccess: (rec) => {
      toast.success(
        { published: "Publicado.", scheduled: "Agendado.", unpublished: "Despublicado.", inactive: "Desativado." }[rec.status as string] ?? "Status atualizado.",
      );
      qc.invalidateQueries({ queryKey: ["records"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const publish = (rec: Rec) => {
    const when = def.scheduleKey ? String(rec.data[def.scheduleKey] ?? "") : "";
    const scheduled = when && when.slice(0, 10) > today();
    confirm.ask({
      title: scheduled ? "Agendar publicação?" : "Publicar agora?",
      description: scheduled
        ? `"${rec.title}" ficará visível no app a partir de ${when.slice(0, 10).split("-").reverse().join("/")}.`
        : `"${rec.title}" ficará visível no app para o público configurado.`,
      confirmLabel: scheduled ? "Agendar" : "Publicar",
      run: () => setStatus.mutate({ rec, status: scheduled ? "scheduled" : "published" }),
    });
  };

  const columns: Column<Rec>[] = [
    {
      header: def.titleLabel ?? "Título",
      width: "minmax(240px,2.2fr)",
      cell: (r) => (
        <span className="flex min-w-0 items-center gap-3">
          {r.data.image && <img src={r.data.image} alt="" className="h-9 w-12 shrink-0 rounded-md object-cover" />}
          <span className="min-w-0">
            <Strong>{r.title}</Strong>
            {def.summary && <Sub>{def.summary(r.data)}</Sub>}
          </span>
        </span>
      ),
    },
    { header: "Status", width: "140px", cell: (r) => <RecordStatus def={def} status={r.status} /> },
    ...extraColumns,
    ...(def.fields.some((f) => f.type === "profiles") ? [{ header: "Público", width: "minmax(160px,1fr)", cell: (r: Rec) => <Segment data={r.data} /> }] : []),
    { header: "Atualizado", width: "130px", cell: (r) => formatDate(r.updatedAt) },
    {
      header: "Ações",
      width: "200px",
      className: "flex justify-end gap-1",
      cell: (r) => (
        <>
          {extraActions?.(r)}
          {def.kind === "training" && (
            <button className={iconButton} title="Relatório de progresso" aria-label="Relatório de progresso" onClick={() => setViewing({ rec: r, mode: "report" })}>
              <BarChart3 className="h-4 w-4" />
            </button>
          )}
          {def.kind === "poll" && (
            <button className={iconButton} title="Resultado" aria-label="Resultado" onClick={() => setViewing({ rec: r, mode: "poll" })}>
              <BarChart3 className="h-4 w-4" />
            </button>
          )}
          <button className={iconButton} title="Pré-visualizar" aria-label="Pré-visualizar" onClick={() => setViewing({ rec: r, mode: "preview" })}>
            <Eye className="h-4 w-4" />
          </button>
          <button className={iconButton} title="Histórico" aria-label="Histórico de alterações" onClick={() => setViewing({ rec: r, mode: "history" })}>
            <History className="h-4 w-4" />
          </button>
          {canEdit && (
            <>
              <button className={iconButton} title="Editar" aria-label="Editar" onClick={() => setEditing(r)}>
                <Pencil className="h-4 w-4" />
              </button>
              {def.flow === "publish" ? (
                ["published", "scheduled"].includes(r.status) ? (
                  <button
                    className={iconButton}
                    title="Despublicar"
                    aria-label="Despublicar"
                    onClick={() =>
                      confirm.ask({
                        title: "Despublicar?",
                        description: `"${r.title}" deixa de aparecer no app. Você pode publicar de novo depois.`,
                        confirmLabel: "Despublicar",
                        danger: true,
                        run: () => setStatus.mutate({ rec: r, status: "unpublished" }),
                      })
                    }
                  >
                    <EyeOff className="h-4 w-4" />
                  </button>
                ) : (
                  <button className={iconButton} title="Publicar / agendar" aria-label="Publicar" onClick={() => publish(r)}>
                    <Send className="h-4 w-4" />
                  </button>
                )
              ) : (
                <button
                  className={iconButton}
                  title={r.status === "published" ? "Desativar" : "Ativar"}
                  aria-label={r.status === "published" ? "Desativar" : "Ativar"}
                  onClick={() => setStatus.mutate({ rec: r, status: r.status === "published" ? "inactive" : "published" })}
                >
                  <Power className="h-4 w-4" />
                </button>
              )}
            </>
          )}
        </>
      ),
    },
  ];

  const statusOptions =
    def.flow === "publish"
      ? [
          ["draft", "Rascunho"],
          ["scheduled", "Agendado"],
          ["published", "Publicado"],
          ["unpublished", "Despublicado"],
        ]
      : [
          ["published", "Ativo"],
          ["inactive", "Inativo"],
        ];

  return (
    <div className="space-y-4">
      <Toolbar
        actions={
          canEdit && (
            <button className={primaryButton} onClick={() => setEditing(null)}>
              <Plus className="h-4 w-4" />
              Novo(a) {def.singular}
            </button>
          )
        }
      >
        <SearchInput value={list.filters.search} onChange={(search) => list.patch({ search })} placeholder={`Buscar ${def.label.toLowerCase()}...`} />
        <select aria-label="Status" className={`${fieldClass} w-auto`} value={list.filters.status ?? ""} onChange={(e) => list.patch({ status: e.target.value })}>
          <option value="">Todos os status</option>
          {statusOptions.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </Toolbar>

      <DataTable
        columns={columns}
        page={list.data}
        isLoading={list.isLoading}
        isError={list.isError}
        onPageChange={list.setPage}
        minWidth={980}
        empty={canEdit ? `Nenhum(a) ${def.singular} ainda. Clique em "Novo(a) ${def.singular}" para começar.` : "Nenhum registro."}
      />

      {editing !== undefined && <RecordDialog key={editing?.id ?? "new"} def={def} record={editing} open onOpenChange={(o) => !o && setEditing(undefined)} />}

      <ViewDialog
        open={!!viewing}
        onOpenChange={(o) => !o && setViewing(null)}
        wide={viewing?.mode === "report"}
        title={
          viewing &&
          { preview: "Pré-visualização no app", history: "Histórico de alterações", report: `Progresso — ${viewing.rec.title}`, poll: `Resultado — ${viewing.rec.title}` }[viewing.mode]
        }
      >
        {viewing?.mode === "preview" && <AppPreview def={def} rec={viewing.rec} />}
        {viewing?.mode === "history" && <HistoryList history={viewing.rec.history} />}
        {viewing?.mode === "report" && <TrainingReport rec={viewing.rec} />}
        {viewing?.mode === "poll" && <PollResults rec={viewing.rec} />}
      </ViewDialog>
      {confirm.dialog}
    </div>
  );
}

/** listagem genérica de /api/records/:kind (notícias, banners, comunicados, treinamentos, quiz, gamificação) */
export function RecordsPage({ section }: { section: string }) {
  const config = SECTIONS[section];
  const [kind, setKind] = useState(config.kinds[0]);
  const def = KINDS[kind];
  return (
    <div className="space-y-5">
      <p className="text-sm text-[#73737D] dark:text-muted-foreground">{config.intro}</p>
      {config.kinds.length > 1 && <Tabs value={kind} onChange={setKind} tabs={config.kinds.map((k) => ({ value: k, label: KINDS[k].label }))} />}
      <RecordsList key={kind} def={def} />
    </div>
  );
}
