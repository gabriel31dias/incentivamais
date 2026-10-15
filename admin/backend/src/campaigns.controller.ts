import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Brackets, DataSource, Repository, SelectQueryBuilder } from 'typeorm';
import { AuthUser, CurrentUser, distributorScope, Perm, teamScope } from './auth';
import { PageQuery, paginate } from './common';
import {
  audit,
  CalcType,
  Campaign,
  CampaignStatus,
  EntryType,
  PointEntry,
  PointRule,
  PROFILES,
  ProfileKey,
  Sale,
  Team,
  TeamGoal,
  User,
} from './entities';
import { campaignFor, computePoints, effectiveStatus, ruleLabel } from './points';

// ---------------------------------------------------------------- campanhas

const today = () => new Date().toISOString().slice(0, 10);

const CAMPAIGN_STATUSES: CampaignStatus[] = ['draft', 'scheduled', 'active', 'paused', 'ended'];
const withStatus = (c: Campaign) => ({ ...c, status: effectiveStatus(c), storedStatus: c.status });

// ponytail: banner como data URL na própria linha (~300 KB). Storage de arquivos quando houver backend real.
const BANNER = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/;

class CampaignDto {
  @IsString() @MinLength(3) @MaxLength(120) name: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsDateString() startDate: string;
  @IsDateString() endDate: string;
  @IsOptional() @IsArray() @Type(() => Number) @IsInt({ each: true }) distributorIds?: number[];
  @IsOptional() @IsArray() @IsIn(PROFILES, { each: true }) audience?: ProfileKey[];
  @IsOptional() @IsArray() @Type(() => Number) @IsInt({ each: true }) productIds?: number[];
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(120, { each: true }) rewards?: string[];
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) goalCents?: number;
  @IsOptional() @IsString() @MaxLength(420_000) @Matches(BANNER, { message: 'Banner deve ser uma imagem (png, jpg, webp ou gif)' })
  banner?: string | null;
}

class PatchCampaignDto {
  @IsOptional() @IsString() @MinLength(3) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsArray() @Type(() => Number) @IsInt({ each: true }) distributorIds?: number[];
  @IsOptional() @IsArray() @IsIn(PROFILES, { each: true }) audience?: ProfileKey[];
  @IsOptional() @IsArray() @Type(() => Number) @IsInt({ each: true }) productIds?: number[];
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(120, { each: true }) rewards?: string[];
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) goalCents?: number;
  @IsOptional() @IsString() @MaxLength(420_000) @Matches(BANNER, { message: 'Banner deve ser uma imagem (png, jpg, webp ou gif)' })
  banner?: string | null;
  /** "" remove o banner */
  @IsOptional() @IsIn([true, false]) removeBanner?: boolean;
}

const ACTIONS = ['schedule', 'pause', 'resume', 'end', 'draft'] as const;
type CampaignAction = (typeof ACTIONS)[number];

class StatusDto {
  @IsIn(ACTIONS) action: CampaignAction;
}

class CampaignQuery extends PageQuery {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() sort?: string;
  @IsOptional() @IsString() dir?: string;
}

class GoalsQuery extends PageQuery {
  @IsOptional() @Matches(/^(\d{4}-\d{2}|all)$/) competence?: string;
  @IsOptional() @Type(() => Number) @IsInt() distributorId?: number;
  @IsOptional() @IsString() sort?: string;
  @IsOptional() @IsString() dir?: string;
}

class GoalDto {
  @Type(() => Number) @IsInt() @Min(0) @Max(100_000_000_00) goalCents: number;
}

class BonusDto {
  @Matches(/^\d{4}-\d{2}$/) competence: string;
  @IsOptional() @IsArray() @Type(() => Number) @IsInt({ each: true }) teamIds?: number[];
}

const checkDates = (start?: string, end?: string) => {
  if (start && end && end.slice(0, 10) < start.slice(0, 10))
    throw new BadRequestException('A data de término deve ser igual ou posterior à de início');
};

/** "2026-09" → primeiro e último dia */
const monthRange = (competence: string) => {
  const [y, m] = competence.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [`${competence}-01`, `${competence}-${String(last).padStart(2, '0')}`];
};

@Controller('campaigns')
export class CampaignsController {
  constructor(
    private readonly db: DataSource,
    @InjectRepository(Campaign) private readonly campaigns: Repository<Campaign>,
    @InjectRepository(Team) private readonly teams: Repository<Team>,
  ) {}

  // ponytail: campanhas são poucas (dezenas); filtra/ordena em memória por causa do status efetivo
  @Perm('CAMPAIGNS_MANAGE')
  @Get()
  async list(@Query() q: CampaignQuery) {
    const all = (await this.campaigns.find()).map(withStatus);
    let rows = all;
    if (q.status) rows = rows.filter((c) => c.status === q.status);
    if (q.search) {
      const s = q.search.toLowerCase();
      rows = rows.filter((c) => c.name.toLowerCase().includes(s) || c.description.toLowerCase().includes(s));
    }
    const field = (['name', 'startDate', 'endDate', 'goalCents', 'createdAt'] as const).find((f) => f === q.sort) ?? 'startDate';
    const dir = q.dir === 'asc' ? 1 : -1;
    rows.sort((a, b) => (a[field] > b[field] ? dir : a[field] < b[field] ? -dir : 0));
    const total = rows.length;
    return {
      data: rows.slice((q.page - 1) * q.per_page, q.page * q.per_page),
      pagination: { page: q.page, perPage: q.per_page, total, lastPage: Math.max(1, Math.ceil(total / q.per_page)) },
      summary: Object.fromEntries(CAMPAIGN_STATUSES.map((st) => [st, all.filter((c) => c.status === st).length])),
    };
  }

  // ---------- metas (antes de :id para não colidir) ----------

