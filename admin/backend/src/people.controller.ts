import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  UnprocessableEntityException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as bcrypt from 'bcryptjs';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type { Response } from 'express';
import { DataSource, EntityManager, In } from 'typeorm';
import { AuthUser, CurrentUser, distributorScope, Perm } from './auth';
import { isValidCpf, onlyDigits, PageQuery, paginate } from './common';
import { audit, AuditLog, Campaign, Distributor, ImportBatch, PROFILES, ProfileKey, Team, User } from './entities';
import {
  ensureCanGrant,
  ensureDistributorInScope,
  ensureUserInScope,
  formatCnpj,
  hasProfile,
  latestCompetence,
  presentUsers,
  readSheet,
  scopeUsers,
  snapshot,
  tempPassword,
  xlsxBuffer,
} from './people.shared';

const Int = () => Type(() => Number);

/** DTO com target ES2022 traz campos opcionais como undefined: tira antes de mesclar */
const defined = <T extends object>(body: T) => Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)) as Partial<T>;

/** ordenação em memória: números e textos (pt-BR) */
const compare = (a: unknown, b: unknown, dir?: string) =>
  (typeof a === 'number' && typeof b === 'number' ? a - b : String(a ?? '').localeCompare(String(b ?? ''), 'pt-BR')) * (dir === 'desc' ? -1 : 1);

// =====================================================================
// Usuários
// =====================================================================

class UserQuery extends PageQuery {
  @IsOptional() @IsIn(PROFILES) profile?: ProfileKey;
  @IsOptional() @Int() @IsInt() distributor_id?: number;
  @IsOptional() @Int() @IsInt() team_id?: number;
  @IsOptional() @Int() @IsInt() manager_id?: number;
  @IsOptional() @IsIn(['active', 'inactive', 'blocked']) status?: string;
  @IsOptional() @IsIn(['name', 'email', 'lastAccessAt', 'createdAt']) sort?: string;
  @IsOptional() @IsIn(['asc', 'desc']) dir?: string;
}

class UserDto {
  @IsString() @MinLength(3) @MaxLength(120) name: string;
  @IsEmail({}, { message: 'E-mail inválido' }) email: string;
  @IsOptional() @IsString() cpf?: string;
  @IsArray() @ArrayMinSize(1, { message: 'Escolha ao menos um perfil' }) @IsIn(PROFILES, { each: true }) profiles: ProfileKey[];
  @IsOptional() @Int() @IsInt() distributorId?: number | null;
  @IsOptional() @Int() @IsInt() managerId?: number | null;
  @IsOptional() @Int() @IsInt() teamId?: number | null;
}

class PatchUserDto {
  @IsOptional() @IsString() @MinLength(3) @MaxLength(120) name?: string;
  @IsOptional() @IsEmail({}, { message: 'E-mail inválido' }) email?: string;
  @IsOptional() @IsString() cpf?: string;
  @IsOptional() @IsArray() @ArrayMinSize(1) @IsIn(PROFILES, { each: true }) profiles?: ProfileKey[];
  @IsOptional() @Int() @IsInt() distributorId?: number | null;
  @IsOptional() @Int() @IsInt() managerId?: number | null;
  @IsOptional() @Int() @IsInt() teamId?: number | null;
}

class BulkUserDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10000) @IsInt({ each: true }) ids: number[];
  @IsOptional() @IsIn(['active', 'inactive']) status?: 'active' | 'inactive';
  @IsOptional() @IsIn(['block', 'unblock']) block?: 'block' | 'unblock';
  @IsOptional() @Int() @IsInt() distributorId?: number;
  @IsOptional() @Int() @IsInt() teamId?: number;
  @IsOptional() @Int() @IsInt() managerId?: number;
  @IsOptional() @IsIn(PROFILES) addProfile?: ProfileKey;
  @IsOptional() @IsIn(PROFILES) removeProfile?: ProfileKey;
}

class StatusDto {
  @IsIn(['block', 'unblock', 'activate', 'deactivate']) action: 'block' | 'unblock' | 'activate' | 'deactivate';
}

const USER_COLUMNS = ['nome', 'email', 'cpf', 'perfis', 'distribuidora_codigo', 'gerente_email'];
const PROFILE_ALIASES: Record<string, ProfileKey> = {
  vendedor: 'seller', seller: 'seller', gerente: 'manager', manager: 'manager', 'ponto focal': 'focal', focal: 'focal',
  ponto_focal: 'focal', admin: 'admin', 'admin do cliente': 'admin', super_admin: 'super_admin', 'super admin': 'super_admin',
};

/** meta de cada equipe na competência (team_goals); sem linha = sem meta */
/** vendedor com o mesmo nome (ignora maiúsculas e espaços extras); o índice uq_users_seller_name segura o resto */
// ponytail: lower() do SQLite só trata ASCII ("JOÃO" ≠ "joão"); normalizar numa coluna se isso importar
async function sellerNameTaken(m: EntityManager, name: string, selfId?: number) {
  return m
    .createQueryBuilder(User, 'u')
    .where('lower(u.name) = lower(:n)', { n: name })
    .andWhere(`u.profiles LIKE '%"seller"%'`)
    .andWhere('u.id != :id', { id: selfId ?? -1 })
    .getOne();
}
export const cleanName = (s: string) => s.trim().replace(/\s+/g, ' ');

async function monthGoals(m: { query: (sql: string, params?: unknown[]) => Promise<{ teamId: number; goalCents: number }[]> }, competence: string) {
  const rows = await m.query('SELECT teamId, goalCents FROM team_goals WHERE competence = ?', [competence]);
  return new Map(rows.map((r) => [Number(r.teamId), Number(r.goalCents)]));
}

@Controller('users')
export class UsersController {
  constructor(private readonly db: DataSource) {}

  @Perm('USERS_VIEW')
  @Get()
  async list(@CurrentUser() actor: AuthUser, @Query() q: UserQuery) {
    const m = this.db.manager;
    const qb = m.createQueryBuilder(User, 'u');
    await scopeUsers(qb, actor, m);
    if (q.profile) qb.andWhere(hasProfile('u', q.profile));
    if (q.distributor_id) qb.andWhere('u.distributorId = :d', { d: q.distributor_id });
    if (q.team_id) qb.andWhere('u.teamId = :t', { t: q.team_id });
    if (q.manager_id) qb.andWhere('u.managerId = :mg', { mg: q.manager_id });
    if (q.status === 'blocked') qb.andWhere('u.blocked = 1');
    else if (q.status) qb.andWhere('u.status = :st AND u.blocked = 0', { st: q.status });
    if (q.search) {
      const digits = onlyDigits(q.search);
      qb.andWhere(
        digits.length >= 3 && digits.length === q.search.replace(/[.\-\s]/g, '').length
          ? 'u.cpf LIKE :cpf'
          : '(u.name LIKE :s OR u.email LIKE :s)',
        { s: `%${q.search.trim()}%`, cpf: `%${digits}%` },
      );
    }
    qb.orderBy(`u.${q.sort ?? 'name'}`, q.dir === 'desc' ? 'DESC' : 'ASC').addOrderBy('u.id', 'ASC');
    const page = await paginate(qb, q);
    return { ...page, data: await presentUsers(m, page.data) };
  }

