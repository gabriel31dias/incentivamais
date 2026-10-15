import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { AuthUser, CurrentUser, Perm } from './auth';
import { audit, Menu, MenuTemplate, MenuType, PERMISSIONS, Profile, ProfileKey, PROFILES } from './entities';
import {
  applySetOp,
  buildTree,
  countPortable,
  descendants,
  PortableMenu,
  profileTree,
  selectionRoots,
  SetOp,
  toPortable,
  visibleTree,
  wouldCycle,
} from './menus';

const TYPES: MenuType[] = ['page', 'link', 'report', 'content', 'feature'];
/** DTOs têm campos declarados (ES2022): tira os undefined antes de espalhar */
const defined = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

const today = () => new Date().toISOString().slice(0, 10);

class MenuDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) title?: string;
  @IsOptional() @IsString() @MaxLength(40) icon?: string;
  @IsOptional() @IsIn(TYPES) type?: MenuType;
  @IsOptional() @IsString() @MaxLength(300) target?: string;
  @IsOptional() @Type(() => Number) @IsInt() parentId?: number | null;
  @IsOptional() @Type(() => Number) @IsInt() order?: number;
  @IsOptional() @IsIn(['active', 'inactive']) status?: 'active' | 'inactive';
  @IsOptional() @IsDateString() startDate?: string | null;
  @IsOptional() @IsDateString() endDate?: string | null;
  @IsOptional() @IsArray() @IsIn(PROFILES, { each: true }) profiles?: ProfileKey[];
  @IsOptional() @IsArray() @IsInt({ each: true }) distributorIds?: number[];
  @IsOptional() @IsArray() @IsString({ each: true }) groups?: string[];
  @IsOptional() @IsString() permission?: string | null;
  @IsOptional() @IsBoolean() ownMenu?: boolean;
}

class IdsDto {
  @IsArray() @ArrayMaxSize(5000) @IsInt({ each: true }) ids: number[];
}

class BulkDto extends IdsDto {
  @IsOptional() @IsObject() profiles?: SetOp<ProfileKey>;
  @IsOptional() @IsObject() distributorIds?: SetOp<number>;
  @IsOptional() @IsObject() groups?: SetOp<string>;
  @IsOptional() @IsIn(['active', 'inactive']) status?: 'active' | 'inactive';
  @IsOptional() @IsString() startDate?: string | null;
  @IsOptional() @IsString() endDate?: string | null;
  @IsOptional() @IsString() permission?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() parentId?: number | null;
}

class ReorderDto {
  @IsArray() @ArrayMaxSize(5000) items: { id: number; parentId: number | null; order: number }[];
}

class GenerateDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) count?: number;
  @IsOptional() @IsString() @MaxLength(80) parentTitle?: string;
}

class CopyProfileDto {
  @IsIn(PROFILES) from: ProfileKey;
  @IsIn(PROFILES) to: ProfileKey;
}

class ImportDto {
  @IsArray() @ArrayMaxSize(2000) items: PortableMenu[];
  @IsIn(['append', 'replace']) mode: 'append' | 'replace';
}

class TemplateDto {
  @IsString() @MinLength(2) @MaxLength(80) name: string;
  @IsOptional() @IsString() @MaxLength(300) description?: string;
  @IsOptional() @IsArray() @IsInt({ each: true }) menuIds?: number[];
  @IsOptional() @IsArray() items?: PortableMenu[];
  /** com menuIds: leva só os submenus que esse perfil vê */
  @IsOptional() @IsIn(PROFILES) profile?: ProfileKey;
}

class TemplatePatchDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MaxLength(300) description?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(500) items?: PortableMenu[];
}

class ApplyDto {
  @IsIn(PROFILES) profile: ProfileKey;
  /** vazio = menu geral do perfil */
  @IsArray() @ArrayMaxSize(500) @IsInt({ each: true }) distributorIds: number[];
}

class SegmentDto {
  @IsIn(PROFILES) profile: ProfileKey;
  @Type(() => Number) @IsInt() distributorId: number;
}

class PreviewQuery {
  @IsIn(PROFILES) profile: ProfileKey;
  @IsOptional() @Type(() => Number) @IsInt() distributorId?: number;
  @IsOptional() @IsDateString() date?: string;
}

