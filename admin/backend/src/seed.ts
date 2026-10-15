// Dados fictícios da demonstração. Roda no 1º boot (banco vazio) e em
// "Restaurar dados fictícios" (POST /api/admin/reset-demo).
import * as bcrypt from 'bcryptjs';
import { DataSource, EntityManager } from 'typeorm';
import { fakeCpf } from './common';
import {
  AuditLog,
  Campaign,
  Distributor,
  ImportBatch,
  ImportRow,
  Menu,
  MenuTemplate,
  PointEntry,
  PointRule,
  Product,
  Profile,
  ProfileKey,
  RecordItem,
  Sale,
  Team,
  TeamGoal,
  User,
} from './entities';
import { campaignFor, computePoints, ruleLabel } from './points';

export const DEMO_PASSWORD = 'demo123';

// pseudo-aleatório determinístico: o seed sai igual toda vez
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(42);
const pick = <T>(list: T[]) => list[Math.floor(rand() * list.length)];
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));

const FIRST = ['Ana', 'Bruno', 'Carla', 'Diego', 'Eduarda', 'Felipe', 'Gabriela', 'Henrique', 'Isabela', 'João', 'Juliana', 'Lucas', 'Mariana', 'Marcelo', 'Natália', 'Otávio', 'Patrícia', 'Pedro', 'Rafaela', 'Renato', 'Sabrina', 'Thiago', 'Vanessa', 'Vinícius', 'Larissa', 'Fernanda', 'Rodrigo', 'Camila', 'Gustavo', 'Letícia'];
const LAST = ['Silva', 'Santos', 'Oliveira', 'Souza', 'Lima', 'Pereira', 'Costa', 'Ferreira', 'Almeida', 'Ribeiro', 'Carvalho', 'Gomes', 'Martins', 'Rocha', 'Barbosa', 'Araújo', 'Melo', 'Cardoso', 'Teixeira', 'Moreira'];
const fullName = () => `${pick(FIRST)} ${pick(LAST)}`;
// vendedores não repetem nome: nome + dois sobrenomes (30 × 20 × 19 = 11.400 combinações)
const usedNames = new Set<string>();
const sellerName = () => {
  for (;;) {
    const [mid, last] = [pick(LAST), pick(LAST)];
    const name = `${pick(FIRST)} ${mid} ${last}`;
    if (mid !== last && !usedNames.has(name)) return usedNames.add(name), name;
  }
};

const CITIES: [string, string][] = [
  ['Central', 'Centro-Oeste'], ['Sudeste', 'Sudeste'], ['Paulista', 'Sudeste'], ['Carioca', 'Sudeste'], ['Mineira', 'Sudeste'],
  ['Capixaba', 'Sudeste'], ['Gaúcha', 'Sul'], ['Catarinense', 'Sul'], ['Paranaense', 'Sul'], ['Baiana', 'Nordeste'],
  ['Pernambucana', 'Nordeste'], ['Cearense', 'Nordeste'], ['Potiguar', 'Nordeste'], ['Paraibana', 'Nordeste'], ['Alagoana', 'Nordeste'],
  ['Sergipana', 'Nordeste'], ['Maranhense', 'Nordeste'], ['Piauiense', 'Nordeste'], ['Amazonense', 'Norte'], ['Paraense', 'Norte'],
  ['Tocantinense', 'Norte'], ['Rondoniense', 'Norte'], ['Acreana', 'Norte'], ['Amapaense', 'Norte'], ['Roraimense', 'Norte'],
  ['Goiana', 'Centro-Oeste'], ['Brasiliense', 'Centro-Oeste'], ['Cuiabana', 'Centro-Oeste'], ['Sul-Mato-Grossense', 'Centro-Oeste'], ['Campineira', 'Sudeste'],
  ['Santista', 'Sudeste'], ['Litoral Norte', 'Sudeste'], ['Vale do Paraíba', 'Sudeste'], ['Serra Gaúcha', 'Sul'], ['Triângulo', 'Sudeste'],
];