  @Perm('USERS_CREATE')
  @Get('template')
  async template(@Res() res: Response) {
    const buffer = await xlsxBuffer('usuarios', USER_COLUMNS, [
      ['Maria da Silva', 'maria.silva@exemplo.com', '529.982.247-25', 'vendedor', 'DIST01', 'gerente1@incentiva.demo'],
      ['João Pereira', 'joao.pereira@exemplo.com', '111.444.777-35', 'gerente, ponto focal', 'DIST02', ''],
    ]);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="modelo-usuarios.xlsx"');
    res.end(buffer);
  }

  @Perm('USERS_VIEW')
  @Get(':id')
  async one(@CurrentUser() actor: AuthUser, @Param('id', ParseIntPipe) id: number) {
    const user = await ensureUserInScope(this.db.manager, actor, id);
    return (await presentUsers(this.db.manager, [user]))[0];
  }

  @Perm('USERS_VIEW')
  @Get(':id/history')
  async history(@CurrentUser() actor: AuthUser, @Param('id', ParseIntPipe) id: number) {
    await ensureUserInScope(this.db.manager, actor, id);
    return this.db.manager.find(AuditLog, { where: { targetType: 'user', targetId: String(id) }, order: { createdAt: 'DESC', id: 'DESC' }, take: 100 });
  }

  @Perm('USERS_CREATE')
  @Post()
  async create(@CurrentUser() actor: AuthUser, @Body() body: UserDto) {
    return this.db.transaction(async (m) => {
      await ensureCanGrant(m, actor, body.profiles);
      const data = await this.clean(m, actor, body);
      const password = tempPassword();
      const user = await m.save(
        m.create(User, {
          ...data,
          passwordHash: await bcrypt.hash(password, 10),
          status: 'active',
          blocked: false,
        } as Partial<User>),
      );
      await audit(m, actor, 'user.create', 'user', user.id, `Criou o usuário ${user.name} (${user.profiles.join(', ')})`, null, snapshot(user));
      return { user: (await presentUsers(m, [user]))[0], tempPassword: password };
    });
  }

  @Perm('USERS_EDIT')
  @Patch(':id')
  async update(@CurrentUser() actor: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() body: PatchUserDto) {
    return this.db.transaction(async (m) => {
      const user = await ensureUserInScope(m, actor, id);
      await ensureCanGrant(m, actor, user.profiles); // não edita quem tem mais acesso que ele
      if (body.profiles) {
        const changed = [...body.profiles.filter((p) => !user.profiles.includes(p)), ...user.profiles.filter((p) => !body.profiles!.includes(p))];
        await ensureCanGrant(m, actor, changed);
      }
      const before = snapshot(user);
      Object.assign(user, await this.clean(m, actor, { ...before, ...defined(body) } as UserDto, user.id));
      await m.save(user);
      const after = snapshot(user);
      const diff = Object.keys(after).filter((k) => JSON.stringify(before[k as keyof typeof before]) !== JSON.stringify(after[k as keyof typeof after]));
      await audit(m, actor, 'user.update', 'user', id, `Editou ${user.name}: ${diff.join(', ') || (body.cpf ? 'cpf' : 'sem mudanças')}`, before, after);
      return (await presentUsers(m, [user]))[0];
    });
  }

  @Perm('USERS_DISABLE')
  @Post(':id/status')
  @HttpCode(200)
  async setStatus(@CurrentUser() actor: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() { action }: StatusDto) {
    if (id === actor.id) throw new BadRequestException('Você não pode bloquear ou desativar a si mesmo');
    return this.db.transaction(async (m) => {
      const user = await ensureUserInScope(m, actor, id);
      await ensureCanGrant(m, actor, user.profiles);
      const before = snapshot(user);
      if (action === 'block' || action === 'unblock') user.blocked = action === 'block';
      else user.status = action === 'activate' ? 'active' : 'inactive';
      await m.save(user);
      const label = { block: 'Bloqueou', unblock: 'Desbloqueou', activate: 'Ativou', deactivate: 'Desativou' }[action];
      await audit(m, actor, `user.${action}`, 'user', id, `${label} ${user.name}`, before, snapshot(user));
      return (await presentUsers(m, [user]))[0];
    });
  }

  @Perm('USERS_EDIT')
  @Post(':id/reset-password')
  @HttpCode(200)
  async resetPassword(@CurrentUser() actor: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.db.transaction(async (m) => {
      const user = await ensureUserInScope(m, actor, id);
      await ensureCanGrant(m, actor, user.profiles);
      const password = tempPassword();
      await m.update(User, id, { passwordHash: await bcrypt.hash(password, 10) });
      await audit(m, actor, 'user.reset_password', 'user', id, `Redefiniu a senha de ${user.name}`);
      // ponytail: senha mostrada uma vez na tela; com e-mail real, enviar link de redefinição
      return { tempPassword: password };
    });
  }

