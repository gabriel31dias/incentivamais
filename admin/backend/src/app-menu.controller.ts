import { Body, Controller, ForbiddenException, Get, HttpCode, NotFoundException, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { DataSource, Repository } from 'typeorm';
import { AuthUser, CurrentUser, toApiUser } from './auth';
import { Campaign, Distributor, Menu, PointEntry, ProfileKey, TrainingProgress } from './entities';
import { effectiveStatus } from './points';
import { menuAllows, visibleMenuFor } from './menu-access';
import { MenuNode } from './menus';

class MySalesQuery {
  /** AAAA-MM ou "all" */
  @IsOptional() @Matches(/^(\d{4}-\d{2}|all)$/) competence?: string;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) per_page = 20;
}

type TeamGoalRow = {
  teamId: number;
  name: string;
  distributorName: unknown;
  managerName: unknown;
  goalCents: number | null;
  soldCents: number;
  members: number;
  percent: number | null;
  reached: boolean;
  bonusLaunched: boolean;
};

class MyPointsQuery {
  /** AAAA-MM (mês do lançamento) ou "all" */
  @IsOptional() @Matches(/^(\d{4}-\d{2}|all)$/) month?: string;
  /** c = créditos, d = débitos, e = estornos */
  @IsOptional() @IsIn(['', 'c', 'd', 'e']) type?: string;
  @IsOptional() @Type(() => Number) @IsInt() campaignId?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) per_page = 20;
}

/** aba do extrato → filtro SQL (estorno é tipo próprio; débito é qualquer outro lançamento negativo) */
const POINT_TYPE: Record<string, string> = {
  c: "e.type != 'reversal' AND e.points > 0",
  d: "e.type != 'reversal' AND e.points < 0",
  e: "e.type = 'reversal'",
};

class MyRankingQuery {
  /** AAAA-MM (mês do lançamento dos pontos) */
  @IsOptional() @Matches(/^\d{4}-\d{2}$/) month?: string;
  @IsOptional() @IsIn(['all', 'distributor', 'team']) scope: 'all' | 'distributor' | 'team' = 'all';
}

class MyGoalsQuery {
  @IsOptional() @Matches(/^\d{4}-\d{2}$/) competence?: string;
}

class LessonDto {
  @IsString() @MaxLength(20) key: string;
  @IsBoolean() done: boolean;
}

class FavoriteDto {
  @IsBoolean() favorite: boolean;
}

type Lesson = { key: string; title: string; video: string | null; material: string | null; minutes: number | null };
/** módulos do cadastro → aulas com chave "módulo.aula"; módulo sem aula cadastrada não aparece
 * (o seed antigo guarda só a quantidade, "lessons: 4", que o admin também mostra como vazio) */
const lessonsOf = (modules: unknown): { title: string; lessons: Lesson[] }[] =>
  (Array.isArray(modules) ? modules : [])
    .map((m, mi) => ({
      title: String(m?.title ?? `Módulo ${mi + 1}`),
      lessons: (Array.isArray(m?.lessons) ? m.lessons : []).map((l: Record<string, unknown>, li: number) => ({
        key: `${mi}.${li}`,
        title: String(l.title || `Aula ${li + 1}`),
        video: (l.video as string) || null,
        material: (l.material as string) || null,
        minutes: Number(l.minutes) || null,
      })),
    }))
    .filter((m) => m.lessons.length);

/** conteúdo com público: vazio = todos; senão precisa casar perfil e distribuidora */
export const forMe = (user: AuthUser, d: { profiles?: ProfileKey[]; distributorIds?: number[] }) =>
  (!d.profiles?.length || d.profiles.some((p) => user.profiles.includes(p))) &&
  (!d.distributorIds?.length || (!!user.distributorId && d.distributorIds.includes(user.distributorId)));

type AppItem = { title: string; icon: string; type: string; target: string; children: AppItem[] };
const slim = (n: MenuNode): AppItem => ({ title: n.title, icon: n.icon, type: n.type, target: n.target, children: n.children.map(slim) });

/** tela inicial do app por perfil (o de maior responsabilidade vence) */
const HOME: [ProfileKey, string][] = [
  ['manager', '/gerente'],
  ['focal', '/importar'],
  ['seller', '/inicio'],
];

