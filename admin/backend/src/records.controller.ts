import { BadRequestException, Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsIn, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { DataSource, Repository } from 'typeorm';
import { AuthUser, CurrentUser, Perm } from './auth';
import { PageQuery, paginate } from './common';
import { audit, RecordItem } from './entities';

/** tipos aceitos pelo registro genérico (módulos secundários) */
export const KINDS = [
  'news', 'banner', 'notice', 'video', 'material', 'training', 'quiz', 'poll', 'mission', 'medal', 'level',
  'challenge', 'reward', 'redemption', 'ticket', 'message_template', 'settings',
] as const;

const checkKind = (kind: string) => {
  if (!(KINDS as readonly string[]).includes(kind)) throw new BadRequestException(`Tipo desconhecido: ${kind}`);
};

/** regras de conteúdo que o app precisa para funcionar */
function checkData(kind: string, data?: Record<string, unknown>) {
  if (kind !== 'quiz' || !data || !Array.isArray(data.questions)) return;
  data.questions.forEach((q: { q?: unknown; options?: unknown; correct?: unknown }, i: number) => {
    const n = i + 1;
    const options = (Array.isArray(q?.options) ? q.options : []).filter((o) => String(o ?? '').trim());
    if (!String(q?.q ?? '').trim()) throw new BadRequestException(`Pergunta ${n}: escreva o enunciado`);
    if (options.length < 2) throw new BadRequestException(`Pergunta ${n}: cadastre pelo menos 2 alternativas (uma por linha)`);
    const c = Number(q?.correct ?? 0);
    if (!Number.isInteger(c) || c < 0 || c >= options.length) throw new BadRequestException(`Pergunta ${n}: escolha a resposta correta`);
  });
}

class RecordQuery extends PageQuery {
  /** um status ou vários separados por vírgula */
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() status_not?: string;
  // filtros por campo do JSON (chamados)
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() priority?: string;
  @IsOptional() @IsString() distributor?: string;
}

class RecordDto {
  @IsString() @MinLength(2) @MaxLength(160) title: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsObject() data?: Record<string, unknown>;
}

class PatchRecordDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(160) title?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsObject() data?: Record<string, unknown>;
}

class MessageDto {
  @IsString() @MinLength(1) @MaxLength(2000) text: string;
}

class TicketOpenDto {
  @IsString() @MinLength(3) @MaxLength(160) title: string;
  @IsString() @MinLength(1) @MaxLength(8000) transcript: string;
  @IsOptional() @IsString() category?: string;
}

const REDEMPTION_FLOW: Record<string, string[]> = {
  requested: ['approved', 'rejected'],
  approved: ['shipped', 'rejected'],
  shipped: ['delivered'],
  delivered: [],
  rejected: [],
};

class RedemptionStatusDto {
  @IsIn(['approved', 'shipped', 'delivered', 'rejected']) status: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

class SettingsDto {
  @IsObject() data: Record<string, unknown>;
}

const entry = (by: string, action: string) => ({ at: new Date().toISOString(), by, action });

@Controller('records')
export class RecordsController {
  constructor(
    private readonly db: DataSource,
    @InjectRepository(RecordItem) private readonly records: Repository<RecordItem>,
  ) {}

  /** configurações gerais: um único registro kind=settings (cria se não houver) */
  @Get('settings/current')
  async settings() {
    const found = await this.records.findOne({ where: { kind: 'settings' }, order: { id: 'ASC' } });
    return found ?? this.records.save(this.records.create({ kind: 'settings', title: 'Configurações gerais', status: 'published', data: {}, history: [] }));
  }

  /** salva parte das configurações (merge raso) e audita só o que mudou */
  @Perm('USERS_EDIT')
  @Patch('settings/current')
  async saveSettings(@CurrentUser() actor: AuthUser, @Body() body: SettingsDto) {
    const rec = await this.settings();
    return this.db.transaction(async (m) => {
      const changed = Object.keys(body.data).filter((k) => JSON.stringify(rec.data[k]) !== JSON.stringify(body.data[k]));
      if (!changed.length) return rec;
      const before = Object.fromEntries(changed.map((k) => [k, rec.data[k] ?? null]));
      const after = Object.fromEntries(changed.map((k) => [k, body.data[k]]));
      rec.data = { ...rec.data, ...body.data };
      rec.history = [...rec.history, entry(actor.name, `Alterou: ${changed.join(', ')}`)];
      await m.save(rec);
      await audit(m, actor, 'settings.update', 'settings', rec.id, `Configurações: ${changed.join(', ')}`, before, after);
      return rec;
    });
  }

  @Get(':kind')
  list(@Param('kind') kind: string, @Query() q: RecordQuery) {
    checkKind(kind);
    const qb = this.records.createQueryBuilder('r').where('r.kind = :kind', { kind }).orderBy('r.updatedAt', 'DESC');
    if (q.status) qb.andWhere('r.status IN (:...st)', { st: q.status.split(',') });
    if (q.status_not) qb.andWhere('r.status NOT IN (:...sn)', { sn: q.status_not.split(',') });
    if (q.search) qb.andWhere('(r.title LIKE :s OR r.data LIKE :s)', { s: `%${q.search}%` });
    for (const key of ['category', 'priority', 'distributor'] as const)
      if (q[key]) qb.andWhere(`json_extract(r.data, '$.${key}') = :${key}`, { [key]: q[key] });
    return paginate(qb, q);
  }