  /** edição em massa: uma operação, um registro de auditoria */
  @Perm('USERS_EDIT')
  @Post('bulk')
  @HttpCode(200)
  async bulk(@CurrentUser() actor: AuthUser, @Body() body: BulkUserDto) {
    const changes = (['status', 'block', 'distributorId', 'teamId', 'managerId', 'addProfile', 'removeProfile'] as const).filter((k) => body[k] != null);
    if (!changes.length) throw new BadRequestException('Escolha ao menos uma alteração');
    if ((body.status || body.block) && !actor.permissions.includes('USERS_DISABLE'))
      throw new ForbiddenException('Sem permissão (USERS_DISABLE) para alterar status');
    if (body.status || body.block) {
      if (body.ids.includes(actor.id)) throw new BadRequestException('Remova você mesmo da seleção para alterar status');
    }

    return this.db.transaction(async (m) => {
      const qb = m.createQueryBuilder(User, 'u').where('u.id IN (:...ids)', { ids: body.ids });
      const users = await (await scopeUsers(qb, actor, m)).getMany();
      if (users.length !== new Set(body.ids).size) throw new ForbiddenException('Há usuários fora do seu escopo na seleção');
      await ensureCanGrant(m, actor, [...new Set(users.flatMap((u) => u.profiles))]);
      await ensureCanGrant(m, actor, [body.addProfile, body.removeProfile].filter(Boolean) as ProfileKey[]);

      let team: Team | null = null;
      if (body.teamId) {
        team = await m.findOneBy(Team, { id: body.teamId });
        if (!team) throw new BadRequestException('Equipe não encontrada');
      }
      const distributorId = team?.distributorId ?? body.distributorId;
      ensureDistributorInScope(actor, distributorId);
      if (body.distributorId && !(await m.existsBy(Distributor, { id: body.distributorId }))) throw new BadRequestException('Distribuidora não encontrada');
      if (body.managerId) await this.checkManager(m, body.managerId);

      for (const u of users) {
        if (body.status) u.status = body.status;
        if (body.block) u.blocked = body.block === 'block';
        if (distributorId) u.distributorId = distributorId;
        if (team) Object.assign(u, { teamId: team.id, managerId: team.managerId });
        if (body.managerId) u.managerId = body.managerId;
        if (body.addProfile && !u.profiles.includes(body.addProfile)) {
          if (body.addProfile === 'seller' && (await sellerNameTaken(m, u.name, u.id)))
            throw new ConflictException(`Já existe um vendedor chamado ${u.name}`);
          u.profiles = [...u.profiles, body.addProfile];
        }
        if (body.removeProfile) {
          const next = u.profiles.filter((p) => p !== body.removeProfile);
          if (!next.length) throw new BadRequestException(`${u.name} ficaria sem perfil`);
          u.profiles = next;
        }
      }
      // ponytail: save em lote de 200; com dezenas de milhares por vez, trocar por UPDATE ... WHERE id IN
      for (let i = 0; i < users.length; i += 200) await m.save(users.slice(i, i + 200));
      const { ids, ...patch } = body;
      // uma linha por usuário para o histórico individual + uma linha resumo da operação
      const rows = users.map((u) => ({ action: 'user.bulk_update', actorId: actor.id, actorName: actor.name, targetType: 'user', targetId: String(u.id), description: `Edição em massa (${users.length} usuários): ${changes.join(', ')}` }));
      for (let i = 0; i < rows.length; i += 500) await m.insert(AuditLog, rows.slice(i, i + 500));
      await audit(m, actor, 'user.bulk_update', 'user', 'bulk', `Edição em massa de ${users.length} usuário(s): ${changes.join(', ')}`, { ids }, patch);
      return { updated: users.length };
    });
  }

  /** importação por planilha: tudo ou nada, relatório por linha */
  @Perm('USERS_CREATE')
  @Post('import')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async import(@CurrentUser() actor: AuthUser, @UploadedFile() file: Express.Multer.File) {
    const rows = await readSheet(file, ['nome', 'email', 'cpf', 'perfis']);
    if (!rows.length) throw new BadRequestException('Planilha sem linhas');
    if (rows.length > 2000) throw new BadRequestException('Máximo de 2.000 usuários por planilha');

    return this.db.transaction(async (m) => {
      const errors: { line: number; message: string }[] = [];
      const dists = await m.find(Distributor);
      const emails = rows.map((r) => (r.email ?? '').toLowerCase().trim());
      const managerEmails = rows.map((r) => (r.gerente_email ?? '').toLowerCase().trim()).filter(Boolean);
      const existing = new Set((await m.find(User, { select: ['email'], where: { email: In(emails.concat('-')) } })).map((u) => u.email));
      const managers = await m.find(User, { where: { email: In(managerEmails.concat('-')) } });
      const cpfs = rows.map((r) => onlyDigits(r.cpf).padStart(11, '0'));
      const existingCpf = new Set((await m.find(User, { select: ['cpf'], where: { cpf: In(cpfs.concat('-')) } })).map((u) => u.cpf));
      const seen = new Set<string>();
      const seenCpf = new Set<string>();
      // ponytail: carrega os nomes de todos os vendedores (~10 mil); com centenas de milhares, consultar só os da planilha
      const seenName = new Set(
        (await m.createQueryBuilder(User, 'u').select('lower(u.name)', 'n').where(`u.profiles LIKE '%"seller"%'`).getRawMany<{ n: string }>()).map((r) => r.n),
      );
      const toCreate: Partial<User>[] = [];
      const grant = new Set<ProfileKey>();

      rows.forEach((r, i) => {
        const line = i + 2;
        const fail = (message: string) => errors.push({ line, message });
        const email = emails[i];
        const cpf = onlyDigits(r.cpf).padStart(11, '0');
        const profiles = [...new Set((r.perfis ?? '').split(/[,;|]/).map((p) => PROFILE_ALIASES[p.trim().toLowerCase()]).filter(Boolean))];
        if (!r.nome || r.nome.length < 3) return fail('Nome obrigatório');
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail(`E-mail inválido: ${r.email ?? ''}`);
        if (existing.has(email) || seen.has(email)) return fail(`E-mail já cadastrado: ${email}`);
        if (!isValidCpf(cpf)) return fail(`CPF inválido: ${r.cpf ?? ''}`);
        if (existingCpf.has(cpf) || seenCpf.has(cpf)) return fail(`CPF já cadastrado: ${r.cpf}`);
        if (!profiles.length) return fail(`Perfil inválido: "${r.perfis ?? ''}" (use vendedor, gerente, ponto focal, admin)`);
        const name = cleanName(r.nome);
        if (profiles.includes('seller') && seenName.has(name.toLowerCase())) return fail(`Já existe um vendedor chamado ${name}`);
        const dist = r.distribuidora_codigo ? dists.find((d) => d.code.toLowerCase() === r.distribuidora_codigo.toLowerCase()) : null;
        if (r.distribuidora_codigo && !dist) return fail(`Distribuidora não encontrada: ${r.distribuidora_codigo}`);
        if (dist) {
          const allowed = distributorScope(actor);
          if (allowed && !allowed.includes(dist.id)) return fail(`Distribuidora fora do seu escopo: ${dist.code}`);
        }
        if ((profiles.includes('seller') || profiles.includes('focal')) && !dist) return fail('Vendedor/ponto focal precisa de distribuidora_codigo');
        const manager = r.gerente_email ? managers.find((u) => u.email === r.gerente_email.toLowerCase().trim()) : null;
        if (r.gerente_email && (!manager || !manager.profiles.includes('manager'))) return fail(`Gerente não encontrado: ${r.gerente_email}`);
        seen.add(email);
        seenCpf.add(cpf);
        if (profiles.includes('seller')) seenName.add(name.toLowerCase());
        profiles.forEach((p) => grant.add(p));
        toCreate.push({ name, email, cpf, profiles, distributorId: dist?.id ?? null, managerId: manager?.id ?? null, status: 'active', blocked: false });
      });

      try {
        await ensureCanGrant(m, actor, [...grant]);
      } catch (e) {
        errors.push({ line: 0, message: (e as Error).message });
      }
      if (errors.length) throw new UnprocessableEntityException({ message: `${errors.length} linha(s) com erro. Nada foi importado.`, errors });

      // vendedor com gerente entra na equipe que o gerente gerencia na mesma distribuidora
      const teams = await m.find(Team, { where: { managerId: In(managers.map((u) => u.id).concat(-1)) } });
      const password = tempPassword();
      const hash = await bcrypt.hash(password, 10);
      for (const u of toCreate) {
        u.passwordHash = hash;
        const team = teams.find((t) => t.managerId === u.managerId && t.distributorId === u.distributorId);
        if (team && u.profiles!.includes('seller')) u.teamId = team.id;
      }
      for (let i = 0; i < toCreate.length; i += 300) await m.insert(User, toCreate.slice(i, i + 300) as never);
      await audit(m, actor, 'user.import', 'user', 'import', `Importou ${toCreate.length} usuário(s) da planilha ${file.originalname}`, null, { count: toCreate.length, file: file.originalname });
      return { created: toCreate.length, tempPassword: password };
    });
  }