const MODES = ['set', 'add', 'remove'];
function checkOp(name: string, op?: SetOp<unknown>, allowed?: readonly unknown[]) {
  if (!op) return;
  if (!MODES.includes(op.mode) || !Array.isArray(op.values)) throw new BadRequestException(`${name}: use {mode: set|add|remove, values: []}`);
  if (allowed && op.values.some((v) => !allowed.includes(v))) throw new BadRequestException(`${name}: valor inválido`);
}

function checkPortable(items: PortableMenu[], depth = 0) {
  if (depth > 6) throw new BadRequestException('Árvore profunda demais (máx. 6 níveis)');
  for (const i of items) {
    if (!i || typeof i.title !== 'string' || !i.title.trim()) throw new BadRequestException('Item sem título no JSON');
    if (i.type && !TYPES.includes(i.type)) throw new BadRequestException(`Tipo inválido: ${i.type}`);
    if (i.profiles?.some((p) => !PROFILES.includes(p))) throw new BadRequestException(`Perfil inválido em "${i.title}"`);
    checkPortable(i.children ?? [], depth + 1);
  }
}

const OP_LABEL = { set: 'definir', add: '+', remove: '−' };
const describeOp = (name: string, op?: SetOp<unknown>) => (op ? `${name} ${OP_LABEL[op.mode]} [${op.values.join(', ') || 'todos'}]` : null);

/** insere árvore portátil sob parentId; devolve quantos nós criou */
async function insertPortable(m: EntityManager, items: PortableMenu[], parentId: number | null, startOrder: number): Promise<number> {
  let count = 0;
  for (const [i, it] of items.entries()) {
    const saved = await m.save(
      m.create(Menu, {
        title: it.title.trim().slice(0, 80),
        icon: it.icon || 'Circle',
        type: it.type ?? 'page',
        target: it.target ?? '',
        parentId,
        order: startOrder + i,
        status: it.status ?? 'active',
        startDate: it.startDate ?? null,
        endDate: it.endDate ?? null,
        profiles: it.profiles ?? [],
        distributorIds: it.distributorIds ?? [],
        groups: it.groups ?? [],
        permission: it.permission ?? null,
        ownMenu: it.ownMenu ?? false,
      }),
    );
    count += 1 + (await insertPortable(m, it.children ?? [], saved.id, 0));
  }
  return count;
}

/**
 * Troca o menu de um segmento (perfil + distribuidora; distribuidora null = menu geral do perfil)
 * por `items`. Item só do segmento é excluído; item compartilhado só deixa de valer para ele.
 * A cópia é independente: o item principal marca o segmento e os submenus seguem o pai.
 */
async function replaceSegment(m: EntityManager, profile: ProfileKey, distributorId: number | null, items: PortableMenu[] | null) {
  const all = await m.find(Menu);
  const roots = profileTree(all, profile).filter((r) => (distributorId == null ? !r.distributorIds.length : r.ownMenu && r.distributorIds.includes(distributorId)));
  const gone = new Set<number>();
  for (const r of roots) {
    const onlyProfile = r.profiles.length === 1;
    const onlyDist = distributorId == null || r.distributorIds.length === 1;
    if (onlyProfile && onlyDist) descendants(all, r.id).forEach((id) => gone.add(id));
    else if (!onlyDist) await m.update(Menu, r.id, { distributorIds: r.distributorIds.filter((d) => d !== distributorId) });
    else await m.update(Menu, r.id, { profiles: (r.profiles.length ? r.profiles : [...PROFILES]).filter((p) => p !== profile) });
  }
  if (gone.size) await m.delete(Menu, [...gone]);
  if (!items) return { created: 0, deleted: gone.size };
  const mark = (n: PortableMenu, root = true): PortableMenu => ({
    ...n,
    profiles: root ? [profile] : [],
    distributorIds: root && distributorId != null ? [distributorId] : [],
    ownMenu: root && distributorId != null,
    children: n.children?.map((c) => mark(c, false)),
  });
  const created = await insertPortable(m, items.map((n) => mark(n)), null, await nextOrder(m, null));
  return { created, deleted: gone.size };
}

