import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { DataSource } from 'typeorm';
import { AuthUser, CurrentUser, Perm } from './auth';
import { applyPeriod, PageQuery, paginate, teamGoalSql } from './common';
import { AuditLog, Campaign } from './entities';
import { effectiveStatus } from './points';
import {
  and,
  campaignWindow,
  DEFAULT_FROM,
  DEFAULT_TO,
  distWhere,
  inList,
  prevMonth,
  ReportFilters,
  salesWhere,
  scopeOf,
  ScopeInfo,
  TODAY,
} from './reports.scope';

class ActivityQuery extends PageQuery {
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsString() actor?: string;
}

type Row = Record<string, string | number | null>;
const n = (v: unknown) => Number(v ?? 0);

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly db: DataSource) {}

  /** tudo do dashboard numa chamada; números respeitam o escopo do usuário */
  @Get()
  async overview(@CurrentUser() u: AuthUser, @Query() f: ReportFilters) {
    const scope = await scopeOf(this.db, u);
    const s = await salesWhere(this.db, scope, f);
    const q = (sql: string, params: unknown[] = s.params) => this.db.query(sql, params) as Promise<Row[]>;
    const from = f.from ?? DEFAULT_FROM;
    const to = f.to ?? DEFAULT_TO;

    const byMonth = await q(
      `SELECT s.competence, SUM(s.amountCents) amountCents, SUM(s.quantity) quantity, SUM(s.points) points, COUNT(*) sales
       FROM sales s ${and(s.where)} GROUP BY s.competence ORDER BY s.competence`,
    );
    const last = byMonth.at(-1);
    const previous = last ? byMonth.find((m) => m.competence === prevMonth(String(last.competence))) : undefined;

    const ranking = await q(
      `SELECT d.id, d.name, SUM(s.amountCents) amountCents, SUM(s.points) points
       FROM sales s JOIN distributors d ON d.id = s.distributorId ${and(s.where)}
       GROUP BY d.id ORDER BY amountCents DESC LIMIT 10`,
    );
    const byProduct = await q(
      `SELECT p.id, p.name, SUM(s.amountCents) amountCents, SUM(s.quantity) quantity
       FROM sales s JOIN products p ON p.id = s.productId ${and(s.where)}
       GROUP BY p.id ORDER BY amountCents DESC`,
    );

    // pessoas / distribuidoras no escopo
    const userW = distWhere(scope, 'u.distributorId', f);
    if (scope.teams) userW.push(`(u.teamId IN (${inList(scope.teams)}) OR u.id = ${u.id})`);
    const [people] = await q(
      `SELECT SUM(u.profiles LIKE '%"seller"%' AND u.status = 'active') sellers,
              SUM(u.profiles LIKE '%"manager"%' AND u.status = 'active') managers
       FROM users u ${and(userW)}`,
      [],
    );
    const [dists] = await q(`SELECT COUNT(*) total FROM distributors d ${and([...distWhere(scope, 'd.id', f), "d.status = 'active'"])}`, []);
    const [pending] = await q(
      `SELECT COUNT(*) total FROM import_batches b ${and([...distWhere(scope, 'b.distributorId', f), "b.status IN ('with_errors','awaiting_confirmation')"])}`,
      [],
    );

    // metas: equipes do escopo com vendas ≥ meta na última competência
    const goalMonth = String(last?.competence ?? to);
    const teamW = distWhere(scope, 't.distributorId', f);
    if (scope.teams) teamW.push(`t.id IN (${inList(scope.teams)})`);
    teamW.push("t.status = 'active'", `${teamGoalSql('t', goalMonth)} > 0`);
    const teams = await q(
      `SELECT t.id, ${teamGoalSql('t', goalMonth)} goalCents,
         (SELECT COALESCE(SUM(s.amountCents),0) FROM sales s JOIN users su ON su.id = s.sellerId
          WHERE su.teamId = t.id AND s.status = 'active' AND s.competence = ?) amountCents
       FROM teams t ${and(teamW)}`,
      [goalMonth],
    );

    // campanhas: vendas na janela de cada campanha vs meta
    const campaigns = (await this.db.getRepository(Campaign).find({ order: { startDate: 'ASC' } })).map((c) => ({ ...c, status: effectiveStatus(c) }));
    const base = await salesWhere(this.db, scope, { ...f, campaignId: undefined }, false);
    const campaignPerf = [];
    for (const c of campaigns.filter((c) => ['active', 'ended', 'paused'].includes(c.status))) {
      if (f.campaignId && c.id !== f.campaignId) continue;
      const [r] = await q(`SELECT COALESCE(SUM(s.amountCents),0) amountCents FROM sales s ${and([...base.where, ...campaignWindow(c)])}`, base.params);
      campaignPerf.push({ id: c.id, name: c.name, status: c.status, amountCents: n(r.amountCents), goalCents: c.goalCents });
    }

    const batchW = distWhere(scope, 'b.distributorId', f);
    const lastImports = await q(
      `SELECT b.id, b.distributorName, b.competence, b.fileName, b.status, b.total, b.valid, b.invalid, b.createdAt
       FROM import_batches b ${and(batchW)} ORDER BY b.createdAt DESC, b.id DESC LIMIT 6`,
      [],
    );
    const alerts = await q(
      `SELECT b.id, b.distributorName, b.competence, b.status, b.invalid, b.error, b.createdAt
       FROM import_batches b ${and([...batchW, "b.status IN ('with_errors','failed')"])} ORDER BY b.createdAt DESC LIMIT 6`,
      [],
    );
    const missingComp = DEFAULT_TO;
    const missing = await q(
      `SELECT d.id, d.name, d.code, d.region,
         (SELECT MAX(b.competence) FROM import_batches b WHERE b.distributorId = d.id AND b.status = 'done') lastCompetence
       FROM distributors d
       ${and([...distWhere(scope, 'd.id', f), "d.status = 'active'", `NOT EXISTS (SELECT 1 FROM import_batches b WHERE b.distributorId = d.id AND b.competence = '${missingComp}' AND b.status NOT IN ('failed','replaced'))`])}
       ORDER BY d.name`,
      [],
    );
    const limit = new Date(new Date(TODAY).getTime() + 30 * 864e5).toISOString().slice(0, 10);
    const ending = campaigns
      .filter((c) => ['active', 'paused'].includes(c.status) && c.endDate >= TODAY && c.endDate <= limit)
      .map((c) => ({ id: c.id, name: c.name, endDate: c.endDate, daysLeft: Math.round((Date.parse(c.endDate) - Date.parse(TODAY)) / 864e5) }));

    // atividades administrativas: só para quem vê relatórios/auditoria
    const activities = u.permissions.includes('REPORTS_VIEW')
      ? await this.db.getRepository(AuditLog).find({ order: { createdAt: 'DESC', id: 'DESC' }, take: 8 })
      : [];

    return {
      period: { from, to },
      cards: {
        sellers: n(people?.sellers),
        managers: n(people?.managers),
        activeDistributors: n(dists?.total),
        monthSales: {
          competence: last?.competence ?? null,
          amountCents: n(last?.amountCents),
          previousCents: n(previous?.amountCents),
          variation: previous && n(previous.amountCents) ? (n(last?.amountCents) - n(previous.amountCents)) / n(previous.amountCents) : null,
        },
        points: byMonth.reduce((sum, m) => sum + n(m.points), 0),
        activeCampaigns: campaigns.filter((c) => c.status === 'active').length,
        pendingFiles: n(pending?.total),
        goals: { competence: goalMonth, hit: teams.filter((t) => n(t.amountCents) >= n(t.goalCents)).length, total: teams.length },
      },
      salesByMonth: byMonth.map((m) => ({ competence: m.competence, amountCents: n(m.amountCents), quantity: n(m.quantity), sales: n(m.sales), points: n(m.points) })),
      distributorRanking: ranking.map((r) => ({ id: r.id, name: r.name, amountCents: n(r.amountCents), points: n(r.points) })),
      salesByProduct: byProduct.map((r) => ({ id: r.id, name: r.name, amountCents: n(r.amountCents), quantity: n(r.quantity) })),
      campaignPerformance: campaignPerf,
      lastImports,
      alerts,
      activities,
      endingCampaigns: ending,
      missingDistributors: { competence: missingComp, items: missing },
    };
  }

  /** pendências acionáveis da Central de atividades */
  @Perm('REPORTS_VIEW')
  @Get('pending')
  async pending(@CurrentUser() u: AuthUser) {
    const scope = await scopeOf(this.db, u);
    const batches = await this.db.query(
      `SELECT b.id, b.distributorName, b.competence, b.fileName, b.status, b.invalid, b.valid, b.createdAt
       FROM import_batches b ${and([...distWhere(scope, 'b.distributorId'), "b.status IN ('with_errors','awaiting_confirmation','failed')"])}
       ORDER BY b.createdAt DESC LIMIT 20`,
    );
    const records = await this.db.query(
      `SELECT id, kind, title, status, data, createdAt FROM records
       WHERE (kind = 'ticket' AND status IN ('open','in_progress')) OR (kind = 'redemption' AND status = 'requested')
       ORDER BY createdAt DESC LIMIT 20`,
    );
    return {
      batches,
      tickets: records.filter((r: Row) => r.kind === 'ticket').map(parseData),
      redemptions: records.filter((r: Row) => r.kind === 'redemption').map(parseData),
    };
  }

  /** tipos de entidade presentes na auditoria (filtro do feed) */
  @Perm('REPORTS_VIEW')
  @Get('activity-types')
  async activityTypes() {
    const rows: Row[] = await this.db.query(`SELECT targetType type, COUNT(*) total FROM audit_logs GROUP BY targetType ORDER BY total DESC`);
    return rows.map((r) => ({ type: r.type, total: n(r.total) }));
  }

  /** feed da auditoria (mesmo dado de /audit, com filtro por tipo e ator) */
  @Perm('REPORTS_VIEW')
  @Get('activity')
  activity(@Query() q: ActivityQuery) {
    const qb = applyPeriod(this.db.getRepository(AuditLog).createQueryBuilder('a'), q);
    qb.addOrderBy('a.id', 'DESC');
    if (q.type) qb.andWhere('a.targetType = :t', { t: q.type });
    if (q.actor) qb.andWhere('a.actorName LIKE :n', { n: `%${q.actor}%` });
    if (q.search) qb.andWhere('a.description LIKE :s', { s: `%${q.search}%` });
    return paginate(qb, q);
  }
}