  /** normaliza e valida os dados de criação/edição */
  private async clean(m: EntityManager, actor: AuthUser, body: UserDto, selfId?: number) {
    const email = body.email.toLowerCase().trim();
    const dup = await m.findOneBy(User, { email });
    if (dup && dup.id !== selfId) throw new ConflictException('E-mail já cadastrado');
    let cpf: string | undefined;
    if (body.cpf !== undefined && !body.cpf.includes('*')) {
      cpf = onlyDigits(body.cpf).padStart(11, '0');
      if (!isValidCpf(cpf)) throw new BadRequestException('CPF inválido');
      const cpfDup = await m.findOneBy(User, { cpf });
      if (cpfDup && cpfDup.id !== selfId) throw new ConflictException('CPF já cadastrado para outro usuário');
    }
    const profiles = [...new Set(body.profiles)];
    let distributorId = body.distributorId ?? null;
    let managerId = body.managerId ?? null;
    const teamId = body.teamId ?? null;
    if (teamId) {
      const team = await m.findOneBy(Team, { id: teamId });
      if (!team) throw new BadRequestException('Equipe não encontrada');
      distributorId = team.distributorId;
      managerId = managerId ?? team.managerId;
    }
    if (distributorId && !(await m.existsBy(Distributor, { id: distributorId }))) throw new BadRequestException('Distribuidora não encontrada');
    if ((profiles.includes('seller') || profiles.includes('focal') || profiles.includes('manager')) && !distributorId)
      throw new BadRequestException('Vendedor, gerente e ponto focal precisam de distribuidora');
    ensureDistributorInScope(actor, distributorId);
    if (managerId) {
      if (managerId === selfId) throw new BadRequestException('O usuário não pode ser gerente de si mesmo');
      await this.checkManager(m, managerId);
    }
    const name = cleanName(body.name);
    if (profiles.includes('seller') && (await sellerNameTaken(m, name, selfId)))
      throw new ConflictException(`Já existe um vendedor chamado ${name}. Use o nome completo para diferenciar.`);
    return { name, email, ...(cpf !== undefined ? { cpf } : {}), profiles, distributorId, managerId, teamId };
  }

  private async checkManager(m: EntityManager, id: number) {
    const manager = await m.findOneBy(User, { id });
    if (!manager || !manager.profiles.includes('manager')) throw new BadRequestException('Gerente responsável precisa ter o perfil Gerente');
  }
}

// =====================================================================
// Distribuidoras
// =====================================================================

class DistributorQuery extends PageQuery {
  @IsOptional() @IsIn(['active', 'inactive']) status?: string;
  @IsOptional() @IsString() region?: string;
  @IsOptional() @IsIn(['name', 'code', 'region', 'sellers', 'salesCents', 'points']) sort?: string;
  @IsOptional() @IsIn(['asc', 'desc']) dir?: string;
}

const CNPJ = /^\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}$/;

class DistributorDto {
  @IsString() @MinLength(3) @MaxLength(120) name: string;
  @IsString() @Matches(/^[A-Z0-9-]{2,12}$/i, { message: 'Código: 2 a 12 letras/números' }) code: string;
  @Matches(CNPJ, { message: 'CNPJ no formato 00.000.000/0000-00' }) cnpj: string;
  @IsString() @MinLength(3) @MaxLength(120) responsible: string;
  @IsString() @MinLength(2) @MaxLength(40) region: string;
  @IsOptional() @Int() @IsInt() focalUserId?: number | null;
  @IsOptional() @IsIn(['active', 'inactive']) status?: 'active' | 'inactive';
}

class PatchDistributorDto {
  @IsOptional() @IsString() @MinLength(3) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @Matches(/^[A-Z0-9-]{2,12}$/i, { message: 'Código: 2 a 12 letras/números' }) code?: string;
  @IsOptional() @Matches(CNPJ, { message: 'CNPJ no formato 00.000.000/0000-00' }) cnpj?: string;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(120) responsible?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(40) region?: string;
  @IsOptional() @Int() @IsInt() focalUserId?: number | null;
  @IsOptional() @IsIn(['active', 'inactive']) status?: 'active' | 'inactive';
}

class SellersQuery extends PageQuery {}

@Controller('distributors')
export class DistributorsController {
  constructor(private readonly db: DataSource) {}

