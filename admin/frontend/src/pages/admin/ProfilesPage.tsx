import { Badge, card, Field, fieldClass, FormDialog, Panel, primaryButton, secondaryButton, Skeleton, useConfirm, useList } from "@/shared/components/kit";
import { api, formatDate, PROFILE_LABEL, useCan, type Permission, type ProfileKey, type Scope } from "@/shared/lib/api";
import { toast } from "@/shared/lib/toast";
import { cn } from "@/shared/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, History, Info, Save, ShieldCheck, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";

type Profile = { id: number; key: ProfileKey; name: string; permissions: Permission[]; scope: Scope };
type AuditRow = { id: number; actorName: string; description: string; targetId: string; createdAt: string; before: Partial<Profile> | null; after: Partial<Profile> | null };

export const SCOPE_LABEL: Record<Scope, string> = {
  own: "Próprios dados",
  team: "Própria equipe",
  distributors: "Distribuidoras atribuídas",
  organization: "Toda a organização",
};

const AREAS: { label: string; perms: [Permission, string][] }[] = [
  {
    label: "Usuários e equipes",
    perms: [
      ["USERS_VIEW", "Ver usuários, distribuidoras e pontos focais"],
      ["USERS_CREATE", "Cadastrar usuários e importar planilha"],
      ["USERS_EDIT", "Editar usuários, perfis e configurações"],
      ["USERS_DISABLE", "Bloquear/desativar usuários e encerrar sessões"],
      ["TEAMS_MANAGE", "Gerenciar equipes, vínculos e transferências"],
    ],
  },
  {
    label: "Menus do app",
    perms: [
      ["MENUS_MANAGE", "Criar, editar e reorganizar menus"],
      ["MENUS_BULK_EDIT", "Alterações em massa (permissões, vigência, visibilidade)"],
    ],
  },
  {
    label: "Campanhas e pontos",
    perms: [
      ["CAMPAIGNS_MANAGE", "Criar, pausar e encerrar campanhas"],
      ["POINT_RULES_MANAGE", "Regras de pontuação e simulação"],
      ["POINTS_ADJUST", "Ajustes e estornos manuais de pontos"],
    ],
  },
  {
    label: "Importação de vendas",
    perms: [
      ["SALES_IMPORT", "Enviar planilhas de vendas"],
      ["SALES_VALIDATE", "Ver validação e inconsistências"],
      ["SALES_APPROVE", "Confirmar lotes para processamento"],
      ["SALES_REPROCESS", "Reprocessar lotes"],
    ],
  },
  {
    label: "Relatórios e conteúdo",
    perms: [
      ["REPORTS_VIEW", "Dashboards, relatórios e auditoria"],
      ["CONTENT_MANAGE", "Notícias, treinamentos, gamificação, prêmios e atendimento"],
    ],
  },
];

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

function diff(before: Pick<Profile, "permissions" | "scope">, after: Pick<Profile, "permissions" | "scope">) {
  const added = after.permissions.filter((p) => !before.permissions.includes(p));
  const removed = before.permissions.filter((p) => !after.permissions.includes(p));
  return { added, removed, scope: before.scope !== after.scope ? [before.scope, after.scope] : null };
}

function Diff({ d }: { d: ReturnType<typeof diff> }) {
  return (
    <div className="space-y-2 text-sm">
      {d.added.map((p) => (
        <p key={p} className="font-mono text-[#047857] dark:text-[#34D399]">
          + {p}
        </p>
      ))}
      {d.removed.map((p) => (
        <p key={p} className="font-mono text-destructive">
          − {p}
        </p>
      ))}
      {d.scope && (
        <p>
          Escopo: <b>{SCOPE_LABEL[d.scope[0] as Scope] ?? d.scope[0]}</b> → <b>{SCOPE_LABEL[d.scope[1] as Scope] ?? d.scope[1]}</b>
        </p>
      )}
      {!d.added.length && !d.removed.length && !d.scope && <p>Sem mudanças.</p>}
    </div>
  );
}

function PermissionHistory() {
  const list = useList<AuditRow>("audit", "/audit", { target_type: "profile" }, 10);
  return (
    <Panel title="Histórico de alterações de permissões" icon={<History className="h-4 w-4" />}>
      {list.isLoading ? (
        <Skeleton className="h-24" />
      ) : !list.data?.data.length ? (
        <p className="text-sm text-[#73737D] dark:text-muted-foreground">Nenhuma alteração registrada.</p>
      ) : (
        <ul className="divide-y divide-[#E5E7EB] dark:divide-border/40">
          {list.data.data.map((a) => (
            <li key={a.id} className="grid gap-2 py-3 sm:grid-cols-[180px_minmax(0,1fr)]">
              <div className="text-xs text-[#73737D] dark:text-muted-foreground">
                <b className="block text-sm text-[#1F1F24] dark:text-white">{PROFILE_LABEL[a.targetId as ProfileKey] ?? a.targetId}</b>
                {a.actorName} · {formatDate(a.createdAt)}
              </div>
              {a.before?.permissions && a.after?.permissions ? (
                <Diff
                  d={diff(
                    { permissions: a.before.permissions, scope: (a.before.scope ?? a.after.scope) as Scope },
                    { permissions: a.after.permissions, scope: (a.after.scope ?? a.before.scope) as Scope },
                  )}
                />
              ) : (
                <p className="text-sm">{a.description}</p>
              )}
            </li>
          ))}
        </ul>
      )}
      {list.data && list.data.pagination.lastPage > 1 && (
        <div className="mt-3 flex justify-end gap-2">
          <button className={secondaryButton} disabled={list.data.pagination.page <= 1} onClick={() => list.setPage(list.data!.pagination.page - 1)}>
            Anterior
          </button>
          <button
            className={secondaryButton}
            disabled={list.data.pagination.page >= list.data.pagination.lastPage}
            onClick={() => list.setPage(list.data!.pagination.page + 1)}
          >
            Próxima
          </button>
        </div>
      )}
    </Panel>
  );
}