async function nextOrder(m: EntityManager, parentId: number | null) {
  const qb = m.createQueryBuilder(Menu, 'm').select('MAX(m.order)', 'max');
  parentId == null ? qb.where('m.parentId IS NULL') : qb.where('m.parentId = :p', { p: parentId });
  const { max } = (await qb.getRawOne<{ max: number | null }>()) ?? { max: null };
  return (max ?? -1) + 1;
}

// títulos fictícios para "Gerar 100 menus"
const GEN: [string, string, MenuType, string][] = [
  ['Ranking Regional', 'Trophy', 'report', '/ranking/regional'],
  ['Campanha Relâmpago', 'Zap', 'page', '/campanhas/relampago'],
  ['Catálogo de Prêmios', 'Gift', 'page', '/premios'],
  ['Vídeo da Semana', 'Video', 'content', '/conteudos/video'],
  ['Desafio do Mês', 'Flag', 'feature', '/desafios'],
  ['Simulador de Pontos', 'Calculator', 'feature', '/simulador'],
  ['Manual do Vendedor', 'BookOpen', 'content', '/materiais/manual'],
  ['Portal do Cliente', 'ExternalLink', 'link', 'https://exemplo.com.br/portal'],
  ['Relatório de Metas', 'Target', 'report', '/relatorios/metas'],
  ['Enquete Rápida', 'Vote', 'feature', '/enquetes'],
  ['Notícias Regionais', 'Newspaper', 'content', '/noticias/regionais'],
  ['Meus Pedidos', 'ShoppingBag', 'page', '/pedidos'],
  ['Lançamentos', 'Rocket', 'content', '/lancamentos'],
  ['Fale Conosco', 'MessageCircle', 'feature', '/atendimento'],
  ['Calendário de Ações', 'CalendarDays', 'page', '/calendario'],
];

@Perm('MENUS_MANAGE')
@Controller()
export class MenusController {
  constructor(
    private readonly db: DataSource,
    @InjectRepository(Menu) private readonly menus: Repository<Menu>,
    @InjectRepository(MenuTemplate) private readonly templates: Repository<MenuTemplate>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
  ) {}

  @Get('menus')
  list() {
    return this.menus.find({ order: { parentId: 'ASC', order: 'ASC', id: 'ASC' } });
  }

  @Get('menus/preview')
  async preview(@Query() q: PreviewQuery) {
    const profile = await this.profiles.findOneBy({ key: q.profile });
    const date = q.date?.slice(0, 10) ?? today();
    const all = await this.menus.find();
    const tree = visibleTree(all, { profile: q.profile, permissions: profile?.permissions ?? [], distributorId: q.distributorId ?? null, date });
    return { profile: q.profile, date, distributorId: q.distributorId ?? null, tree };
  }

  @Get('menus/export')
  async export() {
    const tree = buildTree(await this.menus.find());
    return { version: 1, exportedAt: new Date().toISOString(), count: countPortable(tree.map(toPortable)), items: tree.map(toPortable) };
  }

  @Post('menus')
  async create(@CurrentUser() actor: AuthUser, @Body() dto: MenuDto) {
    const body = defined(dto);
    if (!body.title?.trim()) throw new BadRequestException('Título obrigatório');
    if (body.startDate && body.endDate && body.endDate < body.startDate) throw new BadRequestException('Término antes do início');
    return this.db.transaction(async (m) => {
      const parentId = body.parentId ?? null;
      if (parentId != null) await m.findOneByOrFail(Menu, { id: parentId });
      const saved = await m.save(
        m.create(Menu, {
          icon: 'Circle',
          type: 'page',
          target: '',
          status: 'active',
          profiles: [],
          distributorIds: [],
          groups: [],
          permission: null,
          ...body,
          title: body.title!.trim(),
          parentId,
          order: body.order ?? (await nextOrder(m, parentId)),
        }),
      );
      await audit(m, actor, 'menu.create', 'menu', saved.id, `Criou o menu "${saved.title}"`, null, body);
      return saved;
    });
  }

