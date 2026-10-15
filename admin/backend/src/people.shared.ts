// Helpers do módulo de gestão comercial (usuários, distribuidoras, equipes).
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { extname } from 'path';
import { Readable } from 'stream';
import { EntityManager, In, ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import { AuthUser, distributorScope } from './auth';
import { formatCpf } from './common';
import { Distributor, Profile, ProfileKey, SCOPES, Team, User } from './entities';

/** competência atual da demonstração = a mais recente com vendas */
export async function latestCompetence(m: EntityManager): Promise<string> {
  const row = await m.query(`SELECT MAX(competence) AS c FROM sales WHERE status = 'active'`);
  return row[0]?.c ?? new Date().toISOString().slice(0, 7);
}

/** filtro de perfil num campo simple-json (["manager","focal"]) */
export const hasProfile = (alias: string, key: string) => `${alias}.profiles LIKE '%"${key.replace(/[^a-z_]/g, '')}"%'`;

/**
 * Restringe a consulta de usuários ao escopo do ator:
 * organização = todos · distribuidoras = a própria distribuidora ·
 * equipe = equipes que gerencia + quem tem ele como gerente + ele mesmo · próprio = só ele.
 */
export async function scopeUsers<T extends ObjectLiteral>(qb: SelectQueryBuilder<T>, actor: AuthUser, m: EntityManager) {
  const a = qb.alias;
  if (actor.scope === 'organization') return qb;
  if (actor.scope === 'distributors') return qb.andWhere(`${a}.distributorId IN (:...sd)`, { sd: distributorScope(actor)!.concat(-1) });
  if (actor.scope === 'team') {
    const teams = (await m.findBy(Team, { managerId: actor.id })).map((t) => t.id);
    return qb.andWhere(`(${a}.teamId IN (:...st) OR ${a}.managerId = :sm OR ${a}.id = :sm)`, { st: teams.concat(-1), sm: actor.id });
  }
  return qb.andWhere(`${a}.id = :so`, { so: actor.id });
}

export async function ensureUserInScope(m: EntityManager, actor: AuthUser, id: number) {
  const qb = m.createQueryBuilder(User, 'u').where('u.id = :id', { id });
  const user = await (await scopeUsers(qb, actor, m)).getOne();
  if (!user) throw new NotFoundException('Usuário não encontrado');
  return user;
}

/** distribuidora precisa estar no escopo do ator */
export function ensureDistributorInScope(actor: AuthUser, distributorId: number | null | undefined) {
  if (distributorId == null) return;
  const allowed = distributorScope(actor);
  if (allowed && !allowed.includes(distributorId)) throw new ForbiddenException('Distribuidora fora do seu escopo');
}

/**
 * Ninguém concede mais acesso do que tem: cada perfil atribuído/removido
 * precisa ter permissões contidas nas do ator e escopo não maior que o dele.
 */
export async function ensureCanGrant(m: EntityManager, actor: AuthUser, keys: ProfileKey[]) {
  if (!keys.length) return;
  const profiles = await m.findBy(Profile, { key: In(keys) });
  if (profiles.length !== new Set(keys).size) throw new BadRequestException('Perfil inexistente');
  const myScope = SCOPES.indexOf(actor.scope);
  for (const p of profiles) {
    if (p.key === 'super_admin' && !actor.profiles.includes('super_admin'))
      throw new ForbiddenException('Só o Super Admin atribui o perfil Super Admin');
    if (!p.permissions.every((x) => actor.permissions.includes(x)) || SCOPES.indexOf(p.scope) > myScope)
      throw new ForbiddenException(`Você não pode atribuir/alterar o perfil ${p.name}: ele excede suas permissões`);
  }
}

/** resposta de usuário para a API: sem hash, CPF mascarado, com nomes relacionados */
export async function presentUsers(m: EntityManager, users: User[]) {
  const ids = (list: (number | null)[]) => [...new Set(list.filter((v): v is number => v != null))].concat(-1);
  const [dists, teams, managers] = await Promise.all([
    m.find(Distributor, { select: ['id', 'name', 'code'], where: { id: In(ids(users.map((u) => u.distributorId))) } }),
    m.find(Team, { select: ['id', 'name'], where: { id: In(ids(users.map((u) => u.teamId))) } }),
    m.find(User, { select: ['id', 'name'], where: { id: In(ids(users.map((u) => u.managerId))) } }),
  ]);
  const name = <T extends { id: number; name: string }>(list: T[], id: number | null) => list.find((x) => x.id === id)?.name ?? null;
  return users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    // CPF completo para quem tem USERS_VIEW no escopo (pedido do cliente); auditoria segue mascarada
    cpf: formatCpf(u.cpf),
    profiles: u.profiles,
    distributorId: u.distributorId,
    distributorName: name(dists, u.distributorId),
    managerId: u.managerId,
    managerName: name(managers, u.managerId),
    teamId: u.teamId,
    teamName: name(teams, u.teamId),
    status: u.blocked ? 'blocked' : u.status,
    blocked: u.blocked,
    lastAccessAt: u.lastAccessAt,
    mfaEnabled: u.totpEnabled,
    createdAt: u.createdAt,
  }));
}

