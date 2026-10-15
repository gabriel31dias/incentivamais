import {
  Badge,
  DataTable,
  Field,
  FilterPanel,
  fieldClass,
  iconButton,
  PeriodFields,
  SearchInput,
  Strong,
  Sub,
  Tabs,
  Toolbar,
  useList,
  ViewDialog,
  type Column,
} from "@/shared/components/kit";
import { api, downloadCsv, formatDate } from "@/shared/lib/api";
import { cn } from "@/shared/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Download, Eye } from "lucide-react";
import { useState } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type AuditLog = {
  id: number;
  action: string;
  actorId: number;
  actorName: string;
  targetType: string;
  targetId: string;
  description: string;
  before: any;
  after: any;
  createdAt: string;
};

const TYPE_LABEL: Record<string, string> = {
  profile: "Perfil",
  point_rule: "Regra de pontuação",
  campaign: "Campanha",
  user: "Usuário",
  distributor: "Distribuidora",
  team: "Equipe",
  import_batch: "Lote de importação",
  point_entry: "Lançamento de pontos",
  menu: "Menu",
  menu_template: "Modelo de menu",
  ticket: "Chamado",
  redemption: "Resgate",
  reward: "Prêmio",
  settings: "Configurações",
};
export const typeLabel = (t: string) => TYPE_LABEL[t] ?? t;

// abas: históricos específicos pedidos (vários nomes possíveis por módulo)
const TABS = [
  { value: "", label: "Todos os logs" },
  { value: "import_batch,batch,import,sale", label: "Importações" },
  { value: "profile", label: "Permissões" },
  { value: "point_rule,rule", label: "Regras de pontuação" },
  { value: "point_entry,points,adjustment", label: "Ajustes de pontos" },
];

// dado pessoal nunca aparece inteiro: a API já mascara CPF; isto cobre o que escapar
const maskValue = (key: string, v: any) =>
  /cpf/i.test(key) && typeof v === "string" && /\d{11}/.test(v.replace(/\D/g, "")) && !v.includes("*")
    ? `***.${v.replace(/\D/g, "").slice(3, 6)}.${v.replace(/\D/g, "").slice(6, 9)}-**`
    : v;

/** achata {a:{b:1}} → {"a.b": 1} para comparar campo a campo */
function flatten(value: any, prefix = "", out: Record<string, any> = {}) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else if (prefix) out[prefix] = maskValue(prefix, value);
  return out;
}

const show = (v: any) => (v === undefined ? "—" : typeof v === "string" ? v : JSON.stringify(v));