  /**
   * Metas das equipes. Com competence=AAAA-MM: uma linha por equipe (sem meta no
   * mês aparece com goalCents=null). Com competence=all: uma linha por meta mensal
   * cadastrada, de todas as competências.
   */
  @Perm('CAMPAIGNS_MANAGE', 'TEAMS_MANAGE')
  @Get('goals/teams')
  async teamGoals(@CurrentUser() user: AuthUser, @Query() q: GoalsQuery) {
    const all = q.competence === 'all';
    const competence = all ? null : (q.competence ?? '2026-09');
    const comp = all ? 'g.competence' : ':competence';
    const qb = this.db
      .createQueryBuilder()
      .select(all ? "t.id || ':' || g.competence" : 't.id', 'id')
      .addSelect('t.id', 'teamId')
      .addSelect(all ? 'g.competence' : ':competence', 'competence')
      .addSelect('t.name', 'name')
      .addSelect('g.goalCents', 'goalCents')
      .addSelect('t.goalCents', 'defaultGoalCents')
      .addSelect('g.updatedAt', 'goalUpdatedAt')
      .addSelect('g.createdByName', 'goalByName')
      .addSelect('t.distributorId', 'distributorId')
      .addSelect('d.name', 'distributorName')
      .addSelect('mgr.name', 'managerName')
      .addSelect('(SELECT COUNT(*) FROM users u WHERE u.teamId = t.id AND u.status = \'active\')', 'members')
      .addSelect(
        `(SELECT COALESCE(SUM(s.amountCents),0) FROM sales s JOIN users u ON u.id = s.sellerId
          WHERE u.teamId = t.id AND s.status = 'active' AND s.competence = ${comp})`,
        'soldCents',
      )
      .addSelect(`(SELECT COUNT(*) FROM point_entries e WHERE e.bonusKey = 'GOAL:' || ${comp} || ':T' || t.id)`, 'bonusEntries')
      .from(Team, 't')
      .leftJoin('distributors', 'd', 'd.id = t.distributorId')
      .leftJoin('users', 'mgr', 'mgr.id = t.managerId')
      .where('t.status = :tstatus', { tstatus: 'active' });
    if (all) qb.innerJoin('team_goals', 'g', 'g.teamId = t.id');
    else qb.leftJoin('team_goals', 'g', 'g.teamId = t.id AND g.competence = :competence').setParameter('competence', competence);
    await scopeTeams(qb, user, this.teams);
    if (q.distributorId) qb.andWhere('t.distributorId = :did', { did: q.distributorId });
    if (q.search) qb.andWhere('(t.name LIKE :s OR mgr.name LIKE :s OR d.name LIKE :s)', { s: `%${q.search}%` });

    const rows = (await qb.getRawMany()).map((r) => {
      const goalCents = r.goalCents == null ? null : Number(r.goalCents);
      const soldCents = Number(r.soldCents);
      return {
        ...r,
        id: String(r.id),
        teamId: Number(r.teamId),
        goalCents,
        defaultGoalCents: Number(r.defaultGoalCents),
        soldCents,
        members: Number(r.members),
        percent: goalCents ? Math.round((soldCents / goalCents) * 1000) / 10 : 0,
        reached: !!goalCents && soldCents >= goalCents,
        bonusLaunched: Number(r.bonusEntries) > 0,
      };
    });
    const field = (['name', 'competence', 'goalCents', 'soldCents', 'percent'] as const).find((f) => f === q.sort) ?? (all ? 'competence' : 'percent');
    const dir = q.dir === 'asc' ? 1 : -1;
    rows.sort((a, b) => ((a[field] ?? -1) > (b[field] ?? -1) ? dir : (a[field] ?? -1) < (b[field] ?? -1) ? -dir : 0) || a.name.localeCompare(b.name));
    const total = rows.length;
    return {
      data: rows.slice((q.page - 1) * q.per_page, q.page * q.per_page),
      pagination: { page: q.page, perPage: q.per_page, total, lastPage: Math.max(1, Math.ceil(total / q.per_page)) },
      summary: {
        competence: competence ?? 'all',
        teams: total,
        withGoal: rows.filter((r) => r.goalCents != null).length,
        reached: rows.filter((r) => r.reached).length,
        pendingBonus: all ? 0 : rows.filter((r) => r.reached && !r.bonusLaunched).length,
        goalCents: rows.reduce((s, r) => s + (r.goalCents ?? 0), 0),
        soldCents: rows.filter((r) => r.goalCents != null).reduce((s, r) => s + r.soldCents, 0),
      },
    };
  }

  private async scopedTeam(actor: AuthUser, id: number) {
    const allowed = await teamScope(this.teams, actor);
    const team = await this.teams.findOneBy({ id });
    const scopeDist = distributorScope(actor);
    if (!team || (allowed && !allowed.includes(id)) || (scopeDist && !scopeDist.includes(team.distributorId)))
      throw new NotFoundException('Equipe não encontrada');
    return team;
  }

  /** define (cria ou altera) a meta da equipe numa competência */
  @Perm('CAMPAIGNS_MANAGE', 'TEAMS_MANAGE')
  @Put('goals/teams/:id/:competence')
  async setTeamGoal(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('competence') competence: string,
    @Body() body: GoalDto,
  ) {
    if (!/^\d{4}-\d{2}$/.test(competence)) throw new BadRequestException('Competência inválida (AAAA-MM)');
    const team = await this.scopedTeam(actor, id);
    return this.db.transaction(async (m) => {
      const current = await m.findOneBy(TeamGoal, { teamId: id, competence });
      const brl = (c: number) => `R$ ${(c / 100).toLocaleString('pt-BR')}`;
      if (current) await m.update(TeamGoal, current.id, { goalCents: body.goalCents, createdByName: actor.name });
      else await m.insert(TeamGoal, { teamId: id, competence, goalCents: body.goalCents, createdByName: actor.name });
      await audit(
        m, actor, 'team.goal', 'team', id,
        current
          ? `Meta de ${team.name} em ${competence}: ${brl(current.goalCents)} → ${brl(body.goalCents)}`
          : `Definiu a meta de ${team.name} em ${competence}: ${brl(body.goalCents)}`,
        current ? { competence, goalCents: current.goalCents } : null,
        { competence, goalCents: body.goalCents },
      );
      return { teamId: id, competence, goalCents: body.goalCents };
    });
  }

  /** remove a meta da competência; bloqueado se o bônus daquele mês já foi pago */
  @Perm('CAMPAIGNS_MANAGE', 'TEAMS_MANAGE')
  @Delete('goals/teams/:id/:competence')
  async removeTeamGoal(@CurrentUser() actor: AuthUser, @Param('id', ParseIntPipe) id: number, @Param('competence') competence: string) {
    const team = await this.scopedTeam(actor, id);
    return this.db.transaction(async (m) => {
      const current = await m.findOneBy(TeamGoal, { teamId: id, competence });
      if (!current) throw new NotFoundException('Meta não encontrada');
      if (await m.existsBy(PointEntry, { bonusKey: `GOAL:${competence}:T${id}` }))
        throw new ConflictException('O bônus desta meta já foi lançado. Para remover, estorne os bônus no extrato antes.');
      await m.delete(TeamGoal, current.id);
      await audit(m, actor, 'team.goal.remove', 'team', id, `Removeu a meta de ${team.name} em ${competence}`, { competence, goalCents: current.goalCents }, null);
      return { ok: true };
    });
  }

