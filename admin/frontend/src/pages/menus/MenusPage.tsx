// Menu do app, versão simples: lista com setas, formulário em modal e prévia ao lado.
// Cada perfil (vendedor, gerente, focal) tem seu menu geral; uma distribuidora pode ter menu próprio,
// criado aplicando um modelo de navegação (cópia independente, sem refazer os itens um a um).
import {
  card,
  CheckGroup,
  EmptyState,
  Field,
  fieldClass,
  FormDialog,
  iconButton,
  primaryButton,
  secondaryButton,
  Skeleton,
  useConfirm,
} from "@/shared/components/kit";
import { api, PROFILE_LABEL, useLookups, type ProfileKey } from "@/shared/lib/api";
import { toast } from "@/shared/lib/toast";
import { cn } from "@/shared/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ChevronRight, Copy, Eye, EyeOff, LayoutTemplate, Pencil, Play, Plus, Smartphone, Store, Trash2 } from "lucide-react";
import { useState } from "react";
import { buildTree, ICON_CHOICES, MenuIcon, type Menu, type MenuNode, type PreviewNode } from "./menuUtils";

/** telas que existem no app (~/incentiva/app) */
const PAGES: { target: string; label: string; icon: string }[] = [
  { target: "/inicio", label: "Início", icon: "House" },
  { target: "/extrato", label: "Extrato de pontos", icon: "ReceiptText" },
  { target: "/extrato/historico", label: "Histórico de pontos", icon: "History" },
  { target: "/vendas", label: "Minhas vendas", icon: "ShoppingCart" },
  { target: "/metas", label: "Minhas metas", icon: "Target" },
  { target: "/quiz", label: "Quiz e enquetes", icon: "CircleHelp" },
  { target: "/ranking", label: "Ranking", icon: "Trophy" },
  { target: "/treinamentos", label: "Treinamentos", icon: "GraduationCap" },
  { target: "/equipe", label: "Minha equipe", icon: "Users" },
  { target: "/gerente", label: "Painel do gerente", icon: "PieChart" },
  { target: "/importar", label: "Importar vendas", icon: "CloudUpload" },
];
const AUDIENCE: ProfileKey[] = ["seller", "manager", "focal"];

