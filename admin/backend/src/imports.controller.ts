import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InjectRepository } from '@nestjs/typeorm';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import ExcelJS from 'exceljs';
import type { Response } from 'express';
import { extname } from 'path';
import { Readable } from 'stream';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { AuthUser, CurrentUser, distributorScope, Perm } from './auth';
import { menuAllows } from './menu-access';
import { fakeCpf, formatCpf, PageQuery, paginate } from './common';
import { RealtimeGateway } from './realtime';
import {
  audit,
  Campaign,
  Distributor,
  ImportBatch,
  ImportRow,
  Menu,
  PointEntry,
  PointRule,
  Product,
  Sale,
  User,
} from './entities';
import {
  describeChange,
  ERROR_INFO,
  IMPORT_COLUMNS,
  ImportContext,
  MAX_ROWS,
  missingColumns,
  SaleRef,
  TEXT_COLUMNS,
  validateRows,
} from './import';
import { campaignFor, computePoints, ruleLabel } from './points';

const BATCH_STATUSES = ['received', 'validating', 'with_errors', 'awaiting_confirmation', 'queued', 'processing', 'done', 'failed', 'replaced'];
const ROW_STATUSES = ['valid', 'invalid', 'duplicate', 'already_imported', 'correction'];
const SORTS: Record<string, string> = {
  id: 'b.id',
  createdAt: 'b.createdAt',
  competence: 'b.competence',
  distributorName: 'b.distributorName',
  total: 'b.total',
  invalid: 'b.invalid',
  status: 'b.status',
};
const MAX_FILE = 10 * 1024 * 1024;
const PROCESS_DELAY_MS = Number(process.env.IMPORT_PROCESS_DELAY_MS ?? 2500);

class LayoutError extends Error {}

/** lê .xlsx/.csv → cabeçalho em minúsculas + linhas como texto */
async function readSheet(file: Express.Multer.File) {
  const wb = new ExcelJS.Workbook();
  const ext = extname(file.originalname).toLowerCase();
  let ws: ExcelJS.Worksheet | undefined;
  try {
    if (ext === '.csv') {
      const first = file.buffer.toString('utf8').split(/\r?\n/)[0];
      const delimiter = first.split(';').length > first.split(',').length ? ';' : ',';
      ws = await wb.csv.read(Readable.from(file.buffer), { parserOptions: { delimiter } });
    } else {
      await wb.xlsx.load(file.buffer as never);
      ws = wb.worksheets[0];
    }
  } catch {
    throw new LayoutError(
      ext === '.xls' ? 'Arquivo .xls (Excel 97-2003) não suportado: salve como .xlsx ou .csv' : 'Arquivo ilegível: não é uma planilha .xlsx/.csv válida',
    );
  }
  if (!ws || ws.rowCount < 1) throw new LayoutError('Planilha vazia');

  const cellText = (cell: ExcelJS.Cell) => {
    const v = cell.value;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return typeof v === 'object' && v !== null ? cell.text : String(v ?? '');
  };
  const header = (ws.getRow(1).values as unknown[]).map((v) => String(v ?? '').trim().toLowerCase().replace(/^﻿/, ''));
  const missing = missingColumns(header);
  if (missing.length) throw new LayoutError(`Divergência de layout: colunas obrigatórias ausentes (${missing.join(', ')})`);

  const rows: Record<string, string>[] = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const record: Record<string, string> = {};
    header.forEach((col, i) => col && (record[col] = cellText(row.getCell(i)).trim()));
    if (Object.values(record).some(Boolean)) rows.push(record);
  });
  if (!rows.length) throw new LayoutError('Planilha sem linhas de venda');
  if (rows.length > MAX_ROWS) throw new LayoutError(`Máximo de ${MAX_ROWS} linhas por arquivo`);
  return rows;
}

const brNumber = (cents: number) => (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const brDate = (iso: string) => iso.split('-').reverse().join('/');

/** em blocos: o SQLite limita variáveis por consulta */
async function inChunks<T, R>(items: T[], size: number, fn: (chunk: T[]) => Promise<R[]>) {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await fn(items.slice(i, i + size))));
  return out;
}

async function activeSales(m: EntityManager, externalIds: string[]) {
  const sales = await inChunks(externalIds, 500, (ids) => m.findBy(Sale, { externalId: In(ids), status: 'active' }));
  return new Map(sales.map((s) => [s.externalId, s]));
}