  /**
   * Bônus de meta: vendedores ativos das equipes que bateram a meta na competência
   * recebem a regra goal_bonus vigente. Idempotente por equipe+competência (bonusKey).
   */
  @Perm('CAMPAIGNS_MANAGE')
  @Post('goals/bonus')
  @HttpCode(200)
  async launchBonus(@CurrentUser() actor: AuthUser, @Body() body: BonusDto) {
    const goals = await this.teamGoals(actor, Object.assign(new GoalsQuery(), { competence: body.competence, page: 1, per_page: 500 }));
    const [, lastDay] = monthRange(body.competence);
    const campaigns = (await this.campaigns.find()).filter((c) => c.status !== 'draft');
    const rules = await this.db.getRepository(PointRule).findBy({ calcType: 'goal_bonus', status: 'active' });

    const eligible = goals.data.filter((t) => t.reached && !t.bonusLaunched && (!body.teamIds?.length || body.teamIds.includes(t.teamId)));
    let sellers = 0;
    let points = 0;
    const launched: string[] = [];
    const skipped: string[] = goals.data.filter((t) => t.reached && t.bonusLaunched).map((t) => t.name);

    await this.db.transaction(async (m) => {
      for (const team of eligible) {
        const campaign = campaignFor(campaigns, { productId: -1, distributorId: team.distributorId, quantity: 0, amountCents: 0, date: lastDay })
          ?? campaigns.find((c) => c.startDate <= lastDay && c.endDate >= lastDay && !c.productIds.length && (!c.distributorIds.length || c.distributorIds.includes(team.distributorId)));
        const rule = rules
          .filter((r) => r.campaignId === campaign?.id && r.startDate <= lastDay && r.endDate >= lastDay && (r.distributorId == null || r.distributorId === team.distributorId))
          .sort((a, b) => b.priority - a.priority)[0];
        if (!rule) {
          skipped.push(`${team.name} (sem regra de bônus vigente)`);
          continue;
        }
        const key = `GOAL:${body.competence}:T${team.teamId}`;
        // checa de novo dentro da transação: dois cliques não lançam duas vezes
        if (await m.existsBy(PointEntry, { bonusKey: key })) continue;
        const members = await m.find(User, { where: { teamId: team.teamId, status: 'active' }, select: ['id', 'name', 'profiles'] });
        const rows = members
          .filter((u) => u.profiles.includes('seller'))
          .map((u) => ({
            sellerId: u.id,
            sellerName: u.name,
            distributorId: team.distributorId,
            campaignId: rule.campaignId,
            type: 'bonus' as EntryType,
            points: rule.value,
            origin: `Bônus meta ${body.competence} · ${team.name}`,
            ruleId: rule.id,
            ruleLabel: ruleLabel(rule),
            bonusKey: key,
            reason: `Equipe atingiu ${team.percent}% da meta`,
            actorName: actor.name,
          }));
        for (let i = 0; i < rows.length; i += 300) await m.insert(PointEntry, rows.slice(i, i + 300));
        sellers += rows.length;
        points += rows.length * rule.value;
        launched.push(team.name);
        await audit(m, actor, 'goal.bonus', 'team', team.teamId, `Bônus de meta ${body.competence}: ${rows.length} vendedores × ${rule.value} pts (${team.name})`, null, { competence: body.competence, ruleId: rule.id, sellers: rows.length });
      }
    });
    return { teams: launched.length, sellers, points, launched, skipped };
  }

  /** metas das campanhas: vendido no mês e acumulado contra a meta */
  @Perm('CAMPAIGNS_MANAGE', 'TEAMS_MANAGE')
  @Get('goals/campaigns')
  async campaignGoals(@CurrentUser() user: AuthUser, @Query() q: GoalsQuery) {
    const competence = q.competence ?? '2026-09';
    const scope = distributorScope(user);
    const rows = await Promise.all(
      (await this.campaigns.find()).map(async (c) => {
        const qb = this.db
          .createQueryBuilder()
          .select('COALESCE(SUM(s.amountCents),0)', 'total')
          .addSelect(`COALESCE(SUM(CASE WHEN s.competence = :competence THEN s.amountCents END),0)`, 'month')
          .from(Sale, 's')
          .where("s.status = 'active' AND s.campaignId = :id", { id: c.id, competence });
        if (scope) qb.andWhere('s.distributorId IN (:...scope)', { scope: scope.length ? scope : [0] });
        const r = await qb.getRawOne();
        const total = Number(r.total);
        return {
          id: c.id,
          name: c.name,
          status: effectiveStatus(c),
          startDate: c.startDate,
          endDate: c.endDate,
          goalCents: c.goalCents,
          soldCents: total,
          monthCents: Number(r.month),
          percent: c.goalCents > 0 ? Math.round((total / c.goalCents) * 1000) / 10 : 0,
        };
      }),
    );
    return rows.sort((a, b) => b.startDate.localeCompare(a.startDate));
  }

  // ---------- CRUD ----------

  @Perm('CAMPAIGNS_MANAGE')
  @Get(':id')
  async one(@Param('id', ParseIntPipe) id: number) {
    const c = await this.campaigns.findOneBy({ id });
    if (!c) throw new NotFoundException('Campanha não encontrada');
    return withStatus(c);
  }

  @Perm('CAMPAIGNS_MANAGE')
  @Post()
  async create(@CurrentUser() actor: AuthUser, @Body() body: CampaignDto) {
    checkDates(body.startDate, body.endDate);
    return this.db.transaction(async (m) => {
      const saved = await m.save(
        m.create(Campaign, {
          name: body.name.trim(),
          description: body.description ?? '',
          startDate: body.startDate.slice(0, 10),
          endDate: body.endDate.slice(0, 10),
          status: 'draft',
          distributorIds: body.distributorIds ?? [],
          audience: body.audience ?? [],
          productIds: body.productIds ?? [],
          rewards: (body.rewards ?? []).map((r) => r.trim()).filter(Boolean),
          goalCents: body.goalCents ?? 0,
          banner: body.banner ?? null,
        }),
      );
      await audit(m, actor, 'campaign.create', 'campaign', saved.id, `Criou a campanha ${saved.name}`, null, { ...saved, banner: saved.banner ? '[imagem]' : null });
      return withStatus(saved);
    });
  }

