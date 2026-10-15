import {
  BadRequestException,
  Body,
  CanActivate,
  Controller,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Get,
  HttpCode,
  Injectable,
  Post,
  Req,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { IsEmail, IsString, Matches } from 'class-validator';
import { randomUUID } from 'crypto';
import QRCode from 'qrcode';
import { In, IsNull, Repository } from 'typeorm';
import { Permission, Profile, ProfileKey, PROFILES, RecordItem, Scope, SCOPES, Session, Team, User } from './entities';
import { newSecret, otpauthUri, verifyTotp } from './totp';

const PUBLIC = 'public';
const PERMS = 'perms';
export const Public = () => SetMetadata(PUBLIC, true);
/** exige qualquer uma das permissões; checado no backend em toda rota */
export const Perm = (...perms: Permission[]) => SetMetadata(PERMS, perms);

export type AuthUser = User & { permissions: Permission[]; scope: Scope; sessionId: number };
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest().user as AuthUser,
);

export const toApiUser = (u: AuthUser) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  profiles: u.profiles,
  permissions: u.permissions,
  scope: u.scope,
  distributorId: u.distributorId,
});

/**
 * Guard global: toda rota exige login (exceto @Public) e as permissões do
 * @Perm. Recarrega usuário, sessão e perfis a cada request: bloquear usuário,
 * revogar sessão ou tirar permissão vale na hora.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
  ) {}

  async canActivate(ctx: ExecutionContext) {
    if (ctx.getType() !== 'http') return true; // o socket autentica na conexão (realtime.ts)
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest();
    const token = req.headers.authorization?.replace(/^Bearer /, '');
    if (!token) throw new UnauthorizedException();

    let payload: { sub: number; sid: number; mfa?: boolean };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new UnauthorizedException();
    }
    // o token de desafio do MFA não tem sessão e não pode ser usado como login
    if (payload.mfa || !Number.isInteger(payload.sub) || !Number.isInteger(payload.sid)) throw new UnauthorizedException();

    const [user, session] = await Promise.all([
      this.users.findOneBy({ id: payload.sub }),
      this.sessions.findOneBy({ id: payload.sid, revokedAt: IsNull() }),
    ]);
    if (!user || !session) throw new UnauthorizedException();
    if (user.blocked || user.status !== 'active') throw new UnauthorizedException('Acesso bloqueado');

    const access = await resolveAccess(this.profiles, user);
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMS, targets);
    if (required?.length && !required.some((p) => access.permissions.includes(p)))
      throw new ForbiddenException(`Sem permissão (${required.join(' ou ')})`);

    req.user = Object.assign(user, access, { sessionId: session.id });
    return true;
  }
}

export async function resolveAccess(profiles: Repository<Profile>, user: User) {
  const list = await profiles.findBy({ key: In(user.profiles) });
  const permissions = [...new Set(list.flatMap((p) => p.permissions))];
  const scope = SCOPES[Math.max(0, ...list.map((p) => SCOPES.indexOf(p.scope)))];
  return { permissions, scope };
}

/**
 * Distribuidoras que o usuário enxerga. null = todas (escopo organização).
 * Escopo equipe/próprio: só a própria distribuidora (e o resto filtra por equipe/usuário).
 */
export const distributorScope = (u: AuthUser): number[] | null =>
  u.scope === 'organization' ? null : u.distributorId ? [u.distributorId] : [];

/** equipes que o usuário enxerga. null = todas dentro do escopo de distribuidora */
export async function teamScope(teams: Repository<Team>, u: AuthUser): Promise<number[] | null> {
  if (u.scope === 'organization' || u.scope === 'distributors') return null;
  if (u.scope === 'team') return (await teams.findBy({ managerId: u.id })).map((t) => t.id);
  return u.teamId ? [u.teamId] : [];
}

export const ALL_PROFILES = PROFILES;
const MAX_ATTEMPTS = 5;
const attempts = new Map<string, number>();

/**
 * Política de MFA (Configurações → Segurança): perfis obrigados a usar o 2º fator.
 * Sem configuração salva vale para todos os perfis. Usuário com vários perfis:
 * basta um deles estar na política.
 */
export async function mfaProfiles(records: Repository<RecordItem>): Promise<ProfileKey[]> {
  const settings = await records.findOneBy({ kind: 'settings' });
  const list = settings?.data?.mfaProfiles;
  return Array.isArray(list) ? list : [...ALL_PROFILES];
}

async function mfaRequired(records: Repository<RecordItem>, user: User) {
  const required = await mfaProfiles(records);
  return user.profiles.some((p) => required.includes(p));
}

/**
 * Valida o código e ativa o MFA se ainda estava no cadastro. Update condicional:
 * o mesmo código não passa duas vezes (nem em paralelo). 400 e não 401.
 */