const toRef = (s: Sale): SaleRef => ({
  sellerId: s.sellerId,
  productId: s.productId,
  date: s.date,
  quantity: s.quantity,
  amountCents: s.amountCents,
  points: s.points,
});

/** pontos pela regra vigente na data da venda (regras e campanhas do banco) */
async function pointsCalculator(m: EntityManager, distributorId: number) {
  const [rules, campaigns] = await Promise.all([m.find(PointRule), m.find(Campaign)]);
  return (s: { productId: number; quantity: number; amountCents: number; date: string }) => {
    const input = { ...s, distributorId };
    const campaign = campaignFor(campaigns, input);
    return { campaign, ...computePoints(rules, campaign?.id ?? null, input) };
  };
}

class ListQuery extends PageQuery {
  @IsOptional() @Type(() => Number) @IsInt() distributorId?: number;
  @IsOptional() @Matches(/^\d{4}-\d{2}$/) competence?: string;
  /** um ou vários separados por vírgula */
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsIn(Object.keys(SORTS)) sort?: string;
  @IsOptional() @IsIn(['asc', 'desc']) dir?: 'asc' | 'desc';
}

class RowsQuery extends PageQuery {
  @IsOptional() @IsIn(ROW_STATUSES) status?: string;
}

class ReturnDto {
  @IsString() @MinLength(10, { message: 'Justificativa obrigatória (mínimo 10 caracteres)' }) @MaxLength(500) reason: string;
}

class UploadDto {
  @Type(() => Number) @IsInt() distributorId: number;
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'Competência no formato AAAA-MM' }) competence: string;
  @IsOptional() @Type(() => Number) @IsInt() replaces?: number;
}

class SampleQuery {
  @Type(() => Number) @IsInt() distributorId: number;
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) competence: string;
  @IsIn(['valid', 'errors', 'correction']) kind: 'valid' | 'errors' | 'correction';
}

const STAFF = ['SALES_IMPORT', 'SALES_VALIDATE', 'SALES_APPROVE'] as const;

@Controller('imports')
export class ImportsController {
  constructor(
    private readonly db: DataSource,
    @InjectRepository(ImportBatch) private readonly batches: Repository<ImportBatch>,
    @InjectRepository(ImportRow) private readonly rows: Repository<ImportRow>,
    @InjectRepository(Distributor) private readonly distributors: Repository<Distributor>,
    @InjectRepository(Menu) private readonly menus: Repository<Menu>,
    private readonly realtime: RealtimeGateway,
  ) {}

  /**
   * Quem pode usar a importação: a equipe interna (SALES_IMPORT/VALIDATE/APPROVE)
   * ou qualquer usuário que enxergue o menu "Importar Vendas" (/importar) na
   * segmentação dos Menus Dinâmicos. Esse segundo grupo só envia para a própria
   * distribuidora e só vê os lotes que ele mesmo enviou. Confirmar/reprocessar: só admin.
   */
  private async access(user: AuthUser): Promise<'staff' | 'menu'> {
    if (STAFF.some((p) => user.permissions.includes(p))) return 'staff';
    if (await menuAllows(this.menus, user, '/importar')) return 'menu';
    throw new ForbiddenException('Seu perfil não tem acesso à importação de vendas.');
  }

  private assertScope(user: AuthUser, distributorId: number) {
    const ids = distributorScope(user);
    if (ids && !ids.includes(distributorId)) throw new ForbiddenException('Distribuidora fora do seu escopo');
  }

  private async findBatch(user: AuthUser, id: number) {
    const batch = await this.batches.findOneBy({ id });
    if (!batch) throw new NotFoundException('Lote não encontrado');
    this.assertScope(user, batch.distributorId);
    if ((await this.access(user)) === 'menu' && batch.userId !== user.id) throw new NotFoundException('Lote não encontrado');
    return batch;
  }

  // ---------- planilhas ----------