  @Perm('CAMPAIGNS_MANAGE')
  @Patch(':id')
  async update(@CurrentUser() actor: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() body: PatchCampaignDto) {
    return this.db.transaction(async (m) => {
      const c = await m.findOneBy(Campaign, { id });
      if (!c) throw new NotFoundException('Campanha não encontrada');
      if (effectiveStatus(c) === 'ended') throw new BadRequestException('Campanha encerrada não pode ser editada (duplique para reaproveitar)');
      // DTO de classe traz as chaves não enviadas como undefined: descarta
      const { removeBanner, ...rest } = body;
      const patch = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) as Omit<PatchCampaignDto, 'removeBanner'>;
      const next = { ...c, ...patch } as Campaign;
      if (patch.startDate) next.startDate = patch.startDate.slice(0, 10);
      if (patch.endDate) next.endDate = patch.endDate.slice(0, 10);
      if (patch.rewards) next.rewards = patch.rewards.map((r) => r.trim()).filter(Boolean);
      if (removeBanner) next.banner = null;
      checkDates(next.startDate, next.endDate);
      const before = { ...c, banner: c.banner ? '[imagem]' : null };
      await m.save(Campaign, next);
      const changed = Object.keys(patch).filter((k) => JSON.stringify((c as never)[k]) !== JSON.stringify((next as never)[k]));
      await audit(m, actor, 'campaign.update', 'campaign', id, `Editou ${next.name}: ${changed.join(', ') || 'sem mudanças'}`, before, { ...next, banner: next.banner ? '[imagem]' : null });
      return withStatus(next);
    });
  }

  @Perm('CAMPAIGNS_MANAGE')
  @Post(':id/duplicate')
  async duplicate(@CurrentUser() actor: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.db.transaction(async (m) => {
      const c = await m.findOneBy(Campaign, { id });
      if (!c) throw new NotFoundException('Campanha não encontrada');
      const { id: _omit, createdAt: _c, ...rest } = c;
      void _omit;
      void _c;
      const copy = await m.save(m.create(Campaign, { ...rest, name: `${c.name} (cópia)`.slice(0, 120), status: 'draft' }));
      // regras vigentes vão junto, como versão 1 de regras novas
      const rules = await m.findBy(PointRule, { campaignId: id });
      const current = rules.filter((r) => r.status !== 'superseded');
      for (const r of current) {
        const { id: _r, createdAt: _rc, ...fields } = r;
        void _r;
        void _rc;
        await m.insert(PointRule, { ...fields, ruleKey: newRuleKey(), version: 1, campaignId: copy.id, createdByName: actor.name });
      }
      await audit(m, actor, 'campaign.duplicate', 'campaign', copy.id, `Duplicou ${c.name} → ${copy.name} (${current.length} regras)`, { sourceId: id }, { id: copy.id });
      return withStatus(copy);
    });
  }

  @Perm('CAMPAIGNS_MANAGE')
  @Post(':id/status')
  @HttpCode(200)
  async setStatus(@CurrentUser() actor: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() body: StatusDto) {
    return this.db.transaction(async (m) => {
      const c = await m.findOneBy(Campaign, { id });
      if (!c) throw new NotFoundException('Campanha não encontrada');
      const current = effectiveStatus(c);
      const t = today();
      const next: Record<CampaignAction, [CampaignStatus[], CampaignStatus, string, string]> = {
        schedule: [['draft'], 'scheduled', 'agendou', 'agendar'],
        draft: [['scheduled'], 'draft', 'voltou para rascunho', 'voltar para rascunho'],
        pause: [['active'], 'paused', 'pausou', 'pausar'],
        resume: [['paused'], 'active', 'retomou', 'retomar'],
        end: [['active', 'paused', 'scheduled'], 'ended', 'encerrou', 'encerrar'],
      };
      const LABEL: Record<CampaignStatus, string> = { draft: 'em rascunho', scheduled: 'agendada', active: 'ativa', paused: 'pausada', ended: 'encerrada' };
      const [from, to, verb, infinitive] = next[body.action];
      if (!from.includes(current)) throw new BadRequestException(`Não é possível ${infinitive} uma campanha ${LABEL[current]}`);
      if (body.action === 'schedule' && c.endDate < t) throw new BadRequestException('O término já passou: ajuste as datas antes de agendar');
      const patch: Partial<Campaign> = { status: to };
      // encerrar antes do fim: o término passa a ser hoje
      if (body.action === 'end' && c.endDate > t) patch.endDate = t;
      await m.update(Campaign, id, patch);
      await audit(m, actor, `campaign.${body.action}`, 'campaign', id, `${verb[0].toUpperCase()}${verb.slice(1)} a campanha ${c.name}`, { status: current, endDate: c.endDate }, patch);
      return withStatus({ ...c, ...patch } as Campaign);
    });
  }

  @Perm('CAMPAIGNS_MANAGE', 'REPORTS_VIEW')
  @Get(':id/results')
  async results(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    const c = await this.campaigns.findOneBy({ id });
    if (!c) throw new NotFoundException('Campanha não encontrada');
    const scope = distributorScope(user);
    const sales = () => {
      const qb = this.db.createQueryBuilder().from(Sale, 's').where("s.status = 'active' AND s.campaignId = :id", { id });
      if (scope) qb.andWhere('s.distributorId IN (:...scope)', { scope: scope.length ? scope : [0] });
      return qb;
    };
    const entries = this.db.createQueryBuilder().from(PointEntry, 'e').where('e.campaignId = :id', { id });
    if (scope) entries.andWhere('e.distributorId IN (:...scope)', { scope: scope.length ? scope : [0] });

    const [totals, points, byMonth, top, byDistributor, rules] = await Promise.all([
      sales()
        .select('COUNT(*)', 'count')
        .addSelect('COALESCE(SUM(s.amountCents),0)', 'amountCents')
        .addSelect('COALESCE(SUM(s.points),0)', 'salePoints')
        .addSelect('COUNT(DISTINCT s.sellerId)', 'participants')
        .addSelect('COUNT(DISTINCT s.distributorId)', 'distributors')
        .getRawOne(),
      entries.clone().select('COALESCE(SUM(e.points),0)', 'points').getRawOne(),
      sales()
        .select('s.competence', 'competence')
        .addSelect('SUM(s.amountCents)', 'amountCents')
        .addSelect('SUM(s.points)', 'points')
        .groupBy('s.competence')
        .orderBy('s.competence')
        .getRawMany(),
      sales()
        .select('s.sellerId', 'sellerId')
        .addSelect('u.name', 'name')
        .addSelect('d.name', 'distributorName')
        .addSelect('SUM(s.amountCents)', 'amountCents')
        .addSelect('SUM(s.points)', 'points')
        .leftJoin('users', 'u', 'u.id = s.sellerId')
        .leftJoin('distributors', 'd', 'd.id = s.distributorId')
        .groupBy('s.sellerId')
        .orderBy('points', 'DESC')
        .limit(10)
        .getRawMany(),
      sales()
        .select('s.distributorId', 'distributorId')
        .addSelect('d.name', 'name')
        .addSelect('SUM(s.amountCents)', 'amountCents')
        .addSelect('SUM(s.points)', 'points')
        .leftJoin('distributors', 'd', 'd.id = s.distributorId')
        .groupBy('s.distributorId')
        .orderBy('amountCents', 'DESC')
        .getRawMany(),
      this.db.getRepository(PointRule).find({ where: { campaignId: id }, order: { priority: 'DESC', id: 'ASC' } }),
    ]);
    const amountCents = Number(totals.amountCents);
    const n = (rows: Record<string, unknown>[]) =>
      rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'string' && /^-?\d+$/.test(v) && k !== 'name' && k !== 'competence' ? Number(v) : v])));
    return {
      campaign: withStatus(c),
      totals: {
        sales: Number(totals.count),
        amountCents,
        salePoints: Number(totals.salePoints),
        points: Number(points.points),
        participants: Number(totals.participants),
        distributors: Number(totals.distributors),
        goalPercent: c.goalCents > 0 ? Math.round((amountCents / c.goalCents) * 1000) / 10 : null,
      },
      byMonth: n(byMonth),
      top: n(top),
      byDistributor: n(byDistributor),
      rules: rules.filter((r) => r.status !== 'superseded'),
    };
  }
}