/** retrato do usuário para auditoria (sem hash nem CPF) */
export const snapshot = (u: User) => ({
  name: u.name,
  email: u.email,
  profiles: u.profiles,
  distributorId: u.distributorId,
  managerId: u.managerId,
  teamId: u.teamId,
  status: u.status,
  blocked: u.blocked,
});

/** senha temporária legível: 3 letras + 4 dígitos + símbolo */
export function tempPassword() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';
  const pick = (s: string) => s[Math.floor(Math.random() * s.length)];
  return `${pick(letters)}${pick(letters)}${pick(letters)}${Math.floor(1000 + Math.random() * 9000)}${pick('!@#$%')}`;
}

// Excel em pt-BR salva CSV com ";"
const detectDelimiter = (buffer: Buffer) => {
  const firstLine = buffer.toString('utf8').split(/\r?\n/)[0];
  return firstLine.split(';').length > firstLine.split(',').length ? ';' : ',';
};

/** lê .xlsx/.csv → linhas com cabeçalho em minúsculas */
export async function readSheet(file: Express.Multer.File, required: string[]) {
  if (!file) throw new BadRequestException('Envie um arquivo');
  const ext = extname(file.originalname).toLowerCase();
  if (!['.xlsx', '.csv'].includes(ext)) throw new BadRequestException('Formato aceito: .xlsx ou .csv');
  const wb = new ExcelJS.Workbook();
  const ws =
    ext === '.csv'
      ? await wb.csv.read(Readable.from(file.buffer), { parserOptions: { delimiter: detectDelimiter(file.buffer) } })
      : (await wb.xlsx.load(file.buffer as never), wb.worksheets[0]);
  if (!ws) throw new BadRequestException('Planilha vazia');
  const cellText = (cell: ExcelJS.Cell) => (typeof cell.value === 'object' && cell.value !== null ? cell.text : String(cell.value ?? ''));
  const header = (ws.getRow(1).values as unknown[]).map((v) => String(v ?? '').trim().toLowerCase().replace(/^﻿/, ''));
  const missing = required.filter((c) => !header.includes(c));
  if (missing.length) throw new BadRequestException(`Colunas ausentes: ${missing.join(', ')}. Use o modelo.`);
  const rows: Record<string, string>[] = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const record: Record<string, string> = {};
    header.forEach((col, i) => col && (record[col] = cellText(row.getCell(i)).trim()));
    if (Object.values(record).some(Boolean)) rows.push(record);
  });
  return rows;
}

export async function xlsxBuffer(sheet: string, header: string[], rows: string[][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheet);
  ws.addRow(header).font = { bold: true };
  rows.forEach((r) => ws.addRow(r));
  ws.columns.forEach((c) => (c.width = 26));
  header.forEach((h, i) => h === 'cpf' && (ws.getColumn(i + 1).numFmt = '@'));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** CNPJ no formato 00.000.000/0000-00 (ou 14 dígitos) */
export const formatCnpj = (value: string) => {
  const d = value.replace(/\D/g, '');
  return d.length === 14 ? d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5') : null;
};