  @Get('template')
  async template(@CurrentUser() user: AuthUser, @Res() res: Response) {
    await this.access(user);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('vendas');
    ws.addRow([...IMPORT_COLUMNS]).font = { bold: true };
    ws.addRow(['NF0012345', '1', '529.982.247-25', 'PRD-A', '15/09/2026', '3', '569,70']);
    ws.addRow(['NF0012345', '2', '529.982.247-25', 'PRD-C', '15/09/2026', '1', '89,90']);
    this.formatSheet(ws);
    const help = wb.addWorksheet('instruções');
    help.addRows([
      ['Coluna', 'Obrigatória', 'Formato'],
      ['documento', 'sim', 'Número da nota/pedido'],
      ['item', 'não (padrão 1)', 'Item dentro do documento; documento+item identifica a venda'],
      ['cpf_vendedor', 'sim', 'CPF do vendedor cadastrado na distribuidora'],
      ['sku', 'sim', 'Código do produto (ex.: PRD-A)'],
      ['data', 'sim', 'DD/MM/AAAA, dentro da competência'],
      ['quantidade', 'sim', 'Inteiro maior que zero'],
      ['valor', 'sim', 'Valor total da linha, ex.: 1.250,00'],
    ]);
    help.getRow(1).font = { bold: true };
    help.columns.forEach((c) => (c.width = 40));
    await this.sendXlsx(res, wb, 'modelo-importacao-vendas.xlsx');
  }

  /** planilha de demonstração com vendedores reais da distribuidora */
  @Get('sample')
  async sample(@CurrentUser() user: AuthUser, @Query() q: SampleQuery, @Res() res: Response) {
    await this.access(user);
    this.assertScope(user, q.distributorId);
    const d = await this.distributors.findOneBy({ id: q.distributorId });
    if (!d) throw new NotFoundException('Distribuidora não encontrada');
    const m = this.db.manager;
    const sellersQb = (distributorId: number, active: boolean) =>
      m
        .createQueryBuilder(User, 'u')
        .where('u.distributorId = :d', { d: distributorId })
        .andWhere('u.profiles LIKE :p', { p: '%seller%' })
        .andWhere(active ? "u.status = 'active' AND u.blocked = 0" : "(u.status = 'inactive' OR u.blocked = 1)");
    const sellers = await sellersQb(d.id, true).orderBy('u.id').take(12).getMany();
    if (!sellers.length) throw new BadRequestException('Distribuidora sem vendedores ativos');
    const products = await m.find(Product, { order: { id: 'ASC' } });
    const [y, mo] = q.competence.split('-').map(Number);
    const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    const day = (n: number) => brDate(`${q.competence}-${String(Math.min(n, lastDay)).padStart(2, '0')}`);
    // documento único por geração: reimportar o mesmo arquivo cai em "já importada"
    const tag = Date.now().toString(36).slice(-5).toUpperCase();
    let k = 0;
    const good = () => {
      k++;
      const s = sellers[k % sellers.length];
      const p = products[k % products.length];
      const qty = (k % 7) + 1;
      return [`DEMO-${tag}-${String(k).padStart(3, '0')}`, '1', formatCpf(s.cpf!), p.sku, day(3 + ((k * 3) % 25)), String(qty), brNumber(qty * p.priceCents)];
    };
    const lines: string[][] = [];

    if (q.kind === 'valid') for (let i = 0; i < 25; i++) lines.push(good());

    if (q.kind === 'errors') {
      for (let i = 0; i < 12; i++) lines.push(good());
      const base = () => good();
      const set = (r: string[], col: number, v: string) => ((r[col] = v), r);
      lines.push(set(base(), 3, '')); // campo obrigatório
      lines.push(set(base(), 2, '123.456.789-00')); // CPF inválido
      let ghost = 500000;
      while (await m.existsBy(User, { cpf: fakeCpf(ghost) })) ghost++;
      lines.push(set(base(), 2, formatCpf(fakeCpf(ghost)))); // vendedor inexistente
      const other = await m
        .createQueryBuilder(User, 'u')
        .where('u.distributorId != :d', { d: d.id })
        .andWhere('u.profiles LIKE :p', { p: '%seller%' })
        .getOne();
      if (other) lines.push(set(base(), 2, formatCpf(other.cpf!))); // vendedor de outra distribuidora
      const inactive = await sellersQb(d.id, false).getOne();
      if (inactive) lines.push(set(base(), 2, formatCpf(inactive.cpf!))); // vendedor inativo
      lines.push(set(base(), 3, 'PRD-ZZZ')); // produto inexistente
      lines.push(set(base(), 4, `31/02/${y}`)); // data inválida
      lines.push(set(base(), 4, brDate(`${mo === 1 ? y - 1 : y}-${String(mo === 1 ? 12 : mo - 1).padStart(2, '0')}-10`))); // fora da competência
      lines.push(set(base(), 5, '-2')); // quantidade inválida
      lines.push(set(base(), 6, '0,00')); // valor inválido
      lines.push([...lines[0]]); // duplicado no arquivo
      const imported = await m.findOne(Sale, { where: { distributorId: d.id, competence: q.competence, status: 'active' }, order: { id: 'ASC' } });
      if (imported) lines.push(await this.saleLine(m, imported)); // já importada
    }

    if (q.kind === 'correction') {
      const sales = await m.find(Sale, { where: { distributorId: d.id, competence: q.competence, status: 'active' }, order: { id: 'ASC' }, take: 7 });
      if (!sales.length)
        throw new BadRequestException(`Nenhuma venda processada de ${d.name} em ${q.competence} para corrigir. Importe e processe um lote antes.`);
      for (const [i, sale] of sales.entries()) {
        const line = await this.saleLine(m, sale);
        const product = products.find((p) => p.id === sale.productId)!;
        // 0–2: quantidade maior (ajuste +), 3: menor (estorno −), resto idêntico (ignorado)
        const qty = i < 3 ? sale.quantity + 3 : i === 3 ? Math.max(1, sale.quantity - 1) : sale.quantity;
        if (i === 3 && qty === sale.quantity) line[5] = String(sale.quantity + 1);
        else line[5] = String(qty);
        line[6] = brNumber(Number(line[5]) * product.priceCents);
        lines.push(line);
      }
      for (let i = 0; i < 3; i++) lines.push(good());
    }

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('vendas');
    ws.addRow([...IMPORT_COLUMNS]).font = { bold: true };
    lines.forEach((l) => ws.addRow(l));
    this.formatSheet(ws);
    await this.sendXlsx(res, wb, `vendas_${d.code.toLowerCase()}_${q.competence.replace('-', '')}_${q.kind}.xlsx`);
  }