/** equipes no escopo: gerente só as dele; ponto focal só da própria distribuidora */
async function scopeTeams(qb: SelectQueryBuilder<any>, // eslint-disable-line
   user: AuthUser, teams: Repository<Team>) {
  const dist = distributorScope(user);
  if (dist) qb.andWhere('t.distributorId IN (:...sd)', { sd: dist.length ? dist : [0] });
  const own = await teamScope(teams, user);
  if (own) qb.andWhere('t.id IN (:...ownTeams)', { ownTeams: own.length ? own : [0] });
}

// ---------------------------------------------------------------- regras

const CALC_TYPES: CalcType[] = ['per_unit', 'per_amount', 'goal_bonus', 'multiplier'];
const newRuleKey = () => `R-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1296).toString(36).toUpperCase()}`;

class RuleDto {
  @IsString() @MinLength(3) @MaxLength(100) name: string;
  @Type(() => Number) @IsInt() campaignId: number;
  @IsOptional() @Type(() => Number) @IsInt() productId?: number | null;
  @IsOptional() @Type(() => Number) @IsInt() distributorId?: number | null;
  @IsIn(CALC_TYPES) calcType: CalcType;
  @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000) value: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(100) amountStepCents?: number | null;
  @IsDateString() startDate: string;
  @IsDateString() endDate: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) priority?: number;
  @IsOptional() @IsIn(['active', 'inactive']) status?: 'active' | 'inactive';
}

class RuleStatusDto {
  @IsIn(['active', 'inactive']) status: 'active' | 'inactive';
}

class RuleQuery {
  @IsOptional() @Type(() => Number) @IsInt() campaignId?: number;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() calcType?: string;
  @IsOptional() @IsString() search?: string;
}

class SimulateDto {
  @IsOptional() @Type(() => Number) @IsInt() campaignId?: number;
  @Type(() => Number) @IsInt() productId: number;
  @Type(() => Number) @IsInt() distributorId: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(100_000) quantity: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) amountCents?: number;
  @IsDateString() date: string;
}

function validateRule(body: RuleDto) {
  checkDates(body.startDate, body.endDate);
  if (body.calcType === 'per_amount' && !body.amountStepCents)
    throw new BadRequestException('Regra por valor precisa do valor de referência (ex.: a cada R$ 100)');
  if (body.calcType === 'multiplier' && (body.value < 101 || body.value > 1000))
    throw new BadRequestException('Multiplicador entre 1,01× e 10× (valor 101 a 1000, ex.: 200 = 2×)');
}

@Controller('rules')
export class RulesController {
  constructor(
    private readonly db: DataSource,
    @InjectRepository(PointRule) private readonly rules: Repository<PointRule>,
  ) {}

  /** versão atual de cada regra (a não substituída), com a contagem de versões */
  @Perm('POINT_RULES_MANAGE', 'CAMPAIGNS_MANAGE')
  @Get()
  async list(@Query() q: RuleQuery) {
    const qb = this.rules.createQueryBuilder('r').where("r.status != 'superseded'");
    if (q.campaignId) qb.andWhere('r.campaignId = :c', { c: q.campaignId });
    if (q.status) qb.andWhere('r.status = :st', { st: q.status });
    if (q.calcType) qb.andWhere('r.calcType = :ct', { ct: q.calcType });
    if (q.search) qb.andWhere('r.name LIKE :s', { s: `%${q.search}%` });
    const rows = await qb.orderBy('r.campaignId').addOrderBy('r.priority', 'DESC').addOrderBy('r.id').getMany();
    const counts = await this.rules
      .createQueryBuilder('r')
      .select('r.ruleKey', 'ruleKey')
      .addSelect('COUNT(*)', 'n')
      .groupBy('r.ruleKey')
      .getRawMany<{ ruleKey: string; n: string }>();
    const versions = new Map(counts.map((c) => [c.ruleKey, Number(c.n)]));
    const credited = await this.db
      .createQueryBuilder()
      .select('e.ruleId', 'ruleId')
      .addSelect('COUNT(*)', 'n')
      .from(PointEntry, 'e')
      .where('e.ruleId IN (:...ids)', { ids: rows.length ? rows.map((r) => r.id) : [0] })
      .groupBy('e.ruleId')
      .getRawMany<{ ruleId: number; n: string }>();
    const uses = new Map(credited.map((c) => [Number(c.ruleId), Number(c.n)]));
    return rows.map((r) => ({ ...r, versions: versions.get(r.ruleKey) ?? 1, entries: uses.get(r.id) ?? 0 }));
  }