const parseData = (r: Row) => ({ ...r, data: JSON.parse(String(r.data ?? '{}')) });

// ---------------------------------------------------------------- relatórios

type ColType = 'text' | 'int' | 'cents' | 'pct' | 'date' | 'datetime' | 'status' | 'competence';
type Report = {
  title: string;
  views?: { key: string; label: string }[];
  view?: string;
  columns: { key: string; label: string; type: ColType }[];
  rows: Row[];
  chart?: { type: 'area' | 'bar' | 'hbar'; x: string; series: { key: string; label: string; type: ColType }[] };
  filters: ('period' | 'distributor' | 'campaign')[];
  truncated?: boolean;
};

const MAX_ROWS = 5000;
const col = (key: string, label: string, type: ColType = 'text') => ({ key, label, type });

@Controller('reports')
export class ReportsController {
  constructor(private readonly db: DataSource) {}

  @Perm('REPORTS_VIEW')
  @Get(':kind')
  async report(@CurrentUser() u: AuthUser, @Param('kind') kind: string, @Query() f: ReportFilters): Promise<Report> {
    const scope = await scopeOf(this.db, u);
    const fn = (this as unknown as Record<string, (s: ScopeInfo, f: ReportFilters) => Promise<Report>>)[`r_${kind}`];
    if (!fn) throw new BadRequestException(`Relatório desconhecido: ${kind}`);
    const r = await fn.call(this, scope, f);
    const truncated = r.rows.length > MAX_ROWS;
    return { ...r, rows: r.rows.slice(0, MAX_ROWS), truncated };
  }