  private async saleLine(m: EntityManager, sale: Sale) {
    const [seller, product] = await Promise.all([m.findOneByOrFail(User, { id: sale.sellerId }), m.findOneByOrFail(Product, { id: sale.productId })]);
    const [, document, item] = sale.externalId.split(':');
    return [document, item, formatCpf(seller.cpf!), product.sku, brDate(sale.date), String(sale.quantity), brNumber(sale.amountCents)];
  }

  private formatSheet(ws: ExcelJS.Worksheet) {
    ws.columns.forEach((c) => (c.width = 20));
    TEXT_COLUMNS.forEach((c) => (ws.getColumn(IMPORT_COLUMNS.indexOf(c as never) + 1).numFmt = '@'));
  }

  private async sendXlsx(res: Response, wb: ExcelJS.Workbook, filename: string) {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.end(Buffer.from(await wb.xlsx.writeBuffer()));
  }

  // ---------- envio e validação ----------

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE } }))
  async upload(@CurrentUser() user: AuthUser, @UploadedFile() file: Express.Multer.File, @Body() body: UploadDto) {
    await this.access(user);
    if (!file) throw new BadRequestException('Envie a planilha no campo "file"');
    if (!['.xlsx', '.xls', '.csv'].includes(extname(file.originalname).toLowerCase()))
      throw new BadRequestException('Formatos aceitos: .xlsx, .xls, .csv');
    this.assertScope(user, body.distributorId);
    const d = await this.distributors.findOneBy({ id: body.distributorId });
    if (!d) throw new NotFoundException('Distribuidora não encontrada');
    if (d.status !== 'active') throw new BadRequestException(`${d.name} está inativa`);

    const batch = await this.batches.save(
      this.batches.create({
        distributorId: d.id,
        distributorName: d.name,
        competence: body.competence,
        fileName: file.originalname.slice(0, 200),
        userId: user.id,
        userName: user.name,
        status: 'received',
        replacesBatchId: body.replaces ?? null,
      }),
    );
    await this.batches.update(batch.id, { status: 'validating' });

    let sheet: Record<string, string>[];
    try {
      sheet = await readSheet(file);
    } catch (e) {
      if (!(e instanceof LayoutError)) throw e;
      await this.db.transaction(async (m) => {
        await m.update(ImportBatch, batch.id, { status: 'failed', error: e.message });
        await audit(m, user, 'import.failed', 'import_batch', batch.id, `Lote #${batch.id} (${d.name} ${body.competence}) recusado: ${e.message}`);
      });
      return this.detail(user, batch.id);
    }

    const m = this.db.manager;
    const cpfs = [...new Set(sheet.map((r) => (r.cpf_vendedor ?? '').replace(/\D/g, '')).filter((c) => c.length === 11))];
    const users = await inChunks(cpfs, 500, (chunk) => m.findBy(User, { cpf: In(chunk) }));
    const products = await m.find(Product);
    const ids = sheet.map((r) => `${d.code}:${(r.documento ?? '').trim()}:${(r.item ?? '').trim() || '1'}`);
    const existing = await activeSales(m, [...new Set(ids)]);
    const calc = await pointsCalculator(m, d.id);

    const ctx: ImportContext = {
      distributorId: d.id,
      distributorCode: d.code,
      competence: body.competence,
      sellersByCpf: new Map(
        users
          .filter((u) => u.profiles.includes('seller'))
          .map((u) => [u.cpf!, { id: u.id, name: u.name, distributorId: u.distributorId, active: u.status === 'active' && !u.blocked }]),
      ),
      productsBySku: new Map(products.filter((p) => p.status === 'active').map((p) => [p.sku.toUpperCase(), { id: p.id }])),
      existing: new Map([...existing].map(([k, s]) => [k, toRef(s)])),
      points: (s) => calc(s).points,
    };
    const parsed = validateRows(sheet, ctx);
    const count = (st: string) => parsed.filter((r) => r.status === st).length;
    const invalid = count('invalid');
    const valid = count('valid');
    const corrections = count('correction');

    await this.db.transaction(async (tx) => {
      for (let i = 0; i < parsed.length; i += 300)
        await tx.insert(
          ImportRow,
          parsed.slice(i, i + 300).map((r) => ({ ...r, batchId: batch.id })),
        );
      await tx.update(ImportBatch, batch.id, {
        status: invalid + count('duplicate') > 0 ? 'with_errors' : 'awaiting_confirmation',
        total: parsed.length,
        valid,
        invalid,
        duplicates: count('duplicate') + count('already_imported'),
        corrections,
        predictedPoints: parsed.reduce((s, r) => s + (r.status === 'correction' ? r.points - (r.previousPoints ?? 0) : r.points), 0),
      });
      await audit(
        tx,
        user,
        'import.upload',
        'import_batch',
        batch.id,
        `Enviou ${file.originalname} (${d.name} ${body.competence}): ${parsed.length} linhas, ${valid} válidas, ${invalid} inválidas, ${corrections} correções`,
      );
    });
    return this.detail(user, batch.id);
  }

  // ---------- consultas ----------

  @Get()
  async list(@CurrentUser() user: AuthUser, @Query() q: ListQuery) {
    const mode = await this.access(user);
    const qb = this.batches.createQueryBuilder('b');
    if (mode === 'menu') qb.andWhere('b.userId = :uid', { uid: user.id });
    const ids = distributorScope(user);
    if (ids) qb.andWhere(ids.length ? 'b.distributorId IN (:...ids)' : '1 = 0', { ids });
    if (q.distributorId) qb.andWhere('b.distributorId = :d', { d: q.distributorId });
    if (q.competence) qb.andWhere('b.competence = :c', { c: q.competence });
    if (q.status) qb.andWhere('b.status IN (:...st)', { st: q.status.split(',').filter((s) => BATCH_STATUSES.includes(s)) });
    if (q.search) qb.andWhere('(b.fileName LIKE :s OR b.userName LIKE :s OR b.distributorName LIKE :s OR CAST(b.id AS TEXT) = :id)', { s: `%${q.search}%`, id: q.search.replace('#', '') });
    if (q.date_from) qb.andWhere('b.createdAt >= :df', { df: q.date_from.slice(0, 10) });
    if (q.date_to) qb.andWhere("b.createdAt < date(:dt, '+1 day')", { dt: q.date_to.slice(0, 10) });
    qb.orderBy(SORTS[q.sort ?? 'createdAt'], (q.dir ?? 'desc').toUpperCase() as 'ASC' | 'DESC').addOrderBy('b.id', 'DESC');
    return paginate(qb, q);
  }

  /** lotes com problema + total por tipo de inconsistência */
  @Perm('SALES_VALIDATE', 'SALES_APPROVE')
  @Get('inconsistencies')
  async inconsistencies(@CurrentUser() user: AuthUser) {
    const qb = this.batches.createQueryBuilder('b').where("b.status IN ('with_errors', 'failed')").orderBy('b.createdAt', 'DESC');
    const ids = distributorScope(user);
    if (ids) qb.andWhere(ids.length ? 'b.distributorId IN (:...ids)' : '1 = 0', { ids });
    const batches = await qb.getMany();
    const rows = batches.length
      ? await this.rows.find({ where: { batchId: In(batches.map((b) => b.id)), status: In(['invalid', 'duplicate']) }, select: ['batchId', 'errors'] })
      : [];
    const byType = new Map<string, number>();
    const perBatch = new Map<number, number>();
    for (const r of rows) {
      perBatch.set(r.batchId, (perBatch.get(r.batchId) ?? 0) + 1);
      for (const e of r.errors) byType.set(e.code, (byType.get(e.code) ?? 0) + 1);
    }
    for (const b of batches) if (b.status === 'failed') byType.set('layout', (byType.get('layout') ?? 0) + 1);
    return {
      byType: [...byType].map(([code, count]) => ({ code, count, ...ERROR_INFO[code] })).sort((a, b) => b.count - a.count),
      batches: batches.map((b) => ({ ...b, errorRows: perBatch.get(b.id) ?? 0 })),
    };
  }

  @Get(':id')
  async detail(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    const batch = await this.findBatch(user, id);
    const rows = await this.rows.find({ where: { batchId: id, status: In(['invalid', 'duplicate', 'already_imported']) }, select: ['status', 'errors'] });
    const counts = new Map<string, number>();
    for (const r of rows) {
      const codes = r.status === 'already_imported' ? ['already_imported'] : r.errors.map((e) => e.code);
      for (const c of codes) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    if (batch.status === 'failed' && batch.error && !batch.total) counts.set('layout', 1);
    const replacedBy = await this.batches.findOne({ where: { replacesBatchId: id }, select: ['id', 'status'], order: { id: 'DESC' } });
    return {
      ...batch,
      replacedById: replacedBy?.id ?? null,
      errorsByType: [...counts].map(([code, count]) => ({ code, count, ...ERROR_INFO[code] })).sort((a, b) => b.count - a.count),
    };
  }

  @Get(':id/rows')
  async rowsOf(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Query() q: RowsQuery) {
    await this.findBatch(user, id);
    const qb = this.rows.createQueryBuilder('r').where('r.batchId = :id', { id }).orderBy('r.line', 'ASC');
    if (q.status) qb.andWhere('r.status = :st', { st: q.status });
    if (q.search) qb.andWhere('(r.data LIKE :s OR r.errors LIKE :s)', { s: `%${q.search}%` });
    return paginate(qb, q);
  }

  @Get(':id/errors.csv')
  async errorsCsv(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const batch = await this.findBatch(user, id);
    const rows = await this.rows.find({ where: { batchId: id, status: In(['invalid', 'duplicate']) }, order: { line: 'ASC' } });
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['linha', 'status', 'erros', 'orientacao', ...IMPORT_COLUMNS].map(esc).join(';')];
    if (batch.status === 'failed' && batch.error) lines.push(['', 'layout', batch.error, ERROR_INFO.layout.hint].map(esc).join(';'));
    for (const r of rows)
      lines.push(
        [
          r.line,
          r.status === 'duplicate' ? 'duplicada' : 'inválida',
          r.errors.map((e) => e.message).join(' | '),
          [...new Set(r.errors.map((e) => ERROR_INFO[e.code]?.hint))].join(' '),
          ...IMPORT_COLUMNS.map((c) => r.data[c]),
        ]
          .map(esc)
          .join(';'),
      );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="erros-lote-${id}.csv"`);
    res.end('﻿' + lines.join('\n'));
  }

  // ---------- confirmação e reprocessamento ----------

  @Perm('SALES_APPROVE')
  @Post(':id/confirm')
  @HttpCode(200)
  async confirm(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    const batch = await this.findBatch(user, id);
    if (batch.valid + batch.corrections === 0)
      throw new BadRequestException('Lote sem linhas aptas (válidas ou correções): corrija a planilha e reenvie');
    await this.db.transaction(async (m) => {
      // update condicional: dois cliques/admins no mesmo lote → o segundo recebe 409
      const { affected } = await m
        .createQueryBuilder()
        .update(ImportBatch)
        .set({ status: 'queued', confirmedById: user.id, confirmedByName: user.name, confirmedAt: new Date() })
        .where("id = :id AND status IN ('awaiting_confirmation', 'with_errors')", { id })
        .execute();
      if (!affected) throw new ConflictException('Lote não está aguardando confirmação');

      // reenvio corrigido: lotes pendentes da mesma distribuidora+competência são substituídos (preservados)
      const pending = await m.find(ImportBatch, {
        where: { distributorId: batch.distributorId, competence: batch.competence, status: In(['with_errors', 'awaiting_confirmation', 'failed', 'returned']) },
      });
      const others = pending.filter((b) => b.id !== id);
      if (others.length) {
        await m.update(ImportBatch, { id: In(others.map((b) => b.id)) }, { status: 'replaced' });
        if (!batch.replacesBatchId) await m.update(ImportBatch, id, { replacesBatchId: Math.max(...others.map((b) => b.id)) });
      }
      const ignored = batch.invalid + batch.duplicates;
      await audit(
        m,
        user,
        'import.confirm',
        'import_batch',
        id,
        `Confirmou o lote #${id} (${batch.distributorName} ${batch.competence}): ${batch.valid} novas, ${batch.corrections} correções` +
          (ignored ? `, ${ignored} linhas ignoradas` : '') +
          (others.length ? `; substituiu ${others.map((b) => `#${b.id}`).join(', ')}` : ''),
        { status: batch.status },
        { status: 'queued' },
      );
    });
    return this.detail(user, id);
  }

  /** devolve o lote para quem enviou corrigir; a pessoa recebe um modal em tempo real */
  @Perm('SALES_APPROVE')
  @Post(':id/return')
  @HttpCode(200)
  async returnToSender(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() body: ReturnDto) {
    const batch = await this.findBatch(user, id);
    const reason = body.reason.trim();
    await this.db.transaction(async (m) => {
      const { affected } = await m
        .createQueryBuilder()
        .update(ImportBatch)
        .set({ status: 'returned', returnReason: reason, returnedById: user.id, returnedByName: user.name, returnedAt: new Date(), returnSeenAt: null })
        .where("id = :id AND status IN ('awaiting_confirmation', 'with_errors')", { id })
        .execute();
      if (!affected) throw new ConflictException('Só lotes aguardando confirmação podem ser devolvidos');
      await audit(m, user, 'import.return', 'import_batch', id, `Devolveu o lote #${id} (${batch.distributorName} ${batch.competence}) para ${batch.userName}: ${reason}`, { status: batch.status }, { status: 'returned', reason });
    });
    this.realtime.notifyReturned((await this.batches.findOneBy({ id }))!);
    return this.detail(user, id);
  }

  @Perm('SALES_REPROCESS', 'SALES_APPROVE')
  @Post(':id/reprocess')
  @HttpCode(200)
  async reprocess(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    const batch = await this.findBatch(user, id);
    if (!batch.total) throw new BadRequestException('Lote recusado na leitura do arquivo: reenvie a planilha corrigida');
    await this.db.transaction(async (m) => {
      const { affected } = await m
        .createQueryBuilder()
        .update(ImportBatch)
        .set({
          status: 'queued',
          error: null,
          reprocessCount: () => 'reprocessCount + 1',
          confirmedById: user.id,
          confirmedByName: user.name,
          confirmedAt: new Date(),
        })
        .where("id = :id AND status IN ('done', 'failed')", { id })
        .execute();
      if (!affected) throw new ConflictException('Só lotes concluídos ou com falha podem ser reprocessados');
      await audit(m, user, 'import.reprocess', 'import_batch', id, `Reprocessou o lote #${id} (${batch.distributorName} ${batch.competence})`, { status: batch.status }, { status: 'queued' });
    });
    return this.detail(user, id);
  }
}