  @Perm('POINT_RULES_MANAGE', 'CAMPAIGNS_MANAGE')
  @Get('versions/:ruleKey')
  async versions(@Param('ruleKey') ruleKey: string) {
    const rows = await this.rules.find({ where: { ruleKey }, order: { version: 'DESC' } });
    if (!rows.length) throw new NotFoundException('Regra não encontrada');
    return rows;
  }

  @Perm('POINT_RULES_MANAGE')
  @Post()
  async create(@CurrentUser() actor: AuthUser, @Body() body: RuleDto) {
    validateRule(body);
    return this.db.transaction(async (m) => {
      if (!(await m.existsBy(Campaign, { id: body.campaignId }))) throw new BadRequestException('Campanha não encontrada');
      const saved = await m.save(
        m.create(PointRule, {
          ...body,
          name: body.name.trim(),
          productId: body.productId ?? null,
          distributorId: body.distributorId ?? null,
          amountStepCents: body.calcType === 'per_amount' ? body.amountStepCents ?? null : null,
          startDate: body.startDate.slice(0, 10),
          endDate: body.endDate.slice(0, 10),
          priority: body.priority ?? 10,
          status: body.status ?? 'active',
          ruleKey: newRuleKey(),
          version: 1,
          createdByName: actor.name,
        }),
      );
      await audit(m, actor, 'rule.create', 'point_rule', saved.id, `Criou a regra ${ruleLabel(saved)}`, null, saved);
      return saved;
    });
  }

  /**
   * Editar = nova versão. A linha antiga vira 'superseded' e continua no banco:
   * lançamentos já creditados apontam pra ela e nunca são recalculados.
   */
  @Perm('POINT_RULES_MANAGE')
  @Put(':id')
  async newVersion(@CurrentUser() actor: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() body: RuleDto) {
    validateRule(body);
    return this.version(actor, id, body, 'rule.update');
  }

  /** ativar/desativar também gera versão: o histórico mostra quando a regra parou de valer */
  @Perm('POINT_RULES_MANAGE')
  @Post(':id/status')
  @HttpCode(200)
  async setStatus(@CurrentUser() actor: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() body: RuleStatusDto) {
    return this.version(actor, id, { status: body.status }, body.status === 'active' ? 'rule.activate' : 'rule.deactivate');
  }

  private version(actor: AuthUser, id: number, input: Partial<RuleDto>, action: string) {
    const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as Partial<RuleDto>;
    return this.db.transaction(async (m) => {
      const current = await m.findOneBy(PointRule, { id });
      if (!current) throw new NotFoundException('Regra não encontrada');
      if (current.status === 'superseded') throw new BadRequestException('Esta versão já foi substituída; edite a versão atual');
      if (patch.campaignId && !(await m.existsBy(Campaign, { id: patch.campaignId }))) throw new BadRequestException('Campanha não encontrada');
      const last = await m.findOne(PointRule, { where: { ruleKey: current.ruleKey }, order: { version: 'DESC' } });
      const { id: _id, createdAt: _c, ...fields } = current;
      void _id;
      void _c;
      const next = {
        ...fields,
        ...patch,
        productId: patch.productId === undefined ? current.productId : patch.productId ?? null,
        distributorId: patch.distributorId === undefined ? current.distributorId : patch.distributorId ?? null,
        startDate: (patch.startDate ?? current.startDate).slice(0, 10),
        endDate: (patch.endDate ?? current.endDate).slice(0, 10),
        version: (last?.version ?? current.version) + 1,
        status: patch.status ?? current.status,
        createdByName: actor.name,
      };
      if ((next.calcType as CalcType) !== 'per_amount') next.amountStepCents = null;
      await m.update(PointRule, id, { status: 'superseded' });
      const saved = await m.save(m.create(PointRule, next));
      const diff = (Object.keys(patch) as (keyof PointRule)[])
        .filter((k) => current[k] !== saved[k])
        .map((k) => `${k}: ${current[k] ?? '—'} → ${saved[k] ?? '—'}`);
      await audit(m, actor, action, 'point_rule', saved.id, `${current.name}: v${current.version} → v${saved.version} (${diff.join(', ') || 'sem mudanças'})`, current, saved);
      return saved;
    });
  }

  @Perm('POINT_RULES_MANAGE', 'CAMPAIGNS_MANAGE')
  @Post('simulate')
  @HttpCode(200)
  async simulate(@Body() body: SimulateDto) {
    const [campaigns, rules, product] = await Promise.all([
      this.db.getRepository(Campaign).find(),
      this.rules.find(),
      this.db.getRepository('products').findOneBy({ id: body.productId }) as Promise<{ priceCents: number; name: string } | null>,
    ]);
    if (!product) throw new BadRequestException('Produto não encontrado');
    const input = {
      productId: body.productId,
      distributorId: body.distributorId,
      quantity: body.quantity,
      amountCents: body.amountCents ?? body.quantity * product.priceCents,
      date: body.date.slice(0, 10),
    };
    // a simulação considera inclusive campanhas agendadas/rascunho quando escolhidas explicitamente
    const campaign = body.campaignId ? campaigns.find((c) => c.id === body.campaignId) : campaignFor(campaigns, input);
    const result = computePoints(rules, campaign?.id ?? null, input);
    const warnings: string[] = [];
    if (!campaign) warnings.push('Nenhuma campanha cobre esta venda (data, distribuidora ou produto fora da campanha).');
    if (campaign && (input.date < campaign.startDate || input.date > campaign.endDate)) warnings.push('A data está fora da vigência da campanha escolhida.');
    return {
      input,
      campaign: campaign ? { id: campaign.id, name: campaign.name, status: effectiveStatus(campaign) } : null,
      points: result.points,
      rule: result.rule,
      breakdown: result.breakdown,
      warnings,
    };
  }
}

// ---------------------------------------------------------------- extrato

const ENTRY_TYPES: EntryType[] = ['credit', 'debit', 'reversal', 'adjustment', 'bonus'];