  private q(sql: string, params: unknown[] = []) {
    return this.db.query(sql, params) as Promise<Row[]>;
  }

  async r_vendas(scope: ScopeInfo, f: ReportFilters): Promise<Report> {
    const s = await salesWhere(this.db, scope, f);
    const views = [
      { key: 'periodo', label: 'Por período' },
      { key: 'distribuidora', label: 'Por distribuidora' },
      { key: 'vendedor', label: 'Por vendedor' },
    ];
    const view = f.view ?? 'periodo';
    const base = { title: 'Vendas', views, view, filters: ['period', 'distributor', 'campaign'] as Report['filters'] };
    const metrics = `SUM(s.amountCents) amountCents, SUM(s.quantity) quantity, COUNT(*) sales, SUM(s.points) points`;
    const metricCols = [col('amountCents', 'Vendas', 'cents'), col('quantity', 'Unidades', 'int'), col('sales', 'Notas', 'int'), col('points', 'Pontos', 'int')];
    if (view === 'distribuidora')
      return {
        ...base,
        columns: [col('name', 'Distribuidora'), col('region', 'Região'), ...metricCols],
        rows: await this.q(`SELECT d.id, d.name, d.region, ${metrics} FROM sales s JOIN distributors d ON d.id = s.distributorId ${and(s.where)} GROUP BY d.id ORDER BY amountCents DESC`, s.params),
        chart: { type: 'hbar', x: 'name', series: [{ key: 'amountCents', label: 'Vendas', type: 'cents' }] },
      };
    if (view === 'vendedor')
      return {
        ...base,
        columns: [col('name', 'Vendedor'), col('distributor', 'Distribuidora'), col('team', 'Equipe'), ...metricCols],
        rows: await this.q(
          `SELECT u.id, u.name, d.name distributor, t.name team, ${metrics}
           FROM sales s JOIN users u ON u.id = s.sellerId JOIN distributors d ON d.id = s.distributorId LEFT JOIN teams t ON t.id = u.teamId
           ${and(s.where)} GROUP BY u.id ORDER BY amountCents DESC LIMIT ${MAX_ROWS + 1}`,
          s.params,
        ),
        chart: { type: 'hbar', x: 'name', series: [{ key: 'amountCents', label: 'Vendas', type: 'cents' }] },
      };
    return {
      ...base,
      columns: [col('competence', 'Competência', 'competence'), ...metricCols],
      rows: await this.q(`SELECT s.competence id, s.competence, ${metrics} FROM sales s ${and(s.where)} GROUP BY s.competence ORDER BY s.competence`, s.params),
      chart: { type: 'area', x: 'competence', series: [{ key: 'amountCents', label: 'Vendas', type: 'cents' }] },
    };
  }

