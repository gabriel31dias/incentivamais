import { Repository } from 'typeorm';
import { AuthUser } from './auth';
import { Menu } from './entities';
import { MenuNode, visibleTree } from './menus';

/** menu que o usuário enxerga hoje (mesma regra do app e da pré-visualização do admin) */
export async function visibleMenuFor(menus: Repository<Menu>, user: AuthUser) {
  return visibleTree(await menus.find(), {
    profile: user.profiles[0],
    profiles: user.profiles,
    permissions: user.permissions,
    distributorId: user.distributorId,
    date: new Date().toISOString().slice(0, 10),
  });
}

/** existe item visível no menu do usuário apontando para `target`? */
export async function menuAllows(menus: Repository<Menu>, user: AuthUser, target: string) {
  const has = (list: MenuNode[]): boolean => list.some((n) => n.target === target || has(n.children));
  return has(await visibleMenuFor(menus, user));
}