/**
 * Menu do app (~/incentiva/app) para o usuário logado, montado com o que foi
 * cadastrado em Menus Dinâmicos. Exige login (guard global): o perfil vem do
 * token, não do app, então não dá para pedir o menu de outro perfil.
 * Usuário com vários perfis vê a união do que cada perfil vê.
 */
@Controller('app')
export class AppMenuController {
  constructor(
    @InjectRepository(Menu) private readonly menus: Repository<Menu>,
    @InjectRepository(Distributor) private readonly distributors: Repository<Distributor>,
    @InjectRepository(TrainingProgress) private readonly progress: Repository<TrainingProgress>,
    private readonly db: DataSource,
  ) {}

  private visibleMenu(user: AuthUser) {
    return visibleMenuFor(this.menus, user);
  }

  /**
   * A tela só pode ser usada se houver um item visível no menu do usuário apontando
   * para ela. Tirar um perfil do menu em Menus Dinâmicos bloqueia também os dados.
   */
  private async assertMenu(user: AuthUser, target: string) {
    if (!(await menuAllows(this.menus, user, target))) throw new ForbiddenException('Seu perfil não tem acesso a esta tela.');
  }

  /**
   * Minhas Vendas: só as vendas do usuário do token (sellerId = user.id), ativas
   * (uma venda corrigida aparece pela versão nova). Não aceita sellerId de fora.
   */
  @Get('me/sales')
  async mySales(@CurrentUser() user: AuthUser, @Query() q: MySalesQuery) {
    await this.assertMenu(user, '/vendas');
    const monthly: { competence: string; count: number; quantity: number; amountCents: number; points: number }[] = (
      await this.db.query(
        `SELECT competence, COUNT(*) count, SUM(quantity) quantity, SUM(amountCents) amountCents, SUM(points) points
         FROM sales WHERE sellerId = ? AND status = 'active' GROUP BY competence ORDER BY competence`,
        [user.id],
      )
    ).map((r: Record<string, string | number>) => ({
      competence: String(r.competence),
      count: Number(r.count),
      quantity: Number(r.quantity),
      amountCents: Number(r.amountCents),
      points: Number(r.points),
    }));
    const competence = q.competence ?? monthly.at(-1)?.competence ?? 'all';

    const where = ["s.sellerId = ?", "s.status = 'active'"];
    const params: (string | number)[] = [user.id];
    if (competence !== 'all') {
      where.push('s.competence = ?');
      params.push(competence);
    }
    if (q.search?.trim()) {
      where.push('(s.document LIKE ? OR p.name LIKE ? OR p.sku LIKE ?)');
      const like = `%${q.search.trim()}%`;
      params.push(like, like, like);
    }
    const from = `FROM sales s JOIN products p ON p.id = s.productId LEFT JOIN point_rules r ON r.id = s.ruleId WHERE ${where.join(' AND ')}`;
    const [totals] = await this.db.query(
      `SELECT COUNT(*) count, COALESCE(SUM(s.quantity),0) quantity, COALESCE(SUM(s.amountCents),0) amountCents, COALESCE(SUM(s.points),0) points ${from}`,
      params,
    );
    const rows = await this.db.query(
      `SELECT s.id, s.document, s.date, s.competence, s.quantity, s.amountCents, s.points, s.batchId, s.createdAt,
              p.name productName, p.sku, r.name ruleName, r.version ruleVersion,
              (SELECT COUNT(*) FROM sales o WHERE o.replacedBySaleId = s.id) corrected
       ${from} ORDER BY s.date DESC, s.id DESC LIMIT ? OFFSET ?`,
      [...params, q.per_page, (q.page - 1) * q.per_page],
    );
    const total = Number(totals.count);
    return {
      competence,
      summary: { count: total, quantity: Number(totals.quantity), amountCents: Number(totals.amountCents), points: Number(totals.points) },
      monthly,
      data: rows.map((r: Record<string, string | number | null>) => ({
        ...r,
        quantity: Number(r.quantity),
        amountCents: Number(r.amountCents),
        points: Number(r.points),
        corrected: Number(r.corrected) > 0,
        rule: r.ruleName ? `${r.ruleName} (v${r.ruleVersion})` : null,
      })),
      pagination: { page: q.page, perPage: q.per_page, total, lastPage: Math.max(1, Math.ceil(total / q.per_page)) },
    };
  }

