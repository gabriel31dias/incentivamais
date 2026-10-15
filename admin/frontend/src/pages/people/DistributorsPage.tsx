import {
  DataTable,
  Field,
  fieldClass,
  FilterPanel,
  FormDialog,
  iconButton,
  primaryButton,
  SearchInput,
  StatCard,
  StatusBadge,
  Strong,
  Sub,
  Toolbar,
  useList,
  type Column,
} from "@/shared/components/kit";
import { api, ApiError, cents, num, useCan, useLookups, type Page } from "@/shared/lib/api";
import { toast } from "@/shared/lib/toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, CheckCircle2, Coins, Pencil, Plus, Users, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { maskCnpjInput, toastError, type UserRow } from "./shared";

export interface DistributorRow {
  id: number;
  name: string;
  code: string;
  cnpj: string;
  responsible: string;
  region: string;
  focalUserId: number | null;
  focal: { id: number; name: string; email: string } | null;
  status: "active" | "inactive";
  sellers: number;
  activeSellers: number;
  managersCount: number;
  managers: { id: number; name: string }[];
  salesCents: number;
  salesCount: number;
  points: number;
}

type Summary = { sellers: number; salesCents: number; points: number; active: number; regions: string[] };

export const REGIONS = ["Norte", "Nordeste", "Centro-Oeste", "Sudeste", "Sul"];