  /** agregados por distribuidora (são 35: agrega tudo e pagina em memória) */
  private async aggregates(ids: number[]) {
    const m = this.db.manager;
    const list = ids.concat(-1).join(',');
    const [people, sales, points] = await Promise.all([
      m.query(
        `SELECT distributorId AS id,
                SUM(CASE WHEN profiles LIKE '%"seller"%' THEN 1 ELSE 0 END) AS sellers,
                SUM(CASE WHEN profiles LIKE '%"seller"%' AND status = 'active' AND blocked = 0 THEN 1 ELSE 0 END) AS activeSellers,
                SUM(CASE WHEN profiles LIKE '%"manager"%' THEN 1 ELSE 0 END) AS managers
         FROM users WHERE distributorId IN (${list}) GROUP BY distributorId`,
      ),
      m.query(`SELECT distributorId AS id, SUM(amountCents) AS salesCents, COUNT(*) AS salesCount FROM sales WHERE status = 'active' AND distributorId IN (${list}) GROUP BY distributorId`),
      m.query(`SELECT distributorId AS id, SUM(points) AS points FROM point_entries WHERE distributorId IN (${list}) GROUP BY distributorId`),
    ]);
    const managers = await m.find(User, { select: ['id', 'name', 'distributorId', 'profiles'], where: { distributorId: In(ids.concat(-1)) } });
    const by = (rows: Record<string, number>[], id: number) => rows.find((r) => r.id === id);
    return (id: number) => ({
      sellers: Number(by(people, id)?.sellers ?? 0),
      activeSellers: Number(by(people, id)?.activeSellers ?? 0),
      managersCount: Number(by(people, id)?.managers ?? 0),
      managers: managers.filter((u) => u.distributorId === id && u.profiles.includes('manager')).map((u) => ({ id: u.id, name: u.name })),
      salesCents: Number(by(sales, id)?.salesCents ?? 0),
      salesCount: Number(by(sales, id)?.salesCount ?? 0),
      points: Number(by(points, id)?.points ?? 0),
    });
  }

  private async present(dists: Distributor[]) {
    const agg = await this.aggregates(dists.map((d) => d.id));
    const focals = await this.db.manager.find(User, { select: ['id', 'name', 'email'], where: { id: In(dists.map((d) => d.focalUserId ?? -1).concat(-1)) } });
    return dists.map((d) => ({ ...d, focal: focals.find((f) => f.id === d.focalUserId) ?? null, ...agg(d.id) }));
  }

  private scoped(actor: AuthUser) {
    const qb = this.db.manager.createQueryBuilder(Distributor, 'd');
    const allowed = distributorScope(actor);
    if (allowed) qb.where('d.id IN (:...ids)', { ids: allowed.concat(-1) });
    return qb;
  }

  private async findScoped(actor: AuthUser, id: number) {
    const d = await this.scoped(actor).andWhere('d.id = :id', { id }).getOne();
    if (!d) throw new NotFoundException('Distribuidora não encontrada');
    return d;
  }

  @Perm('USERS_VIEW')
  @Get()
  async list(@CurrentUser() actor: AuthUser, @Query() q: DistributorQuery) {
    const qb = this.scoped(actor);
    if (q.status) qb.andWhere('d.status = :st', { st: q.status });
    if (q.region) qb.andWhere('d.region = :rg', { rg: q.region });
    if (q.search) qb.andWhere('(d.name LIKE :s OR d.code LIKE :s OR d.cnpj LIKE :s OR d.responsible LIKE :s)', { s: `%${q.search.trim()}%` });
    // ponytail: agrega e ordena em memória (35 distribuidoras); paginar no SQL se passar de alguns milhares
    const rows = await this.present(await qb.getMany());
    const field = (q.sort ?? 'name') as 'name';
    rows.sort((a, b) => compare(a[field], b[field], q.dir));
    const start = (q.page - 1) * q.per_page;
    const totals = rows.reduce((t, r) => ({ sellers: t.sellers + r.sellers, salesCents: t.salesCents + r.salesCents, points: t.points + r.points }), { sellers: 0, salesCents: 0, points: 0 });
    return {
      data: rows.slice(start, start + q.per_page),
      pagination: { page: q.page, perPage: q.per_page, total: rows.length, lastPage: Math.max(1, Math.ceil(rows.length / q.per_page)) },
      summary: { ...totals, active: rows.filter((r) => r.status === 'active').length, regions: [...new Set(rows.map((r) => r.region))].sort() },
    };
  }

  @Perm('USERS_VIEW')
  @Get(':id')
  async one(@CurrentUser() actor: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return (await this.present([await this.findScoped(actor, id)]))[0];
  }

  /** painel individual: KPIs, vendas por mês, equipes, metas, campanhas, importações, últimas vendas */
  @Perm('USERS_VIEW')
  @Get(':id/overview')
  async overview(@CurrentUser() actor: AuthUser, @Param('id', ParseIntPipe) id: number) {
    const m = this.db.manager;
    const d = (await this.present([await this.findScoped(actor, id)]))[0];
    const current = await latestCompetence(m);
    const goals = await monthGoals(m, current);
    const [monthly, teamsRaw, teamSales, campaigns, imports, lastSales] = await Promise.all([
      m.query(
        `SELECT competence, SUM(amountCents) AS salesCents, SUM(points) AS points, COUNT(*) AS count
         FROM sales WHERE status = 'active' AND distributorId = ? GROUP BY competence ORDER BY competence`,
        [id],
      ),
      m.find(Team, { where: { distributorId: id }, order: { name: 'ASC' } }),
      m.query(
        `SELECT u.teamId AS teamId, SUM(s.amountCents) AS salesCents, SUM(s.points) AS points,
                SUM(CASE WHEN s.competence = ? THEN s.amountCents ELSE 0 END) AS monthCents
         FROM sales s JOIN users u ON u.id = s.sellerId
         WHERE s.status = 'active' AND s.distributorId = ? GROUP BY u.teamId`,
        [current, id],
      ),
      m.find(Campaign, { order: { startDate: 'DESC' } }),
      m.find(ImportBatch, { where: { distributorId: id }, order: { createdAt: 'DESC' }, take: 24 }),
      m.query(
        `SELECT s.id, s.document, s.date, s.quantity, s.amountCents, s.points, u.name AS sellerName, p.name AS productName
         FROM sales s JOIN users u ON u.id = s.sellerId JOIN products p ON p.id = s.productId
         WHERE s.status = 'active' AND s.distributorId = ? ORDER BY s.date DESC, s.id DESC LIMIT 15`,
        [id],
      ),
    ]);
    const members = await m.query(`SELECT teamId, COUNT(*) AS n FROM users WHERE distributorId = ? AND teamId IS NOT NULL GROUP BY teamId`, [id]);
    const managers = await m.find(User, { select: ['id', 'name'], where: { id: In(teamsRaw.map((t) => t.managerId ?? -1).concat(-1)) } });
    const teams = teamsRaw.map((t) => {
      const s = teamSales.find((x: { teamId: number }) => x.teamId === t.id);
      const monthCents = Number(s?.monthCents ?? 0);
      return {
        ...t,
        managerName: managers.find((u) => u.id === t.managerId)?.name ?? null,
        members: Number(members.find((x: { teamId: number }) => x.teamId === t.id)?.n ?? 0),
        salesCents: Number(s?.salesCents ?? 0),
        points: Number(s?.points ?? 0),
        monthCents,
        monthGoalCents: goals.get(t.id) ?? 0,
        goalPct: goals.get(t.id) ? Math.round((monthCents / goals.get(t.id)!) * 100) : null,
      };
    });
    const monthRow = monthly.find((r: { competence: string }) => r.competence === current);
    const goalCents = teams.reduce((s, t) => s + t.monthGoalCents, 0);
    return {
      distributor: d,
      currentCompetence: current,
      kpis: {
        salesCents: d.salesCents,
        points: d.points,
        sellers: d.sellers,
        activeSellers: d.activeSellers,
        teams: teams.length,
        monthCents: Number(monthRow?.salesCents ?? 0),
        goalCents,
        goalPct: goalCents ? Math.round((Number(monthRow?.salesCents ?? 0) / goalCents) * 100) : null,
      },
      monthly: monthly.map((r: { competence: string; salesCents: number; points: number; count: number }) => ({
        competence: r.competence,
        salesCents: Number(r.salesCents),
        points: Number(r.points),
        count: Number(r.count),
      })),
      teams,
      campaigns: campaigns.filter((c) => !c.distributorIds.length || c.distributorIds.includes(id)),
      imports,
      lastSales,
    };
  }