  /**
   * Extrato de Pontos: só os lançamentos do usuário do token (sellerId = user.id).
   * Saldo é de todo o período; créditos/débitos/estornos são do mês escolhido.
   */
  @Get('me/points')
  async myPoints(@CurrentUser() user: AuthUser, @Query() q: MyPointsQuery) {
    await this.assertMenu(user, '/extrato');
    const month = "strftime('%Y-%m', e.createdAt)";
    const months: string[] = (
      await this.db.query(`SELECT DISTINCT ${month} month FROM point_entries e WHERE e.sellerId = ? ORDER BY month`, [user.id])
    ).map((r: { month: string }) => r.month);
    const current = q.month ?? months.at(-1) ?? 'all';

    // filtros do período (resumo) e da lista (período + aba + campanha)
    const period = ['e.sellerId = ?'];
    const params: (string | number)[] = [user.id];
    if (current !== 'all') {
      period.push(`${month} = ?`);
      params.push(current);
    }
    if (q.campaignId) {
      period.push('e.campaignId = ?');
      params.push(q.campaignId);
    }
    const [[balance], [sum], campaigns] = await Promise.all([
      this.db.query('SELECT COALESCE(SUM(points),0) points FROM point_entries WHERE sellerId = ?', [user.id]),
      this.db.query(
        `SELECT COALESCE(SUM(CASE WHEN ${POINT_TYPE.c} THEN e.points END),0) credits,
                COALESCE(SUM(CASE WHEN ${POINT_TYPE.d} THEN e.points END),0) debits,
                COALESCE(SUM(CASE WHEN ${POINT_TYPE.e} THEN e.points END),0) reversals,
                COALESCE(SUM(e.points),0) net
         FROM point_entries e WHERE ${period.join(' AND ')}`,
        params,
      ),
      this.db.query(
        `SELECT DISTINCT c.id, c.name FROM point_entries e JOIN campaigns c ON c.id = e.campaignId WHERE e.sellerId = ? ORDER BY c.name`,
        [user.id],
      ),
    ]);

    const where = q.type ? [...period, POINT_TYPE[q.type]] : period;
    const from = `FROM point_entries e LEFT JOIN campaigns c ON c.id = e.campaignId LEFT JOIN distributors d ON d.id = e.distributorId WHERE ${where.join(' AND ')}`;
    const [{ total }] = await this.db.query(`SELECT COUNT(*) total ${from}`, params);
    const rows = await this.db.query(
      `SELECT e.id, e.type, e.points, e.origin, e.ruleLabel, e.reason, e.createdAt, e.relatedEntryId, c.name campaignName, d.name distributorName
       ${from} ORDER BY e.createdAt DESC, e.id DESC LIMIT ? OFFSET ?`,
      [...params, q.per_page, (q.page - 1) * q.per_page],
    );
    return {
      month: current,
      months,
      campaigns,
      balance: Number(balance.points),
      summary: { credits: Number(sum.credits), debits: Number(sum.debits), reversals: Number(sum.reversals), net: Number(sum.net) },
      data: rows.map((r: Record<string, unknown>) => ({ ...r, points: Number(r.points) })),
      pagination: { page: q.page, perPage: q.per_page, total: Number(total), lastPage: Math.max(1, Math.ceil(Number(total) / q.per_page)) },
    };
  }

