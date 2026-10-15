// Peças repetidas nas telas, no visual do ~/sistema-pg (que veio do ~/loja).
import { api, type Page } from "@/shared/lib/api";
import { cn } from "@/shared/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ArrowUpDown, Inbox, Search, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Pagination } from "./Pagination";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "./ui/sheet";

export const fieldClass =
  "h-10 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 text-sm font-medium text-[#1F1F24] outline-none transition-colors placeholder:text-[#8C8C96] hover:border-[#00E6A0]/40 focus:border-[#00E6A0] disabled:opacity-60 dark:border-border/40 dark:bg-[#071E24] dark:text-white dark:placeholder:text-muted-foreground";

export const textareaClass = cn(fieldClass, "h-auto min-h-[96px] py-2");

export const primaryButton =
  "inline-flex h-10 items-center justify-center gap-2 rounded-2xl bg-[#00E6A0] px-4 text-sm font-semibold text-[#03261A] shadow-sm shadow-[#00E6A0]/20 transition-colors hover:bg-[#00C98C] disabled:opacity-60";

export const secondaryButton =
  "inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-[#E5E7EB] bg-white px-4 text-sm font-semibold text-[#2C2C33] transition-colors hover:border-[#00E6A0]/40 hover:text-[#00A876] disabled:opacity-60 dark:border-border/40 dark:bg-white/[0.03] dark:text-white dark:hover:bg-primary/10";

export const dangerButton =
  "inline-flex h-10 items-center justify-center gap-2 rounded-2xl bg-destructive px-4 text-sm font-semibold text-white transition-colors hover:bg-destructive/90 disabled:opacity-60";

/** botão só com ícone (ações de linha) */
export const iconButton =
  "inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#73737D] transition-colors hover:bg-[#00E6A0]/10 hover:text-[#00A876] disabled:opacity-40 dark:text-muted-foreground dark:hover:text-[#00E6A0]";

export const card = "rounded-2xl border border-[#E5E7EB] bg-white dark:border-border/40 dark:bg-white/[0.03]";

// ---------- badges ----------

export type Tone = "green" | "yellow" | "red" | "blue" | "gray" | "purple";
const TONES: Record<Tone, string> = {
  green: "bg-success/15 text-[#047857] dark:text-[#34D399]",
  yellow: "bg-warning/15 text-[#B76E00] dark:text-warning",
  red: "bg-destructive/15 text-destructive",
  blue: "bg-info/15 text-[#1D6FD1] dark:text-[#60A5FA]",
  gray: "bg-[#73737D]/15 text-[#52525B] dark:text-[#A2A5B3]",
  purple: "bg-[#8B5CF6]/15 text-[#7C3AED] dark:text-[#A78BFA]",
};

export function Badge({ tone = "gray", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold", TONES[tone])}>
      {children}
    </span>
  );
}

/** mapa status → [rótulo, cor]; usado por StatusBadge em todas as telas */
export const STATUS: Record<string, [string, Tone]> = {
  active: ["Ativo", "green"],
  inactive: ["Inativo", "gray"],
  blocked: ["Bloqueado", "red"],
  draft: ["Rascunho", "gray"],
  scheduled: ["Agendado", "blue"],
  paused: ["Pausado", "yellow"],
  ended: ["Encerrado", "purple"],
  published: ["Publicado", "green"],
  unpublished: ["Despublicado", "gray"],
  archived: ["Arquivado", "gray"],
  superseded: ["Substituída", "gray"],
  received: ["Recebido", "blue"],
  validating: ["Validando", "blue"],
  with_errors: ["Com inconsistências", "red"],
  awaiting_confirmation: ["Aguardando confirmação", "yellow"],
  queued: ["Na fila", "blue"],
  processing: ["Processando", "blue"],
  done: ["Concluído", "green"],
  failed: ["Falhou", "red"],
  replaced: ["Substituído/corrigido", "purple"],
  returned: ["Devolvido p/ correção", "yellow"],
  open: ["Aberto", "yellow"],
  in_progress: ["Em atendimento", "blue"],
  closed: ["Encerrado", "gray"],
  requested: ["Solicitado", "yellow"],
  approved: ["Aprovado", "blue"],
  shipped: ["Enviado", "purple"],
  delivered: ["Entregue", "green"],
  rejected: ["Recusado", "red"],
};