const PRODUCTS: [string, string, string, number][] = [
  ['PRD-A', 'Produto A — Linha Premium', 'Premium', 18990],
  ['PRD-B', 'Produto B — Linha Profissional', 'Profissional', 32900],
  ['PRD-C', 'Produto C — Linha Essencial', 'Essencial', 8990],
  ['PRD-D', 'Kit Revenda 12 un', 'Kits', 54000],
  ['PRD-E', 'Refil Econômico', 'Essencial', 2490],
  ['PRD-F', 'Acessório Plus', 'Acessórios', 4990],
  ['PRD-G', 'Combo Família', 'Kits', 21900],
  ['PRD-H', 'Linha Verde Sustentável', 'Premium', 15900],
];

// competências com vendas na demonstração (hoje = out/2026)
const MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];

async function chunked<T>(m: EntityManager, entity: new () => T, rows: Partial<T>[], size = 400) {
  for (let i = 0; i < rows.length; i += size) await m.insert(entity, rows.slice(i, i + size) as never);
}

export async function seed(db: DataSource) {
  usedNames.clear(); // "Restaurar dados fictícios" roda o seed de novo no mesmo processo
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);

  await db.transaction(async (m) => {
    // ---------- perfis ----------
    const ALL = [
      'USERS_VIEW', 'USERS_CREATE', 'USERS_EDIT', 'USERS_DISABLE', 'TEAMS_MANAGE', 'MENUS_MANAGE', 'MENUS_BULK_EDIT',
      'CAMPAIGNS_MANAGE', 'POINT_RULES_MANAGE', 'POINTS_ADJUST', 'SALES_IMPORT', 'SALES_VALIDATE', 'SALES_APPROVE',
      'SALES_REPROCESS', 'REPORTS_VIEW', 'CONTENT_MANAGE',
    ] as const;
    await m.insert(Profile, [
      { key: 'super_admin', name: 'Super Admin', permissions: [...ALL], scope: 'organization' },
      { key: 'admin', name: 'Admin do Cliente', permissions: ALL.filter((p) => p !== 'SALES_REPROCESS'), scope: 'organization' },
      { key: 'manager', name: 'Gerente', permissions: ['USERS_VIEW', 'TEAMS_MANAGE', 'REPORTS_VIEW'], scope: 'team' },
      { key: 'seller', name: 'Vendedor', permissions: [], scope: 'own' },
      { key: 'focal', name: 'Ponto Focal', permissions: ['SALES_IMPORT', 'SALES_VALIDATE', 'REPORTS_VIEW'], scope: 'distributors' },
    ]);

    // ---------- distribuidoras ----------
    const distributors = CITIES.map(([city, region], i) => ({
      name: `Distribuidora ${city}`,
      code: `DIST${String(i + 1).padStart(2, '0')}`,
      cnpj: `${String(10 + i).padStart(2, '0')}.${int(100, 999)}.${int(100, 999)}/0001-${int(10, 99)}`,
      responsible: fullName(),
      region,
      status: (i === 34 ? 'inactive' : 'active') as 'active' | 'inactive',
    }));
    await m.insert(Distributor, distributors);
    const dists = await m.find(Distributor, { order: { id: 'ASC' } });

    // ---------- produtos ----------
    await m.insert(Product, PRODUCTS.map(([sku, name, category, priceCents]) => ({ sku, name, category, priceCents })));
    const products = await m.find(Product, { order: { id: 'ASC' } });

    // ---------- usuários: 10 admins, 50 gerentes (35 também pontos focais), 9.940 vendedores ----------
    const users: Partial<User>[] = [
      { name: 'Ana Administradora', email: 'admin@incentiva.demo', profiles: ['super_admin'] },
      { name: 'Carlos Cliente', email: 'cliente@incentiva.demo', profiles: ['admin'] },
      ...Array.from({ length: 8 }, (_, i) => ({ name: fullName(), email: `admin${i + 2}@incentiva.demo`, profiles: ['admin'] as User['profiles'] })),
    ];
    // ponto focal "puro" (os demais pontos focais também são gerentes), para o login do app
    const focalOnly: Partial<User> = { name: 'Paula Focal', email: 'focal@incentiva.demo', profiles: ['focal'], distributorId: dists[1].id };
    for (let i = 1; i <= 50; i++) {
      users.push({
        name: fullName(),
        email: `gerente${i}@incentiva.demo`,
        profiles: i <= 35 ? ['manager', 'focal'] : ['manager'],
        distributorId: dists[(i - 1) % 35].id,
      });
    }
    users.push(focalOnly);
    let n = 0;
    for (const u of users) Object.assign(u, { cpf: fakeCpf(++n), passwordHash: hash, status: 'active', blocked: false });
    await chunked(m, User, users);
    const managers = (await m.find(User, { order: { id: 'ASC' } })).filter((u) => u.profiles.includes('manager'));

    // pontos focais: os 35 primeiros gerentes, um por distribuidora
    for (const mgr of managers.slice(0, 35)) await m.update(Distributor, mgr.distributorId!, { focalUserId: mgr.id });

    // equipes: uma por gerente
    await m.insert(
      Team,
      managers.map((mgr, i) => ({
        name: `Equipe ${['Alfa', 'Beta', 'Gama', 'Delta', 'Ômega'][i % 5]} ${i + 1}`,
        distributorId: mgr.distributorId!,
        managerId: mgr.id,
        goalCents: int(14, 32) * 100000,
      })),
    );
    const teams = await m.find(Team, { order: { id: 'ASC' } });
    // metas mensais por competência, variando um pouco em torno da meta padrão da equipe
    await chunked(
      m,
      TeamGoal,
      teams.flatMap((t) => MONTHS.map((competence, i) => ({ teamId: t.id, competence, goalCents: t.goalCents + ((i % 3) - 1) * 100000, createdByName: 'Ana Administradora' }))),
    );

    const sellers: Partial<User>[] = [];
    for (let i = 1; i <= 9940; i++) {
      const team = teams[(i - 1) % teams.length];
      sellers.push({
        name: sellerName(),
        email: `vendedor${i}@incentiva.demo`,
        cpf: fakeCpf(++n),
        passwordHash: hash,
        profiles: ['seller'],
        distributorId: team.distributorId,
        teamId: team.id,
        managerId: team.managerId,
        status: i % 97 === 0 ? 'inactive' : 'active',
        blocked: i % 211 === 0,
        lastAccessAt: i % 3 === 0 ? null : new Date(Date.UTC(2026, 9, int(1, 13), int(8, 20), int(0, 59))),
      });
    }
    await chunked(m, User, sellers, 300);

    // ---------- campanhas e regras ----------
    const allProducts = products.map((p) => p.id);
    await m.insert(Campaign, [
      { name: 'Incentiva+ 2026', description: 'Campanha anual: cada venda gera pontos trocáveis no catálogo de prêmios.', startDate: '2026-01-01', endDate: '2026-12-31', status: 'active', distributorIds: [], audience: ['seller', 'manager'], productIds: [], rewards: ['Catálogo de prêmios', 'Viagem para os 10 primeiros'], goalCents: 1500000000, banner: null },
      { name: 'Desafio Primavera', description: 'Pontos em dobro em datas selecionadas da Linha Premium.', startDate: '2026-09-01', endDate: '2026-10-31', status: 'active', distributorIds: dists.slice(0, 12).map((d) => d.id), audience: ['seller'], productIds: [products[0].id, products[7].id], rewards: ['Smartwatch para o top 3'], goalCents: 80000000, banner: null },
      { name: 'Turbo Verão', description: 'Campanha relâmpago de verão.', startDate: '2026-01-15', endDate: '2026-03-31', status: 'ended', distributorIds: [], audience: ['seller'], productIds: allProducts, rewards: ['Vale-compras R$ 500'], goalCents: 120000000, banner: null },
      { name: 'Black Friday Turbo', description: 'Pontuação especial na semana da Black Friday.', startDate: '2026-11-20', endDate: '2026-11-30', status: 'scheduled', distributorIds: [], audience: ['seller', 'manager'], productIds: [], rewards: ['Bônus de 500 pontos'], goalCents: 200000000, banner: null },
      { name: 'Natal Premiado (rascunho)', description: 'Em definição com o cliente.', startDate: '2026-12-01', endDate: '2026-12-24', status: 'draft', distributorIds: [], audience: ['seller'], productIds: [], rewards: [], goalCents: 0, banner: null },
    ]);
    const campaigns = await m.find(Campaign, { order: { id: 'ASC' } });
    const main = campaigns[0];

    const rule = (o: Partial<PointRule>) => ({
      ruleKey: `R-${String(o.name).toUpperCase().replace(/[^A-Z0-9]+/g, '-').slice(0, 30)}`,
      version: 1,
      campaignId: main.id,
      productId: null,
      distributorId: null,
      amountStepCents: null,
      startDate: main.startDate,
      endDate: main.endDate,
      priority: 10,
      status: 'active' as const,
      createdByName: 'Ana Administradora',
      ...o,
    });
    await m.insert(PointRule, [
      rule({ name: 'Produto A por unidade', productId: products[0].id, calcType: 'per_unit', value: 10, priority: 20 }),
      rule({ name: 'Produto B por unidade', productId: products[1].id, calcType: 'per_unit', value: 20, priority: 20 }),
      rule({ name: 'Produto C por valor', productId: products[2].id, calcType: 'per_amount', value: 5, amountStepCents: 10000, priority: 20 }),
      rule({ name: 'Demais produtos por valor', calcType: 'per_amount', value: 1, amountStepCents: 1000, priority: 0 }),
      rule({ name: 'Bônus meta mensal', calcType: 'goal_bonus', value: 200, priority: 0 }),
      rule({ name: 'Semana do Cliente em dobro', calcType: 'multiplier', value: 200, startDate: '2026-09-14', endDate: '2026-09-20', priority: 30 }),
      rule({ name: 'Primavera Premium', campaignId: campaigns[1].id, productId: products[0].id, calcType: 'per_unit', value: 25, startDate: '2026-09-01', endDate: '2026-10-31', priority: 20 }),
    ]);
    // histórico de versões: a regra do Produto B já foi 15 pts no 1º trimestre
    const rB = await m.findOneByOrFail(PointRule, { name: 'Produto B por unidade' });
    await m.insert(PointRule, { ...rB, id: undefined, version: 0, value: 15, endDate: '2026-03-31', status: 'superseded', createdAt: new Date('2025-12-20T12:00:00Z') });
    const rules = await m.find(PointRule);

    // ---------- vendas: um lote por distribuidora por mês ----------
    const allUsers = await m.find(User, { select: ['id', 'name', 'email', 'cpf', 'distributorId', 'profiles', 'status'] });
    // vendedora de demonstração (login do app) recebe 1 em cada 5 vendas da distribuidora dela
    const demoSeller = allUsers.find((u) => u.email === 'vendedor1@incentiva.demo')!;
    const cpfOf = new Map(allUsers.map((u) => [u.id, (u.cpf ?? '').replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')]));
    const sellersByDist = new Map<number, { id: number; name: string }[]>();
    for (const u of allUsers)
      if (u.profiles.includes('seller') && u.status === 'active')
        sellersByDist.set(u.distributorId!, [...(sellersByDist.get(u.distributorId!) ?? []), u]);

    const focalOf = new Map(managers.slice(0, 35).map((mgr) => [mgr.distributorId!, mgr]));
    const lastIdx = MONTHS.length - 1;

    for (const [mi, competence] of MONTHS.entries()) {
      for (const d of dists) {
        if (d.status === 'inactive' && mi > 5) continue;
        // set/2026: 5 distribuidoras ainda não enviaram, 3 com inconsistências
        const pos = d.id % 35;
        if (mi === lastIdx && pos >= 28) continue;
        const withErrors = mi === lastIdx && pos >= 25;
        const focal = focalOf.get(d.id)!;
        const sentAt = new Date(`${MONTHS[mi + 1] ?? '2026-10'}-0${int(1, 6)}T${int(10, 18)}:${int(10, 59)}:00Z`);
        const count = int(28, 46);
        const batch = await m.save(
          m.create(ImportBatch, {
            distributorId: d.id,
            distributorName: d.name,
            competence,
            fileName: `vendas_${d.code.toLowerCase()}_${competence.replace('-', '')}.xlsx`,
            userId: focal.id,
            userName: focal.name,
            status: withErrors ? 'with_errors' : 'done',
            total: count,
            valid: withErrors ? count - 4 : count,
            invalid: withErrors ? 4 : 0,
            processedAt: withErrors ? null : sentAt,
            createdAt: sentAt,
          }),
        );
        const pool = sellersByDist.get(d.id) ?? [];
        if (withErrors) {
          // lote parado em inconsistências: linhas válidas + 4 com erro, para a tela de validação ter o que mostrar
          const errs: [string, string, Partial<Record<string, string>>][] = [
            ['cpf_invalid', 'CPF inválido', { cpf_vendedor: '123.456.789-00' }],
            ['seller_not_found', 'Vendedor inexistente', { cpf_vendedor: '529.982.247-25' }],
            ['product_not_found', 'Produto inexistente', { sku: 'PRD-Z' }],
            ['quantity_invalid', 'Quantidade inválida', { quantidade: '0' }],
          ];
          const rows = Array.from({ length: count }, (_, k) => {
            const seller = pick(pool);
            const product = pick(products);
            const quantity = int(1, 12);
            const date = `${competence}-${String(int(1, 28)).padStart(2, '0')}`;
            const document = `NF${competence.replace('-', '')}${String(k + 1).padStart(4, '0')}`;
            const input = { productId: product.id, distributorId: d.id, quantity, amountCents: quantity * product.priceCents, date };
            const err = k >= count - 4 ? errs[k - (count - 4)] : null;
            const data = {
              documento: document, item: '1', cpf_vendedor: cpfOf.get(seller.id) ?? '', sku: product.sku,
              data: date.split('-').reverse().join('/'), quantidade: String(quantity), valor: (input.amountCents / 100).toFixed(2).replace('.', ','),
              ...(err?.[2] ?? {}),
            };
            return {
              batchId: batch.id, line: k + 2, data, errors: err ? [{ code: err[0], message: err[1] }] : [], status: err ? 'invalid' : 'valid',
              externalId: `${d.code}:${document}:1`, sellerId: err ? null : seller.id, productId: err?.[0] === 'product_not_found' ? null : product.id,
              document, date, quantity: err?.[0] === 'quantity_invalid' ? null : quantity, amountCents: input.amountCents,
              points: err ? 0 : computePoints(rules, campaignFor(campaigns, input)?.id ?? null, input).points, previousPoints: null,
            };
          });
          await chunked(m, ImportRow, rows as Partial<ImportRow>[]);
          await m.update(ImportBatch, batch.id, { predictedPoints: rows.reduce((t, r) => t + r.points, 0) });
          continue;
        }

        const sales: Partial<Sale>[] = [];
        const entries: Partial<PointEntry>[] = [];
        for (let k = 1; k <= count; k++) {
          const seller = d.id === demoSeller.distributorId && k % 5 === 0 ? demoSeller : pick(pool);
          const product = pick(products);
          const quantity = int(1, 12);
          const date = `${competence}-${String(int(1, 28)).padStart(2, '0')}`;
          const input = { productId: product.id, distributorId: d.id, quantity, amountCents: quantity * product.priceCents, date };
          const campaign = campaignFor(campaigns, input);
          const { points, rule: r } = computePoints(rules, campaign?.id ?? null, input);
          const externalId = `${d.code}:NF${competence.replace('-', '')}${String(k).padStart(4, '0')}:1`;
          sales.push({ externalId, batchId: batch.id, distributorId: d.id, sellerId: seller.id, productId: product.id, campaignId: campaign?.id ?? null, document: externalId.split(':')[1], date, competence, quantity, amountCents: input.amountCents, points, ruleId: r?.id ?? null, status: 'active', createdAt: sentAt });
          entries.push({ sellerId: seller.id, sellerName: seller.name, distributorId: d.id, campaignId: campaign?.id ?? null, type: 'credit', points, origin: `Venda ${externalId.split(':')[1]}`, ruleId: r?.id ?? null, ruleLabel: r ? ruleLabel(r) : null, saleExternalId: externalId, batchId: batch.id, actorName: 'Processamento automático', createdAt: sentAt });
        }
        await chunked(m, Sale, sales);
        await chunked(m, PointEntry, entries);
        const credited = entries.reduce((s, e) => s + (e.points ?? 0), 0);
        await m.update(ImportBatch, batch.id, { creditedPoints: credited, predictedPoints: credited });
      }
    }

    // lote com falha e lote substituído, para o histórico ter todos os estados
    const d0 = dists[0];
    const f0 = focalOf.get(d0.id)!;
    await m.insert(ImportBatch, [
      { distributorId: d0.id, distributorName: d0.name, competence: '2026-05', fileName: 'vendas_maio_layout_antigo.csv', userId: f0.id, userName: f0.name, status: 'failed', total: 0, error: 'Divergência de layout: colunas obrigatórias ausentes (cpf_vendedor, sku)', createdAt: new Date('2026-06-02T13:20:00Z') },
      { distributorId: d0.id, distributorName: d0.name, competence: '2026-04', fileName: 'vendas_abril_v1.xlsx', userId: f0.id, userName: f0.name, status: 'replaced', total: 38, valid: 36, invalid: 2, createdAt: new Date('2026-05-02T10:05:00Z') },
    ]);

    // bônus, ajustes e estornos no extrato
    const someSellers = (sellersByDist.get(dists[1].id) ?? []).slice(0, 6);
    await m.insert(PointEntry, [
      ...someSellers.slice(0, 3).map((s) => ({ sellerId: s.id, sellerName: s.name, distributorId: dists[1].id, campaignId: main.id, type: 'bonus' as const, points: 200, origin: 'Bônus meta mensal agosto', ruleLabel: 'Bônus meta mensal (v1)', actorName: 'Processamento automático', createdAt: new Date('2026-09-05T09:00:00Z') })),
      { sellerId: someSellers[3].id, sellerName: someSellers[3].name, distributorId: dists[1].id, campaignId: main.id, type: 'adjustment', points: 50, origin: 'Ajuste administrativo', reason: 'Venda de 12/08 lançada com quantidade menor pela distribuidora', actorName: 'Ana Administradora', createdAt: new Date('2026-09-10T15:30:00Z') },
      { sellerId: someSellers[4].id, sellerName: someSellers[4].name, distributorId: dists[1].id, campaignId: main.id, type: 'reversal', points: -120, origin: 'Estorno de venda cancelada', reason: 'Pedido cancelado pelo cliente final (NF devolvida)', actorName: 'Carlos Cliente', createdAt: new Date('2026-09-18T11:10:00Z') },
      { sellerId: someSellers[5].id, sellerName: someSellers[5].name, distributorId: dists[1].id, campaignId: main.id, type: 'debit', points: -500, origin: 'Resgate: Fone Bluetooth', actorName: 'Catálogo de prêmios', createdAt: new Date('2026-10-02T17:45:00Z') },
    ]);

    // ---------- menus do app (árvore do enunciado) ----------
    const tree: [string, string, string, ProfileKey[], [string, string, string][]][] = [
      ['Início', 'House', '/inicio', [], []],
      ['Desempenho', 'TrendingUp', '', [], [['Minhas Vendas', 'ShoppingCart', '/vendas'], ['Minhas Metas', 'Target', '/metas'], ['Ranking', 'Trophy', '/ranking']]],
      ['Pontos', 'Coins', '', [], [['Meu Extrato', 'ReceiptText', '/extrato'], ['Histórico', 'History', '/extrato/historico']]],
      ['Conteúdos', 'Newspaper', '', [], [['Notícias', 'Newspaper', '/noticias'], ['Treinamentos', 'GraduationCap', '/treinamentos']]],
      ['Gamificação', 'Gamepad2', '', [], [['Quiz', 'CircleHelp', '/quiz'], ['Missões', 'Flag', '/missoes'], ['Medalhas', 'Medal', '/medalhas']]],
      ['Painel do Gerente', 'ChartPie', '/gerente', ['manager'], []],
      ['Minha Equipe', 'Users', '/equipe', ['manager'], []],
      ['Importar Vendas', 'CloudUpload', '/importar', ['focal'], []],
    ];
    for (const [order, [title, icon, target, profiles, children]] of tree.entries()) {
      const parent = await m.save(m.create(Menu, { title, icon, target, type: 'page', order, profiles, distributorIds: [], groups: [], permission: null }));
      for (const [o, [t, i, tg]] of children.entries())
        await m.insert(Menu, { title: t, icon: i, target: tg, type: 'page', order: o, parentId: parent.id, profiles: [], distributorIds: [], groups: [], permission: null });
    }
    await m.save(MenuTemplate, {
      name: 'Gamificação padrão',
      description: 'Quiz, missões e medalhas — base para novas campanhas',
      items: [{ title: 'Gamificação', icon: 'Gamepad2', type: 'page', target: '', children: [{ title: 'Quiz', icon: 'CircleHelp', type: 'feature', target: '/quiz' }, { title: 'Missões', icon: 'Flag', type: 'feature', target: '/missoes' }, { title: 'Medalhas', icon: 'Medal', type: 'feature', target: '/medalhas' }] }],
      createdByName: 'Ana Administradora',
    });

    // ---------- módulos genéricos ----------
    const rec = (kind: string, title: string, status: string, data: Record<string, any>) => ({
      kind, title, status, data, history: [{ at: '2026-09-01T12:00:00.000Z', by: 'Ana Administradora', action: 'Criado' }],
    });
    await m.insert(RecordItem, [
      rec('news', 'Campanha Incentiva+ 2026 bate recorde em agosto', 'published', { summary: 'Vendas cresceram 18% sobre julho.', body: 'As distribuidoras do Sudeste lideraram o crescimento...', profiles: [], distributorIds: [], publishAt: '2026-09-02' }),
      rec('news', 'Novo catálogo de prêmios disponível', 'published', { summary: 'Mais de 40 itens novos.', body: 'Confira os novos prêmios...', profiles: ['seller'], distributorIds: [], publishAt: '2026-09-20' }),
      rec('news', 'Black Friday Turbo: prepare-se', 'scheduled', { summary: 'Pontuação especial de 20 a 30/11.', body: 'Em breve...', profiles: [], distributorIds: [], publishAt: '2026-11-10' }),
      rec('banner', 'Desafio Primavera — pontos em dobro', 'published', { link: '/campanhas/2', image: '', profiles: [], distributorIds: [], startDate: '2026-09-01', endDate: '2026-10-31' }),
      rec('banner', 'Black Friday Turbo', 'scheduled', { link: '/campanhas/4', image: '', profiles: [], distributorIds: [], startDate: '2026-11-15', endDate: '2026-11-30' }),
      rec('notice', 'Prazo de envio das vendas de setembro: 10/10', 'published', { body: 'Pontos focais: enviem as planilhas até 10/10.', profiles: ['focal'], distributorIds: [] }),
      rec('notice', 'Manutenção programada no domingo', 'draft', { body: 'A plataforma ficará indisponível das 2h às 4h.', profiles: [], distributorIds: [] }),
      rec('training', 'Técnicas de Vendas Avançadas', 'published', { modules: [{ title: 'Abordagem', lessons: 4 }, { title: 'Objeções', lessons: 3 }], points: 50, completionRule: '100% das aulas + quiz ≥ 70%', certificate: true, enrolled: 4210, completed: 2876 }),
      rec('training', 'Conhecendo a Linha Premium', 'published', { modules: [{ title: 'Produtos', lessons: 5 }], points: 30, completionRule: '100% das aulas', certificate: true, enrolled: 6120, completed: 5034 }),
      rec('training', 'Atendimento ao Cliente', 'draft', { modules: [], points: 20, completionRule: '100% das aulas', certificate: false, enrolled: 0, completed: 0 }),
      rec('quiz', 'Quiz da Semana — Linha Premium', 'published', { questions: [{ q: 'Qual o diferencial do Produto A?', options: ['Preço', 'Durabilidade', 'Cor'], correct: 1 }], points: 50, timeLimit: 300, attempts: 2, startDate: '2026-10-06', endDate: '2026-10-19', profiles: ['seller'] }),
      rec('poll', 'Qual prêmio você mais quer?', 'published', { options: ['Viagem', 'Eletrônicos', 'Vale-compras'], votes: [812, 1340, 977] }),
      rec('mission', 'Vender 10 unidades do Produto A', 'published', { condition: 'Vendas Produto A ≥ 10 no mês', points: 100, medal: 'Especialista Premium' }),
      rec('mission', 'Concluir 2 treinamentos', 'published', { condition: 'Treinamentos concluídos ≥ 2', points: 60, medal: 'Aprendiz' }),
      rec('medal', 'Especialista Premium', 'published', { condition: 'Completar a missão Produto A', icon: 'Medal' }),
      rec('medal', 'Aprendiz', 'published', { condition: 'Concluir 2 treinamentos', icon: 'GraduationCap' }),
      rec('medal', 'Top 10 do mês', 'published', { condition: 'Ficar entre os 10 primeiros do ranking mensal', icon: 'Trophy' }),
      rec('level', 'Bronze', 'published', { minPoints: 0 }),
      rec('level', 'Prata', 'published', { minPoints: 2000 }),
      rec('level', 'Ouro', 'published', { minPoints: 6000 }),
      rec('reward', 'Fone Bluetooth', 'published', { points: 500, stock: 120, startDate: '2026-01-01', endDate: '2026-12-31', profiles: ['seller'] }),
      rec('reward', 'Smartwatch', 'published', { points: 2500, stock: 40, startDate: '2026-01-01', endDate: '2026-12-31', profiles: ['seller'] }),
      rec('reward', 'Vale-compras R$ 200', 'published', { points: 1200, stock: 300, startDate: '2026-01-01', endDate: '2026-12-31', profiles: ['seller', 'manager'] }),
      rec('reward', 'Viagem para 2 pessoas', 'published', { points: 15000, stock: 5, startDate: '2026-06-01', endDate: '2026-12-31', profiles: ['seller'] }),
      ...['Fone Bluetooth', 'Smartwatch', 'Vale-compras R$ 200', 'Fone Bluetooth', 'Vale-compras R$ 200'].map((r, i) =>
        rec('redemption', `${r} — ${fullName()}`, ['requested', 'approved', 'shipped', 'delivered', 'requested'][i], { reward: r, points: [500, 2500, 1200, 500, 1200][i], requestedAt: `2026-10-0${i + 1}` }),
      ),
      ...[
        ['Pontos da venda de agosto não apareceram', 'Pontuação', 'high', 'open'],
        ['Não consigo acessar o treinamento', 'Treinamentos', 'medium', 'in_progress'],
        ['Planilha recusada por layout', 'Importação', 'high', 'open'],
        ['Dúvida sobre resgate de prêmio', 'Premiações', 'low', 'closed'],
      ].map(([title, category, priority, status]) =>
        rec('ticket', title, status, { requester: fullName(), distributor: pick(dists).name, category, priority, assignee: status === 'open' ? null : 'Carlos Cliente', messages: [{ from: 'user', text: title + '. Podem verificar?', at: '2026-10-08T14:00:00.000Z' }] }),
      ),
      rec('settings', 'Configurações gerais', 'published', { orgName: 'Incentiva+ Demo', primaryColor: '#00E6A0', pointsExpireMonths: 12, minRedeemPoints: 500, notifyEmail: true, notifyPush: true, mfaProfiles: ['super_admin', 'admin', 'manager', 'seller', 'focal'], sessionHours: 12, welcomeMessage: 'Bem-vindo(a) à campanha Incentiva+!' }),
    ]);

    await m.save(AuditLog, [
      { action: 'campaign.create', actorId: 1, actorName: 'Ana Administradora', targetType: 'campaign', targetId: String(main.id), description: 'Criou a campanha Incentiva+ 2026', before: null, after: { name: main.name }, createdAt: new Date('2025-12-15T10:00:00Z') },
      { action: 'rule.update', actorId: 1, actorName: 'Ana Administradora', targetType: 'point_rule', targetId: String(rB.id), description: 'Produto B por unidade: 15 → 20 pts (nova versão)', before: { value: 15 }, after: { value: 20 }, createdAt: new Date('2026-03-28T16:00:00Z') },
      { action: 'profile.update', actorId: 1, actorName: 'Ana Administradora', targetType: 'profile', targetId: 'focal', description: 'Ponto Focal: + SALES_VALIDATE', before: { permissions: ['SALES_IMPORT', 'REPORTS_VIEW'] }, after: { permissions: ['SALES_IMPORT', 'SALES_VALIDATE', 'REPORTS_VIEW'] }, createdAt: new Date('2026-02-03T09:00:00Z') },
    ]);
  });
}