async function checkTotp(users: Repository<User>, user: User, code: string) {
  const step = user.totpSecret ? verifyTotp(user.totpSecret, code, user.totpLastStep) : null;
  const ok =
    step != null &&
    (
      await users
        .createQueryBuilder()
        .update()
        .set({ totpLastStep: step, totpEnabled: true })
        .where('id = :id AND (totpLastStep IS NULL OR totpLastStep < :step)', { id: user.id, step })
        .execute()
    ).affected;
  if (!ok) throw new BadRequestException('Código inválido. Confira o código atual no app autenticador.');
}

class MfaDto {
  @IsString() challenge: string;
  @Matches(/^\d{6}$/, { message: 'O código tem 6 dígitos' }) code: string;
}

class LoginDto {
  @IsEmail() email: string;
  @IsString() password: string;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly jwt: JwtService,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
    @InjectRepository(RecordItem) private readonly records: Repository<RecordItem>,
  ) {}

  // ponytail: senha única de demonstração no seed. O 2º fator (TOTP) é real:
  // quem a política de segurança obriga só recebe o token depois do código.
  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: LoginDto, @Req() req: { headers: Record<string, string>; ip: string }) {
    const user = await this.users.findOneBy({ email: body.email.toLowerCase().trim() });
    if (!user || !(await bcrypt.compare(body.password, user.passwordHash)))
      throw new UnauthorizedException('E-mail ou senha inválidos');
    if (user.blocked || user.status !== 'active')
      throw new ForbiddenException('Seu acesso está bloqueado. Fale com o administrador.');

    if (!(await mfaRequired(this.records, user))) return this.startSession(user, req);

    // senha certa: devolve um desafio de 5 min, não o acesso
    const challenge = await this.jwt.signAsync({ sub: user.id, mfa: true, jti: randomUUID() }, { expiresIn: '5m' });
    if (user.totpEnabled) return { mfa: 'required', challenge };
    if (!user.totpSecret) await this.users.update(user.id, { totpSecret: (user.totpSecret = newSecret()) });
    return {
      mfa: 'setup',
      challenge,
      secret: user.totpSecret,
      qr: await QRCode.toDataURL(otpauthUri(user.email, user.totpSecret)),
    };
  }

  /** 2ª etapa: valida o código do app autenticador e só então abre a sessão */
  @Public()
  @Post('mfa')
  @HttpCode(200)
  async mfa(@Body() body: MfaDto, @Req() req: { headers: Record<string, string>; ip: string }) {
    let payload: { sub: number; mfa?: boolean; jti?: string };
    try {
      payload = await this.jwt.verifyAsync(body.challenge);
    } catch {
      throw new UnauthorizedException('O código expirou. Entre com e-mail e senha de novo.');
    }
    if (!payload.mfa || !payload.jti) throw new UnauthorizedException();
    // ponytail: contador em memória (some ao reiniciar); vira tabela/redis com mais de uma instância
    const tries = (attempts.get(payload.jti) ?? 0) + 1;
    attempts.set(payload.jti, tries);
    if (tries > MAX_ATTEMPTS) throw new UnauthorizedException('Muitas tentativas. Entre com e-mail e senha de novo.');

    const user = await this.users.findOneBy({ id: payload.sub });
    if (!user) throw new UnauthorizedException();
    if (user.blocked || user.status !== 'active') throw new ForbiddenException('Seu acesso está bloqueado. Fale com o administrador.');
    await checkTotp(this.users, user, body.code);
    attempts.delete(payload.jti);
    user.totpEnabled = true;
    return this.startSession(user, req);
  }

  private async startSession(user: User, req: { headers: Record<string, string>; ip: string }) {
    const session = await this.sessions.save(
      this.sessions.create({
        userId: user.id,
        userName: user.name,
        userAgent: req.headers['user-agent']?.slice(0, 200) ?? null,
        ip: req.ip,
      }),
    );
    await this.users.update(user.id, { lastAccessAt: new Date() });
    const access = await resolveAccess(this.profiles, user);
    return {
      token: await this.jwt.signAsync({ sub: user.id, sid: session.id }),
      user: toApiUser(Object.assign(user, access, { sessionId: session.id })),
    };
  }

  /** atalhos da tela de login (ambiente de demonstração) */
  @Public()
  @Get('demo-users')
  async demoUsers() {
    const emails = ['admin@incentiva.demo', 'cliente@incentiva.demo', 'gerente1@incentiva.demo', 'vendedor1@incentiva.demo'];
    const users = await this.users.findBy({ email: In(emails) });
    return emails
      .map((e) => users.find((u) => u.email === e))
      .filter(Boolean)
      .map((u) => ({ name: u!.name, email: u!.email, profiles: u!.profiles }));
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return toApiUser(user);
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@CurrentUser() user: AuthUser) {
    await this.sessions.update(user.sessionId, { revokedAt: new Date() });
    return { ok: true };
  }
}
