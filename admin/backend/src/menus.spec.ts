import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applySetOp, buildTree, profileTree, selectionRoots, visibleTree, wouldCycle } from './menus.ts';

const m = (o: Record<string, unknown>) =>
  ({ title: 'M', icon: 'Circle', type: 'page', target: '', parentId: null, order: 0, status: 'active', startDate: null,
     endDate: null, profiles: [], distributorIds: [], groups: [], permission: null, ownMenu: false, ...o }) as never;

const menus = [
  m({ id: 1, title: 'Início', order: 0 }),
  m({ id: 2, title: 'Equipe', order: 1, profiles: ['manager'] }),
  m({ id: 3, title: 'Membros', parentId: 2 }),
  m({ id: 4, title: 'Promo', order: 2, startDate: '2026-11-01', endDate: '2026-11-30' }),
  m({ id: 5, title: 'Importar', order: 3, permission: 'SALES_IMPORT' }),
  m({ id: 6, title: 'Sul', order: 4, distributorIds: [7] }),
  m({ id: 7, title: 'Off', order: 5, status: 'inactive' }),
];
const titles = (t: { title: string; children: unknown[] }[]): string[] => t.map((n) => n.title);

test('árvore ordenada com filhos', () => {
  const t = buildTree(menus);
  assert.deepEqual(titles(t), ['Início', 'Equipe', 'Promo', 'Importar', 'Sul', 'Off']);
  assert.equal(t[1].children[0].title, 'Membros');
});

test('vendedor x gerente', () => {
  const seller = visibleTree(menus, { profile: 'seller', permissions: [], distributorId: 1, date: '2026-10-14' });
  assert.deepEqual(titles(seller), ['Início']);
  const mgr = visibleTree(menus, { profile: 'manager', permissions: ['SALES_IMPORT'], distributorId: 7, date: '2026-11-05' });
  assert.deepEqual(titles(mgr), ['Início', 'Equipe', 'Promo', 'Importar', 'Sul']);
  assert.equal(mgr[1].children.length, 1);
});

test('pai oculto esconde filho', () => {
  const t = visibleTree(menus, { profile: 'seller', permissions: [], date: '2026-10-14' });
  assert.ok(!JSON.stringify(t).includes('Membros'));
});

test('grupo sem destino com todos os filhos ocultos some', () => {
  const list = [m({ id: 1, title: 'Grupo' }), m({ id: 2, title: 'Só gerente', parentId: 1, profiles: ['manager'] })];
  assert.deepEqual(titles(visibleTree(list, { profile: 'seller', permissions: [], date: '2026-10-14' })), []);
  assert.deepEqual(titles(visibleTree(list, { profile: 'manager', permissions: [], date: '2026-10-14' })), ['Grupo']);
});

test('ciclo e conjuntos', () => {
  assert.equal(wouldCycle(menus, 2, 3), true);
  assert.equal(wouldCycle(menus, 3, 1), false);
  assert.deepEqual(applySetOp(['a', 'b'], { mode: 'add', values: ['b', 'c'] }), ['a', 'b', 'c']);
  assert.deepEqual(applySetOp(['a', 'b'], { mode: 'remove', values: ['a'] }), ['b']);
  assert.deepEqual(applySetOp(['a'], { mode: 'set', values: ['x'] }), ['x']);
  assert.deepEqual(selectionRoots(menus, [2, 3, 1]), [2, 1]);
});

test('usuário com vários perfis vê a união (gerente + ponto focal)', () => {
  const base = { icon: 'Circle', type: 'page', parentId: null, order: 0, status: 'active', startDate: null, endDate: null, distributorIds: [], groups: [], permission: null } as const;
  const list = [
    { ...base, id: 1, title: 'Início', target: '/inicio', profiles: [] },
    { ...base, id: 2, title: 'Minha Equipe', target: '/equipe', profiles: ['manager'] },
    { ...base, id: 3, title: 'Importar', target: '/importar', profiles: ['focal'] },
  ] as never[];
  const both = visibleTree(list, { profile: 'manager', profiles: ['manager', 'focal'], permissions: [], date: '2026-10-14' });
  assert.deepEqual(both.map((n) => n.title), ['Início', 'Minha Equipe', 'Importar']);
  const seller = visibleTree(list, { profile: 'seller', profiles: ['seller'], permissions: [], date: '2026-10-14' });
  assert.deepEqual(seller.map((n) => n.title), ['Início']);
});

test('árvore do perfil ignora status e esconde filho de pai de outro perfil', () => {
  assert.deepEqual(titles(profileTree(menus, 'seller')), ['Início', 'Promo', 'Importar', 'Sul', 'Off']);
  const mgr = profileTree(menus, 'manager');
  assert.equal(mgr[1].children[0].title, 'Membros');
});

test('distribuidora com menu próprio vê só o dela; as outras seguem no geral', () => {
  const list = [
    m({ id: 1, title: 'Geral', profiles: ['seller'] }),
    m({ id: 2, title: 'Extra Sul', profiles: ['seller'], distributorIds: [7] }),
    m({ id: 3, title: 'Próprio', profiles: ['seller'], distributorIds: [5], ownMenu: true }),
  ];
  const a = (distributorId: number) => ({ profile: 'seller' as const, permissions: [], distributorId, date: '2026-10-15' });
  assert.deepEqual(titles(visibleTree(list, a(5))), ['Próprio']);
  assert.deepEqual(titles(visibleTree(list, a(7))), ['Geral', 'Extra Sul']);
  assert.deepEqual(titles(visibleTree(list, a(1))), ['Geral']);
});