  async r_desempenho(scope: ScopeInfo, f: ReportFilters): Promise<Report> {
    const views = [
      { key: 'gerentes', label: 'Gerentes' },
      { key: 'metas', label: 'Metas atingidas' },
    ];
    const view = f.view ?? 'gerentes';
    const month = f.to ?? DEFAULT_TO;
    const teamW = distWhere(scope, 't.distributorId', f);
    if (scope.teams) teamW.push(`t.id IN (${inList(scope.teams)})`);
    const teamSales = `(SELECT COALESCE(SUM(s.amountCents),0) FROM sales s JOIN users su ON su.id = s.sellerId WHERE su.teamId = t.id AND s.status = 'active' AND s.competence = ?)`;
    const base = { title: 'Desempenho', views, view, filters: ['period', 'distributor'] as Report['filters'] };
    if (view === 'metas') {
      const rows = await this.q(
        `SELECT t.id, t.name, d.name distributor, m.name manager, ${teamGoalSql('t', month)} goalCents, ${teamSales} amountCents
         FROM teams t JOIN distributors d ON d.id = t.distributorId LEFT JOIN users m ON m.id = t.managerId ${and(teamW)} ORDER BY t.name`,
        [month],
      );
      for (const r of rows) {
        r.pct = n(r.goalCents) ? n(r.amountCents) / n(r.goalCents) : null;
        r.status = !n(r.goalCents) ? 'Sem meta' : n(r.amountCents) >= n(r.goalCents) ? 'Atingida' : 'Não atingida';
      }
      rows.sort((a, b) => n(b.pct) - n(a.pct));
      return {
        ...base,
        title: `Metas atingidas · ${month}`,
        columns: [col('name', 'Equipe'), col('distributor', 'Distribuidora'), col('manager', 'Gerente'), col('goalCents', 'Meta', 'cents'), col('amountCents', 'Vendas', 'cents'), col('pct', '% da meta', 'pct'), col('status', 'Situação')],
        rows,
        chart: { type: 'hbar', x: 'name', series: [{ key: 'pct', label: '% da meta', type: 'pct' }] },
      };
    }
    const rows = await this.q(
      `SELECT m.id, m.name, d.name distributor, COUNT(t.id) teams, SUM(${teamGoalSql('t', month)}) goalCents,
         SUM(${teamSales}) amountCents,
         (SELECT COUNT(*) FROM users su WHERE su.managerId = m.id AND su.status = 'active') sellers
       FROM teams t JOIN users m ON m.id = t.managerId JOIN distributors d ON d.id = m.distributorId
       ${and(teamW)} GROUP BY m.id ORDER BY amountCents DESC`,
      [month],
    );
    for (const r of rows) r.pct = n(r.goalCents) ? n(r.amountCents) / n(r.goalCents) : null;
    return {
      ...base,
      title: `Desempenho dos gerentes · ${month}`,
      columns: [col('name', 'Gerente'), col('distributor', 'Distribuidora'), col('teams', 'Equipes', 'int'), col('sellers', 'Vendedores', 'int'), col('goalCents', 'Meta do mês', 'cents'), col('amountCents', 'Vendas do mês', 'cents'), col('pct', '% da meta', 'pct')],
      rows,
      chart: { type: 'hbar', x: 'name', series: [{ key: 'pct', label: '% da meta', type: 'pct' }] },
    };
  }