  @Patch('menus/:id')
  async update(@CurrentUser() actor: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: MenuDto) {
    const body = defined(dto);
    return this.db.transaction(async (m) => {
      const menu = await m.findOneByOrFail(Menu, { id });
      if (body.parentId !== undefined && wouldCycle(await m.find(Menu, { select: ['id', 'parentId'] }), id, body.parentId))
        throw new BadRequestException('Um menu não pode ficar dentro dele mesmo ou de um submenu seu');
      const next = { ...menu, ...body };
      if (next.startDate && next.endDate && next.endDate < next.startDate) throw new BadRequestException('Término antes do início');
      const before = Object.fromEntries(Object.keys(body).map((k) => [k, menu[k as keyof Menu]]));
      await m.update(Menu, id, body);
      await audit(m, actor, 'menu.update', 'menu', id, `Editou o menu "${next.title}" (${Object.keys(body).join(', ')})`, before, body);
      return m.findOneByOrFail(Menu, { id });
    });
  }

  @Delete('menus/:id')
  async remove(@CurrentUser() actor: AuthUser, @Param('id', ParseIntPipe) id: number, @Query('hard') hard?: string) {
    return this.db.transaction(async (m) => {
      const menu = await m.findOneByOrFail(Menu, { id });
      const ids = descendants(await m.find(Menu, { select: ['id', 'parentId'] }), id);
      if (hard === '1') {
        await m.delete(Menu, { id: In(ids) });
        await audit(m, actor, 'menu.delete', 'menu', id, `Excluiu o menu "${menu.title}" e ${ids.length - 1} submenu(s)`, menu, null);
      } else {
        await m.update(Menu, id, { status: 'inactive' });
        await audit(m, actor, 'menu.disable', 'menu', id, `Desativou o menu "${menu.title}"`, { status: menu.status }, { status: 'inactive' });
      }
      return { affected: hard === '1' ? ids.length : 1 };
    });
  }

  @Perm('MENUS_MANAGE', 'MENUS_BULK_EDIT')
  @Post('menus/reorder')
  @HttpCode(200)
  async reorder(@CurrentUser() actor: AuthUser, @Body() body: ReorderDto) {
    return this.db.transaction(async (m) => {
      const all = await m.find(Menu, { select: ['id', 'parentId'] });
      const byId = new Map(all.map((x) => [x.id, { ...x }]));
      for (const it of body.items) {
        if (!byId.has(it.id) || (it.parentId != null && !byId.has(it.parentId))) throw new BadRequestException(`Menu inexistente: ${it.id}`);
        byId.get(it.id)!.parentId = it.parentId ?? null;
      }
      // valida ciclo na estrutura final
      const final = [...byId.values()];
      for (const it of body.items) {
        let p = byId.get(it.id)!.parentId;
        for (let guard = 0; p != null; guard++) {
          if (p === it.id || guard > final.length) throw new BadRequestException('Movimento criaria um ciclo');
          p = byId.get(p)?.parentId ?? null;
        }
      }
      for (const it of body.items) await m.update(Menu, it.id, { parentId: it.parentId ?? null, order: it.order });
      await audit(m, actor, 'menu.reorder', 'menu', body.items[0]?.id ?? 0, `Reorganizou ${body.items.length} menu(s)`, null, body.items);
      return { affected: body.items.length };
    });
  }

  @Post('menus/:id/duplicate')
  async duplicate(@CurrentUser() actor: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.duplicateMany(actor, { ids: [id] });
  }

  @Perm('MENUS_MANAGE', 'MENUS_BULK_EDIT')
  @Post('menus/bulk-duplicate')
  async duplicateMany(@CurrentUser() actor: AuthUser, @Body() body: IdsDto) {
    const t0 = Date.now();
    return this.db.transaction(async (m) => {
      const all = await m.find(Menu);
      const tree = buildTree(all);
      const find = (list: ReturnType<typeof buildTree>, id: number): (typeof list)[number] | undefined =>
        list.find((n) => n.id === id) ?? list.map((n) => find(n.children, id)).find(Boolean);
      let count = 0;
      for (const id of selectionRoots(all, body.ids)) {
        const node = find(tree, id);
        if (!node) continue;
        const copy = { ...toPortable(node), title: `${node.title} (cópia)`.slice(0, 80) };
        count += await insertPortable(m, [copy], node.parentId, await nextOrder(m, node.parentId));
      }
      await audit(m, actor, 'menu.duplicate', 'menu', body.ids[0] ?? 0, `Duplicou ${body.ids.length} menu(s) → ${count} criado(s)`, { ids: body.ids }, null);
      return { affected: count, ms: Date.now() - t0 };
    });
  }