  /** Histórico de pontos: um resumo por mês e o saldo acumulado no fim de cada mês */
  @Get('me/points/history')
  async myPointsHistory(@CurrentUser() user: AuthUser) {
    await this.assertMenu(user, '/extrato/historico');
    const rows: Record<string, string | number>[] = await this.db.query(
      `SELECT strftime('%Y-%m', e.createdAt) month, COUNT(*) count,
              COALESCE(SUM(CASE WHEN ${POINT_TYPE.c} THEN e.points END),0) credits,
              COALESCE(SUM(CASE WHEN ${POINT_TYPE.d} THEN e.points END),0) debits,
              COALESCE(SUM(CASE WHEN ${POINT_TYPE.e} THEN e.points END),0) reversals,
              SUM(e.points) net
       FROM point_entries e WHERE e.sellerId = ? GROUP BY month ORDER BY month`,
      [user.id],
    );
    let balance = 0;
    const months = rows.map((r) => {
      balance += Number(r.net);
      return { month: String(r.month), count: Number(r.count), credits: Number(r.credits), debits: Number(r.debits), reversals: Number(r.reversals), net: Number(r.net), balance };
    });
    const sum = (k: 'credits' | 'debits' | 'reversals' | 'count') => months.reduce((a, m) => a + m[k], 0);
    const [campaigns, sales, reversals] = await Promise.all([
      // pontos por campanha (lançamentos sem campanha ficam de fora)
      this.db.query(
        `SELECT c.id, c.name, c.status, c.startDate, c.endDate, COUNT(*) count, SUM(e.points) points
         FROM point_entries e JOIN campaigns c ON c.id = e.campaignId
         WHERE e.sellerId = ? GROUP BY c.id ORDER BY c.startDate DESC`,
        [user.id],
      ),
      // vendas por competência (só as vigentes; as substituídas por correção não contam)
      this.db.query(
        `SELECT competence, COUNT(*) count, SUM(quantity) quantity, SUM(amountCents) amountCents, SUM(points) points
         FROM sales WHERE sellerId = ? AND status = 'active' GROUP BY competence ORDER BY competence`,
        [user.id],
      ),
      // estornos com o lançamento de origem
      this.db.query(
        `SELECT e.id, e.points, e.reason, e.createdAt, e.actorName, c.name campaignName,
                o.origin originOrigin, o.ruleLabel originRule, o.saleExternalId originSale, o.createdAt originAt, o.points originPoints
         FROM point_entries e LEFT JOIN point_entries o ON o.id = e.relatedEntryId LEFT JOIN campaigns c ON c.id = e.campaignId
         WHERE e.sellerId = ? AND e.type = 'reversal' ORDER BY e.createdAt DESC LIMIT 50`,
        [user.id],
      ),
    ]);
    const nums = (r: Record<string, unknown>, ...keys: string[]) => ({ ...r, ...Object.fromEntries(keys.map((k) => [k, r[k] == null ? null : Number(r[k])])) });
    return {
      balance,
      totals: { credits: sum('credits'), debits: sum('debits'), reversals: sum('reversals'), count: sum('count') },
      months,
      campaigns: campaigns.map((r: Campaign & Record<string, unknown>) => ({ ...nums(r, 'count', 'points'), status: effectiveStatus(r) })),
      sales: sales.map((r: Record<string, unknown>) => nums(r, 'count', 'quantity', 'amountCents', 'points')),
      reversals: reversals.map((r: Record<string, unknown>) => nums(r, 'points', 'originPoints')),
    };
  }

  /**
   * Início: banners e notícias publicados para o usuário (público vazio = todos;
   * senão precisa casar perfil e distribuidora). Os números da tela vêm das rotas
   * de extrato, vendas, metas e ranking, cada uma com a sua permissão de menu.
   */
  @Get('me/home')
  async myHome(@CurrentUser() user: AuthUser) {
    await this.assertMenu(user, '/inicio');
    const today = new Date().toISOString().slice(0, 10);
    type Rec = { id: number; kind: string; title: string; data: string };
    const rows: Rec[] = await this.db.query("SELECT id, kind, title, data FROM records WHERE kind IN ('banner','news') AND status = 'published' ORDER BY id DESC");
    const items = rows.map((r) => ({ ...r, data: JSON.parse(r.data || '{}') })).filter((r) => forMe(user, r.data));
    return {
      banners: items
        .filter((r) => r.kind === 'banner' && (!r.data.startDate || r.data.startDate <= today) && (!r.data.endDate || r.data.endDate >= today))
        .map((r) => ({ id: r.id, title: r.title, image: r.data.image || null, link: r.data.link || null, endDate: r.data.endDate ?? null })),
      news: items
        .filter((r) => r.kind === 'news' && (!r.data.publishAt || r.data.publishAt <= today))
        .sort((a, b) => String(b.data.publishAt ?? '').localeCompare(String(a.data.publishAt ?? '')))
        .slice(0, 4)
        .map((r) => ({ id: r.id, title: r.title, summary: r.data.summary ?? '', publishAt: r.data.publishAt ?? null })),
    };
  }