  async r_pontuacao(scope: ScopeInfo, f: ReportFilters): Promise<Report> {
    const views = [
      { key: 'mensal', label: 'Por tipo e mês' },
      { key: 'lancamentos', label: 'Estornos, ajustes e bônus' },
    ];
    const view = f.view ?? 'mensal';
    const w = distWhere(scope, 'e.distributorId', f);
    if (scope.teams) w.push(`e.sellerId IN (SELECT id FROM users WHERE teamId IN (${inList(scope.teams)}))`);
    if (scope.ownId) w.push(`e.sellerId = ${Number(scope.ownId)}`);
    if (f.campaignId) w.push(`e.campaignId = ${Number(f.campaignId)}`);
    w.push(`strftime('%Y-%m', e.createdAt) BETWEEN ? AND ?`);
    const params = [f.from ?? DEFAULT_FROM, f.to ?? '2026-10'];
    const base = { title: 'Pontuação', views, view, filters: ['period', 'distributor', 'campaign'] as Report['filters'] };
    if (view === 'lancamentos')
      return {
        ...base,
        columns: [col('createdAt', 'Data', 'datetime'), col('type', 'Tipo'), col('sellerName', 'Vendedor'), col('points', 'Pontos', 'int'), col('origin', 'Origem'), col('reason', 'Justificativa'), col('actorName', 'Responsável')],
        rows: await this.q(
          `SELECT e.id, e.createdAt, CASE e.type WHEN 'reversal' THEN 'Estorno' WHEN 'adjustment' THEN 'Ajuste' WHEN 'bonus' THEN 'Bônus' WHEN 'debit' THEN 'Débito' ELSE e.type END type,
             e.sellerName, e.points, e.origin, e.reason, e.actorName
           FROM point_entries e ${and([...w, "e.type <> 'credit'"])} ORDER BY e.createdAt DESC LIMIT ${MAX_ROWS + 1}`,
          params,
        ),
      };
    const rows = await this.q(
      `SELECT strftime('%Y-%m', e.createdAt) id, strftime('%Y-%m', e.createdAt) competence,
         SUM(CASE WHEN e.type = 'credit' THEN e.points ELSE 0 END) credit,
         SUM(CASE WHEN e.type = 'bonus' THEN e.points ELSE 0 END) bonus,
         SUM(CASE WHEN e.type = 'adjustment' THEN e.points ELSE 0 END) adjustment,
         SUM(CASE WHEN e.type = 'reversal' THEN e.points ELSE 0 END) reversal,
         SUM(CASE WHEN e.type = 'debit' THEN e.points ELSE 0 END) debit,
         SUM(e.points) net
       FROM point_entries e ${and(w)} GROUP BY competence ORDER BY competence`,
      params,
    );
    return {
      ...base,
      title: 'Pontos por mês de lançamento',
      columns: [col('competence', 'Mês', 'competence'), col('credit', 'Creditados', 'int'), col('bonus', 'Bônus', 'int'), col('adjustment', 'Ajustes', 'int'), col('reversal', 'Estornados', 'int'), col('debit', 'Débitos (resgates)', 'int'), col('net', 'Saldo do mês', 'int')],
      rows,
      chart: { type: 'bar', x: 'competence', series: [{ key: 'credit', label: 'Creditados', type: 'int' }] },
    };
  }