export function AuditDiff({ before, after }: { before: any; after: any }) {
  const b = flatten(before ?? {});
  const a = flatten(after ?? {});
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  if (!keys.length) return <p className="text-sm text-[#73737D] dark:text-muted-foreground">Esta operação não registrou valores (ex.: só ação).</p>;
  return (
    <div className="overflow-x-auto rounded-xl border border-[#E5E7EB] dark:border-border/40">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="bg-[#FBFBFC] text-xs font-bold uppercase tracking-wide text-[#73737D] dark:bg-white/[0.02] dark:text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">Campo</th>
            <th className="px-3 py-2 text-left">Valor anterior</th>
            <th className="px-3 py-2 text-left">Valor novo</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#E5E7EB] dark:divide-border/40">
          {keys.map((k) => {
            const changed = show(b[k]) !== show(a[k]);
            return (
              <tr key={k} className={cn(changed && "bg-warning/[0.07]")}>
                <td className="px-3 py-2 font-mono text-xs font-bold">{k}</td>
                <td className={cn("break-all px-3 py-2 font-mono text-xs", changed && b[k] !== undefined && "text-destructive line-through decoration-destructive/40")}>
                  {show(b[k])}
                </td>
                <td className={cn("break-all px-3 py-2 font-mono text-xs", changed && a[k] !== undefined && "font-bold text-[#047857] dark:text-[#34D399]")}>
                  {show(a[k])}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function AuditPage() {
  const list = useList<AuditLog>("audit", "/audit");
  const types = useQuery({ queryKey: ["audit-types"], queryFn: () => api.get<string[]>("/audit/types") });
  const [tab, setTab] = useState("");
  const [viewing, setViewing] = useState<AuditLog | null>(null);

  const columns: Column<AuditLog>[] = [
    { header: "Data/hora", width: "140px", cell: (r) => formatDate(r.createdAt) },
    { header: "Usuário", width: "minmax(150px,1fr)", cell: (r) => <Strong>{r.actorName}</Strong> },
    {
      header: "Operação",
      width: "minmax(260px,2.2fr)",
      cell: (r) => (
        <>
          <span className="block truncate text-[#1F1F24] dark:text-white">{r.description}</span>
          <Sub>{r.action}</Sub>
        </>
      ),
    },
    {
      header: "Entidade",
      width: "minmax(150px,1fr)",
      cell: (r) => (
        <span className="flex items-center gap-2">
          <Badge tone="blue">{typeLabel(r.targetType)}</Badge>
          <span className="truncate text-xs">#{r.targetId}</span>
        </span>
      ),
    },
    {
      header: "",
      width: "60px",
      className: "flex justify-end",
      cell: (r) => (
        <button className={iconButton} title="Valores anteriores × novos" aria-label="Ver detalhes" onClick={() => setViewing(r)}>
          <Eye className="h-4 w-4" />
        </button>
      ),
    },
  ];

  const exportCsv = async () => {
    const page = await api.get<{ data: AuditLog[] }>("/audit", { ...list.filters, page: 1, per_page: 500 });
    downloadCsv(
      "auditoria.csv",
      page.data.map((r) => ({
        data: formatDate(r.createdAt),
        usuario: r.actorName,
        acao: r.action,
        descricao: r.description,
        entidade: typeLabel(r.targetType),
        id_entidade: r.targetId,
        antes: JSON.stringify(r.before ?? ""),
        depois: JSON.stringify(r.after ?? ""),
      })),
    );
  };

  return (
    <div className="space-y-4">
      <Tabs
        value={tab}
        onChange={(v) => {
          setTab(v);
          list.patch({ target_type: v });
        }}
        tabs={TABS}
      />
      <Toolbar
        actions={
          <>
            <button className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#E5E7EB] px-4 text-sm font-semibold dark:border-border/40" onClick={exportCsv}>
              <Download className="h-4 w-4 text-[#00A876] dark:text-[#00E6A0]" />
              CSV
            </button>
            <FilterPanel onApply={(f) => list.applyPanel({ ...f, ...(tab && !f.target_type ? { target_type: tab } : {}) })}>
              <Field label="Tipo de entidade">
                <select name="target_type" className={fieldClass} defaultValue="">
                  <option value="">Todos</option>
                  {types.data?.map((t) => (
                    <option key={t} value={t}>
                      {typeLabel(t)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Ação (prefixo)" hint="Ex.: profile, import, menu.bulk">
                <input name="action" className={fieldClass} />
              </Field>
              <Field label="Usuário responsável">
                <input name="actor" className={fieldClass} />
              </Field>
              <PeriodFields />
            </FilterPanel>
          </>
        }
      >
        <SearchInput value={list.filters.search} onChange={(search) => list.patch({ search })} placeholder="Buscar na descrição..." />
      </Toolbar>
      <DataTable
        columns={columns}
        page={list.data}
        isLoading={list.isLoading}
        isError={list.isError}
        onPageChange={list.setPage}
        onRowClick={setViewing}
        empty="Nenhum log para os filtros escolhidos."
      />
      <ViewDialog wide open={!!viewing} onOpenChange={(o) => !o && setViewing(null)} title={viewing?.description}>
        {viewing && (
          <div className="space-y-4">
            <dl className="grid gap-3 text-sm sm:grid-cols-4">
              {[
                ["Usuário", viewing.actorName],
                ["Operação", viewing.action],
                ["Data/hora", formatDate(viewing.createdAt)],
                ["Entidade", `${typeLabel(viewing.targetType)} #${viewing.targetId}`],
              ].map(([l, v]) => (
                <div key={l}>
                  <dt className="text-xs text-[#73737D] dark:text-muted-foreground">{l}</dt>
                  <dd className="font-semibold">{v}</dd>
                </div>
              ))}
            </dl>
            <AuditDiff before={viewing.before} after={viewing.after} />
            <p className="text-xs text-[#8C8C96]">Dados pessoais (CPF) aparecem mascarados. Logs não podem ser editados nem excluídos.</p>
          </div>
        )}
      </ViewDialog>
    </div>
  );
}
