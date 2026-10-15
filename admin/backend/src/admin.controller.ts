import { BadRequestException, Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsArray, IsIn, IsOptional, IsString } from 'class-validator';
import { DataSource, IsNull, Repository } from 'typeorm';
import { AuthUser, CurrentUser, Perm, Public } from './auth';
import { applyPeriod, maskCpf, onlyDigits, PageQuery, paginate } from './common';
import {
  audit,
  AuditLog,
  Campaign,
  Distributor,
  PERMISSIONS,
  Permission,
  Product,
  Profile,
  PROFILES,
  SCOPES,
  Scope,
  Session,
  Team,
  User,
} from './entities';
import { seed } from './seed';

/** opções dos selects (distribuidoras, produtos, campanhas, perfis, equipes) */
@Controller('lookups')
export class LookupsController {
  constructor(private readonly db: DataSource) {}

  @Get()
  async all() {
    const [distributors, products, campaigns, profiles, teams] = await Promise.all([
      this.db.getRepository(Distributor).find({ select: ['id', 'name', 'code', 'status'], order: { name: 'ASC' } }),
      this.db.getRepository(Product).find({ select: ['id', 'name', 'sku', 'priceCents'], order: { sku: 'ASC' } }),
      this.db.getRepository(Campaign).find({ select: ['id', 'name', 'status', 'startDate', 'endDate'], order: { startDate: 'DESC' } }),
      this.db.getRepository(Profile).find({ select: ['key', 'name'], order: { id: 'ASC' } }),
      this.db.getRepository(Team).find({ select: ['id', 'name', 'distributorId', 'managerId'], order: { name: 'ASC' } }),
    ]);
    return { distributors, products, campaigns, profiles, teams, permissions: PERMISSIONS, scopes: SCOPES };
  }
}

class ProfileDto {
  @IsArray() @IsIn(PERMISSIONS, { each: true }) permissions: Permission[];
  @IsIn(SCOPES) scope: Scope;
}

class CopyProfileDto {
  @IsIn(PROFILES) from: string;
  @IsIn(PROFILES) to: string;
}

@Controller('profiles')
export class ProfilesController {
  constructor(
    private readonly db: DataSource,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
  ) {}

  @Get()
  list() {
    return this.profiles.find({ order: { id: 'ASC' } });
  }

  @Perm('USERS_EDIT')
  @Patch(':key')
  async update(@CurrentUser() actor: AuthUser, @Param('key') key: string, @Body() body: ProfileDto) {
    const profile = await this.profiles.findOneBy({ key: key as Profile['key'] });
    if (!profile) throw new BadRequestException('Perfil não encontrado');
    if (key === 'super_admin' && !body.permissions.includes('USERS_EDIT'))
      throw new BadRequestException('O Super Admin não pode perder USERS_EDIT (ninguém mais conseguiria editar perfis)');
    const before = { permissions: profile.permissions, scope: profile.scope };
    await this.db.transaction(async (m) => {
      await m.update(Profile, profile.id, body);
      const added = body.permissions.filter((p) => !before.permissions.includes(p));
      const removed = before.permissions.filter((p) => !body.permissions.includes(p));
      const parts = [...added.map((p) => `+ ${p}`), ...removed.map((p) => `- ${p}`)];
      if (before.scope !== body.scope) parts.push(`escopo ${before.scope} → ${body.scope}`);
      await audit(m, actor, 'profile.update', 'profile', key, `${profile.name}: ${parts.join(', ') || 'sem mudanças'}`, before, body);
    });
    return this.profiles.findOneBy({ key: key as Profile['key'] });
  }

  @Perm('USERS_EDIT')
  @Post('copy')
  async copy(@CurrentUser() actor: AuthUser, @Body() body: CopyProfileDto) {
    const from = await this.profiles.findOneByOrFail({ key: body.from as Profile['key'] });
    const to = await this.profiles.findOneByOrFail({ key: body.to as Profile['key'] });
    return this.update(actor, to.key, { permissions: from.permissions, scope: from.scope });
  }
}

class AuditQuery extends PageQuery {
  @IsOptional() @IsString() target_type?: string;
  @IsOptional() @IsString() target_id?: string;
  @IsOptional() @IsString() action?: string;
  @IsOptional() @IsString() actor?: string;
}