  async r_distribuidoras(scope: ScopeInfo, f: ReportFilters): Promise<Report> {
    const s = await salesWhere(this.db, scope, { ...f, distributorId: undefined }, true);
    const rows = await this.q(
      `SELECT d.id, d.name, d.code, d.region, d.status,
         (SELECT COUNT(*) FROM users u WHERE u.distributorId = d.id AND u.profiles LIKE '%"seller"%' AND u.status = 'active') sellers,
         (SELECT COUNT(*) FROM teams t WHERE t.distributorId = d.id) teams,
         (SELECT COALESCE(SUM(s.amountCents),0) FROM sales s ${and([...s.where, 's.distributorId = d.id'])}) amountCents,
         (SELECT COALESCE(SUM(s.points),0) FROM sales s ${and([...s.where, 's.distributorId = d.id'])}) points,
         (SELECT COUNT(*) FROM import_batches b WHERE b.distributorId = d.id AND b.status = 'done') batches,
         (SELECT MAX(b.competence) FROM import_batches b WHERE b.distributorId = d.id AND b.status = 'done') lastCompetence
       FROM distributors d ${and(distWhere(scope, 'd.id', f))} ORDER BY amountCents DESC`,
      [...s.params, ...s.params],
    );
    return {
      title: 'Distribuidoras',
      filters: ['period', 'distributor', 'campaign'],
      columns: [col('name', 'Distribuidora'), col('code', 'Código'), col('region', 'Região'), col('status', 'Status', 'status'), col('sellers', 'Vendedores', 'int'), col('teams', 'Equipes', 'int'), col('amountCents', 'Vendas', 'cents'), col('points', 'Pontos', 'int'), col('batches', 'Lotes processados', 'int'), col('lastCompetence', 'Último envio', 'competence')],
      rows,
      chart: { type: 'hbar', x: 'name', series: [{ key: 'amountCents', label: 'Vendas', type: 'cents' }] },
    };
  }

  async r_campanhas(scope: ScopeInfo, f: ReportFilters): Promise<Report> {
    const campaigns = (await this.db.getRepository(Campaign).find({ order: { startDate: 'ASC' } })).map((c) => ({ ...c, status: effectiveStatus(c) }));
    const base = await salesWhere(this.db, scope, { ...f, campaignId: undefined }, false);
    const rows: Row[] = [];
    for (const c of campaigns) {
      if (f.campaignId && c.id !== f.campaignId) continue;
      const [r] = await this.q(
        `SELECT COALESCE(SUM(s.amountCents),0) amountCents, COUNT(DISTINCT s.sellerId) participants, COUNT(*) sales
         FROM sales s ${and([...base.where, ...campaignWindow(c)])}`,
        base.params,
      );
      const [p] = await this.q(`SELECT COALESCE(SUM(points),0) points FROM sales s ${and([...base.where, `s.campaignId = ${c.id}`])}`, base.params);
      rows.push({
        id: c.id, name: c.name, status: c.status, startDate: c.startDate, endDate: c.endDate,
        goalCents: c.goalCents, amountCents: n(r.amountCents), pct: c.goalCents ? n(r.amountCents) / c.goalCents : null,
        participants: n(r.participants), sales: n(r.sales), points: n(p.points),
      });
    }
    return {
      title: 'Campanhas',
      filters: ['distributor', 'campaign'],
      columns: [col('name', 'Campanha'), col('status', 'Status', 'status'), col('startDate', 'Início', 'date'), col('endDate', 'Término', 'date'), col('goalCents', 'Meta', 'cents'), col('amountCents', 'Vendas no período', 'cents'), col('pct', '% da meta', 'pct'), col('participants', 'Vendedores com venda', 'int'), col('points', 'Pontos creditados', 'int')],
      rows,
      chart: { type: 'hbar', x: 'name', series: [{ key: 'pct', label: '% da meta', type: 'pct' }] },
    };
  }