  @Perm('MENUS_MANAGE', 'MENUS_BULK_EDIT')
  @Post('menus/bulk-delete')
  @HttpCode(200)
  async deleteMany(@CurrentUser() actor: AuthUser, @Body() body: IdsDto) {
    const t0 = Date.now();
    return this.db.transaction(async (m) => {
      const all = await m.find(Menu, { select: ['id', 'parentId'] });
      const ids = [...new Set(body.ids.flatMap((id) => descendants(all, id)))];
      await m.delete(Menu, { id: In(ids) });
      await audit(m, actor, 'menu.bulk_delete', 'menu', body.ids[0] ?? 0, `Excluiu ${ids.length} menu(s) em uma operação`, { ids }, null);
      return { affected: ids.length, ms: Date.now() - t0 };
    });
  }

  /** uma operação, uma linha de auditoria, N menus */
  @Perm('MENUS_MANAGE', 'MENUS_BULK_EDIT')
  @Post('menus/bulk')
  @HttpCode(200)
  async bulk(@CurrentUser() actor: AuthUser, @Body() body: BulkDto) {
    const t0 = Date.now();
    checkOp('Perfis', body.profiles, PROFILES);
    checkOp('Distribuidoras', body.distributorIds);
    checkOp('Grupos', body.groups);
    if (body.permission && !(PERMISSIONS as readonly string[]).includes(body.permission)) throw new BadRequestException('Permissão inválida');
    if (!body.ids.length) throw new BadRequestException('Selecione ao menos um menu');
    return this.db.transaction(async (m) => {
      const menus = await m.findBy(Menu, { id: In(body.ids) });
      if (body.parentId !== undefined) {
        const all = await m.find(Menu, { select: ['id', 'parentId'] });
        if (menus.some((x) => wouldCycle(all, x.id, body.parentId ?? null))) throw new BadRequestException('Movimento criaria um ciclo');
      }
      const scalar: Partial<Menu> = {};
      if (body.status) scalar.status = body.status;
      if (body.startDate !== undefined) scalar.startDate = body.startDate || null;
      if (body.endDate !== undefined) scalar.endDate = body.endDate || null;
      if (body.permission !== undefined) scalar.permission = body.permission || null;
      if (body.parentId !== undefined) scalar.parentId = body.parentId ?? null;
      if (scalar.startDate && scalar.endDate && scalar.endDate < scalar.startDate) throw new BadRequestException('Término antes do início');

      if (Object.keys(scalar).length) await m.update(Menu, { id: In(menus.map((x) => x.id)) }, scalar);
      if (body.profiles || body.distributorIds || body.groups)
        for (const x of menus)
          await m.update(Menu, x.id, {
            ...(body.profiles && { profiles: applySetOp(x.profiles, body.profiles) }),
            ...(body.distributorIds && { distributorIds: applySetOp(x.distributorIds, body.distributorIds) }),
            ...(body.groups && { groups: applySetOp(x.groups, body.groups) }),
          });

      const parts = [
        describeOp('perfis', body.profiles),
        describeOp('distribuidoras', body.distributorIds),
        describeOp('grupos', body.groups),
        body.status && `status → ${body.status}`,
        (body.startDate !== undefined || body.endDate !== undefined) && `vigência ${body.startDate || '—'} a ${body.endDate || '—'}`,
        body.permission !== undefined && `permissão → ${body.permission || 'nenhuma'}`,
        body.parentId !== undefined && `mover para ${body.parentId ?? 'raiz'}`,
      ].filter(Boolean);
      const { ids: _ids, ...change } = defined(body);
      const ids = body.ids;
      await audit(m, actor, 'menu.bulk_update', 'menu', ids[0], `Edição em massa de ${menus.length} menu(s): ${parts.join('; ')}`, { ids }, change);
      return { affected: menus.length, operations: 1, ms: Date.now() - t0 };
    });
  }