/**
 * Fila de processamento no próprio backend. Idempotente pela chave
 * distribuidora:documento:item (índice único entre vendas ativas): processar
 * duas vezes o mesmo lote só soma o que ainda não existia.
 */
@Injectable()
export class ImportWorker implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Importação');
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly db: DataSource) {}

  async onModuleInit() {
    // caiu no meio: volta pra fila (seguro, o processamento é idempotente)
    await this.db.getRepository(ImportBatch).update({ status: 'processing' }, { status: 'queued' });
    this.timer = setInterval(() => void this.tick(), 1500);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const repo = this.db.getRepository(ImportBatch);
      const next = await repo.findOne({ where: { status: 'queued' }, order: { confirmedAt: 'ASC', id: 'ASC' } });
      if (!next) return;
      const { affected } = await repo.update({ id: next.id, status: 'queued' }, { status: 'processing' });
      if (!affected) return;
      await new Promise((r) => setTimeout(r, PROCESS_DELAY_MS)); // deixa o estado "Processando" visível na demo
      try {
        await this.process(next);
      } catch (e) {
        this.log.error(`Lote #${next.id}: ${(e as Error).message}`);
        await repo.update(next.id, { status: 'failed', error: `Falha no processamento: ${(e as Error).message}` });
      }
    } finally {
      this.running = false;
    }
  }

  async process(batch: ImportBatch) {
    await this.db.transaction(async (m) => {
      const rows = await m.find(ImportRow, { where: { batchId: batch.id, status: In(['valid', 'correction', 'already_imported']) }, order: { line: 'ASC' } });
      const existing = await activeSales(m, rows.map((r) => r.externalId!));
      const calc = await pointsCalculator(m, batch.distributorId);
      const sellerIds = [...new Set(rows.map((r) => r.sellerId!))];
      const sellers = new Map((await inChunks(sellerIds, 500, (ids) => m.findBy(User, { id: In(ids) }))).map((u) => [u.id, u.name]));
      const actor = { id: batch.confirmedById ?? batch.userId, name: batch.confirmedByName ?? batch.userName };
      let created = 0;
      let skipped = 0;
      let corrected = 0;
      let credited = 0;
      let adjusted = 0;

      for (const row of rows) {
        const sale = { productId: row.productId!, quantity: row.quantity!, amountCents: row.amountCents!, date: row.date! };
        const { points, rule, campaign } = calc(sale);
        const previous = existing.get(row.externalId!);
        const base = {
          externalId: row.externalId!,
          batchId: batch.id,
          distributorId: batch.distributorId,
          sellerId: row.sellerId!,
          campaignId: campaign?.id ?? null,
          document: row.document!,
          competence: batch.competence,
          points,
          ruleId: rule?.id ?? null,
          ...sale,
        };
        const entry = {
          sellerId: row.sellerId!,
          sellerName: sellers.get(row.sellerId!) ?? '—',
          distributorId: batch.distributorId,
          campaignId: campaign?.id ?? null,
          ruleId: rule?.id ?? null,
          ruleLabel: rule ? ruleLabel(rule) : null,
          saleExternalId: row.externalId!,
          batchId: batch.id,
        };

        if (!previous) {
          await m.insert(Sale, base);
          await m.insert(PointEntry, { ...entry, type: 'credit', points, origin: `Venda ${row.document}`, actorName: actor.name });
          created++;
          credited += points;
          continue;
        }
        const before = toRef(previous);
        const same =
          before.sellerId === base.sellerId &&
          before.productId === base.productId &&
          before.date === base.date &&
          before.quantity === base.quantity &&
          before.amountCents === base.amountCents;
        if (same) {
          skipped++;
          continue;
        }
        // correção: preserva a original (replaced) e lança só a diferença
        await m.update(Sale, previous.id, { status: 'replaced' });
        const { identifiers } = await m.insert(Sale, base);
        await m.update(Sale, previous.id, { replacedBySaleId: identifiers[0].id });
        const diff = points - previous.points;
        if (diff !== 0) {
          const original = await m.findOne(PointEntry, { where: { saleExternalId: row.externalId! }, order: { id: 'ASC' } });
          await m.insert(PointEntry, {
            ...entry,
            type: diff > 0 ? 'adjustment' : 'reversal',
            points: diff,
            origin: `Correção da venda ${row.document} (lote #${batch.id})`,
            reason: `${describeChange(before, base)}: ${previous.points} → ${points} pts`,
            relatedEntryId: original?.id ?? null,
            actorName: actor.name,
          });
        }
        corrected++;
        adjusted += diff;
      }

      await m.update(ImportBatch, batch.id, {
        status: 'done',
        processedAt: new Date(),
        // acumulados entre execuções; os contadores abaixo são da última execução
        creditedPoints: () => `creditedPoints + ${credited}`,
        adjustmentPoints: () => `adjustmentPoints + ${adjusted}`,
        newCount: created,
        skippedCount: skipped,
        correctedCount: corrected,
        error: null,
      });
      await audit(
        m,
        actor,
        'import.processed',
        'import_batch',
        batch.id,
        `Lote #${batch.id} processado: ${created} novas (+${credited} pts), ${corrected} corrigidas (${adjusted >= 0 ? '+' : ''}${adjusted} pts), ${skipped} já existentes ignoradas`,
      );
    });
  }
}
