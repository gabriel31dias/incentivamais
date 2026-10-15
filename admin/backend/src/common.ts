import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ObjectLiteral, SelectQueryBuilder } from 'typeorm';

export class PageQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) per_page = 20;
  @IsOptional() @IsDateString() date_from?: string;
  @IsOptional() @IsDateString() date_to?: string;
  @IsOptional() @IsString() order_by?: 'recent' | 'oldest';
  @IsOptional() @IsString() search?: string;
}

export async function paginate<T extends ObjectLiteral>(qb: SelectQueryBuilder<T>, q: PageQuery) {
  const [data, total] = await qb
    .skip((q.page - 1) * q.per_page)
    .take(q.per_page)
    .getManyAndCount();
  return {
    data,
    pagination: {
      page: q.page,
      perPage: q.per_page,
      total,
      lastPage: Math.max(1, Math.ceil(total / q.per_page)),
    },
  };
}

/** createdAt entre date_from e date_to (inclusive, dia inteiro) + ordenação */
export function applyPeriod<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  q: PageQuery,
  column = `${qb.alias}.createdAt`,
) {
  if (q.date_from) qb.andWhere(`${column} >= :date_from`, { date_from: q.date_from.slice(0, 10) });
  if (q.date_to) qb.andWhere(`${column} < date(:date_to, '+1 day')`, { date_to: q.date_to.slice(0, 10) });
  qb.orderBy(column, q.order_by === 'oldest' ? 'ASC' : 'DESC');
  return qb;
}

export const onlyDigits = (value?: string | null) => (value ?? '').replace(/\D/g, '');

/** dado pessoal na listagem: ***.456.789-** */
export const maskCpf = (cpf?: string | null) =>
  cpf && cpf.length === 11 ? `***.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-**` : '—';

/** CPF completo e formatado: 123.456.789-09 */
export const formatCpf = (cpf?: string | null) =>
  cpf && cpf.length === 11 ? cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : '—';

export function isValidCpf(value: string) {
  const cpf = value.replace(/\D/g, '');
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;
  for (const size of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < size; i++) sum += Number(cpf[i]) * (size + 1 - i);
    if (((sum * 10) % 11) % 10 !== Number(cpf[size])) return false;
  }
  return true;
}

/** gera CPF válido a partir de um número (dados fictícios) */
export function fakeCpf(n: number) {
  const base = String(100000000 + ((n * 7919) % 899999999)).slice(0, 9).split('').map(Number);
  for (const size of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < size; i++) sum += base[i] * (size + 1 - i);
    base.push(((sum * 10) % 11) % 10);
  }
  return base.join('');
}

// aceita "1.250,00", "R$ 1250,5", "1250.50" e número vindo do Excel
export function parseAmountCents(value: string): number | null {
  const clean = value.replace(/[^\d,.-]/g, '');
  if (!clean) return null;
  const lastComma = clean.lastIndexOf(',');
  const lastDot = clean.lastIndexOf('.');
  const normalized = lastComma > lastDot ? clean.replace(/\./g, '').replace(',', '.') : clean.replace(/,/g, '');
  const number = Number(normalized);
  return Number.isFinite(number) ? Math.round(number * 100) : null;
}

export const toReais = (cents: number) => Math.round(cents) / 100;

/** lista "1,2,3" da query string → [1,2,3] */
export const idList = (value?: string) =>
  (value ?? '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);

const COMPETENCE = /^\d{4}-\d{2}$/;

/**
 * SQL da meta da equipe numa competência (0 = sem meta definida).
 * `competence` é um literal validado (AAAA-MM) ou uma expressão SQL (ex.: g.competence).
 */
export function teamGoalSql(teamAlias: string, competence: string) {
  const c = COMPETENCE.test(competence) ? `'${competence}'` : competence;
  if (!/^[\w.']+$/.test(c)) throw new Error('competência inválida');
  return `COALESCE((SELECT tg.goalCents FROM team_goals tg WHERE tg.teamId = ${teamAlias}.id AND tg.competence = ${c}), 0)`;
}