export function StatusBadge({ status }: { status: string }) {
  const [label, tone] = STATUS[status] ?? [status, "gray"];
  return <Badge tone={tone}>{label}</Badge>;
}

// ---------- cartões ----------

export function StatCard({
  icon,
  label,
  value,
  caption,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  caption?: ReactNode;
  tone?: "warning" | "danger";
}) {
  return (
    <div className={cn(card, "flex items-center gap-3 p-4")}>
      <div
        className={cn(
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#00E6A0]/10 text-[#00A876] dark:text-[#00E6A0]",
          tone === "warning" && "bg-warning/15 text-[#B76E00] dark:text-warning",
          tone === "danger" && "bg-destructive/15 text-destructive dark:text-destructive",
        )}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-[#73737D] dark:text-muted-foreground">{label}</p>
        <p className="truncate text-xl font-bold text-[#1F1F24] dark:text-white">{value}</p>
        {caption && <p className="text-xs font-medium text-[#8C8C96] dark:text-muted-foreground">{caption}</p>}
      </div>
    </div>
  );
}

/** cartão com título (seções de dashboard/detalhe) */
export function Panel({
  title,
  icon,
  actions,
  children,
  className,
}: {
  title: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn(card, "flex min-w-0 flex-col p-5", className)}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-bold text-[#1F1F24] dark:text-white">
          {icon && <span className="text-[#00A876] dark:text-[#00E6A0]">{icon}</span>}
          {title}
        </h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
      <div className="mb-1 text-[#00A876] dark:text-[#00E6A0]">{icon ?? <Inbox className="h-9 w-9" />}</div>
      <p className="text-sm font-bold text-[#1F1F24] dark:text-white">{title}</p>
      {children && <div className="max-w-md text-sm text-[#73737D] dark:text-muted-foreground">{children}</div>}
    </div>
  );
}

export const Skeleton = ({ className }: { className?: string }) => (
  <div className={cn("animate-pulse rounded-lg bg-[#E5E7EB] dark:bg-white/[0.06]", className)} />
);

// ---------- formulário ----------

export function Field({ label, children, hint, error }: { label: string; children: ReactNode; hint?: ReactNode; error?: string }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-xs font-semibold text-[#73737D] dark:text-muted-foreground">{label}</span>
      {children}
      {error ? (
        <span className="text-xs font-semibold text-destructive">{error}</span>
      ) : (
        hint && <span className="text-xs text-[#8C8C96] dark:text-muted-foreground">{hint}</span>
      )}
    </label>
  );
}

/** grupo de checkboxes (perfis, distribuidoras...). Vazio costuma significar "todos". */
export function CheckGroup<T extends string | number>({
  options,
  value,
  onChange,
  columns = 2,
}: {
  options: { value: T; label: string }[];
  value: T[];
  onChange: (value: T[]) => void;
  columns?: number;
}) {
  return (
    <div className="grid max-h-56 gap-1 overflow-y-auto rounded-xl border border-[#E5E7EB] p-2 dark:border-border/40" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {/* role=checkbox em div (não é "labelable"): o CheckGroup costuma ficar dentro do <label> do Field,
          e um input ali faria o clique no título do campo marcar a primeira opção */}
      {options.map((o) => {
        const on = value.includes(o.value);
        const toggle = () => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value]);
        return (
          <div
            key={String(o.value)}
            role="checkbox"
            aria-checked={on}
            tabIndex={0}
            onClick={(e) => {
              e.preventDefault();
              toggle();
            }}
            onKeyDown={(e) => {
              if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                toggle();
              }
            }}
            className="flex cursor-pointer select-none items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-none hover:bg-[#00E6A0]/5 focus-visible:ring-2 focus-visible:ring-[#00E6A0]"
          >
            <span
              aria-hidden
              className={cn(
                "flex h-4 w-4 shrink-0 items-center justify-center rounded border border-[#8C8C96] text-[10px] font-black leading-none",
                on && "border-[#00E6A0] bg-[#00E6A0] text-[#03261A]",
              )}
            >
              {on && "✓"}
            </span>
            <span className="truncate">{o.label}</span>
          </div>
        );
      })}
    </div>
  );
}