  /**
   * Ranking: vendedores ativos ordenados pelos pontos lançados no mês (mesmo critério de mês do extrato).
   * Escopo pelo token: geral, distribuidora do usuário ou equipe dele (gerente: as equipes que gerencia).
   * Expõe só nome, distribuidora, equipe e pontos dos outros vendedores.
   */
  @Get('me/ranking')
  async myRanking(@CurrentUser() user: AuthUser, @Query() q: MyRankingQuery) {
    await this.assertMenu(user, '/ranking');
    const db = this.db;
    const month = "strftime('%Y-%m', e.createdAt)";
    const months: string[] = (await db.query(`SELECT DISTINCT ${month} month FROM point_entries e ORDER BY month DESC`)).map((r: { month: string }) => r.month);
    const current = q.month ?? months[0] ?? new Date().toISOString().slice(0, 7);
    const [y, m] = current.split('-').map(Number);
    const previous = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);

    const teamIds: number[] = user.teamId ? [user.teamId] : [];
    if (user.profiles.includes('manager'))
      for (const t of await db.query("SELECT id FROM teams WHERE managerId = ? AND status = 'active'", [user.id])) teamIds.push(Number(t.id));
    const scopes = { all: true, distributor: !!user.distributorId, team: teamIds.length > 0 };
    if (!scopes[q.scope]) throw new ForbiddenException('Você não tem distribuidora/equipe para este ranking.');
    const where = ["u.status = 'active'", `u.profiles LIKE '%"seller"%'`];
    const params: (string | number)[] = [current, previous];
    if (q.scope === 'distributor') {
      where.push('u.distributorId = ?');
      params.push(user.distributorId!);
    }
    if (q.scope === 'team') where.push(`u.teamId IN (${teamIds.map(Number).join(',')})`);