  @Perm('USERS_VIEW')
  @Get(':id/sellers')
  async sellers(@CurrentUser() actor: AuthUser, @Param('id', ParseIntPipe) id: number, @Query() q: SellersQuery) {
    await this.findScoped(actor, id);
    const m = this.db.manager;
    const qb = m.createQueryBuilder(User, 'u').where('u.distributorId = :id', { id }).andWhere(hasProfile('u', 'seller'));
    await scopeUsers(qb, actor, m);
    if (q.search) qb.andWhere('(u.name LIKE :s OR u.email LIKE :s)', { s: `%${q.search.trim()}%` });
    qb.orderBy('u.name', 'ASC');
    const page = await paginate(qb, q);
    const ids = page.data.map((u) => u.id).concat(-1).join(',');
    const totals: { sellerId: number; salesCents: number; points: number }[] = await m.query(
      `SELECT sellerId, SUM(amountCents) AS salesCents, SUM(points) AS points FROM sales WHERE status = 'active' AND sellerId IN (${ids}) GROUP BY sellerId`,
    );
    const users = await presentUsers(m, page.data);
    return {
      ...page,
      data: users.map((u) => {
        const t = totals.find((x) => x.sellerId === u.id);
        return { ...u, salesCents: Number(t?.salesCents ?? 0), points: Number(t?.points ?? 0) };
      }),
    };
  }

  @Perm('USERS_CREATE')
  @Post()
  async create(@CurrentUser() actor: AuthUser, @Body() body: DistributorDto) {
    if (actor.scope !== 'organization') throw new ForbiddenException('Só administradores cadastram distribuidoras');
    return this.db.transaction(async (m) => {
      const data = await this.clean(m, body);
      const d = await m.save(m.create(Distributor, data as Partial<Distributor>));
      if (d.focalUserId) await this.linkFocal(m, d);
      await audit(m, actor, 'distributor.create', 'distributor', d.id, `Cadastrou a distribuidora ${d.name} (${d.code})`, null, data);
      return (await this.present([d]))[0];
    });
  }

  @Perm('USERS_EDIT')
  @Patch(':id')
  async update(@CurrentUser() actor: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() body: PatchDistributorDto) {
    if (actor.scope !== 'organization') throw new ForbiddenException('Só administradores editam distribuidoras');
    return this.db.transaction(async (m) => {
      const d = await m.findOneBy(Distributor, { id });
      if (!d) throw new NotFoundException('Distribuidora não encontrada');
      const before = { ...d };
      Object.assign(d, await this.clean(m, { ...d, ...defined(body) } as DistributorDto, id));
      await m.save(d);
      if (d.focalUserId && d.focalUserId !== before.focalUserId) await this.linkFocal(m, d);
      const changed = (Object.keys(defined(body)) as (keyof Distributor)[]).filter((k) => before[k] !== d[k]);
      await audit(m, actor, 'distributor.update', 'distributor', id, `Editou ${d.name}: ${changed.join(', ') || 'sem mudanças'}`, before, d);
      return (await this.present([d]))[0];
    });
  }

  private async clean(m: EntityManager, body: DistributorDto, selfId?: number) {
    const code = body.code.toUpperCase().trim();
    const dup = await m.findOneBy(Distributor, { code });
    if (dup && dup.id !== selfId) throw new ConflictException(`Código ${code} já usado por ${dup.name}`);
    const cnpj = formatCnpj(body.cnpj);
    if (!cnpj) throw new BadRequestException('CNPJ precisa ter 14 dígitos');
    if (body.focalUserId) {
      const focal = await m.findOneBy(User, { id: body.focalUserId });
      if (!focal || !focal.profiles.includes('focal')) throw new BadRequestException('O ponto focal precisa ter o perfil Ponto Focal');
      if (focal.distributorId && focal.distributorId !== selfId && selfId)
        throw new BadRequestException(`${focal.name} já responde por outra distribuidora`);
    }
    return {
      name: body.name.trim(),
      code,
      cnpj,
      responsible: body.responsible.trim(),
      region: body.region.trim(),
      focalUserId: body.focalUserId ?? null,
      status: body.status ?? 'active',
    };
  }

  /** ponto focal sem distribuidora passa a pertencer a ela */
  private async linkFocal(m: EntityManager, d: Distributor) {
    await m.createQueryBuilder().update(User).set({ distributorId: d.id }).where('id = :id AND distributorId IS NULL', { id: d.focalUserId }).execute();
  }
}

// =====================================================================
// Equipes
// =====================================================================

class TeamQuery extends PageQuery {
  @IsOptional() @Int() @IsInt() distributor_id?: number;
  @IsOptional() @Int() @IsInt() manager_id?: number;
  @IsOptional() @IsIn(['name', 'members', 'salesCents', 'points', 'goalPct']) sort?: string;
  @IsOptional() @IsIn(['asc', 'desc']) dir?: string;
}

