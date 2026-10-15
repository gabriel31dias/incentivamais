import {
  DataTable,
  Field,
  fieldClass,
  FilterPanel,
  FormDialog,
  iconButton,
  primaryButton,
  secondaryButton,
  Badge,
  StatusBadge,
  Strong,
  Sub,
  Toolbar,
  SearchInput,
  useConfirm,
  useList,
  useSelection,
  type Column,
} from "@/shared/components/kit";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/shared/components/ui/dropdown-menu";
import { api, downloadCsv, formatDate, PROFILE_LABEL, useCan, useLookups, type ProfileKey } from "@/shared/lib/api";
import { toast } from "@/shared/lib/toast";
import { useQueryClient } from "@tanstack/react-query";
import { Ban, CheckCircle2, Download, FileUp, History, KeyRound, MoreVertical, Pencil, Plus, Power, ShieldOff, UserCheck, X } from "lucide-react";
import { useState } from "react";
import { HistoryDialog, ImportUsersDialog, ProfileBadges, TempPasswordDialog, toastError, UserFormDialog, type UserRow } from "./shared";

const PRESET: Record<string, { intro: string; noun: string }> = {
  manager: { intro: "Gerentes respondem por equipes de vendedores. Um gerente pode ser também Ponto Focal da distribuidora.", noun: "gerente" },
  seller: { intro: "Vendedores acumulam pontos com as vendas importadas pelas distribuidoras.", noun: "vendedor" },
  focal: { intro: "Pontos focais enviam mensalmente a planilha de vendas da distribuidora pela qual respondem.", noun: "ponto focal" },
};

