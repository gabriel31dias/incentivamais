// Lógica pura dos menus dinâmicos (sem banco): árvore, visibilidade, ciclos.
import type { Menu, ProfileKey } from './entities';

export type MenuNode = Menu & { children: MenuNode[] };

/** lista plana → árvore ordenada por `order` (órfãos viram raiz) */
export function buildTree(menus: Menu[]): MenuNode[] {
  const nodes = new Map<number, MenuNode>(menus.map((m) => [m.id, { ...m, children: [] }]));
  const roots: MenuNode[] = [];
  for (const n of nodes.values()) {
    const parent = n.parentId != null ? nodes.get(n.parentId) : undefined;
    (parent ? parent.children : roots).push(n);
  }
  const sort = (list: MenuNode[]) => {
    list.sort((a, b) => a.order - b.order || a.id - b.id);
    list.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}

export type Audience = {
  profile: ProfileKey;
  /** usuário com vários perfis (ex.: gerente + ponto focal): vê o que qualquer um deles vê */
  profiles?: ProfileKey[];
  /** permissões do perfil (Profile.permissions) */
  permissions: string[];
  distributorId?: number | null;
  /** AAAA-MM-DD */
  date: string;
};

/** o menu sozinho aparece para esse público? (não olha o pai) */
export function isVisible(m: Menu, a: Audience) {
  if (m.status !== 'active') return false;
  if (m.startDate && a.date < m.startDate) return false;
  if (m.endDate && a.date > m.endDate) return false;
  if (m.profiles.length && !(a.profiles ?? [a.profile]).some((p) => m.profiles.includes(p))) return false;
  if (m.distributorIds.length && (a.distributorId == null || !m.distributorIds.includes(a.distributorId))) return false;
  if (m.permission && !a.permissions.includes(m.permission)) return false;
  return true;
}

/**
 * Árvore que o público enxerga: pai oculto esconde os filhos, e grupo sem
 * destino cujos filhos ficaram todos ocultos também some (não sobra pasta vazia).
 */
export function visibleTree(menus: Menu[], a: Audience): MenuNode[] {
  const filter = (list: MenuNode[]): MenuNode[] =>
    list
      .filter((n) => isVisible(n, a))
      .map((n) => ({ ...n, children: filter(n.children), had: n.children.length }))
      .filter((n) => !(n.had && !n.children.length && !n.target))
      .map(({ had: _had, ...n }) => n);
  return ownMenuOnly(filter(buildTree(menus)), a.distributorId);
}

/** distribuidora com menu próprio (modelo aplicado) vê só os itens dela, não o menu geral */
export function ownMenuOnly<T extends Pick<Menu, 'ownMenu' | 'distributorIds'>>(roots: T[], distributorId?: number | null) {
  if (distributorId == null || !roots.some((r) => r.ownMenu && r.distributorIds.includes(distributorId))) return roots;
  return roots.filter((r) => r.distributorIds.includes(distributorId));
}

/** ids do menu e de todos os descendentes */
export function descendants(menus: Pick<Menu, 'id' | 'parentId'>[], id: number): number[] {
  const out = [id];
  for (let i = 0; i < out.length; i++) for (const m of menus) if (m.parentId === out[i]) out.push(m.id);
  return out;
}

/** mover `id` para dentro de `parentId` criaria ciclo? */
export const wouldCycle = (menus: Pick<Menu, 'id' | 'parentId'>[], id: number, parentId: number | null) =>
  parentId != null && descendants(menus, id).includes(parentId);

export type SetOp<T> = { mode: 'set' | 'add' | 'remove'; values: T[] };

export function applySetOp<T>(current: T[], op: SetOp<T>): T[] {
  if (op.mode === 'set') return [...new Set(op.values)];
  if (op.mode === 'add') return [...new Set([...current, ...op.values])];
  return current.filter((v) => !op.values.includes(v));
}

/** nó serializável (export/modelo): sem ids nem datas de controle */
export type PortableMenu = {
  title: string;
  icon: string;
  type: Menu['type'];
  target: string;
  status?: Menu['status'];
  startDate?: string | null;
  endDate?: string | null;
  profiles?: ProfileKey[];
  distributorIds?: number[];
  groups?: string[];
  permission?: string | null;
  ownMenu?: boolean;
  children?: PortableMenu[];
};

export const toPortable = (n: MenuNode): PortableMenu => ({
  title: n.title,
  icon: n.icon,
  type: n.type,
  target: n.target,
  status: n.status,
  startDate: n.startDate,
  endDate: n.endDate,
  profiles: n.profiles,
  distributorIds: n.distributorIds,
  groups: n.groups,
  permission: n.permission,
  children: n.children.map(toPortable),
});

/** conta nós de uma árvore portátil */
export const countPortable = (items: PortableMenu[]): number =>
  items.reduce((s, i) => s + 1 + countPortable(i.children ?? []), 0);

/** só as raízes da seleção (selecionar pai e filho não duplica o filho) */
export function selectionRoots(menus: Pick<Menu, 'id' | 'parentId'>[], ids: number[]) {
  const set = new Set(ids);
  const byId = new Map(menus.map((m) => [m.id, m]));
  return ids.filter((id) => {
    let p = byId.get(id)?.parentId;
    while (p != null) {
      if (set.has(p)) return false;
      p = byId.get(p)?.parentId;
    }
    return true;
  });
}

/** o menu é do perfil? (vazio = todos). Ignora status/datas: é para edição, não para o app */
export const ofProfile = (m: Pick<Menu, 'profiles'>, p: ProfileKey) => !m.profiles.length || m.profiles.includes(p);

/** árvore editável de um perfil: filho só aparece se o pai também for do perfil */
export function profileTree(menus: Menu[], p: ProfileKey): MenuNode[] {
  const filter = (list: MenuNode[]): MenuNode[] => list.filter((n) => ofProfile(n, p)).map((n) => ({ ...n, children: filter(n.children) }));
  return filter(buildTree(menus));
}