@Controller('audit')
export class AuditController {
  constructor(@InjectRepository(AuditLog) private readonly logs: Repository<AuditLog>) {}

  /** tipos de entidade já registrados (opções do filtro) */
  @Perm('REPORTS_VIEW', 'USERS_EDIT')
  @Get('types')
  async types() {
    const rows = await this.logs.createQueryBuilder('a').select('DISTINCT a.targetType', 'type').orderBy('type').getRawMany<{ type: string }>();
    return rows.map((r) => r.type);
  }

  @Perm('REPORTS_VIEW', 'USERS_EDIT')
  @Get()
  async list(@Query() q: AuditQuery) {
    const qb = applyPeriod(this.logs.createQueryBuilder('a'), q);
    if (q.target_type) qb.andWhere('a.targetType IN (:...t)', { t: q.target_type.split(',') });
    if (q.target_id) qb.andWhere('a.targetId = :i', { i: q.target_id });
    if (q.action) qb.andWhere('a.action LIKE :ac', { ac: `${q.action}%` });
    if (q.actor) qb.andWhere('a.actorName LIKE :n', { n: `%${q.actor}%` });
    if (q.search) qb.andWhere('a.description LIKE :s', { s: `%${q.search}%` });
    const page = await paginate(qb, q);
    page.data = page.data.map((a) => ({ ...a, before: maskPersonal(a.before), after: maskPersonal(a.after) }));
    return page;
  }
}

/** dado pessoal não sai da API de auditoria: CPF vira ***.456.789-** */
function maskPersonal(value: any): any { // eslint-disable-line
  if (Array.isArray(value)) return value.map(maskPersonal);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, /cpf/i.test(k) && typeof v === 'string' ? maskCpf(onlyDigits(v)) : maskPersonal(v)]),
    );
  return value;
}

@Controller('sessions')
export class SessionsController {
  constructor(
    private readonly db: DataSource,
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
  ) {}

  @Perm('USERS_DISABLE')
  @Get()
  list(@Query() q: PageQuery) {
    const qb = this.sessions.createQueryBuilder('s').where('s.revokedAt IS NULL').orderBy('s.createdAt', 'DESC');
    if (q.search) qb.andWhere('s.userName LIKE :s', { s: `%${q.search}%` });
    return paginate(qb, q);
  }

  @Perm('USERS_DISABLE')
  @Post(':id/revoke')
  @HttpCode(200)
  async revoke(@CurrentUser() actor: AuthUser, @Param('id') id: number) {
    const s = await this.sessions.findOneByOrFail({ id, revokedAt: IsNull() });
    await this.db.transaction(async (m) => {
      await m.update(Session, id, { revokedAt: new Date() });
      await audit(m, actor, 'session.revoke', 'user', s.userId, `Encerrou a sessão de ${s.userName}`);
    });
    return { ok: true };
  }
}

@Controller('admin')
export class DemoController {
  constructor(private readonly db: DataSource) {}

  /** status do ambiente (aberto: a tela de login mostra o selo de demonstração) */
  @Public()
  @Get('health')
  health() {
    return { ok: true, demo: true };
  }

  /** apaga tudo e recria os dados fictícios */
  @Perm('USERS_EDIT')
  @Post('reset-demo')
  @HttpCode(200)
  async reset(@CurrentUser() actor: AuthUser) {
    if (!actor.profiles.includes('super_admin')) throw new BadRequestException('Só o Super Admin restaura os dados');
    await this.db.synchronize(true);
    await seed(this.db);
    return { ok: true };
  }
}

/** recuperação de acesso: apaga o app autenticador cadastrado; no próximo login o usuário cadastra de novo */
@Controller('mfa')
export class MfaController {
  constructor(private readonly db: DataSource) {}

  @Perm('USERS_EDIT', 'USERS_DISABLE')
  @Post('users/:id/reset')
  @HttpCode(200)
  async reset(@CurrentUser() actor: AuthUser, @Param('id') id: number) {
    return this.db.transaction(async (m) => {
      const user = await m.findOneByOrFail(User, { id });
      await m.update(User, id, { totpSecret: null, totpEnabled: false, totpLastStep: null });
      await audit(m, actor, 'user.mfa_reset', 'user', id, `Redefiniu o MFA de ${user.name}`, { mfaEnabled: user.totpEnabled }, { mfaEnabled: false });
      return { ok: true };
    });
  }
}