class TeamDto {
  @IsString() @MinLength(3) @MaxLength(80) name: string;
  @Int() @IsInt() distributorId: number;
  @IsOptional() @Int() @IsInt() managerId?: number | null;
  @Int() @IsInt() @Min(0) goalCents: number;
  @IsOptional() @IsIn(['active', 'inactive']) status?: 'active' | 'inactive';
}

class PatchTeamDto {
  @IsOptional() @IsString() @MinLength(3) @MaxLength(80) name?: string;
  @IsOptional() @Int() @IsInt() distributorId?: number;
  @IsOptional() @Int() @IsInt() managerId?: number | null;
  @IsOptional() @Int() @IsInt() @Min(0) goalCents?: number;
  @IsOptional() @IsIn(['active', 'inactive']) status?: 'active' | 'inactive';
}

class MembersDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(2000) @IsInt({ each: true }) userIds: number[];
}

class CandidatesQuery extends PageQuery {}

@Controller('teams')
export class TeamsController {
  constructor(private readonly db: DataSource) {}

  /** equipes no escopo: organização = todas; distribuidoras = da sua; equipe = as que gerencia */
  private scoped(actor: AuthUser) {
    const qb = this.db.manager.createQueryBuilder(Team, 't');
    if (actor.scope === 'distributors') qb.where('t.distributorId IN (:...sd)', { sd: (distributorScope(actor) ?? []).concat(-1) });
    else if (actor.scope === 'team' || actor.scope === 'own') qb.where('t.managerId = :me', { me: actor.id });
    return qb;
  }

  private async findScoped(actor: AuthUser, id: number) {
    const t = await this.scoped(actor).andWhere('t.id = :id', { id }).getOne();
    if (!t) throw new NotFoundException('Equipe não encontrada');
    return t;
  }

  /** indicadores: membros, vendas, pontos, % da meta do mês e evolução (últimos 6 meses) */
  private async indicators(teams: Team[]) {
    const m = this.db.manager;
    const current = await latestCompetence(m);
    const goals = await monthGoals(m, current);
    const ids = teams.map((t) => t.id).concat(-1).join(',');
    const [rows, members, dists, managers] = await Promise.all([
      m.query(
        `SELECT u.teamId AS teamId, s.competence AS competence, SUM(s.amountCents) AS salesCents, SUM(s.points) AS points
         FROM sales s JOIN users u ON u.id = s.sellerId
         WHERE s.status = 'active' AND u.teamId IN (${ids}) GROUP BY u.teamId, s.competence`,
      ),
      m.query(`SELECT teamId, COUNT(*) AS n, SUM(CASE WHEN status = 'active' AND blocked = 0 THEN 1 ELSE 0 END) AS active FROM users WHERE teamId IN (${ids}) GROUP BY teamId`),
      m.find(Distributor, { select: ['id', 'name'], where: { id: In(teams.map((t) => t.distributorId).concat(-1)) } }),
      m.find(User, { select: ['id', 'name'], where: { id: In(teams.map((t) => t.managerId ?? -1).concat(-1)) } }),
    ]);
    const months = [...new Set<string>(rows.map((r: { competence: string }) => r.competence))].sort().slice(-6);
    return {
      current,
      data: teams.map((t) => {
        const mine = rows.filter((r: { teamId: number }) => r.teamId === t.id);
        const month = mine.find((r: { competence: string }) => r.competence === current);
        const monthCents = Number(month?.salesCents ?? 0);
        const mem = members.find((x: { teamId: number }) => x.teamId === t.id);
        return {
          ...t,
          distributorName: dists.find((d) => d.id === t.distributorId)?.name ?? null,
          managerName: managers.find((u) => u.id === t.managerId)?.name ?? null,
          members: Number(mem?.n ?? 0),
          activeMembers: Number(mem?.active ?? 0),
          salesCents: mine.reduce((s: number, r: { salesCents: number }) => s + Number(r.salesCents), 0),
          points: mine.reduce((s: number, r: { points: number }) => s + Number(r.points), 0),
          monthCents,
          monthGoalCents: goals.get(t.id) ?? 0,
          goalPct: goals.get(t.id) ? Math.round((monthCents / goals.get(t.id)!) * 100) : 0,
          evolution: months.map((c) => ({ competence: c, salesCents: Number(mine.find((r: { competence: string }) => r.competence === c)?.salesCents ?? 0) })),
        };
      }),
    };
  }

  @Perm('TEAMS_MANAGE', 'USERS_VIEW')
  @Get()
  async list(@CurrentUser() actor: AuthUser, @Query() q: TeamQuery) {
    const qb = this.scoped(actor);
    if (q.distributor_id) qb.andWhere('t.distributorId = :d', { d: q.distributor_id });
    if (q.manager_id) qb.andWhere('t.managerId = :mg', { mg: q.manager_id });
    if (q.search) qb.andWhere('t.name LIKE :s', { s: `%${q.search.trim()}%` });
    // ponytail: indicadores calculados em memória (50 equipes); paginar no SQL se passar de alguns milhares
    const { current, data } = await this.indicators(await qb.getMany());
    const field = (q.sort ?? 'name') as 'name';
    data.sort((a, b) => compare(a[field], b[field], q.dir));
    const start = (q.page - 1) * q.per_page;
    return {
      data: data.slice(start, start + q.per_page),
      pagination: { page: q.page, perPage: q.per_page, total: data.length, lastPage: Math.max(1, Math.ceil(data.length / q.per_page)) },
      summary: {
        currentCompetence: current,
        teams: data.length,
        members: data.reduce((s, t) => s + t.members, 0),
        salesCents: data.reduce((s, t) => s + t.salesCents, 0),
        onTarget: data.filter((t) => t.goalPct >= 100).length,
      },
    };
  }

  /** detalhe + ranking dos vendedores da equipe */
  @Perm('TEAMS_MANAGE', 'USERS_VIEW')
  @Get(':id')
  async one(@CurrentUser() actor: AuthUser, @Param('id', ParseIntPipe) id: number) {
    const m = this.db.manager;
    const team = await this.findScoped(actor, id);
    const { current, data } = await this.indicators([team]);
    const ranking: { id: number; name: string; status: string; blocked: number; salesCents: number; monthCents: number; points: number; count: number }[] = await m.query(
      `SELECT u.id, u.name, u.status, u.blocked,
              COALESCE(SUM(s.amountCents), 0) AS salesCents,
              COALESCE(SUM(CASE WHEN s.competence = ? THEN s.amountCents ELSE 0 END), 0) AS monthCents,
              COALESCE(SUM(s.points), 0) AS points, COUNT(s.id) AS count
       FROM users u LEFT JOIN sales s ON s.sellerId = u.id AND s.status = 'active'
       WHERE u.teamId = ? GROUP BY u.id ORDER BY salesCents DESC, u.name`,
      [current, id],
    );
    return {
      ...data[0],
      ranking: ranking.map((r, i) => ({
        position: i + 1,
        id: r.id,
        name: r.name,
        status: r.blocked ? 'blocked' : r.status,
        salesCents: Number(r.salesCents),
        monthCents: Number(r.monthCents),
        points: Number(r.points),
        count: Number(r.count),
      })),
    };
  }