class LedgerQuery extends PageQuery {
  @IsOptional() @Type(() => Number) @IsInt() sellerId?: number;
  @IsOptional() @IsString() seller?: string;
  @IsOptional() @Type(() => Number) @IsInt() distributorId?: number;
  @IsOptional() @Type(() => Number) @IsInt() campaignId?: number;
  @IsOptional() @Type(() => Number) @IsInt() batchId?: number;
  /** um ou vários: "adjustment,reversal" */
  @IsOptional() @IsString() type?: string;
  /** só lançamentos feitos por pessoas (ajustes, estornos manuais) */
  @IsOptional() @IsIn(['1', 'true']) manual?: string;
  @IsOptional() @IsString() sort?: string;
  @IsOptional() @IsString() dir?: string;
}

class AdjustDto {
  @Type(() => Number) @IsInt() sellerId: number;
  @Type(() => Number) @IsInt() @Min(-1_000_000) @Max(1_000_000) points: number;
  @IsIn(['adjustment', 'bonus', 'debit']) type: 'adjustment' | 'bonus' | 'debit';
  @IsString() @MinLength(15, { message: 'Justificativa deve ter pelo menos 15 caracteres' }) @MaxLength(500) reason: string;
  @IsOptional() @Type(() => Number) @IsInt() campaignId?: number;
}

class ReverseDto {
  @IsString() @MinLength(15, { message: 'Justificativa deve ter pelo menos 15 caracteres' }) @MaxLength(500) reason: string;
}

class SellerQuery {
  @IsOptional() @IsString() search?: string;
}

const TYPE_LABEL: Record<EntryType, string> = {
  credit: 'Crédito',
  debit: 'Débito',
  reversal: 'Estorno',
  adjustment: 'Ajuste administrativo',
  bonus: 'Bônus',
};

const SYSTEM_ACTORS = ['Processamento automático', 'Catálogo de prêmios'];