  @Perm('MENUS_MANAGE', 'MENUS_BULK_EDIT')
  @Post('menus/generate')
  async generate(@CurrentUser() actor: AuthUser, @Body() body: GenerateDto) {
    const count = body.count ?? 100;
    const t0 = Date.now();
    return this.db.transaction(async (m) => {
      const lots = await m.createQueryBuilder(Menu, 'm').where('m.title LIKE :t', { t: 'Menus gerados (lote%' }).getCount();
      const title = body.parentTitle?.trim() || `Menus gerados (lote ${lots + 1})`;
      const parent = await m.save(
        m.create(Menu, { title, icon: 'Layers', type: 'page', target: '', parentId: null, order: await nextOrder(m, null), status: 'active', profiles: [], distributorIds: [], groups: ['gerados'], permission: null }),
      );
      const rows = Array.from({ length: count }, (_, i) => {
        const [t, icon, type, target] = GEN[i % GEN.length];
        const n = Math.floor(i / GEN.length) + 1;
        return { title: n > 1 ? `${t} ${n}` : t, icon, type, target: type === 'link' ? target : `${target}-${i + 1}`, parentId: parent.id, order: i, status: 'active' as const, profiles: [], distributorIds: [], groups: ['gerados'], permission: null, startDate: null, endDate: null };
      });
      for (let i = 0; i < rows.length; i += 200) await m.insert(Menu, rows.slice(i, i + 200));
      await audit(m, actor, 'menu.generate', 'menu', parent.id, `Gerou ${count} menus fictícios em "${title}"`, null, { count });
      return { parentId: parent.id, title, affected: count, ms: Date.now() - t0 };
    });
  }

  @Perm('MENUS_MANAGE', 'MENUS_BULK_EDIT')
  /** o menu geral de `to` passa a ser uma cópia independente do menu geral de `from` */
  @Post('menus/copy-profile')
  @HttpCode(200)
  async copyProfile(@CurrentUser() actor: AuthUser, @Body() body: CopyProfileDto) {
    const { from, to } = body;
    if (from === to) throw new BadRequestException('Escolha perfis diferentes');
    return this.db.transaction(async (m) => {
      const source = profileTree(await m.find(Menu), from).filter((r) => !r.distributorIds.length).map(toPortable);
      const r = await replaceSegment(m, to, null, source);
      await audit(m, actor, 'menu.copy_profile', 'menu', 0, `Copiou o menu de ${from} para ${to} (${r.created} item(ns); ${r.deleted} antigo(s) excluído(s))`, { from }, { to, ...r });
      return { affected: r.created, deleted: r.deleted };
    });
  }

  /** distribuidora volta a usar o menu geral do perfil (apaga o menu próprio dela) */
  @Post('menus/own-menu/reset')
  @HttpCode(200)
  async resetOwnMenu(@CurrentUser() actor: AuthUser, @Body() body: SegmentDto) {
    return this.db.transaction(async (m) => {
      const r = await replaceSegment(m, body.profile, body.distributorId, null);
      await audit(m, actor, 'menu.own_reset', 'distributor', body.distributorId, `Distribuidora ${body.distributorId} voltou ao menu geral (${body.profile}; ${r.deleted} item(ns) excluído(s))`);
      return { deleted: r.deleted };
    });
  }

  @Post('menus/import')
  async import(@CurrentUser() actor: AuthUser, @Body() body: ImportDto) {
    checkPortable(body.items);
    return this.db.transaction(async (m) => {
      let disabled = 0;
      if (body.mode === 'replace') disabled = (await m.update(Menu, { status: 'active' }, { status: 'inactive' })).affected ?? 0;
      const created = await insertPortable(m, body.items, null, await nextOrder(m, null));
      await audit(m, actor, 'menu.import', 'menu', 0, `Importou ${created} menu(s) (${body.mode === 'replace' ? `substituindo; ${disabled} desativado(s)` : 'acrescentando'})`, null, { count: created, mode: body.mode });
      return { affected: created, disabled };
    });
  }