export function DistributorsPage() {
  const navigate = useNavigate();
  const list = useList<DistributorRow, Summary>("distributors", "/distributors");
  const canCreate = useCan("USERS_CREATE");
  const canEdit = useCan("USERS_EDIT");
  const [editing, setEditing] = useState<DistributorRow | null | "new">(null);
  const s = list.data?.summary;

  const columns: Column<DistributorRow>[] = [
    {
      header: "Distribuidora",
      width: "minmax(200px,1.6fr)",
      sort: "name",
      cell: (d) => (
        <>
          <Strong>{d.name}</Strong>
          <Sub>
            {d.code} · {d.cnpj}
          </Sub>
        </>
      ),
    },
    { header: "Região", width: "110px", sort: "region", cell: (d) => d.region },
    { header: "Ponto focal", width: "minmax(140px,1fr)", cell: (d) => d.focal?.name ?? <span className="text-destructive">não definido</span> },
    {
      header: "Gerentes",
      width: "minmax(140px,1fr)",
      cell: (d) => <span title={d.managers.map((m) => m.name).join(", ")}>{d.managers.map((m) => m.name).join(", ") || "—"}</span>,
    },
    { header: "Vendedores", width: "100px", sort: "sellers", className: "text-right", cell: (d) => num(d.sellers) },
    { header: "Vendas", width: "130px", sort: "salesCents", className: "text-right", cell: (d) => <Strong>{cents(d.salesCents)}</Strong> },
    { header: "Pontos", width: "100px", sort: "points", className: "text-right", cell: (d) => num(d.points) },
    { header: "Status", width: "90px", cell: (d) => <StatusBadge status={d.status} /> },
    {
      header: "",
      width: "44px",
      cell: (d) =>
        canEdit && (
          <button
            className={iconButton}
            aria-label={`Editar ${d.name}`}
            onClick={(e) => {
              e.stopPropagation();
              setEditing(d);
            }}
          >
            <Pencil className="h-4 w-4" />
          </button>
        ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={<Building2 className="h-5 w-5" />} label="Distribuidoras" value={list.data ? num(list.data.pagination.total) : "—"} caption={s ? `${s.active} ativas` : undefined} />
        <StatCard icon={<Users className="h-5 w-5" />} label="Vendedores" value={s ? num(s.sellers) : "—"} />
        <StatCard icon={<Wallet className="h-5 w-5" />} label="Vendas acumuladas" value={s ? cents(s.salesCents) : "—"} />
        <StatCard icon={<Coins className="h-5 w-5" />} label="Pontos distribuídos" value={s ? num(s.points) : "—"} />
      </div>

      <Toolbar
        actions={
          canCreate && (
            <button className={primaryButton} onClick={() => setEditing("new")}>
              <Plus className="h-4 w-4" /> Nova distribuidora
            </button>
          )
        }
      >
        <SearchInput placeholder="Nome, código, CNPJ ou responsável" value={list.filters.search} onChange={(search) => list.patch({ search })} />
        <FilterPanel onApply={list.applyPanel}>
          <Field label="Status">
            <select name="status" className={fieldClass} defaultValue="">
              <option value="">Todos</option>
              <option value="active">Ativa</option>
              <option value="inactive">Inativa</option>
            </select>
          </Field>
          <Field label="Região">
            <select name="region" className={fieldClass} defaultValue="">
              <option value="">Todas</option>
              {REGIONS.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </Field>
        </FilterPanel>
      </Toolbar>

      <DataTable
        columns={columns}
        page={list.data}
        isLoading={list.isLoading}
        isError={list.isError}
        onPageChange={list.setPage}
        sort={list.sort}
        onSort={list.onSort}
        onRowClick={(d) => navigate(`/distribuidoras/${d.id}`)}
        minWidth={1150}
      />

      <DistributorFormDialog
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        distributor={editing === "new" ? null : editing}
        onSaved={(d) => editing === "new" && navigate(`/distribuidoras/${d.id}`)}
      />
    </div>
  );
}

type Form = { name: string; code: string; cnpj: string; responsible: string; region: string; focalUserId: string; status: string };

export function DistributorFormDialog({
  open,
  onOpenChange,
  distributor,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  distributor: DistributorRow | null;
  onSaved?: (d: DistributorRow) => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>({ name: "", code: "", cnpj: "", responsible: "", region: "Sudeste", focalUserId: "", status: "active" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const lookups = useLookups();
  // pontos focais candidatos: com perfil focal e sem distribuidora ou já desta
  const focals = useQuery({
    queryKey: ["users", "focals"],
    queryFn: () => api.get<Page<UserRow>>("/users", { profile: "focal", per_page: 200, sort: "name" }),
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setForm(
      distributor
        ? {
            name: distributor.name,
            code: distributor.code,
            cnpj: distributor.cnpj,
            responsible: distributor.responsible,
            region: distributor.region,
            focalUserId: distributor.focalUserId ? String(distributor.focalUserId) : "",
            status: distributor.status,
          }
        : { name: "", code: `DIST${String((lookups.data?.distributors.length ?? 0) + 1).padStart(2, "0")}`, cnpj: "", responsible: "", region: "Sudeste", focalUserId: "", status: "active" },
    );
  }, [open, distributor]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (p: Partial<Form>) => setForm((f) => ({ ...f, ...p }));
  const candidates = (focals.data?.data ?? []).filter((u) => !u.distributorId || u.distributorId === distributor?.id);

  const submit = async () => {
    const e: Record<string, string> = {};
    if (form.name.trim().length < 3) e.name = "Informe o nome";
    if (!/^[A-Z0-9-]{2,12}$/i.test(form.code)) e.code = "2 a 12 letras/números";
    if (form.cnpj.replace(/\D/g, "").length !== 14) e.cnpj = "CNPJ com 14 dígitos";
    if (form.responsible.trim().length < 3) e.responsible = "Informe o responsável";
    setErrors(e);
    if (Object.keys(e).length) return;
    const body = { ...form, focalUserId: form.focalUserId ? Number(form.focalUserId) : null };
    setBusy(true);
    try {
      const saved = distributor
        ? await api.patch<DistributorRow>(`/distributors/${distributor.id}`, body)
        : await api.post<DistributorRow>("/distributors", body);
      toast.success(distributor ? "Distribuidora atualizada" : "Distribuidora cadastrada");
      void qc.invalidateQueries({ queryKey: ["distributors"] });
      void qc.invalidateQueries({ queryKey: ["distributor"] });
      void qc.invalidateQueries({ queryKey: ["lookups"] });
      onOpenChange(false);
      onSaved?.(saved);
    } catch (err) {
      const msg = (err as ApiError).message;
      if (/código/i.test(msg)) setErrors({ code: msg });
      else if (/cnpj/i.test(msg)) setErrors({ cnpj: msg });
      else if (/focal/i.test(msg)) setErrors({ focalUserId: msg });
      else toastError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={distributor ? `Editar ${distributor.name}` : "Nova distribuidora"} onSubmit={submit} busy={busy} wide>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome" error={errors.name}>
          <input className={fieldClass} value={form.name} onChange={(e) => set({ name: e.target.value })} autoFocus />
        </Field>
        <Field label="Código" error={errors.code} hint="Usado nas planilhas de vendas.">
          <input className={fieldClass} value={form.code} onChange={(e) => set({ code: e.target.value.toUpperCase() })} />
        </Field>
        <Field label="CNPJ" error={errors.cnpj}>
          <input className={fieldClass} inputMode="numeric" placeholder="00.000.000/0000-00" value={form.cnpj} onChange={(e) => set({ cnpj: maskCnpjInput(e.target.value) })} />
        </Field>
        <Field label="Responsável comercial" error={errors.responsible}>
          <input className={fieldClass} value={form.responsible} onChange={(e) => set({ responsible: e.target.value })} />
        </Field>
        <Field label="Região">
          <select className={fieldClass} value={form.region} onChange={(e) => set({ region: e.target.value })}>
            {REGIONS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select className={fieldClass} value={form.status} onChange={(e) => set({ status: e.target.value })}>
            <option value="active">Ativa</option>
            <option value="inactive">Inativa</option>
          </select>
        </Field>
        <Field
          label="Ponto focal"
          error={errors.focalUserId}
          hint={
            <>
              <CheckCircle2 className="mr-1 inline h-3 w-3" />
              Usuário com perfil Ponto Focal; envia a planilha mensal.
            </>
          }
        >
          <select className={fieldClass} value={form.focalUserId} onChange={(e) => set({ focalUserId: e.target.value })}>
            <option value="">— definir depois —</option>
            {candidates.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.email})
              </option>
            ))}
          </select>
        </Field>
      </div>
    </FormDialog>
  );
}