  /** vendedores da distribuidora da equipe que ainda não estão nela */
  @Perm('TEAMS_MANAGE')
  @Get(':id/candidates')
  async candidates(@CurrentUser() actor: AuthUser, @Param('id', ParseIntPipe) id: number, @Query() q: CandidatesQuery) {
    const team = await this.findScoped(actor, id);
    const m = this.db.manager;
    const qb = m
      .createQueryBuilder(User, 'u')
      .where('u.distributorId = :d', { d: team.distributorId })
      .andWhere(hasProfile('u', 'seller'))
      .andWhere('(u.teamId IS NULL OR u.teamId != :t)', { t: id });
    if (q.search) qb.andWhere('(u.name LIKE :s OR u.email LIKE :s)', { s: `%${q.search.trim()}%` });
    qb.orderBy('u.teamId IS NULL', 'DESC').addOrderBy('u.name', 'ASC');
    const page = await paginate(qb, q);
    return { ...page, data: await presentUsers(m, page.data) };
  }

  @Perm('TEAMS_MANAGE')
  @Post()
  async create(@CurrentUser() actor: AuthUser, @Body() body: TeamDto) {
    return this.db.transaction(async (m) => {
      const data = await this.clean(m, actor, body);
      const team = await m.save(m.create(Team, data));
      await audit(m, actor, 'team.create', 'team', team.id, `Criou a equipe ${team.name}`, null, data);
      return (await this.indicators([team])).data[0];
    });
  }

  @Perm('TEAMS_MANAGE')
  @Patch(':id')
  async update(@CurrentUser() actor: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() body: PatchTeamDto) {
    return this.db.transaction(async (m) => {
      const team = await this.findScoped(actor, id);
      if (actor.scope === 'team' && ((body.managerId !== undefined && body.managerId !== team.managerId) || (body.distributorId && body.distributorId !== team.distributorId)))
        throw new ForbiddenException('Gerente não troca o gerente nem a distribuidora da equipe');
      const before = { ...team };
      Object.assign(team, await this.clean(m, actor, { ...team, ...defined(body) } as TeamDto));
      await m.save(team);
      // gerente da equipe mudou: os membros passam a responder ao novo gerente
      if (team.managerId !== before.managerId) await m.update(User, { teamId: id }, { managerId: team.managerId });
      const changed = (Object.keys(defined(body)) as (keyof Team)[]).filter((k) => before[k] !== team[k]);
      await audit(m, actor, 'team.update', 'team', id, `Editou a equipe ${team.name}: ${changed.join(', ') || 'sem mudanças'}`, before, team);
      return (await this.indicators([team])).data[0];
    });
  }

  /**
   * Vincula vendedores à equipe. Vindo de outra equipe = transferência
   * (auditada com a equipe anterior de cada um).
   */
  @Perm('TEAMS_MANAGE')
  @Post(':id/members')
  @HttpCode(200)
  async members(@CurrentUser() actor: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() body: MembersDto) {
    return this.db.transaction(async (m) => {
      const team = await this.findScoped(actor, id);
      const qb = m.createQueryBuilder(User, 'u').where('u.id IN (:...ids)', { ids: body.userIds });
      // gerente pode puxar vendedor sem equipe da sua distribuidora, além dos que já gerencia
      if (actor.scope !== 'organization') qb.andWhere('u.distributorId IN (:...sd)', { sd: (distributorScope(actor) ?? []).concat(-1) });
      const users = await qb.getMany();
      if (users.length !== new Set(body.userIds).size) throw new ForbiddenException('Há usuários fora do seu escopo na seleção');
      const notSeller = users.find((u) => !u.profiles.includes('seller'));
      if (notSeller) throw new BadRequestException(`${notSeller.name} não é vendedor`);
      if (actor.scope === 'team') {
        const mine = (await m.findBy(Team, { managerId: actor.id })).map((t) => t.id);
        const foreign = users.find((u) => u.teamId && !mine.includes(u.teamId));
        if (foreign) throw new ForbiddenException(`${foreign.name} está em equipe de outro gerente: peça a transferência a um administrador`);
      }
      const from = users.map((u) => ({ id: u.id, teamId: u.teamId, distributorId: u.distributorId }));
      const otherDist = users.filter((u) => u.distributorId !== team.distributorId).length;
      await m.update(User, { id: In(users.map((u) => u.id)) }, { teamId: team.id, managerId: team.managerId, distributorId: team.distributorId });
      const transfers = users.filter((u) => u.teamId && u.teamId !== team.id).length;
      await audit(
        m,
        actor,
        transfers ? 'team.transfer' : 'team.add_members',
        'team',
        id,
        `${users.length} vendedor(es) vinculado(s) à equipe ${team.name}` + (transfers ? ` (${transfers} transferido(s) de outra equipe)` : '') + (otherDist ? `, ${otherDist} de outra distribuidora` : ''),
        { members: from },
        { teamId: team.id, managerId: team.managerId, distributorId: team.distributorId },
      );
      for (const u of users)
        await audit(m, actor, 'user.team', 'user', u.id, `Equipe: ${u.teamId ?? 'nenhuma'} → ${team.name}`, { teamId: u.teamId }, { teamId: team.id });
      return { linked: users.length, transferred: transfers };
    });
  }

  private async clean(m: EntityManager, actor: AuthUser, body: TeamDto) {
    if (!(await m.existsBy(Distributor, { id: body.distributorId }))) throw new BadRequestException('Distribuidora não encontrada');
    ensureDistributorInScope(actor, body.distributorId);
    let managerId = body.managerId ?? null;
    if (actor.scope === 'team' && !managerId) managerId = actor.id;
    if (managerId) {
      const manager = await m.findOneBy(User, { id: managerId });
      if (!manager || !manager.profiles.includes('manager')) throw new BadRequestException('O gerente precisa ter o perfil Gerente');
    }
    return { name: body.name.trim(), distributorId: body.distributorId, managerId, goalCents: body.goalCents, status: body.status ?? 'active' };
  }
}