  // ---------- modelos ----------

  @Get('menu-templates')
  async listTemplates() {
    return (await this.templates.find({ order: { createdAt: 'DESC' } })).map((t) => ({ ...t, count: countPortable(t.items as PortableMenu[]) }));
  }

  @Post('menu-templates')
  async createTemplate(@CurrentUser() actor: AuthUser, @Body() body: TemplateDto) {
    let items = body.items ?? [];
    if (body.menuIds?.length) {
      const all = await this.menus.find();
      const tree = body.profile ? profileTree(all, body.profile) : buildTree(all);
      const byId = new Map<number, (typeof tree)[number]>();
      const walk = (list: typeof tree) => list.forEach((n) => (byId.set(n.id, n), walk(n.children)));
      walk(tree);
      items = selectionRoots(all, body.menuIds).map((id) => byId.get(id)).filter(Boolean).map((n) => toPortable(n!));
    }
    checkPortable(items);
    if (!items.length) throw new BadRequestException('Selecione menus ou envie itens para o modelo');
    return this.db.transaction(async (m) => {
      const saved = await m.save(m.create(MenuTemplate, { name: body.name, description: body.description ?? '', items, createdByName: actor.name }));
      await audit(m, actor, 'menu_template.create', 'menu_template', saved.id, `Criou o modelo "${saved.name}" (${countPortable(items)} itens)`);
      return saved;
    });
  }

  /** aplica o modelo: cada distribuidora ganha o próprio menu (cópia); sem distribuidora = menu geral do perfil */
  @Post('menu-templates/:id/apply')
  @HttpCode(200)
  async applyTemplate(@CurrentUser() actor: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() body: ApplyDto) {
    return this.db.transaction(async (m) => {
      const tpl = await m.findOneByOrFail(MenuTemplate, { id });
      const targets = body.distributorIds.length ? [...new Set(body.distributorIds)] : [null];
      let created = 0;
      for (const d of targets) created += (await replaceSegment(m, body.profile, d, tpl.items as PortableMenu[])).created;
      const where = body.distributorIds.length ? `${targets.length} distribuidora(s)` : 'o menu geral';
      await audit(m, actor, 'menu_template.apply', 'menu_template', id, `Aplicou o modelo "${tpl.name}" em ${where} (${body.profile}; ${created} menus)`, null, body);
      return { affected: created };
    });
  }

  @Patch('menu-templates/:id')
  async updateTemplate(@CurrentUser() actor: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() body: TemplatePatchDto) {
    if (body.items) {
      checkPortable(body.items);
      if (!body.items.length) throw new BadRequestException('O modelo precisa de pelo menos um item');
    }
    return this.db.transaction(async (m) => {
      const tpl = await m.findOneByOrFail(MenuTemplate, { id });
      const before = { name: tpl.name, description: tpl.description, count: countPortable(tpl.items as PortableMenu[]) };
      Object.assign(tpl, defined(body));
      await m.save(tpl);
      await audit(m, actor, 'menu_template.update', 'menu_template', id, `Editou o modelo "${tpl.name}" (${countPortable(tpl.items as PortableMenu[])} itens)`, before, { name: tpl.name, description: tpl.description });
      return { ...tpl, count: countPortable(tpl.items as PortableMenu[]) };
    });
  }

  @Post('menu-templates/:id/duplicate')
  async duplicateTemplate(@CurrentUser() actor: AuthUser, @Param('id', ParseIntPipe) id: number) {
    const tpl = await this.templates.findOneByOrFail({ id });
    return this.createTemplate(actor, { name: `${tpl.name} (cópia)`.slice(0, 80), description: tpl.description, items: tpl.items as PortableMenu[] });
  }

  @Delete('menu-templates/:id')
  async deleteTemplate(@CurrentUser() actor: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.db.transaction(async (m) => {
      const tpl = await m.findOneByOrFail(MenuTemplate, { id });
      await m.delete(MenuTemplate, id);
      await audit(m, actor, 'menu_template.delete', 'menu_template', id, `Excluiu o modelo "${tpl.name}"`, tpl, null);
      return { ok: true };
    });
  }
}