  async r_rankings(scope: ScopeInfo, f: ReportFilters): Promise<Report> {
    const views = [
      { key: 'vendedores', label: 'Vendedores' },
      { key: 'equipes', label: 'Equipes' },
      { key: 'distribuidoras', label: 'Distribuidoras' },
    ];
    const view = f.view ?? 'vendedores';
    const s = await salesWhere(this.db, scope, f);
    const m = `SUM(s.points) points, SUM(s.amountCents) amountCents`;
    const sql =
      view === 'equipes'
        ? `SELECT t.id, t.name, d.name distributor, ${m} FROM sales s JOIN users u ON u.id = s.sellerId JOIN teams t ON t.id = u.teamId JOIN distributors d ON d.id = t.distributorId ${and(s.where)} GROUP BY t.id ORDER BY points DESC LIMIT 100`
        : view === 'distribuidoras'
          ? `SELECT d.id, d.name, d.region distributor, ${m} FROM sales s JOIN distributors d ON d.id = s.distributorId ${and(s.where)} GROUP BY d.id ORDER BY points DESC LIMIT 100`
          : `SELECT u.id, u.name, d.name distributor, ${m} FROM sales s JOIN users u ON u.id = s.sellerId JOIN distributors d ON d.id = s.distributorId ${and(s.where)} GROUP BY u.id ORDER BY points DESC LIMIT 100`;
    const rows = await this.q(sql, s.params);
    rows.forEach((r, i) => (r.position = i + 1));
    return {
      title: 'Rankings',
      views,
      view,
      filters: ['period', 'distributor', 'campaign'],
      columns: [col('position', '#', 'int'), col('name', view === 'vendedores' ? 'Vendedor' : view === 'equipes' ? 'Equipe' : 'Distribuidora'), col('distributor', view === 'distribuidoras' ? 'Região' : 'Distribuidora'), col('points', 'Pontos', 'int'), col('amountCents', 'Vendas', 'cents')],
      rows,
      chart: { type: 'hbar', x: 'name', series: [{ key: 'points', label: 'Pontos', type: 'int' }] },
    };
  }

  // ----- só exportação (página Exportações) -----

  async r_importacoes(scope: ScopeInfo, f: ReportFilters): Promise<Report> {
    const w = distWhere(scope, 'b.distributorId', f);
    w.push('b.competence BETWEEN ? AND ?');
    return {
      title: 'Importações',
      filters: ['period', 'distributor'],
      columns: [col('id', 'Lote', 'int'), col('distributorName', 'Distribuidora'), col('competence', 'Competência', 'competence'), col('fileName', 'Arquivo'), col('userName', 'Responsável'), col('createdAt', 'Envio', 'datetime'), col('total', 'Registros', 'int'), col('valid', 'Válidos', 'int'), col('invalid', 'Inválidos', 'int'), col('creditedPoints', 'Pontos', 'int'), col('status', 'Status', 'status')],
      rows: await this.q(`SELECT b.* FROM import_batches b ${and(w)} ORDER BY b.createdAt DESC LIMIT ${MAX_ROWS + 1}`, [f.from ?? DEFAULT_FROM, f.to ?? '2026-12']),
    };
  }

  async r_treinamentos(): Promise<Report> {
    const rows = (await this.q(`SELECT id, title, status, data FROM records WHERE kind = 'training' ORDER BY title`)).map((r) => {
      const d = JSON.parse(String(r.data ?? '{}'));
      return { id: r.id, title: r.title, status: r.status, points: n(d.points), enrolled: n(d.enrolled), completed: n(d.completed), pct: n(d.enrolled) ? n(d.completed) / n(d.enrolled) : null };
    });
    return {
      title: 'Treinamentos',
      filters: [],
      columns: [col('title', 'Treinamento'), col('status', 'Status', 'status'), col('points', 'Pontos por conclusão', 'int'), col('enrolled', 'Inscritos', 'int'), col('completed', 'Concluíram', 'int'), col('pct', 'Taxa de conclusão', 'pct')],
      rows,
      chart: { type: 'hbar', x: 'title', series: [{ key: 'pct', label: 'Taxa de conclusão', type: 'pct' }] },
    };
  }

  async r_premiacoes(): Promise<Report> {
    const rows = (await this.q(`SELECT id, kind, title, status, data, createdAt FROM records WHERE kind IN ('reward','redemption') ORDER BY kind DESC, createdAt DESC`)).map((r) => {
      const d = JSON.parse(String(r.data ?? '{}'));
      return { id: r.id, kind: r.kind === 'reward' ? 'Prêmio (catálogo)' : 'Resgate', title: r.title, status: r.status, points: n(d.points), stock: d.stock ?? null, requestedAt: d.requestedAt ?? null };
    });
    return {
      title: 'Premiações',
      filters: [],
      columns: [col('kind', 'Tipo'), col('title', 'Descrição'), col('status', 'Status', 'status'), col('points', 'Pontos', 'int'), col('stock', 'Estoque', 'int'), col('requestedAt', 'Solicitado em', 'date')],
      rows,
    };
  }
}