export function ProfilesPage() {
  const qc = useQueryClient();
  const canEdit = useCan("USERS_EDIT");
  const confirm = useConfirm();
  const profiles = useQuery({ queryKey: ["profiles"], queryFn: () => api.get<Profile[]>("/profiles") });
  const [draft, setDraft] = useState<Record<string, Pick<Profile, "permissions" | "scope">>>({});
  const [copyOpen, setCopyOpen] = useState(false);
  const [copy, setCopy] = useState<{ from: ProfileKey; to: ProfileKey }>({ from: "admin", to: "manager" });

  useEffect(() => {
    if (profiles.data) setDraft(Object.fromEntries(profiles.data.map((p) => [p.key, { permissions: p.permissions, scope: p.scope }])));
  }, [profiles.data]);

  const onSaved = (msg: string) => {
    toast.success(msg, { description: "Vale na próxima requisição de cada usuário com esse perfil." });
    qc.invalidateQueries({ queryKey: ["profiles"] });
    qc.invalidateQueries({ queryKey: ["audit"] });
  };

  const save = useMutation({
    mutationFn: (key: ProfileKey) => api.patch<Profile>(`/profiles/${key}`, draft[key]),
    onSuccess: (p) => onSaved(`Perfil ${p.name} salvo.`),
    onError: (e) => toast.error((e as Error).message),
  });

  const copyMutation = useMutation({
    mutationFn: () => api.post<Profile>("/profiles/copy", copy),
    onSuccess: (p) => {
      setCopyOpen(false);
      onSaved(`Permissões copiadas para ${p.name}.`);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const list = profiles.data ?? [];
  const isDirty = (p: Profile) => !!draft[p.key] && (!sameSet(draft[p.key].permissions, p.permissions) || draft[p.key].scope !== p.scope);
  const toggle = (key: ProfileKey, perm: Permission) =>
    setDraft((d) => {
      const cur = d[key].permissions;
      return { ...d, [key]: { ...d[key], permissions: cur.includes(perm) ? cur.filter((x) => x !== perm) : [...cur, perm] } };
    });

  const askSave = (p: Profile) =>
    confirm.ask({
      title: `Salvar perfil ${p.name}?`,
      description: (
        <div className="space-y-3">
          <Diff d={diff(p, draft[p.key])} />
          <p className="text-xs">A alteração fica registrada na auditoria com os valores anteriores e novos.</p>
        </div>
      ),
      confirmLabel: "Salvar",
      run: () => save.mutate(p.key),
    });

  return (
    <div className="space-y-5">
      <div className={cn(card, "flex gap-3 p-4 text-sm text-[#52525B] dark:text-muted-foreground")}>
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-[#00A876] dark:text-[#00E6A0]" />
        <p>
          Um usuário pode ter <b>vários perfis</b> (ex.: Gerente + Ponto Focal): as permissões se <b>somam</b> e vale o <b>maior escopo</b>. O backend confere
          a permissão e o escopo em <b>cada rota da API</b> — esconder um menu não é regra de segurança.
        </p>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        {canEdit && (
          <button className={secondaryButton} onClick={() => setCopyOpen(true)}>
            <Copy className="h-4 w-4" />
            Copiar perfil
          </button>
        )}
      </div>

      <div className={cn(card, "overflow-hidden")}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-[#E5E7EB] bg-[#FBFBFC] dark:border-border/40 dark:bg-white/[0.02]">
                <th className="sticky left-0 z-10 bg-[#FBFBFC] px-4 py-4 text-left text-xs font-bold uppercase tracking-wide text-[#73737D] dark:bg-[#071E24] dark:text-muted-foreground">
                  Permissão
                </th>
                {list.map((p) => (
                  <th key={p.key} className="min-w-[150px] px-3 py-3 text-center align-top">
                    <span className="flex items-center justify-center gap-1.5 font-bold text-[#1F1F24] dark:text-white">
                      <ShieldCheck className="h-4 w-4 text-[#00A876] dark:text-[#00E6A0]" />
                      {p.name}
                    </span>
                    <span className="mt-1 block text-[11px] font-medium text-[#73737D] dark:text-muted-foreground">
                      {draft[p.key]?.permissions.length ?? 0} de 16
                    </span>
                  </th>
                ))}
              </tr>
              <tr className="border-b border-[#E5E7EB] dark:border-border/40">
                <td className="sticky left-0 z-10 bg-white px-4 py-3 text-xs font-bold uppercase tracking-wide text-[#73737D] dark:bg-[#071E24] dark:text-muted-foreground">
                  Escopo de dados
                </td>
                {list.map((p) => (
                  <td key={p.key} className="px-3 py-3">
                    <select
                      aria-label={`Escopo de ${p.name}`}
                      disabled={!canEdit}
                      className={cn(fieldClass, "h-9 text-xs")}
                      value={draft[p.key]?.scope ?? p.scope}
                      onChange={(e) => setDraft((d) => ({ ...d, [p.key]: { ...d[p.key], scope: e.target.value as Scope } }))}
                    >
                      {(Object.keys(SCOPE_LABEL) as Scope[]).map((s) => (
                        <option key={s} value={s}>
                          {SCOPE_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </td>
                ))}
              </tr>
            </thead>
            <tbody>
              {profiles.isLoading && (
                <tr>
                  <td colSpan={6} className="p-4">
                    <Skeleton className="h-64" />
                  </td>
                </tr>
              )}
              {list.length > 0 &&
                AREAS.map((area) => [
                  <tr key={area.label} className="bg-[#00E6A0]/[0.06]">
                    <td colSpan={list.length + 1} className="sticky left-0 px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-[#00A876] dark:text-[#00E6A0]">
                      {area.label}
                    </td>
                  </tr>,
                  ...area.perms.map(([perm, desc]) => (
                    <tr key={perm} className="border-b border-[#E5E7EB] hover:bg-[#00E6A0]/5 dark:border-border/40">
                      <td className="sticky left-0 z-10 bg-white px-4 py-2.5 dark:bg-[#071E24]">
                        <span className="block font-mono text-xs font-bold text-[#1F1F24] dark:text-white">{perm}</span>
                        <span className="block text-xs text-[#73737D] dark:text-muted-foreground">{desc}</span>
                      </td>
                      {list.map((p) => {
                        const on = draft[p.key]?.permissions.includes(perm) ?? false;
                        const changed = on !== p.permissions.includes(perm);
                        return (
                          <td key={p.key} className={cn("px-3 py-2.5 text-center", changed && "bg-warning/10")}>
                            <input
                              type="checkbox"
                              aria-label={`${perm} para ${p.name}`}
                              className="h-5 w-5 cursor-pointer accent-[#00E6A0] disabled:cursor-not-allowed"
                              checked={on}
                              disabled={!canEdit}
                              onChange={() => toggle(p.key, perm)}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  )),
                ])}
            </tbody>
            {canEdit && list.length > 0 && (
              <tfoot>
                <tr>
                  <td className="sticky left-0 z-10 bg-white px-4 py-3 text-xs text-[#73737D] dark:bg-[#071E24] dark:text-muted-foreground">
                    Células em amarelo = alteração não salva
                  </td>
                  {list.map((p) => (
                    <td key={p.key} className="px-3 py-3">
                      <div className="flex justify-center gap-1">
                        <button className={cn(primaryButton, "h-9 px-3 text-xs")} disabled={!isDirty(p) || save.isPending} onClick={() => askSave(p)}>
                          <Save className="h-3.5 w-3.5" />
                          Salvar
                        </button>
                        <button
                          className={cn(secondaryButton, "h-9 px-2")}
                          title="Descartar alterações"
                          aria-label={`Descartar alterações de ${p.name}`}
                          disabled={!isDirty(p)}
                          onClick={() => setDraft((d) => ({ ...d, [p.key]: { permissions: p.permissions, scope: p.scope } }))}
                        >
                          <Undo2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <PermissionHistory />

      <FormDialog
        open={copyOpen}
        onOpenChange={setCopyOpen}
        title="Copiar perfil"
        description="As permissões e o escopo do perfil de origem substituem os do destino."
        submitLabel="Copiar"
        busy={copyMutation.isPending}
        onSubmit={() => {
          if (copy.from === copy.to) return void toast.error("Escolha perfis diferentes.");
          copyMutation.mutate();
        }}
      >
        {(["from", "to"] as const).map((k) => (
          <Field key={k} label={k === "from" ? "Copiar de" : "Para"}>
            <select className={fieldClass} value={copy[k]} onChange={(e) => setCopy({ ...copy, [k]: e.target.value as ProfileKey })}>
              {list.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
        ))}
        {list.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold text-[#73737D]">Mudanças no destino:</p>
            <Diff d={diff(list.find((p) => p.key === copy.to)!, list.find((p) => p.key === copy.from)!)} />
          </div>
        )}
        {copy.to === "super_admin" && <Badge tone="yellow">O Super Admin precisa manter USERS_EDIT.</Badge>}
      </FormDialog>
      {confirm.dialog}
    </div>
  );
}