/** preset: tela de Gerentes/Vendedores/Pontos Focais = a mesma listagem filtrada por perfil */
export function UsersPage({ preset }: { preset?: ProfileKey }) {
  const qc = useQueryClient();
  const lookups = useLookups();
  const list = useList<UserRow>("users", "/users", preset ? { profile: preset } : {});
  const selection = useSelection<number>();
  const confirm = useConfirm();
  const canCreate = useCan("USERS_CREATE");
  const canEdit = useCan("USERS_EDIT");
  const canDisable = useCan("USERS_DISABLE");

  const [editing, setEditing] = useState<UserRow | null | "new">(null);
  const [history, setHistory] = useState<UserRow | null>(null);
  const [password, setPassword] = useState<{ value: string; who?: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);

  const refresh = () => void qc.invalidateQueries({ queryKey: ["users"] });

  const setStatus = (u: UserRow, action: "block" | "unblock" | "activate" | "deactivate") => {
    const labels = { block: "Bloquear", unblock: "Desbloquear", activate: "Ativar", deactivate: "Desativar" };
    confirm.ask({
      title: `${labels[action]} ${u.name}?`,
      description:
        action === "block" || action === "deactivate"
          ? "A sessão do usuário cai na próxima requisição e ele não consegue mais entrar. O histórico e os pontos são preservados."
          : "O usuário volta a conseguir entrar na plataforma.",
      danger: action === "block" || action === "deactivate",
      confirmLabel: labels[action],
      run: () =>
        api
          .post(`/users/${u.id}/status`, { action })
          .then(() => {
            toast.success(`${u.name}: ${labels[action].toLowerCase()} concluído`);
            refresh();
          })
          .catch(toastError),
    });
  };

  const resetPassword = (u: UserRow) =>
    confirm.ask({
      title: `Redefinir a senha de ${u.name}?`,
      description: "A senha atual deixa de funcionar e uma senha temporária é gerada.",
      confirmLabel: "Redefinir",
      run: () =>
        api
          .post<{ tempPassword: string }>(`/users/${u.id}/reset-password`)
          .then((r) => setPassword({ value: r.tempPassword, who: u.name }))
          .catch(toastError),
    });

  const resetMfa = (u: UserRow) =>
    confirm.ask({
      title: `Redefinir o MFA de ${u.name}?`,
      description: "O app autenticador cadastrado deixa de valer. No próximo login, o usuário escaneia um QR code novo para cadastrar o celular.",
      confirmLabel: "Redefinir MFA",
      run: () =>
        api
          .post(`/mfa/users/${u.id}/reset`)
          .then(() => {
            toast.success(`MFA de ${u.name} redefinido`);
            qc.invalidateQueries({ queryKey: ["users"] });
          })
          .catch(toastError),
    });

  const columns: Column<UserRow>[] = [
    {
      header: "Nome",
      width: "minmax(200px,1.6fr)",
      sort: "name",
      cell: (u) => (
        <>
          <Strong>{u.name}</Strong>
          <Sub>{u.email}</Sub>
        </>
      ),
    },
    { header: "CPF", width: "130px", cell: (u) => <span className="font-mono text-xs">{u.cpf}</span> },
    ...(preset === "seller" ? [] : [{ header: "Perfis", width: "minmax(150px,1fr)", cell: (u: UserRow) => <ProfileBadges profiles={u.profiles} /> }]),
    {
      header: preset === "focal" ? "Responde por" : "Distribuidora",
      width: "minmax(150px,1fr)",
      cell: (u) => u.distributorName ?? "—",
    },
    ...(preset === "focal" || preset === "manager"
      ? []
      : [{ header: "Gerente responsável", width: "minmax(140px,1fr)", cell: (u: UserRow) => u.managerName ?? "—" }]),
    ...(preset === "focal" ? [] : [{ header: "Equipe", width: "minmax(120px,0.8fr)", cell: (u: UserRow) => u.teamName ?? "—" }]),
    { header: "Status", width: "110px", cell: (u) => <StatusBadge status={u.status} /> },
    { header: "Último acesso", width: "130px", sort: "lastAccessAt", cell: (u) => (u.lastAccessAt ? formatDate(u.lastAccessAt) : "Nunca") },
    { header: "MFA", width: "90px", cell: (u) => (u.mfaEnabled ? <Badge tone="green">Ativo</Badge> : <Badge tone="gray">Pendente</Badge>) },
    {
      header: "",
      width: "44px",
      cell: (u) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className={iconButton} aria-label={`Ações de ${u.name}`} onClick={(e) => e.stopPropagation()}>
              <MoreVertical className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52 rounded-xl">
            {canEdit && (
              <DropdownMenuItem onClick={() => setEditing(u)}>
                <Pencil className="h-4 w-4" /> Editar
              </DropdownMenuItem>
            )}
            {canEdit && (
              <>
                <DropdownMenuItem onClick={() => resetPassword(u)}>
                  <KeyRound className="h-4 w-4" /> Redefinir senha
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => resetMfa(u)} disabled={!u.mfaEnabled}>
                  <ShieldOff className="h-4 w-4" /> {u.mfaEnabled ? "Redefinir MFA" : "MFA ainda não cadastrado"}
                </DropdownMenuItem>
              </>
            )}
            {canDisable && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setStatus(u, u.blocked ? "unblock" : "block")}>
                  {u.blocked ? <UserCheck className="h-4 w-4" /> : <Ban className="h-4 w-4" />} {u.blocked ? "Desbloquear" : "Bloquear"}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setStatus(u, u.status === "inactive" ? "activate" : "deactivate")}>
                  <Power className="h-4 w-4" /> {u.status === "inactive" ? "Ativar" : "Desativar"}
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setHistory(u)}>
              <History className="h-4 w-4" /> Histórico de alterações
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  const exportPage = () =>
    downloadCsv(
      `usuarios-${preset ?? "todos"}.csv`,
      (list.data?.data ?? []).map((u) => ({
        nome: u.name,
        email: u.email,
        cpf: u.cpf,
        perfis: u.profiles.map((p) => PROFILE_LABEL[p]).join(", "),
        distribuidora: u.distributorName ?? "",
        gerente: u.managerName ?? "",
        equipe: u.teamName ?? "",
        status: u.status,
        ultimo_acesso: u.lastAccessAt ? formatDate(u.lastAccessAt) : "",
      })),
    );

  const selected = selection.selected.size;

  return (
    <div className="space-y-5">
      {preset && <p className="text-sm text-[#73737D] dark:text-muted-foreground">{PRESET[preset].intro}</p>}

      <Toolbar
        actions={
          <>
            <button className={secondaryButton} onClick={exportPage} disabled={!list.data?.data.length}>
              <Download className="h-4 w-4" /> Exportar página
            </button>
            {canCreate && (
              <button className={secondaryButton} onClick={() => setImporting(true)}>
                <FileUp className="h-4 w-4" /> Importar planilha
              </button>
            )}
            {canCreate && (
              <button className={primaryButton} onClick={() => setEditing("new")}>
                <Plus className="h-4 w-4" /> Novo {preset ? PRESET[preset].noun : "usuário"}
              </button>
            )}
          </>
        }
      >
        <SearchInput placeholder="Nome, e-mail ou CPF" value={list.filters.search} onChange={(search) => list.patch({ search })} />
        <FilterPanel onApply={list.applyPanel}>
          {!preset && (
            <Field label="Perfil">
              <select name="profile" className={fieldClass} defaultValue="">
                <option value="">Todos</option>
                {lookups.data?.profiles.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Distribuidora">
            <select name="distributor_id" className={fieldClass} defaultValue="">
              <option value="">Todas</option>
              {lookups.data?.distributors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Equipe">
            <select name="team_id" className={fieldClass} defaultValue="">
              <option value="">Todas</option>
              {lookups.data?.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select name="status" className={fieldClass} defaultValue="">
              <option value="">Todos</option>
              <option value="active">Ativo</option>
              <option value="inactive">Inativo</option>
              <option value="blocked">Bloqueado</option>
            </select>
          </Field>
        </FilterPanel>
      </Toolbar>

      {selected > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[#00E6A0]/40 bg-[#00E6A0]/[0.07] px-4 py-3">
          <span className="text-sm font-bold text-[#1F1F24] dark:text-white">{selected} selecionado(s)</span>
          {canEdit && (
            <button className={primaryButton} onClick={() => setBulkOpen(true)}>
              <CheckCircle2 className="h-4 w-4" /> Editar em massa
            </button>
          )}
          <button className={secondaryButton} onClick={selection.clear}>
            <X className="h-4 w-4" /> Limpar seleção
          </button>
        </div>
      )}

      <DataTable
        columns={columns}
        page={list.data}
        isLoading={list.isLoading}
        isError={list.isError}
        onPageChange={list.setPage}
        sort={list.sort}
        onSort={list.onSort}
        selection={canEdit ? selection : undefined}
        minWidth={1100}
        empty="Nenhum usuário com esses filtros."
      />

      <UserFormDialog
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        user={editing === "new" ? null : editing}
        defaultProfiles={preset ? (preset === "focal" ? ["manager", "focal"] : [preset]) : ["seller"]}
        onCreated={(value, who) => setPassword({ value, who })}
      />
      <HistoryDialog user={history} onClose={() => setHistory(null)} />
      <TempPasswordDialog password={password?.value ?? null} who={password?.who} onClose={() => setPassword(null)} />
      <ImportUsersDialog open={importing} onOpenChange={setImporting} onDone={(value) => setPassword({ value, who: "todos os importados (mesma senha inicial)" })} />
      <BulkDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        ids={[...selection.selected]}
        canDisable={canDisable}
        onDone={() => {
          selection.clear();
          refresh();
        }}
      />
      {confirm.dialog}
    </div>
  );
}

/** edição em massa: uma operação auditada para N usuários */
function BulkDialog({
  open,
  onOpenChange,
  ids,
  canDisable,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  ids: number[];
  canDisable: boolean;
  onDone: () => void;
}) {
  const lookups = useLookups();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ status: "", block: "", distributorId: "", teamId: "", addProfile: "", removeProfile: "" });
  const set = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));

  const submit = async () => {
    const body = Object.fromEntries(Object.entries(form).filter(([, v]) => v !== "").map(([k, v]) => [k, /Id$/.test(k) ? Number(v) : v]));
    if (!Object.keys(body).length) return toast.error("Escolha ao menos uma alteração");
    setBusy(true);
    try {
      const res = await api.post<{ updated: number }>("/users/bulk", { ids, ...body });
      toast.success(`${res.updated} usuário(s) atualizado(s) em uma única operação`);
      onOpenChange(false);
      setForm({ status: "", block: "", distributorId: "", teamId: "", addProfile: "", removeProfile: "" });
      onDone();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Editar ${ids.length} usuário(s) em massa`}
      description="Só os campos preenchidos mudam. Fica registrado na auditoria de cada usuário."
      onSubmit={submit}
      busy={busy}
      submitLabel="Aplicar a todos"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {canDisable && (
          <>
            <Field label="Status">
              <select className={fieldClass} value={form.status} onChange={(e) => set({ status: e.target.value })}>
                <option value="">— não alterar —</option>
                <option value="active">Ativar</option>
                <option value="inactive">Desativar</option>
              </select>
            </Field>
            <Field label="Bloqueio">
              <select className={fieldClass} value={form.block} onChange={(e) => set({ block: e.target.value })}>
                <option value="">— não alterar —</option>
                <option value="block">Bloquear</option>
                <option value="unblock">Desbloquear</option>
              </select>
            </Field>
          </>
        )}
        <Field label="Mover para a distribuidora">
          <select className={fieldClass} value={form.distributorId} onChange={(e) => set({ distributorId: e.target.value, teamId: "" })}>
            <option value="">— não alterar —</option>
            {lookups.data?.distributors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Mover para a equipe" hint="Também define distribuidora e gerente.">
          <select className={fieldClass} value={form.teamId} onChange={(e) => set({ teamId: e.target.value })}>
            <option value="">— não alterar —</option>
            {lookups.data?.teams
              .filter((t) => !form.distributorId || String(t.distributorId) === form.distributorId)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Adicionar perfil">
          <select className={fieldClass} value={form.addProfile} onChange={(e) => set({ addProfile: e.target.value })}>
            <option value="">— não alterar —</option>
            {lookups.data?.profiles.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Remover perfil">
          <select className={fieldClass} value={form.removeProfile} onChange={(e) => set({ removeProfile: e.target.value })}>
            <option value="">— não alterar —</option>
            {lookups.data?.profiles.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </FormDialog>
  );
}