const destinationLabel = (m: Pick<Menu, "target">, hasChildren: boolean) => {
  if (!m.target) return hasChildren ? "Grupo (abre os submenus)" : "Sem destino";
  if (/^https?:\/\//.test(m.target)) return `Link: ${m.target}`;
  return PAGES.find((p) => p.target === m.target)?.label ?? `${m.target} (sem tela no app)`;
};

const audienceLabel = (profiles: ProfileKey[]) => (profiles.length ? profiles.map((p) => PROFILE_LABEL[p]).join(", ") : "Todos");

/** menu editável do perfil (mesma regra do backend): vazio = todos; filho só aparece com o pai */
const profileTree = (list: MenuNode[], p: ProfileKey): MenuNode[] =>
  list.filter((n) => !n.profiles.length || n.profiles.includes(p)).map((n) => ({ ...n, children: profileTree(n.children, p) }));

/** menu geral (dist null) ou o que a distribuidora vê: o próprio, se tiver, senão o geral + extras dela */
const segmentRoots = (roots: MenuNode[], dist: number | null) => {
  if (dist == null) return roots.filter((r) => !r.distributorIds.length);
  const own = roots.some((r) => r.ownMenu && r.distributorIds.includes(dist));
  return roots.filter((r) => r.distributorIds.includes(dist) || (!own && !r.distributorIds.length));
};

/** item de modelo: cópia sem ids; quem vê é definido ao aplicar */
type Portable = { title: string; icon: string; type: string; target: string; status?: string; startDate?: string | null; endDate?: string | null; permission?: string | null; children?: Portable[] };
type Template = { id: number; name: string; description: string; count: number; items: Portable[] };
type TplDraft = { id?: number; name: string; description: string; items: Portable[] };
const toPortable = (n: MenuNode): Portable => ({
  title: n.title,
  icon: n.icon,
  type: n.type,
  target: n.target,
  status: n.status,
  startDate: n.startDate,
  endDate: n.endDate,
  permission: n.permission,
  children: n.children.map(toPortable),
});

type Draft = {
  id?: number;
  title: string;
  icon: string;
  dest: string; // rota, "" (grupo), "__url" ou "__other"
  url: string;
  other: string;
  parentId: string;
  profiles: ProfileKey[];
  active: boolean;
  startDate: string;
  endDate: string;
  distributorIds: number[];
  ownMenu: boolean;
};

const toDraft = (m: Menu | null, parentId: number | null = null): Draft => {
  const target = m?.target ?? "/inicio";
  const known = target === "" || PAGES.some((p) => p.target === target);
  const isUrl = /^https?:\/\//.test(target);
  return {
    id: m?.id,
    title: m?.title ?? "",
    icon: m?.icon ?? "Star",
    dest: known ? target : isUrl ? "__url" : "__other",
    url: isUrl ? target : "",
    other: !known && !isUrl ? target : "",
    parentId: String(m ? (m.parentId ?? "") : (parentId ?? "")),
    profiles: m?.profiles ?? [],
    active: m ? m.status === "active" : true,
    startDate: m?.startDate ?? "",
    endDate: m?.endDate ?? "",
    distributorIds: m?.distributorIds ?? [],
    ownMenu: m?.ownMenu ?? false,
  };
};

export function MenusPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const menusQ = useQuery({ queryKey: ["menus"], queryFn: () => api.get<Menu[]>("/menus") });
  const menus = menusQ.data ?? [];
  const lookups = useLookups().data;
  const [profile, setProfile] = useState<ProfileKey>("seller");
  const [dist, setDist] = useState<number | null>(null);
  const tree = segmentRoots(profileTree(buildTree(menus), profile), dist);
  const hasOwn = dist != null && tree.some((r) => r.ownMenu);
  const distName = (id: number | null) => lookups?.distributors.find((d) => d.id === id)?.name ?? "";
  const templatesQ = useQuery({ queryKey: ["menu-templates"], queryFn: () => api.get<Template[]>("/menu-templates") });
  const [tplEdit, setTplEdit] = useState<TplDraft | null>(null);
  const [apply, setApply] = useState<{ tpl: Template; profile: ProfileKey; distributorIds: number[] } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [copyFrom, setCopyFrom] = useState<ProfileKey | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["menus"] });
    qc.invalidateQueries({ queryKey: ["menu-templates"] });
    qc.invalidateQueries({ queryKey: ["menu-preview"] });
  };
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      refresh();
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const move = (node: MenuNode, siblings: MenuNode[], dir: -1 | 1) => {
    const other = siblings[siblings.findIndex((s) => s.id === node.id) + dir];
    if (!other) return;
    // troca com o vizinho visível dentro da lista completa, para não bagunçar o menu dos outros perfis
    const ids = buildTree(menus.filter((m) => m.parentId === node.parentId)).map((s) => s.id);
    const i = ids.indexOf(node.id);
    const j = ids.indexOf(other.id);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    void run(() => api.post("/menus/reorder", { items: ids.map((id, order) => ({ id, parentId: node.parentId, order })) }), "Ordem salva");
  };

  const toggle = (m: Menu) =>
    run(() => api.patch(`/menus/${m.id}`, { status: m.status === "active" ? "inactive" : "active" }), m.status === "active" ? `"${m.title}" oculto no app` : `"${m.title}" visível no app`);

  const remove = (node: MenuNode) =>
    confirm.ask({
      title: `Excluir "${node.title}"?`,
      description: node.children.length
        ? `O item e seus ${node.children.length} submenu(s) serão excluídos. Se quiser só esconder, use o botão de olho.`
        : "O item será excluído do menu do app. Se quiser só esconder, use o botão de olho.",
      confirmLabel: "Excluir",
      danger: true,
      run: () => run(() => api.delete(`/menus/${node.id}?hard=1`), `"${node.title}" excluído`),
    });

  const save = async (d: Draft) => {
    const target = d.dest === "__url" ? d.url.trim() : d.dest === "__other" ? d.other.trim() : d.dest;
    const body = {
      title: d.title.trim(),
      icon: d.icon,
      type: d.dest === "__url" ? "link" : "page",
      target,
      parentId: d.parentId ? Number(d.parentId) : null,
      profiles: d.profiles,
      status: d.active ? "active" : "inactive",
      startDate: d.startDate || null,
      endDate: d.endDate || null,
      distributorIds: d.distributorIds,
      ownMenu: d.ownMenu && !d.parentId,
    };
    const ok = await run(
      () => (d.id ? api.patch(`/menus/${d.id}`, body) : api.post("/menus", { ...body, order: menus.filter((m) => m.parentId === body.parentId).length })),
      d.id ? `"${body.title}" salvo` : `"${body.title}" criado`,
    );
    if (ok) setDraft(null);
  };

  const row = (node: MenuNode, siblings: MenuNode[], depth: number) => {
    const i = siblings.indexOf(node);
    const off = node.status !== "active";
    return (
      <li key={node.id}>
        <div className={cn("flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-[#00E6A0]/5", depth > 0 && "ml-8 border-l border-[#E5E7EB] pl-4 dark:border-border/40")}>
          <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#00E6A0]/10 text-[#00A876] dark:text-[#00E6A0]", off && "opacity-40")}>
            <MenuIcon name={node.icon} className="h-[18px] w-[18px]" />
          </span>
          <div className={cn("min-w-0 flex-1", off && "opacity-50")}>
            <p className="truncate text-sm font-bold text-[#1F1F24] dark:text-white">
              {node.title}
              {off && <span className="ml-2 text-xs font-semibold text-[#8C8C96]">(oculto)</span>}
            </p>
            <p className="truncate text-xs text-[#73737D] dark:text-muted-foreground">
              {destinationLabel(node, node.children.length > 0)} · Quem vê: {depth > 0 && !node.profiles.length ? "quem vê o grupo" : audienceLabel(node.profiles)}
            </p>
          </div>
          <div className="flex shrink-0 items-center">
            <button className={iconButton} disabled={busy || i === 0} onClick={() => move(node, siblings, -1)} aria-label={`Subir ${node.title}`} title="Subir">
              <ArrowUp className="h-4 w-4" />
            </button>
            <button className={iconButton} disabled={busy || i === siblings.length - 1} onClick={() => move(node, siblings, 1)} aria-label={`Descer ${node.title}`} title="Descer">
              <ArrowDown className="h-4 w-4" />
            </button>
            <button className={iconButton} disabled={busy} onClick={() => toggle(node)} aria-label={off ? `Mostrar ${node.title}` : `Ocultar ${node.title}`} title={off ? "Mostrar no app" : "Ocultar no app"}>
              {off ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
            <button className={iconButton} onClick={() => setDraft(toDraft(node))} aria-label={`Editar ${node.title}`} title="Editar">
              <Pencil className="h-4 w-4" />
            </button>
            {depth === 0 && (
              <button className={iconButton} onClick={() => setDraft({ ...toDraft(null, node.id), dest: "/inicio" })} aria-label={`Adicionar submenu em ${node.title}`} title="Adicionar submenu">
                <Plus className="h-4 w-4" />
              </button>
            )}
            <button className={cn(iconButton, "hover:bg-destructive/10 hover:text-destructive dark:hover:text-destructive")} disabled={busy} onClick={() => remove(node)} aria-label={`Excluir ${node.title}`} title="Excluir">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
        {node.children.length > 0 && <ul>{node.children.map((c) => row(c, node.children, depth + 1))}</ul>}
      </li>
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-2xl text-sm text-[#73737D] dark:text-muted-foreground">
          Estes são os itens do menu do <b className="text-[#1F1F24] dark:text-white">app Incentiva+</b>. O que você alterar aqui aparece no app assim que a tela
          for recarregada.
        </p>
        <div className="flex flex-wrap gap-2">
          {dist == null && (
            <button className={secondaryButton} onClick={() => setCopyFrom(AUDIENCE.find((p) => p !== profile)!)}>
              <Copy className="h-4 w-4" /> Copiar de outro perfil
            </button>
          )}
          <button
            className={primaryButton}
            onClick={() => setDraft({ ...toDraft(null), profiles: [profile], ...(hasOwn ? { distributorIds: [dist!], ownMenu: true } : {}) })}
          >
            <Plus className="h-4 w-4" /> Novo item
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-grid grid-cols-3 gap-1 rounded-xl border border-[#E5E7EB] bg-white p-1 dark:border-border/40 dark:bg-transparent" role="tablist" aria-label="Menu do perfil">
          {AUDIENCE.map((p) => (
            <button
              key={p}
              role="tab"
              aria-selected={p === profile}
              onClick={() => setProfile(p)}
              className={cn("rounded-lg px-4 py-2 text-sm font-semibold text-[#73737D] dark:text-muted-foreground", p === profile && "bg-[#00E6A0] text-[#03261A] dark:text-[#03261A]")}
            >
              {PROFILE_LABEL[p]}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold text-[#52525B] dark:text-[#C7CCD1]">
          <Store className="h-4 w-4" />
          <select className={cn(fieldClass, "h-10 w-auto min-w-[220px]")} value={dist ?? ""} onChange={(e) => setDist(e.target.value ? Number(e.target.value) : null)} aria-label="Menu de qual distribuidora">
            <option value="">Menu geral (todas as distribuidoras)</option>
            {(lookups?.distributors ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {menus.some((m) => m.ownMenu && m.distributorIds.includes(d.id) && (!m.profiles.length || m.profiles.includes(profile))) ? " · menu próprio" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
      {dist != null && (
        <div className={cn(card, "flex flex-wrap items-center justify-between gap-3 border-[#00E6A0]/40 px-4 py-3 text-sm")}>
          <p className="text-[#52525B] dark:text-[#C7CCD1]">
            {hasOwn ? (
              <>
                <b className="text-[#1F1F24] dark:text-white">{distName(dist)}</b> tem menu próprio para {PROFILE_LABEL[profile]}: as mudanças aqui valem só para ela.
              </>
            ) : (
              <>
                <b className="text-[#1F1F24] dark:text-white">{distName(dist)}</b> usa o menu geral do {PROFILE_LABEL[profile]}. Para dar um menu próprio, aplique um modelo de navegação.
              </>
            )}
          </p>
          {hasOwn && (
            <button
              className={secondaryButton}
              disabled={busy}
              onClick={() =>
                confirm.ask({
                  title: `Voltar ${distName(dist)} ao menu geral?`,
                  description: `O menu próprio do ${PROFILE_LABEL[profile]} nessa distribuidora será excluído e ela passa a ver o menu geral.`,
                  confirmLabel: "Voltar ao geral",
                  danger: true,
                  run: () => run(() => api.post("/menus/own-menu/reset", { profile, distributorId: dist }), `${distName(dist)} voltou ao menu geral`),
                })
              }
            >
              Voltar ao menu geral
            </button>
          )}
        </div>
      )}
      <p className="-mt-2 text-xs text-[#8C8C96] dark:text-muted-foreground">Itens marcados para “Todos” aparecem em todas as abas: editar um deles muda para todos os perfis.</p>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className={cn(card, "p-3 sm:p-4")}>
          {menusQ.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 7 }, (_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : tree.length ? (
            <ul>{tree.map((n) => row(n, tree, 0))}</ul>
          ) : (
            <EmptyState title={`O menu do ${PROFILE_LABEL[profile]} está vazio`}>Clique em “Novo item”, copie o menu de outro perfil ou aplique um modelo.</EmptyState>
          )}
        </section>
        <div className="space-y-5">
          <AppPreview profile={profile} distributorId={dist} title={dist != null ? `${PROFILE_LABEL[profile]} · ${distName(dist)}` : PROFILE_LABEL[profile]} />
          <section className={cn(card, "space-y-3 p-4")}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-base font-bold text-[#1F1F24] dark:text-white">
                <LayoutTemplate className="h-4 w-4 text-[#00A876] dark:text-[#00E6A0]" /> Modelos de navegação
              </h2>
              <button className={cn(secondaryButton, "h-8 whitespace-nowrap px-3 text-xs")} onClick={() => setTplEdit({ name: "", description: "", items: tree.map(toPortable) })} title="Criar modelo (começa com o menu da tela)">
                <Plus className="h-4 w-4" /> Novo modelo
              </button>
            </div>
            <p className="text-xs text-[#73737D] dark:text-muted-foreground">Monte um conjunto de menus uma vez e aplique em várias distribuidoras, sem configurar tudo de novo.</p>
            {(templatesQ.data ?? []).length ? (
              <ul className="space-y-1.5">
                {templatesQ.data!.map((t) => (
                  <li key={t.id} className="flex items-center gap-2 rounded-xl border border-[#E5E7EB] px-3 py-2 dark:border-border/40">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-[#1F1F24] dark:text-white">{t.name}</p>
                      <p className="truncate text-xs text-[#8C8C96]">{t.count} menu(s){t.description ? ` · ${t.description}` : ""}</p>
                    </div>
                    <button className={cn(iconButton, "w-auto gap-1 px-2 text-xs font-semibold")} onClick={() => setApply({ tpl: t, profile, distributorIds: dist != null ? [dist] : [] })}>
                      <Play className="h-3.5 w-3.5" /> Aplicar
                    </button>
                    <button className={iconButton} aria-label={`Editar modelo ${t.name}`} title="Editar modelo" onClick={() => setTplEdit({ id: t.id, name: t.name, description: t.description, items: structuredClone(t.items) })}>
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      className={cn(iconButton, "hover:text-destructive")}
                      aria-label={`Excluir modelo ${t.name}`}
                      title="Excluir modelo"
                      onClick={() =>
                        confirm.ask({
                          title: `Excluir o modelo "${t.name}"?`,
                          description: "Os menus já criados a partir dele continuam como estão.",
                          danger: true,
                          confirmLabel: "Excluir",
                          run: () => run(() => api.delete(`/menu-templates/${t.id}`), "Modelo excluído"),
                        })
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-xl bg-[#00E6A0]/5 px-3 py-4 text-center text-xs text-[#73737D] dark:text-muted-foreground">Nenhum modelo ainda.</p>
            )}
          </section>
        </div>
      </div>

      <EditDialog draft={draft} menus={menus} busy={busy} onChange={setDraft} onClose={() => setDraft(null)} onSave={save} />
      <TemplateDialog draft={tplEdit} current={tree} currentLabel={dist != null ? `${PROFILE_LABEL[profile]} · ${distName(dist)}` : PROFILE_LABEL[profile]} busy={busy} onChange={setTplEdit} onSave={async (d) => {
        const body = { name: d.name.trim(), description: d.description.trim(), items: d.items };
        if (await run(() => (d.id ? api.patch(`/menu-templates/${d.id}`, body) : api.post("/menu-templates", body)), `Modelo "${body.name}" salvo`)) setTplEdit(null);
      }} />

      <FormDialog
        open={!!apply}
        onOpenChange={(o) => !o && setApply(null)}
        title={`Aplicar "${apply?.tpl.name}"`}
        description="Cada distribuidora marcada ganha uma cópia do modelo como menu próprio, no lugar do menu geral. Sem distribuidora marcada, o modelo substitui o menu geral do perfil."
        submitLabel={apply?.distributorIds.length ? `Aplicar em ${apply.distributorIds.length} distribuidora(s)` : "Substituir o menu geral"}
        busy={busy}
        wide
        onSubmit={async () => {
          if (!apply) return;
          const { tpl, ...body } = apply;
          const where = body.distributorIds.length ? `${body.distributorIds.length} distribuidora(s)` : "o menu geral";
          if (await run(() => api.post(`/menu-templates/${tpl.id}/apply`, body), `"${tpl.name}" aplicado em ${where}`)) {
            setProfile(body.profile);
            setDist(body.distributorIds.length === 1 ? body.distributorIds[0] : body.distributorIds.length ? dist : null);
            setApply(null);
          }
        }}
      >
        <Field label="Para o perfil">
          <select className={fieldClass} value={apply?.profile ?? "seller"} onChange={(e) => setApply({ ...apply!, profile: e.target.value as ProfileKey })}>
            {AUDIENCE.map((p) => (
              <option key={p} value={p}>
                {PROFILE_LABEL[p]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Nas distribuidoras" hint="Nenhuma marcada = menu geral do perfil (todas as distribuidoras sem menu próprio)">
          <CheckGroup
            options={(lookups?.distributors ?? []).map((x) => ({ value: x.id, label: x.name }))}
            value={apply?.distributorIds ?? []}
            onChange={(distributorIds) => setApply({ ...apply!, distributorIds })}
          />
        </Field>
      </FormDialog>

      <FormDialog
        open={!!copyFrom}
        onOpenChange={(o) => !o && setCopyFrom(null)}
        title={`Copiar menu para ${PROFILE_LABEL[profile]}`}
        description={`O menu atual do ${PROFILE_LABEL[profile]} será substituído por uma cópia. Depois cada perfil pode ser editado separado, sem afetar o outro.`}
        submitLabel="Copiar e substituir"
        busy={busy}
        onSubmit={async () => {
          const from = copyFrom!;
          if (await run(() => api.post("/menus/copy-profile", { from, to: profile }), `Menu do ${PROFILE_LABEL[from]} copiado para ${PROFILE_LABEL[profile]}`)) setCopyFrom(null);
        }}
      >
        <Field label="Copiar o menu de">
          <select className={fieldClass} value={copyFrom ?? ""} onChange={(e) => setCopyFrom(e.target.value as ProfileKey)}>
            {AUDIENCE.filter((p) => p !== profile).map((p) => (
              <option key={p} value={p}>
                {PROFILE_LABEL[p]}
              </option>
            ))}
          </select>
        </Field>
      </FormDialog>
      {confirm.dialog}
    </div>
  );
}

function EditDialog({
  draft,
  menus,
  busy,
  onChange,
  onClose,
  onSave,
}: {
  draft: Draft | null;
  menus: Menu[];
  busy: boolean;
  onChange: (d: Draft) => void;
  onClose: () => void;
  onSave: (d: Draft) => void;
}) {
  const lookups = useLookups().data;
  const [error, setError] = useState("");
  if (!draft) return <FormDialog open={false} onOpenChange={() => undefined} title="" onSubmit={() => undefined}>{null}</FormDialog>;
  const d = draft;
  const set = (patch: Partial<Draft>) => onChange({ ...d, ...patch });
  const hasChildren = !!d.id && menus.some((m) => m.parentId === d.id);
  // só itens principais podem ser "pai"; um item com submenus não pode virar submenu
  const parents = menus.filter((m) => m.parentId === null && m.id !== d.id);

  return (
    <FormDialog
      open
      onOpenChange={(o) => {
        if (!o) {
          setError("");
          onClose();
        }
      }}
      title={d.id ? `Editar "${d.title}"` : d.parentId ? "Novo submenu" : "Novo item do menu"}
      busy={busy}
      wide
      onSubmit={() => {
        if (!d.title.trim()) return setError("Dê um nome ao item");
        if (d.dest === "__url" && !/^https?:\/\/\S+\.\S+/.test(d.url.trim())) return setError("Informe um link completo, começando com https://");
        if (d.dest === "__other" && !d.other.trim().startsWith("/")) return setError("A rota precisa começar com /");
        if (d.startDate && d.endDate && d.endDate < d.startDate) return setError("O fim da exibição é antes do início");
        setError("");
        onSave(d);
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome no menu">
          <input className={fieldClass} value={d.title} maxLength={80} onChange={(e) => set({ title: e.target.value })} placeholder="Ex.: Meu Extrato" autoFocus />
        </Field>
        <Field label="Fica dentro de">
          <select className={fieldClass} value={d.parentId} disabled={hasChildren} onChange={(e) => set({ parentId: e.target.value })}>
            <option value="">Nenhum (item principal)</option>
            {parents.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Ao tocar, abre">
          <select className={fieldClass} value={d.dest} onChange={(e) => set({ dest: e.target.value })}>
            {PAGES.map((p) => (
              <option key={p.target} value={p.target}>
                {p.label}
              </option>
            ))}
            <option value="">Nada: só agrupa submenus</option>
            <option value="__url">Um link externo…</option>
            <option value="__other">Outra rota do app…</option>
          </select>
        </Field>
        {d.dest === "__url" && (
          <Field label="Link externo">
            <input className={fieldClass} value={d.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://..." />
          </Field>
        )}
        {d.dest === "__other" && (
          <Field label="Rota" hint="Ex.: /quiz (aparece como “em breve” enquanto não existir no app)">
            <input className={fieldClass} value={d.other} onChange={(e) => set({ other: e.target.value })} placeholder="/minha-tela" />
          </Field>
        )}
      </div>

      <Field label="Ícone">
        <div className="grid grid-cols-9 gap-1.5 sm:grid-cols-12" role="radiogroup" aria-label="Ícone">
          {ICON_CHOICES.map((name) => (
            <button
              key={name}
              type="button"
              role="radio"
              aria-checked={d.icon === name}
              aria-label={name}
              title={name}
              onClick={() => set({ icon: name })}
              className={cn(
                "flex aspect-square items-center justify-center rounded-lg border border-[#E5E7EB] text-[#52525B] hover:border-[#00E6A0] dark:border-border/40 dark:text-[#C7CCD1]",
                d.icon === name && "border-[#00E6A0] bg-[#00E6A0]/15 text-[#00A876] dark:text-[#00E6A0]",
              )}
            >
              <MenuIcon name={name} className="h-4 w-4" />
            </button>
          ))}
        </div>
      </Field>

      <Field label="Quem vê este item" hint="Nenhum marcado = todos os perfis">
        <CheckGroup columns={3} options={AUDIENCE.map((p) => ({ value: p, label: PROFILE_LABEL[p] }))} value={d.profiles} onChange={(profiles) => set({ profiles })} />
      </Field>

      <label className="flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" className="h-4 w-4 accent-[#00E6A0]" checked={d.active} onChange={(e) => set({ active: e.target.checked })} />
        Visível no app
      </label>

      <details className="rounded-xl border border-[#E5E7EB] px-4 py-3 dark:border-border/40">
        <summary className="cursor-pointer text-sm font-semibold text-[#73737D] dark:text-muted-foreground">Mais opções (período e distribuidoras)</summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Mostrar a partir de">
            <input type="date" className={fieldClass} value={d.startDate} onChange={(e) => set({ startDate: e.target.value })} />
          </Field>
          <Field label="Mostrar até">
            <input type="date" className={fieldClass} value={d.endDate} onChange={(e) => set({ endDate: e.target.value })} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Só para estas distribuidoras" hint="Nenhuma marcada = todas">
              <CheckGroup
                options={(lookups?.distributors ?? []).map((x) => ({ value: x.id, label: x.name }))}
                value={d.distributorIds}
                onChange={(distributorIds) => set({ distributorIds })}
              />
            </Field>
          </div>
        </div>
      </details>

      {error && (
        <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-2.5 text-sm font-semibold text-destructive">
          {error}
        </p>
      )}
    </FormDialog>
  );
}

/** editor de modelo: itens principais (com submenus), renomear, ordenar, tirar e acrescentar */
function TemplateDialog({
  draft,
  current,
  currentLabel,
  busy,
  onChange,
  onSave,
}: {
  draft: TplDraft | null;
  current: MenuNode[];
  currentLabel: string;
  busy: boolean;
  onChange: (d: TplDraft | null) => void;
  onSave: (d: TplDraft) => void;
}) {
  const d = draft ?? { name: "", description: "", items: [] };
  const setItems = (items: Portable[]) => onChange({ ...d, items });
  const move = (i: number, dir: -1 | 1) => {
    const items = [...d.items];
    [items[i], items[i + dir]] = [items[i + dir], items[i]];
    setItems(items);
  };
  const add = (v: string) => {
    if (v.startsWith("m:")) {
      const n = current.find((x) => x.id === Number(v.slice(2)));
      if (n) setItems([...d.items, toPortable(n)]);
    } else if (v.startsWith("p:")) {
      const p = PAGES.find((x) => x.target === v.slice(2))!;
      setItems([...d.items, { title: p.label, icon: p.icon, type: "page", target: p.target, children: [] }]);
    }
  };
  return (
    <FormDialog
      open={!!draft}
      onOpenChange={(o) => !o && onChange(null)}
      title={d.id ? `Editar modelo "${d.name}"` : "Novo modelo de navegação"}
      description="Os itens principais do modelo (com seus submenus). Quem vê cada um é definido ao aplicar o modelo."
      submitLabel="Salvar modelo"
      busy={busy}
      wide
      onSubmit={() => {
        if (d.name.trim().length < 2) return void toast.error("Dê um nome ao modelo");
        if (d.items.some((it) => !it.title.trim())) return void toast.error("Todo item precisa de nome");
        if (!d.items.length) return void toast.error("Adicione pelo menos um item ao modelo");
        onSave(d);
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome do modelo">
          <input className={fieldClass} value={d.name} maxLength={80} autoFocus placeholder="Ex.: Navegação padrão do vendedor" onChange={(e) => onChange({ ...d, name: e.target.value })} />
        </Field>
        <Field label="Descrição (opcional)">
          <input className={fieldClass} value={d.description} maxLength={300} onChange={(e) => onChange({ ...d, description: e.target.value })} />
        </Field>
      </div>
      <div>
        <p className="mb-2 text-sm font-semibold text-[#1F1F24] dark:text-white">Itens do modelo ({d.items.length})</p>
        {d.items.length ? (
          <ul className="space-y-1.5">
            {d.items.map((it, i) => (
              <li key={i} className="flex items-center gap-2 rounded-xl border border-[#E5E7EB] px-2 py-1.5 dark:border-border/40">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#00E6A0]/10 text-[#00A876] dark:text-[#00E6A0]">
                  <MenuIcon name={it.icon} className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <input
                    className="w-full rounded-md bg-transparent px-1 text-sm font-bold text-[#1F1F24] outline-none focus:ring-2 focus:ring-[#00E6A0] dark:text-white"
                    value={it.title}
                    maxLength={80}
                    aria-label={`Nome do item ${i + 1}`}
                    onChange={(e) => setItems(d.items.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                  />
                  <p className="truncate px-1 text-xs text-[#8C8C96]">
                    {destinationLabel(it, !!it.children?.length)}
                    {it.children?.length ? ` · submenus: ${it.children.map((c) => c.title).join(", ")}` : ""}
                  </p>
                </div>
                <button type="button" className={iconButton} disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Subir ${it.title}`} title="Subir">
                  <ArrowUp className="h-4 w-4" />
                </button>
                <button type="button" className={iconButton} disabled={i === d.items.length - 1} onClick={() => move(i, 1)} aria-label={`Descer ${it.title}`} title="Descer">
                  <ArrowDown className="h-4 w-4" />
                </button>
                <button type="button" className={cn(iconButton, "hover:text-destructive")} onClick={() => setItems(d.items.filter((_, j) => j !== i))} aria-label={`Tirar ${it.title} do modelo`} title="Tirar do modelo">
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl bg-[#00E6A0]/5 px-3 py-4 text-center text-xs text-[#73737D] dark:text-muted-foreground">Nenhum item ainda: adicione abaixo.</p>
        )}
      </div>
      <Field label="Adicionar item">
        <select
          className={fieldClass}
          value=""
          onChange={(e) => {
            add(e.target.value);
            e.target.value = "";
          }}
        >
          <option value="">Escolha um item para adicionar…</option>
          {current.length > 0 && (
            <optgroup label={`Do menu atual (${currentLabel})`}>
              {current.map((n) => (
                <option key={n.id} value={`m:${n.id}`}>
                  {n.title}
                  {n.children.length ? ` (+${n.children.length} submenus)` : ""}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Telas do app">
            {PAGES.map((p) => (
              <option key={p.target} value={`p:${p.target}`}>
                {p.label}
              </option>
            ))}
          </optgroup>
        </select>
      </Field>
    </FormDialog>
  );
}

/** como o menu aparece no app para cada perfil (mesma regra do endpoint do app) */
function AppPreview({ profile, distributorId, title }: { profile: ProfileKey; distributorId: number | null; title: string }) {
  const [open, setOpen] = useState<number | null>(null);
  const q = useQuery({
    queryKey: ["menu-preview", profile, distributorId],
    queryFn: () => api.get<{ tree: PreviewNode[] }>("/menus/preview", distributorId != null ? { profile, distributorId } : { profile }),
  });
  const tree = q.data?.tree ?? [];

  return (
    <section className={cn(card, "flex flex-col gap-4 p-4 xl:sticky xl:top-4")}>
      <h2 className="flex items-center gap-2 text-base font-bold text-[#1F1F24] dark:text-white">
        <Smartphone className="h-4 w-4 text-[#00A876] dark:text-[#00E6A0]" /> Como {title} vê no app
      </h2>
      <div className="mx-auto w-full max-w-[300px] rounded-[2rem] border-4 border-[#12343C] bg-[#020F14] p-3">
        <div className="mb-3 flex items-center gap-2 px-1">
          <img src="/logo.png" alt="" className="h-6 w-auto" />
          <span className="text-sm font-bold text-white">
            Incentiva<span className="text-[#00E6A0]">+</span>
          </span>
        </div>
        <div className="min-h-[300px] rounded-2xl bg-[#071E24] p-1.5">
          {q.isLoading ? (
            <div className="space-y-2 p-2">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-8 bg-white/10" />
              ))}
            </div>
          ) : tree.length ? (
            <ul>
              {tree.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => n.children.length && setOpen(open === n.id ? null : n.id)}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] text-white hover:bg-white/5"
                  >
                    <MenuIcon name={n.icon} className="h-4 w-4 shrink-0 text-[#00E6A0]" />
                    <span className="min-w-0 flex-1 truncate">{n.title}</span>
                    {n.children.length > 0 && <ChevronRight className={cn("h-4 w-4 text-white/50 transition-transform", open === n.id && "rotate-90")} />}
                  </button>
                  {open === n.id && (
                    <ul className="pb-1">
                      {n.children.map((c) => (
                        <li key={c.id} className="flex items-center gap-3 rounded-lg py-2 pl-10 pr-3 text-[12px] text-white/80">
                          <MenuIcon name={c.icon} className="h-3.5 w-3.5 shrink-0 text-[#00E6A0]" />
                          <span className="truncate">{c.title}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-16 text-center text-xs text-white/60">Nenhum item visível para este perfil.</p>
          )}
        </div>
      </div>
      <p className="text-center text-xs text-[#8C8C96] dark:text-muted-foreground">Toque num grupo para ver os submenus.</p>
    </section>
  );
}