@Controller('points')
export class PointsController {
  constructor(
    private readonly db: DataSource,
    @InjectRepository(PointEntry) private readonly entries: Repository<PointEntry>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Team) private readonly teams: Repository<Team>,
  ) {}

  /** filtros + escopo, reaproveitado por listagem, totais e exportação */
  private async query(user: AuthUser, q: LedgerQuery) {
    const qb = this.entries.createQueryBuilder('e');
    const dist = distributorScope(user);
    if (dist) qb.andWhere('e.distributorId IN (:...sd)', { sd: dist.length ? dist : [0] });
    if (user.scope === 'own') qb.andWhere('e.sellerId = :me', { me: user.id });
    else {
      const teams = await teamScope(this.teams, user);
      if (teams)
        qb.andWhere(`e.sellerId IN (SELECT u.id FROM users u WHERE u.teamId IN (:...st))`, { st: teams.length ? teams : [0] });
    }
    if (q.sellerId) qb.andWhere('e.sellerId = :sid', { sid: q.sellerId });
    if (q.seller) qb.andWhere('e.sellerName LIKE :sn', { sn: `%${q.seller}%` });
    if (q.distributorId) qb.andWhere('e.distributorId = :did', { did: q.distributorId });
    if (q.campaignId) qb.andWhere('e.campaignId = :cid', { cid: q.campaignId });
    if (q.batchId) qb.andWhere('e.batchId = :bid', { bid: q.batchId });
    const types = (q.type ?? '').split(',').filter((t): t is EntryType => ENTRY_TYPES.includes(t as EntryType));
    if (types.length) qb.andWhere('e.type IN (:...types)', { types });
    if (q.manual) qb.andWhere('e.actorName NOT IN (:...sys)', { sys: SYSTEM_ACTORS });
    if (q.search)
      qb.andWhere(
        new Brackets((w) =>
          w
            .where('e.sellerName LIKE :s', { s: `%${q.search}%` })
            .orWhere('e.origin LIKE :s')
            .orWhere('e.saleExternalId LIKE :s')
            .orWhere('CAST(e.id AS TEXT) = :sid2', { sid2: q.search!.replace(/\D/g, '') || '-1' }),
        ),
      );
    if (q.date_from) qb.andWhere('e.createdAt >= :df', { df: q.date_from.slice(0, 10) });
    if (q.date_to) qb.andWhere("e.createdAt < date(:dt, '+1 day')", { dt: q.date_to.slice(0, 10) });
    return qb;
  }

  @Perm('POINTS_ADJUST', 'REPORTS_VIEW')
  @Get()
  async list(@CurrentUser() user: AuthUser, @Query() q: LedgerQuery) {
    const qb = await this.query(user, q);
    const totals = await qb
      .clone()
      .select('e.type', 'type')
      .addSelect('COUNT(*)', 'count')
      .addSelect('COALESCE(SUM(e.points),0)', 'points')
      .groupBy('e.type')
      .getRawMany<{ type: EntryType; count: string; points: string }>();
    const field = ({ id: 'e.id', createdAt: 'e.createdAt', points: 'e.points', sellerName: 'e.sellerName' } as Record<string, string>)[q.sort ?? ''] ?? 'e.createdAt';
    qb.orderBy(field, q.dir === 'asc' ? 'ASC' : 'DESC').addOrderBy('e.id', 'DESC');
    const page = await paginate(qb, q);
    return {
      ...page,
      summary: {
        byType: Object.fromEntries(ENTRY_TYPES.map((t) => {
          const r = totals.find((x) => x.type === t);
          return [t, { count: Number(r?.count ?? 0), points: Number(r?.points ?? 0) }];
        })),
        balance: totals.reduce((s, r) => s + Number(r.points), 0),
      },
    };
  }

  /** até 5000 linhas filtradas, já com rótulos (o front gera o CSV) */
  @Perm('POINTS_ADJUST', 'REPORTS_VIEW')
  @Get('export')
  async export(@CurrentUser() user: AuthUser, @Query() q: LedgerQuery) {
    const qb = await this.query(user, q);
    const rows = await qb.orderBy('e.createdAt', 'DESC').addOrderBy('e.id', 'DESC').take(5000).getMany();
    return rows.map((e) => ({
      id: e.id,
      data: e.createdAt,
      vendedor: e.sellerName,
      tipo: TYPE_LABEL[e.type],
      pontos: e.points,
      origem: e.origin,
      regra: e.ruleLabel ?? '',
      referencia_venda: e.saleExternalId ?? '',
      lote: e.batchId ?? '',
      justificativa: e.reason ?? '',
      responsavel: e.actorName,
    }));
  }

  @Perm('POINTS_ADJUST')
  @Get('sellers')
  async sellers(@CurrentUser() user: AuthUser, @Query() q: SellerQuery) {
    const qb = this.users
      .createQueryBuilder('u')
      .select(['u.id', 'u.name', 'u.email', 'u.distributorId', 'u.teamId', 'u.status'])
      .where('u.profiles LIKE :p', { p: '%seller%' });
    const dist = distributorScope(user);
    if (dist) qb.andWhere('u.distributorId IN (:...sd)', { sd: dist.length ? dist : [0] });
    const s = (q.search ?? '').trim();
    if (s) {
      const digits = s.replace(/\D/g, '');
      qb.andWhere(
        new Brackets((w) => {
          w.where('u.name LIKE :s', { s: `%${s}%` }).orWhere('u.email LIKE :s');
          if (digits.length >= 3) w.orWhere('u.cpf LIKE :d', { d: `%${digits}%` });
          if (/^\d+$/.test(s)) w.orWhere('u.id = :id', { id: Number(s) });
        }),
      );
    }
    return qb.orderBy('u.name').take(10).getMany();
  }

  @Perm('POINTS_ADJUST', 'REPORTS_VIEW')
  @Get('balance/:sellerId')
  async balance(@CurrentUser() user: AuthUser, @Param('sellerId', ParseIntPipe) sellerId: number) {
    const seller = await this.scopedSeller(user, sellerId);
    return { sellerId, name: seller.name, ...(await this.balanceOf(this.db.manager, sellerId)) };
  }

  private async scopedSeller(user: AuthUser, sellerId: number) {
    const seller = await this.users.findOneBy({ id: sellerId });
    const dist = distributorScope(user);
    if (!seller || !seller.profiles.includes('seller') || (dist && !dist.includes(seller.distributorId ?? -1)))
      throw new NotFoundException('Vendedor não encontrado');
    return seller;
  }

  private async balanceOf(m: DataSource['manager'], sellerId: number) {
    const r = await m
      .createQueryBuilder()
      .select('COALESCE(SUM(e.points),0)', 'balance')
      .addSelect('COALESCE(SUM(CASE WHEN e.points > 0 THEN e.points END),0)', 'credits')
      .addSelect('COALESCE(SUM(CASE WHEN e.points < 0 THEN e.points END),0)', 'debits')
      .addSelect('COUNT(*)', 'entries')
      .from(PointEntry, 'e')
      .where('e.sellerId = :id', { id: sellerId })
      .getRawOne();
    return { balance: Number(r.balance), credits: Number(r.credits), debits: Number(r.debits), entries: Number(r.entries) };
  }

  @Perm('POINTS_ADJUST')
  @Post('adjust')
  async adjust(@CurrentUser() actor: AuthUser, @Body() body: AdjustDto) {
    if (body.points === 0) throw new BadRequestException('Informe uma quantidade de pontos diferente de zero');
    const seller = await this.scopedSeller(actor, body.sellerId);
    // débito sempre negativo, bônus sempre positivo; ajuste aceita os dois sentidos
    const points = body.type === 'debit' ? -Math.abs(body.points) : body.type === 'bonus' ? Math.abs(body.points) : body.points;
    return this.db.transaction(async (m) => {
      const before = await this.balanceOf(m, seller.id);
      if (before.balance + points < 0)
        throw new BadRequestException(`Saldo insuficiente: ${before.balance} pts, o lançamento deixaria ${before.balance + points} pts`);
      const entry = await m.save(
        m.create(PointEntry, {
          sellerId: seller.id,
          sellerName: seller.name,
          distributorId: seller.distributorId,
          campaignId: body.campaignId ?? null,
          type: body.type,
          points,
          origin: body.type === 'debit' ? 'Débito administrativo' : body.type === 'bonus' ? 'Bônus administrativo' : 'Ajuste administrativo',
          reason: body.reason.trim(),
          actorName: actor.name,
        }),
      );
      await audit(m, actor, 'points.adjust', 'point_entry', entry.id, `${TYPE_LABEL[body.type]} de ${points > 0 ? '+' : ''}${points} pts para ${seller.name}: ${body.reason.trim()}`, { balance: before.balance }, { balance: before.balance + points, entryId: entry.id });
      return { entry, balanceBefore: before.balance, balanceAfter: before.balance + points };
    });
  }

  /** estorno: novo lançamento com sinal invertido; o original fica intacto */
  @Perm('POINTS_ADJUST')
  @Post(':id/reverse')
  async reverse(@CurrentUser() actor: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() body: ReverseDto) {
    return this.db.transaction(async (m) => {
      const original = await m.findOneBy(PointEntry, { id });
      if (!original) throw new NotFoundException('Lançamento não encontrado');
      await this.scopedSeller(actor, original.sellerId);
      if (original.type === 'reversal') throw new BadRequestException('Um estorno não pode ser estornado');
      if (original.points === 0) throw new BadRequestException('Lançamento sem pontos não tem o que estornar');
      const already = await m.findOneBy(PointEntry, { relatedEntryId: id, type: 'reversal' });
      if (already) throw new BadRequestException(`Lançamento #${id} já foi estornado (#${already.id})`);
      const before = await this.balanceOf(m, original.sellerId);
      const entry = await m.save(
        m.create(PointEntry, {
          sellerId: original.sellerId,
          sellerName: original.sellerName,
          distributorId: original.distributorId,
          campaignId: original.campaignId,
          type: 'reversal',
          points: -original.points,
          origin: `Estorno do lançamento #${id}`,
          ruleId: original.ruleId,
          ruleLabel: original.ruleLabel,
          saleExternalId: original.saleExternalId,
          batchId: original.batchId,
          relatedEntryId: id,
          reason: body.reason.trim(),
          actorName: actor.name,
        }),
      );
      await audit(m, actor, 'points.reverse', 'point_entry', id, `Estornou #${id} (${original.points > 0 ? '+' : ''}${original.points} pts) de ${original.sellerName}: ${body.reason.trim()}`, { entry: original, balance: before.balance }, { reversalId: entry.id, balance: before.balance - original.points });
      return { entry, balanceBefore: before.balance, balanceAfter: before.balance - original.points };
    });
  }
}
