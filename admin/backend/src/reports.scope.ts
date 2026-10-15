// Filtros de escopo + filtros de tela para consultas agregadas (dashboard e relatórios).
// SQL cru com placeholders: as agregações são mais legíveis assim do que em QueryBuilder.
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches } from 'class-validator';
import { DataSource } from 'typeorm';
import { AuthUser, distributorScope, teamScope } from './auth';
import { Campaign, Team } from './entities';

/** hoje na demonstração; vendas vão até a competência 2026-09 */
export const TODAY = '2026-10-14';
export const DEFAULT_FROM = '2026-01';
export const DEFAULT_TO = '2026-09';

export class ReportFilters {
  @IsOptional() @Matches(/^\d{4}-\d{2}$/) from?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}$/) to?: string;
  @IsOptional() @Type(() => Number) @IsInt() distributorId?: number;
  @IsOptional() @Type(() => Number) @IsInt() campaignId?: number;
  @IsOptional() @IsString() view?: string;
}

export type Sql = { where: string[]; params: unknown[] };

const inList = (ids: number[]) => (ids.length ? ids.map(Number).join(',') : 'NULL');

/** quem o usuário enxerga: distribuidoras, equipes e/ou só ele mesmo */
export async function scopeOf(db: DataSource, u: AuthUser) {
  return {
    dists: distributorScope(u),
    teams: await teamScope(db.getRepository(Team), u),
    ownId: u.scope === 'own' ? u.id : null,
  };
}
export type ScopeInfo = Awaited<ReturnType<typeof scopeOf>>;

/** condições para a tabela `sales` (alias s) */
export async function salesWhere(db: DataSource, scope: ScopeInfo, f: ReportFilters, period = true): Promise<Sql> {
  const where = ["s.status = 'active'"];
  const params: unknown[] = [];
  if (scope.dists) where.push(`s.distributorId IN (${inList(scope.dists)})`);
  if (scope.teams) where.push(`s.sellerId IN (SELECT id FROM users WHERE teamId IN (${inList(scope.teams)}))`);
  if (scope.ownId) where.push(`s.sellerId = ${Number(scope.ownId)}`);
  if (f.distributorId) {
    where.push('s.distributorId = ?');
    params.push(f.distributorId);
  }
  if (period) {
    where.push('s.competence BETWEEN ? AND ?');
    params.push(f.from ?? DEFAULT_FROM, f.to ?? DEFAULT_TO);
  }
  if (f.campaignId) {
    const c = await db.getRepository(Campaign).findOneBy({ id: f.campaignId });
    if (c) where.push(...campaignWindow(c));
  }
  return { where, params };
}

/** vendas "da campanha": dentro do período, distribuidoras e produtos dela */
export function campaignWindow(c: Campaign) {
  const w = [`s.date BETWEEN '${c.startDate}' AND '${c.endDate}'`];
  if (c.distributorIds.length) w.push(`s.distributorId IN (${inList(c.distributorIds)})`);
  if (c.productIds.length) w.push(`s.productId IN (${inList(c.productIds)})`);
  return w;
}

/** condição de escopo para tabelas com distributorId (distribuidoras, lotes, usuários) */
export function distWhere(scope: ScopeInfo, column: string, f?: ReportFilters) {
  const w: string[] = [];
  if (scope.dists) w.push(`${column} IN (${inList(scope.dists)})`);
  if (f?.distributorId) w.push(`${column} = ${Number(f.distributorId)}`);
  return w;
}

export const and = (w: string[]) => (w.length ? `WHERE ${w.join(' AND ')}` : '');

/** competência anterior: "2026-01" → "2025-12" */
export function prevMonth(c: string) {
  const [y, m] = c.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

export { inList };