  @Get(':kind/:id')
  one(@Param('kind') kind: string, @Param('id') id: number) {
    checkKind(kind);
    return this.records.findOneByOrFail({ kind, id });
  }

  /** chamado aberto pelo chatbot: qualquer usuário logado pode abrir */
  @Post('ticket/open')
  async openTicket(@CurrentUser() actor: AuthUser, @Body() body: TicketOpenDto) {
    return this.db.transaction(async (m) => {
      const saved = await m.save(
        m.create(RecordItem, {
          kind: 'ticket',
          title: body.title,
          status: 'open',
          data: {
            requester: actor.name,
            distributor: null,
            category: body.category ?? 'Chatbot',
            priority: 'medium',
            assignee: null,
            messages: [{ from: 'user', name: actor.name, text: body.transcript, at: new Date().toISOString() }],
          },
          history: [entry(actor.name, 'Aberto pelo chatbot (transferência para humano)')],
        }),
      );
      await audit(m, actor, 'ticket.create', 'ticket', saved.id, `Abriu o chamado "${saved.title}" pelo chatbot`, null, { title: saved.title });
      return saved;
    });
  }

  @Perm('CONTENT_MANAGE')
  @Post(':kind')
  async create(@CurrentUser() actor: AuthUser, @Param('kind') kind: string, @Body() body: RecordDto) {
    checkKind(kind);
    checkData(kind, body.data);
    return this.db.transaction(async (m) => {
      const saved = await m.save(
        m.create(RecordItem, { kind, title: body.title, status: body.status ?? 'draft', data: body.data ?? {}, history: [entry(actor.name, 'Criado')] }),
      );
      await audit(m, actor, `${kind}.create`, kind, saved.id, `Criou "${saved.title}"`, null, body);
      return saved;
    });
  }

  @Perm('CONTENT_MANAGE')
  @Patch(':kind/:id')
  async update(@CurrentUser() actor: AuthUser, @Param('kind') kind: string, @Param('id') id: number, @Body() body: PatchRecordDto) {
    checkKind(kind);
    checkData(kind, body.data);
    return this.db.transaction(async (m) => {
      const rec = await m.findOneByOrFail(RecordItem, { kind, id });
      const before = { title: rec.title, status: rec.status, data: rec.data };
      const action = body.status && body.status !== rec.status ? `Status: ${rec.status} → ${body.status}` : 'Editado';
      Object.assign(rec, { title: body.title ?? rec.title, status: body.status ?? rec.status, data: body.data ?? rec.data });
      rec.history = [...rec.history, entry(actor.name, action)];
      await m.save(rec);
      await audit(m, actor, `${kind}.update`, kind, id, `${action}: "${rec.title}"`, before, body);
      return rec;
    });
  }

  /** chamados: resposta do atendente (fica no histórico de mensagens) */
  @Perm('CONTENT_MANAGE')
  @Post('ticket/:id/messages')
  @HttpCode(200)
  async reply(@CurrentUser() actor: AuthUser, @Param('id') id: number, @Body() body: MessageDto) {
    const rec = await this.records.findOneByOrFail({ kind: 'ticket', id });
    if (rec.status === 'closed') throw new BadRequestException('Chamado encerrado: reabra para responder');
    const messages = [...((rec.data.messages as unknown[]) ?? []), { from: 'agent', name: actor.name, text: body.text, at: new Date().toISOString() }];
    return this.update(actor, 'ticket', id, {
      status: rec.status === 'open' ? 'in_progress' : rec.status,
      data: { ...rec.data, messages, assignee: rec.data.assignee ?? actor.name },
    });
  }

  /**
   * Resgate: avança no fluxo solicitado → aprovado → enviado → entregue (ou recusado).
   * Aprovar baixa 1 do estoque do prêmio; sem estoque, recusa a aprovação.
   */
  @Perm('CONTENT_MANAGE')
  @Post('redemption/:id/status')
  @HttpCode(200)
  async redemptionStatus(@CurrentUser() actor: AuthUser, @Param('id') id: number, @Body() body: RedemptionStatusDto) {
    return this.db.transaction(async (m) => {
      const rec = await m.findOneByOrFail(RecordItem, { kind: 'redemption', id });
      if (!(REDEMPTION_FLOW[rec.status] ?? []).includes(body.status))
        throw new BadRequestException(`Não é possível passar de "${rec.status}" para "${body.status}"`);
      const before = { status: rec.status };
      if (body.status === 'approved') {
        const reward = await m
          .createQueryBuilder(RecordItem, 'r')
          .where("r.kind = 'reward' AND r.title = :t", { t: rec.data.reward })
          .getOne();
        if (reward) {
          const stock = Number(reward.data.stock ?? 0);
          if (stock <= 0) throw new BadRequestException(`Prêmio "${reward.title}" sem estoque`);
          reward.data = { ...reward.data, stock: stock - 1 };
          reward.history = [...reward.history, entry(actor.name, `Estoque ${stock} → ${stock - 1} (resgate #${rec.id})`)];
          await m.save(reward);
        }
      }
      rec.status = body.status;
      rec.history = [...rec.history, entry(actor.name, `Status: ${before.status} → ${body.status}${body.note ? ` — ${body.note}` : ''}`)];
      await m.save(rec);
      await audit(m, actor, 'redemption.status', 'redemption', id, `Resgate "${rec.title}": ${before.status} → ${body.status}`, before, { status: body.status, note: body.note });
      return rec;
    });
  }
}
