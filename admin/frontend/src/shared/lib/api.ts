import { useQuery } from "@tanstack/react-query";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ProfileKey = "super_admin" | "admin" | "manager" | "seller" | "focal";
export type Permission =
  | "USERS_VIEW" | "USERS_CREATE" | "USERS_EDIT" | "USERS_DISABLE" | "TEAMS_MANAGE" | "MENUS_MANAGE"
  | "MENUS_BULK_EDIT" | "CAMPAIGNS_MANAGE" | "POINT_RULES_MANAGE" | "POINTS_ADJUST" | "SALES_IMPORT"
  | "SALES_VALIDATE" | "SALES_APPROVE" | "SALES_REPROCESS" | "REPORTS_VIEW" | "CONTENT_MANAGE";
export type Scope = "own" | "team" | "distributors" | "organization";

export interface User {
  id: number;
  name: string;
  email: string;
  profiles: ProfileKey[];
  permissions: Permission[];
  scope: Scope;
  distributorId: number | null;
}

export interface Page<T, S = unknown> {
  data: T[];
  pagination: { page: number; perPage: number; total: number; lastPage: number };
  summary?: S;
}

interface AuthState {
  token: string | null;
  user: User | null;
  setAuth: (token: string, user: User) => void;
  logout: () => void;
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      setAuth: (token, user) => set({ token, user }),
      logout: () => set({ token: null, user: null }),
    }),
    { name: "incentiva-admin-auth" },
  ),
);

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: Record<string, unknown> | null,
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | undefined | null>;

const qs = (query?: Query) => {
  const params = new URLSearchParams();
  Object.entries(query ?? {}).forEach(
    ([k, v]) => v !== undefined && v !== null && v !== "" && params.set(k, String(v)),
  );
  const s = params.toString();
  return s ? `?${s}` : "";
};

async function request(path: string, init: RequestInit & { query?: Query } = {}) {
  const { token } = useAuth.getState();
  const isForm = init.body instanceof FormData;
  const res = await fetch(`/api${path}${qs(init.query)}`, {
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.body && !isForm ? { "Content-Type": "application/json" } : {}),
    },
  });

  // sessão expirada, usuário bloqueado ou removido: volta pro login
  if (res.status === 401 && token) {
    useAuth.getState().logout();
    location.href = "/login";
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message = Array.isArray(body?.message) ? body.message.join(", ") : body?.message;
    throw new ApiError(message || `Erro ${res.status}`, res.status, body);
  }
  return res;
}

export const api = {
  get: <T>(path: string, query?: Query) => request(path, { query }).then((r) => r.json() as Promise<T>),
  post: <T>(path: string, body?: unknown) =>
    request(path, {
      method: "POST",
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    }).then((r) => r.json() as Promise<T>),
  patch: <T>(path: string, body: unknown) =>
    request(path, { method: "PATCH", body: JSON.stringify(body) }).then((r) => r.json() as Promise<T>),
  put: <T>(path: string, body: unknown) =>
    request(path, { method: "PUT", body: JSON.stringify(body) }).then((r) => r.json() as Promise<T>),
  delete: (path: string) => request(path, { method: "DELETE" }),
  download: async (path: string, filename: string) => {
    const blob = await (await request(path)).blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },
};

export const brl = (value: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);

export const formatCpf = (cpf?: string | null) =>
  cpf ? cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4") : "—";

// o SQLite devolve "2026-10-01 20:26:51" (UTC, sem fuso)
export const formatDate = (value?: string | null) =>
  value
    ? new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`).toLocaleString("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : "—";

// datas sem hora ("2026-10-14") não passam por fuso
export const formatDay = (value?: string | null) =>
  value ? value.slice(0, 10).split("-").reverse().join("/") : "—";

export const num = (value?: number | null) => (value ?? 0).toLocaleString("pt-BR");

/** centavos → "R$ 1.234,56" */
export const cents = (value?: number | null) => brl((value ?? 0) / 100);

/** "2026-09" → "Set/2026" */
export const competence = (value?: string | null) => {
  if (!value) return "—";
  const [y, m] = value.split("-");
  return `${["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"][Number(m) - 1]}/${y}`;
};

/** exporta linhas para CSV (; e BOM: abre certo no Excel pt-BR) */
export function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [headers.map(esc).join(";"), ...rows.map((r) => headers.map((h) => esc(r[h])).join(";"))].join("\n");
  const url = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const can = (user: User | null, ...perms: Permission[]) =>
  !!user && (perms.length === 0 || perms.some((p) => user.permissions.includes(p)));

export const useCan = (...perms: Permission[]) => can(useAuth((s) => s.user), ...perms);

export interface Lookups {
  distributors: { id: number; name: string; code: string; status: string }[];
  products: { id: number; name: string; sku: string; priceCents: number }[];
  campaigns: { id: number; name: string; status: string; startDate: string; endDate: string }[];
  profiles: { key: ProfileKey; name: string }[];
  teams: { id: number; name: string; distributorId: number; managerId: number | null }[];
  permissions: Permission[];
  scopes: Scope[];
}

/** opções dos selects; cache de 1 min */
export const useLookups = () =>
  useQuery({ queryKey: ["lookups"], queryFn: () => api.get<Lookups>("/lookups"), staleTime: 60_000 });

export const PROFILE_LABEL: Record<ProfileKey, string> = {
  super_admin: "Super Admin",
  admin: "Admin do Cliente",
  manager: "Gerente",
  seller: "Vendedor",
  focal: "Ponto Focal",
};