    // pontos do mês e do mês anterior por vendedor; posição com empate pelo nome
    const rows: Record<string, string | number | null>[] = await db.query(
      `WITH p AS (
         SELECT e.sellerId id,
                SUM(CASE WHEN ${month} = ? THEN e.points ELSE 0 END) points,
                SUM(CASE WHEN ${month} = ? THEN e.points ELSE 0 END) previous
         FROM point_entries e GROUP BY e.sellerId
       )
       SELECT u.id, u.name, d.name distributorName, t.name teamName, p.points, p.previous,
              ROW_NUMBER() OVER (ORDER BY p.points DESC, u.name) position
       FROM users u JOIN p ON p.id = u.id
       LEFT JOIN distributors d ON d.id = u.distributorId LEFT JOIN teams t ON t.id = u.teamId
       WHERE ${where.join(' AND ')} AND p.points > 0
       ORDER BY position`,
      params,
    );
    const row = (r: (typeof rows)[number]) => {
      const points = Number(r.points), prev = Number(r.previous);
      return {
        position: Number(r.position), id: Number(r.id), name: String(r.name), distributorName: r.distributorName, teamName: r.teamName, points,
        evolution: prev > 0 ? Math.round(((points - prev) / prev) * 1000) / 10 : null,
        me: Number(r.id) === user.id,
      };
    };
    const mine = rows.find((r) => Number(r.id) === user.id);
    return {
      month: current,
      months,
      scope: q.scope,
      scopes,
      kpis: {
        sellers: rows.length,
        distributors: new Set(rows.map((r) => r.distributorName)).size,
        points: rows.reduce((a, r) => a + Number(r.points), 0),
      },
      top: rows.slice(0, 50).map(row),
      me: mine ? row(mine) : null,
    };
  }

  /**
   * Minhas Metas. A meta é da equipe por competência (team_goals); para o vendedor
   * mostra a contribuição dele na equipe e o bônus recebido quando a equipe bate a meta.
   * Equipes do usuário: vendedor → a própria; gerente → as que gerencia;
   * ponto focal → as da distribuidora. Tudo a partir do token.
   */
  @Get('me/goals')
  async myGoals(@CurrentUser() user: AuthUser, @Query() q: MyGoalsQuery) {
    await this.assertMenu(user, '/metas');
    const db = this.db;
    const ids = new Set<number>();
    if (user.profiles.includes('seller') && user.teamId) ids.add(user.teamId);
    if (user.profiles.includes('manager'))
      for (const t of await db.query('SELECT id FROM teams WHERE managerId = ? AND status = \'active\'', [user.id])) ids.add(Number(t.id));
    if (user.profiles.includes('focal') && user.distributorId)
      for (const t of await db.query('SELECT id FROM teams WHERE distributorId = ? AND status = \'active\'', [user.distributorId])) ids.add(Number(t.id));
    const teamIds = [...ids];
    const isSeller = user.profiles.includes('seller') && !!user.teamId;
    const inList = teamIds.length ? teamIds.join(',') : '-1';

    const competences: string[] = (
      await db.query(
        `SELECT competence FROM team_goals WHERE teamId IN (${inList})
         UNION SELECT DISTINCT s.competence FROM sales s JOIN users u ON u.id = s.sellerId WHERE u.teamId IN (${inList}) AND s.status = 'active'
         ORDER BY competence`,
      )
    ).map((r: { competence: string }) => r.competence);
    const competence = q.competence ?? [...competences].reverse().find((c) => c <= new Date().toISOString().slice(0, 7)) ?? competences.at(-1) ?? new Date().toISOString().slice(0, 7);

    const [rule] = await db.query(
      `SELECT value FROM point_rules WHERE calcType = 'goal_bonus' AND status = 'active' AND startDate <= ? AND endDate >= ? ORDER BY priority DESC LIMIT 1`,
      [`${competence}-28`, `${competence}-01`],
    );

    // por equipe e competência: meta, vendido, membros ativos e se o bônus foi lançado
    const perTeam = async (comp: string): Promise<TeamGoalRow[]> =>
      (
        await db.query(
          `SELECT t.id teamId, t.name, d.name distributorName, mgr.name managerName,
             (SELECT goalCents FROM team_goals g WHERE g.teamId = t.id AND g.competence = ?) goalCents,
             (SELECT COALESCE(SUM(s.amountCents),0) FROM sales s JOIN users u ON u.id = s.sellerId
               WHERE u.teamId = t.id AND s.status = 'active' AND s.competence = ?) soldCents,
             (SELECT COUNT(*) FROM users u WHERE u.teamId = t.id AND u.status = 'active' AND u.profiles LIKE '%seller%') members,
             (SELECT COUNT(*) FROM point_entries e WHERE e.bonusKey = 'GOAL:' || ? || ':T' || t.id) bonusEntries
           FROM teams t JOIN distributors d ON d.id = t.distributorId LEFT JOIN users mgr ON mgr.id = t.managerId
           WHERE t.id IN (${inList}) ORDER BY t.name`,
          [comp, comp, comp],
        )
      ).map((r: Record<string, string | number | null>) => {
        const goalCents = r.goalCents == null ? null : Number(r.goalCents);
        const soldCents = Number(r.soldCents);
        return {
          teamId: Number(r.teamId),
          name: String(r.name),
          distributorName: r.distributorName,
          managerName: r.managerName,
          goalCents,
          soldCents,
          members: Number(r.members),
          percent: goalCents ? Math.round((soldCents / goalCents) * 1000) / 10 : null,
          reached: !!goalCents && soldCents >= goalCents,
          bonusLaunched: Number(r.bonusEntries) > 0,
        };
      });

    const mySold = async (comp: string) =>
      Number((await db.query(`SELECT COALESCE(SUM(amountCents),0) v FROM sales WHERE sellerId = ? AND status = 'active' AND competence = ?`, [user.id, comp]))[0].v);
    const myBonus = async (comp: string) =>
      Number((await db.query(`SELECT COALESCE(SUM(points),0) v FROM point_entries WHERE sellerId = ? AND bonusKey LIKE ?`, [user.id, `GOAL:${comp}:%`]))[0].v);

    const teams = await perTeam(competence);
    let me = null;
    if (isSeller) {
      const team = teams.find((t) => t.teamId === user.teamId)!;
      const soldCents = await mySold(competence);
      // ponytail: sem meta individual no modelo (a meta é da equipe); mostra a contribuição do vendedor
      me = {
        teamId: user.teamId,
        soldCents,
        shareOfTeam: team?.soldCents ? Math.round((soldCents / team.soldCents) * 1000) / 10 : 0,
        bonusPoints: await myBonus(competence),
      };
    }

    // histórico: soma das equipes do usuário (e a parte dele, se for vendedor)
    const history = [];
    for (const comp of competences) {
      const list = await perTeam(comp);
      const withGoal = list.filter((t) => t.goalCents != null);
      const row: Record<string, unknown> = {
        competence: comp,
        goalCents: withGoal.reduce((a, t) => a + (t.goalCents ?? 0), 0),
        soldCents: withGoal.reduce((a, t) => a + t.soldCents, 0),
        teams: list.length,
        reachedTeams: list.filter((t) => t.reached).length,
      };
      if (isSeller) {
        const team = list.find((t) => t.teamId === user.teamId);
        row.mySoldCents = await mySold(comp);
        row.teamReached = !!team?.reached;
        row.bonusPoints = await myBonus(comp);
      }
      history.push(row);
    }

    // campanhas em que o usuário está no público e na distribuidora
    const campaigns = (await db.query(`SELECT * FROM campaigns WHERE status != 'draft' ORDER BY endDate DESC`))
      .map((c: Campaign) => ({ ...c, status: effectiveStatus(c) }))
      .filter((c: { status: string; audience: string; distributorIds: string }) => {
        if (c.status === 'scheduled') return false;
        const audience: string[] = JSON.parse(c.audience || '[]');
        const dists: number[] = JSON.parse(c.distributorIds || '[]');
        return (!audience.length || audience.some((p) => user.profiles.includes(p as ProfileKey))) && (!dists.length || (user.distributorId != null && dists.includes(user.distributorId)));
      });
    const campaignRows = [];
    for (const c of campaigns) {
      // vendas no período da campanha, nas distribuidoras e produtos dela (vazio = todos)
      const dists: number[] = JSON.parse(c.distributorIds || '[]');
      const prods: number[] = JSON.parse(c.productIds || '[]');
      const where = ["status = 'active'", 'date >= ?', 'date <= ?'];
      if (dists.length) where.push(`distributorId IN (${dists.map(Number).join(',')})`);
      if (prods.length) where.push(`productId IN (${prods.map(Number).join(',')})`);
      const [r] = await db.query(
        `SELECT COALESCE(SUM(amountCents),0) total,
                COALESCE(SUM(CASE WHEN sellerId = ? THEN amountCents ELSE 0 END),0) mine,
                COALESCE(SUM(CASE WHEN sellerId = ? THEN points ELSE 0 END),0) myPoints
         FROM sales WHERE ${where.join(' AND ')}`,
        [user.id, user.id, c.startDate, c.endDate],
      );
      campaignRows.push({
        id: c.id,
        name: c.name,
        status: c.status,
        startDate: c.startDate,
        endDate: c.endDate,
        goalCents: Number(c.goalCents),
        soldCents: Number(r.total),
        percent: Number(c.goalCents) ? Math.round((Number(r.total) / Number(c.goalCents)) * 1000) / 10 : null,
        mySoldCents: Number(r.mine),
        myPoints: Number(r.myPoints),
      });
    }

    return {
      competence,
      competences,
      view: isSeller ? 'seller' : 'teams',
      bonusPoints: rule ? Number(rule.value) : null,
      me,
      teams,
      history,
      campaigns: campaignRows,
    };
  }

  /** treinamentos publicados para o usuário (mesma regra de público do Início) */
  private async trainings(user: AuthUser, id?: number) {
    type Rec = { id: number; title: string; data: string };
    const rows: Rec[] = await this.db.query(
      `SELECT id, title, data FROM records WHERE kind = 'training' AND status = 'published'${id ? ' AND id = ?' : ''} ORDER BY id`,
      id ? [id] : [],
    );
    return rows.map((r) => ({ id: r.id, title: r.title, data: JSON.parse(r.data || '{}') })).filter((r) => forMe(user, r.data));
  }

  private async course(user: AuthUser, id: number) {
    const [t] = await this.trainings(user, id);
    if (!t) throw new NotFoundException('Treinamento não encontrado');
    return t;
  }

  private async progressOf(user: AuthUser, trainingId: number) {
    return (await this.progress.findOneBy({ userId: user.id, trainingId })) ?? this.progress.create({ userId: user.id, trainingId, lessonsDone: [], favorite: false, completedAt: null });
  }

  /**
   * Treinamentos: cursos com módulos e aulas, e o progresso do usuário (aulas assistidas,
   * favorito, conclusão). Pontos do curso entram no extrato uma única vez, ao concluir.
   */
  @Get('me/trainings')
  async myTrainings(@CurrentUser() user: AuthUser) {
    await this.assertMenu(user, '/treinamentos');
    const list = await this.trainings(user);
    const mine = new Map((await this.progress.findBy({ userId: user.id })).map((p) => [p.trainingId, p]));
    const courses = list.map(({ id, title, data }) => {
      const modules = lessonsOf(data.modules);
      const keys = modules.flatMap((m) => m.lessons.map((l) => l.key));
      const p = mine.get(id);
      const done = keys.filter((k) => p?.lessonsDone.includes(k)).length;
      return {
        id,
        title,
        description: data.description ?? '',
        image: data.image || null,
        category: data.category || null,
        points: Number(data.points) || 0,
        certificate: !!data.certificate,
        workloadHours: Number(data.workloadHours) || null,
        minutes: modules.reduce((s, m) => s + m.lessons.reduce((t, l) => t + (l.minutes ?? 0), 0), 0),
        modules,
        lessons: keys.length,
        done,
        percent: keys.length ? Math.round((done / keys.length) * 100) : 0,
        lessonsDone: p?.lessonsDone ?? [],
        favorite: !!p?.favorite,
        completedAt: p?.completedAt ?? null,
      };
    });
    const [{ v }] = await this.db.query('SELECT COALESCE(SUM(points),0) v FROM point_entries WHERE sellerId = ?', [user.id]);
    return { balance: Number(v), courses };
  }

  @Post('me/trainings/:id/lessons')
  @HttpCode(200)
  async markLesson(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() body: LessonDto) {
    await this.assertMenu(user, '/treinamentos');
    const t = await this.course(user, id);
    const keys = lessonsOf(t.data.modules).flatMap((m) => m.lessons.map((l) => l.key));
    if (!keys.includes(body.key)) throw new NotFoundException('Aula não encontrada');
    return this.db.transaction(async (m) => {
      const p = await this.progressOf(user, id);
      p.lessonsDone = body.done ? [...new Set([...p.lessonsDone, body.key])] : p.lessonsDone.filter((k) => k !== body.key);
      let earned = 0;
      // concluído uma vez fica concluído (desmarcar aula depois não tira os pontos)
      if (!p.completedAt && keys.every((k) => p.lessonsDone.includes(k))) {
        p.completedAt = new Date();
        const points = Number(t.data.points) || 0;
        const bonusKey = `TRAIN:${id}:U${user.id}`;
        if (points > 0 && !(await m.existsBy(PointEntry, { bonusKey }))) {
          await m.insert(PointEntry, {
            sellerId: user.id,
            sellerName: user.name,
            distributorId: user.distributorId ?? null,
            campaignId: null,
            type: 'bonus',
            points,
            origin: `Treinamento: ${t.title}`,
            bonusKey,
            reason: 'Treinamento concluído',
            actorName: user.name,
          });
          earned = points;
        }
      }
      await m.save(p);
      return { lessonsDone: p.lessonsDone, completedAt: p.completedAt, earned };
    });
  }

  @Post('me/trainings/:id/favorite')
  @HttpCode(200)
  async favorite(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() body: FavoriteDto) {
    await this.assertMenu(user, '/treinamentos');
    await this.course(user, id);
    const p = await this.progressOf(user, id);
    p.favorite = body.favorite;
    await this.progress.save(p);
    return { favorite: p.favorite };
  }

  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    const tree = await this.visibleMenu(user);
    const distributor = user.distributorId ? await this.distributors.findOneBy({ id: user.distributorId }) : null;
    return {
      user: { ...toApiUser(user), distributorName: distributor?.name ?? null },
      home: HOME.find(([p]) => user.profiles.includes(p))?.[1] ?? '/inicio',
      items: tree.map(slim),
    };
  }
}