/** busca com debounce (300 ms) */
export function SearchInput({
  value,
  onChange,
  placeholder = "Buscar...",
  className,
}: {
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [text, setText] = useState(value ?? "");
  useEffect(() => {
    const t = setTimeout(() => text !== (value ?? "") && onChange(text), 300);
    return () => clearTimeout(t);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={cn("relative w-full sm:w-72", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8C8C96]" />
      <input
        type="search"
        aria-label={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        className={cn(fieldClass, "pl-9")}
      />
    </div>
  );
}

/** barra acima das listagens: busca à esquerda, ações à direita */
export function Toolbar({ children, actions }: { children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** abas no estilo pill */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { value: T; label: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="tablist" className="flex max-w-full gap-1 overflow-x-auto rounded-2xl border border-[#E5E7EB] bg-white p-1 dark:border-border/40 dark:bg-white/[0.03]">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={t.value === value}
          onClick={() => onChange(t.value)}
          className={cn(
            "flex items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2 text-sm font-semibold text-[#73737D] transition-colors hover:text-[#00A876] dark:text-muted-foreground dark:hover:text-[#00E6A0]",
            t.value === value && "bg-[#00E6A0] text-[#03261A] hover:text-[#03261A] dark:text-[#03261A] dark:hover:text-[#03261A]",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ---------- modais ----------

/** modal de formulário: o submit chama onSubmit; fecha só se der certo */
export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  onSubmit,
  submitLabel = "Salvar",
  busy,
  wide,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  onSubmit: () => void | Promise<unknown>;
  submitLabel?: string;
  busy?: boolean;
  wide?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("max-h-[90vh] gap-0 overflow-hidden rounded-2xl p-0", wide ? "max-w-3xl" : "max-w-lg")}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onSubmit();
          }}
          className="flex max-h-[90vh] flex-col"
        >
          <DialogHeader className="border-b border-[#E5E7EB] px-6 py-5 text-left dark:border-border/40">
            <DialogTitle className="text-base font-bold text-[#1F1F24] dark:text-white">{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <div className="flex flex-col gap-4 overflow-y-auto px-6 py-5">{children}</div>
          <div className="flex justify-end gap-2 border-t border-[#E5E7EB] px-6 py-4 dark:border-border/40">
            <button type="button" className={secondaryButton} onClick={() => onOpenChange(false)}>
              Cancelar
            </button>
            <button type="submit" className={primaryButton} disabled={busy}>
              {busy ? "Salvando..." : submitLabel}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** modal só de leitura (detalhes) */
export function ViewDialog({
  open,
  onOpenChange,
  title,
  children,
  wide,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("max-h-[90vh] gap-0 overflow-hidden rounded-2xl p-0", wide ? "max-w-4xl" : "max-w-lg")}>
        <DialogHeader className="border-b border-[#E5E7EB] px-6 py-5 text-left dark:border-border/40">
          <DialogTitle className="text-base font-bold text-[#1F1F24] dark:text-white">{title}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[75vh] overflow-y-auto px-6 py-5">{children}</div>
      </DialogContent>
    </Dialog>
  );
}

type ConfirmState = { title: string; description: ReactNode; confirmLabel?: string; danger?: boolean; run: () => unknown };

/**
 * Confirmação antes de ação sensível:
 *   const confirm = useConfirm();
 *   confirm.ask({ title, description, run: () => mutate() })
 *   ...{confirm.dialog}
 */
export function useConfirm() {
  const [state, setState] = useState<ConfirmState | null>(null);
  const dialog = (
    <AlertDialog open={!!state} onOpenChange={(o) => !o && setState(null)}>
      <AlertDialogContent className="rounded-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle>{state?.title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>{state?.description}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className={secondaryButton}>Cancelar</AlertDialogCancel>
          <AlertDialogAction className={state?.danger ? dangerButton : primaryButton} onClick={() => state?.run()}>
            {state?.confirmLabel ?? "Confirmar"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  return { ask: setState, dialog };
}

// ---------- filtros e tabela ----------

export type Filters = Record<string, string>;

/**
 * Filtros num painel que desliza da lateral direita (padrão de todas as
 * telas). Os campos são inputs nativos com `name`: "Aplicar" lê o form
 * inteiro, "Limpar" volta aos defaultValue.
 */
export function FilterPanel({ children, onApply }: { children: ReactNode; onApply: (filters: Filters) => void }) {
  const [open, setOpen] = useState(false);
  const [applied, setApplied] = useState<Filters | null>(null);
  const active = applied ? Object.keys(applied).filter((k) => k !== "order_by").length : 0;

  const read = (form: HTMLFormElement) =>
    Object.fromEntries([...new FormData(form)].filter(([, v]) => String(v).trim() !== "").map(([k, v]) => [k, String(v).trim()]));

  const apply = (filters: Filters) => {
    setApplied(filters);
    onApply(filters);
    setOpen(false);
  };

  // useCallback: ref novo a cada render reescreveria o que o usuário digitou
  const restore = useCallback(
    (form: HTMLFormElement | null) => {
      if (!form || !applied) return;
      for (const el of form.elements as unknown as (HTMLInputElement | HTMLSelectElement)[]) if (el.name) el.value = applied[el.name] ?? "";
    },
    [applied],
  );

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button type="button" className={secondaryButton}>
          <SlidersHorizontal className="h-4 w-4 text-[#00A876] dark:text-[#00E6A0]" />
          Filtros
          {active > 0 && (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#00E6A0] px-1.5 text-[11px] font-bold text-[#03261A]">{active}</span>
          )}
        </button>
      </SheetTrigger>
      <SheetContent className="flex w-full flex-col gap-0 border-[#E5E7EB] bg-white p-0 dark:border-border/40 dark:bg-[#071E24] sm:max-w-[380px]">
        <SheetHeader className="border-b border-[#E5E7EB] px-6 py-5 dark:border-border/40">
          <SheetTitle className="flex items-center gap-2 text-base font-bold text-[#1F1F24] dark:text-white">
            <SlidersHorizontal className="h-4 w-4 text-[#00E6A0]" />
            Filtros
          </SheetTitle>
        </SheetHeader>
        <form
          ref={restore}
          onSubmit={(e: FormEvent<HTMLFormElement>) => {
            e.preventDefault();
            apply(read(e.currentTarget));
          }}
          // reset dispara antes dos campos voltarem: lê no próximo tick
          onReset={(e) => {
            const form = e.currentTarget;
            setTimeout(() => apply(read(form)));
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">{children}</div>
          <div className="grid grid-cols-2 gap-2 border-t border-[#E5E7EB] px-6 py-4 dark:border-border/40">
            <button type="reset" className={secondaryButton}>
              Limpar
            </button>
            <button type="submit" className={primaryButton}>
              Aplicar
            </button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export function PeriodFields() {
  return (
    <div className="grid gap-2">
      <Field label="De">
        <input type="date" name="date_from" className={fieldClass} />
      </Field>
      <Field label="Até">
        <input type="date" name="date_to" className={fieldClass} />
      </Field>
    </div>
  );
}

export type Column<T> = {
  header: string;
  width: string;
  cell: (row: T) => ReactNode;
  className?: string;
  /** campo de ordenação no backend (sort=campo&dir=asc|desc) */
  sort?: string;
};

export type Selection<K> = { selected: Set<K>; toggle: (id: K) => void; setAll: (ids: K[], on: boolean) => void; clear: () => void };

/** seleção de linhas (ações em massa) */
export function useSelection<K extends string | number>(): Selection<K> {
  const [selected, setSelected] = useState<Set<K>>(new Set());
  return {
    selected,
    toggle: (id) =>
      setSelected((s) => {
        const n = new Set(s);
        n.has(id) ? n.delete(id) : n.add(id);
        return n;
      }),
    setAll: (ids, on) =>
      setSelected((s) => {
        const n = new Set(s);
        ids.forEach((id) => (on ? n.add(id) : n.delete(id)));
        return n;
      }),
    clear: () => setSelected(new Set()),
  };
}

export function DataTable<T extends { id: string | number }>({
  columns,
  page,
  isLoading,
  isError,
  onPageChange,
  onRowClick,
  empty = "Nenhum registro encontrado.",
  minWidth = 900,
  selection,
  sort,
  onSort,
}: {
  columns: Column<T>[];
  page?: Page<T, unknown>;
  isLoading: boolean;
  isError: boolean;
  onPageChange: (page: number) => void;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
  minWidth?: number;
  selection?: Selection<T["id"]>;
  sort?: { field?: string; dir?: string };
  onSort?: (field: string, dir: "asc" | "desc") => void;
}) {
  const rows = page?.data ?? [];
  const template = (selection ? "36px " : "") + columns.map((c) => c.width).join(" ");
  const allOn = selection && rows.length > 0 && rows.every((r) => selection.selected.has(r.id));

  return (
    <div className={cn(card, "overflow-hidden")}>
      <div className="overflow-x-auto">
        <div style={{ minWidth }}>
          <div
            role="row"
            style={{ gridTemplateColumns: template }}
            className="grid items-center gap-3 border-b border-[#E5E7EB] bg-[#FBFBFC] px-4 py-4 text-xs font-bold uppercase tracking-wide text-[#73737D] dark:border-border/40 dark:bg-white/[0.02] dark:text-muted-foreground"
          >
            {selection && (
              <input
                type="checkbox"
                aria-label="Selecionar página"
                className="h-4 w-4 accent-[#00E6A0]"
                checked={!!allOn}
                onChange={(e) => selection.setAll(rows.map((r) => r.id), e.target.checked)}
              />
            )}
            {columns.map((c) => (
              <div key={c.header} className={c.className}>
                {c.sort && onSort ? (
                  <button
                    className="inline-flex items-center gap-1 uppercase hover:text-[#00A876] dark:hover:text-[#00E6A0]"
                    onClick={() => onSort(c.sort!, sort?.field === c.sort && sort?.dir === "asc" ? "desc" : "asc")}
                  >
                    {c.header}
                    {sort?.field === c.sort ? (
                      sort.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                    ) : (
                      <ArrowUpDown className="h-3 w-3 opacity-50" />
                    )}
                  </button>
                ) : (
                  c.header
                )}
              </div>
            ))}
          </div>
          <div className="divide-y divide-[#E5E7EB] dark:divide-border/40">
            {isLoading && !rows.length
              ? Array.from({ length: 6 }, (_, i) => (
                  <div key={i} style={{ gridTemplateColumns: template }} className="grid items-center gap-3 px-4 py-4">
                    {selection && <span />}
                    {columns.map((c) => (
                      <Skeleton key={c.header} className="h-4" />
                    ))}
                  </div>
                ))
              : rows.map((row) => (
                  <div
                    key={row.id}
                    style={{ gridTemplateColumns: template }}
                    onClick={onRowClick && (() => onRowClick(row))}
                    className={cn(
                      "grid items-center gap-3 px-4 py-3.5 text-sm font-medium text-[#73737D] transition-colors hover:bg-[#00E6A0]/5 dark:text-muted-foreground dark:hover:bg-primary/10",
                      onRowClick && "cursor-pointer",
                      selection?.selected.has(row.id) && "bg-[#00E6A0]/[0.07]",
                    )}
                  >
                    {selection && (
                      <input
                        type="checkbox"
                        aria-label="Selecionar linha"
                        className="h-4 w-4 accent-[#00E6A0]"
                        checked={selection.selected.has(row.id)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => selection.toggle(row.id)}
                      />
                    )}
                    {columns.map((c) => (
                      <div key={c.header} className={cn("min-w-0 truncate", c.className)}>
                        {c.cell(row)}
                      </div>
                    ))}
                  </div>
                ))}
          </div>
        </div>
      </div>

      {!isLoading && rows.length === 0 && (
        isError ? (
          <EmptyState title="Não foi possível carregar.">Verifique se o backend está rodando e tente novamente.</EmptyState>
        ) : (
          <EmptyState title="Nada por aqui">{empty}</EmptyState>
        )
      )}

      {page && page.pagination.total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#E5E7EB] px-4 py-1 dark:border-border/40">
          <span className="text-xs font-medium text-[#73737D] dark:text-muted-foreground">
            {page.pagination.total.toLocaleString("pt-BR")} registro(s)
            {selection && selection.selected.size > 0 && ` · ${selection.selected.size} selecionado(s)`}
          </span>
          {page.pagination.lastPage > 1 && (
            <Pagination currentPage={page.pagination.page} totalPages={page.pagination.lastPage} onPageChange={onPageChange} />
          )}
        </div>
      )}
    </div>
  );
}

/** célula de destaque (nome, valor) */
export const Strong = ({ children }: { children: ReactNode }) => (
  <span className="font-bold text-[#1F1F24] dark:text-white">{children}</span>
);

/** texto secundário embaixo do principal numa célula */
export const Sub = ({ children }: { children: ReactNode }) => (
  <span className="block truncate text-xs text-[#8C8C96] dark:text-muted-foreground">{children}</span>
);

/**
 * Estado padrão de listagem: filtros + busca + ordenação + página, tudo no
 * servidor. Manda `search`, `sort`, `dir`, `page`, `per_page` e os filtros.
 */
export function useList<T, S = unknown>(key: string, path: string, defaults: Filters = {}, perPage = 20) {
  const [filters, setFiltersState] = useState<Filters>(defaults);
  const [pageNumber, setPage] = useState(1);
  const query = useQuery({
    queryKey: [key, path, filters, pageNumber],
    queryFn: () => api.get<Page<T, S>>(path, { ...filters, page: pageNumber, per_page: perPage }),
    placeholderData: (previous) => previous,
  });
  const setFilters = (f: Filters) => {
    setFiltersState(f);
    setPage(1);
  };
  /** troca um filtro mantendo os outros (busca, ordenação, abas) */
  const patch = (f: Filters) => setFilters(Object.fromEntries(Object.entries({ ...filters, ...f }).filter(([, v]) => v !== "")));
  /** resultado do FilterPanel: troca os filtros do painel, mantém busca/ordenação/defaults */
  const applyPanel = (f: Filters) => {
    const keep = ["search", "sort", "dir", ...Object.keys(defaults)];
    setFilters({ ...Object.fromEntries(Object.entries(filters).filter(([k]) => keep.includes(k))), ...f });
  };
  return {
    filters,
    setFilters,
    patch,
    applyPanel,
    setPage,
    sort: { field: filters.sort, dir: filters.dir },
    onSort: (sort: string, dir: string) => patch({ sort, dir }),
    ...query,
  };
}
