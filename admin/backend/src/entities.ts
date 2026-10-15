import {
  Column,
  CreateDateColumn,
  Entity,
  EntityManager,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// ponytail: sem FKs (mesmo padrão do sistema-pg). Registros históricos guardam
// id + nome de quem fez, então desativar/remover algo nunca quebra o histórico.

export const PROFILES = ['super_admin', 'admin', 'manager', 'seller', 'focal'] as const;
export type ProfileKey = (typeof PROFILES)[number];

export const PERMISSIONS = [
  'USERS_VIEW',
  'USERS_CREATE',
  'USERS_EDIT',
  'USERS_DISABLE',
  'TEAMS_MANAGE',
  'MENUS_MANAGE',
  'MENUS_BULK_EDIT',
  'CAMPAIGNS_MANAGE',
  'POINT_RULES_MANAGE',
  'POINTS_ADJUST',
  'SALES_IMPORT',
  'SALES_VALIDATE',
  'SALES_APPROVE',
  'SALES_REPROCESS',
  'REPORTS_VIEW',
  'CONTENT_MANAGE',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** escopo de dados: o maior escopo entre os perfis do usuário vale */
export const SCOPES = ['own', 'team', 'distributors', 'organization'] as const;
export type Scope = (typeof SCOPES)[number];

@Entity('profiles')
export class Profile {
  @PrimaryGeneratedColumn() id: number;
  @Index({ unique: true }) @Column() key: ProfileKey;
  @Column() name: string;
  @Column({ type: 'simple-json' }) permissions: Permission[];
  @Column({ type: 'varchar' }) scope: Scope;
}

@Entity('users')
// vendedores não repetem nome; maiúsculas/minúsculas são conferidas na API (sellerNameTaken)
@Index('uq_users_seller_name', ['name'], { unique: true, where: `profiles LIKE '%"seller"%'` })
export class User {
  @PrimaryGeneratedColumn() id: number;
  @Column() name: string;
  @Index({ unique: true }) @Column() email: string;
  @Index() @Column({ type: 'varchar', nullable: true }) cpf: string | null;
  @Column() passwordHash: string;
  /** múltiplos perfis: ex. gerente + ponto focal */
  @Column({ type: 'simple-json' }) profiles: ProfileKey[];
  @Index() @Column({ type: 'integer', nullable: true }) distributorId: number | null;
  @Index() @Column({ type: 'integer', nullable: true }) managerId: number | null;
  @Index() @Column({ type: 'integer', nullable: true }) teamId: number | null;
  @Index() @Column({ type: 'varchar', default: 'active' }) status: 'active' | 'inactive';
  @Column({ default: false }) blocked: boolean;
  @Column({ type: 'datetime', nullable: true }) lastAccessAt: Date | null;
  // MFA (app autenticador/TOTP): secret gerado no 1º login com MFA, ativo após o 1º código válido
  @Column({ type: 'varchar', nullable: true }) totpSecret: string | null;
  @Column({ default: false }) totpEnabled: boolean;
  /** último passo de 30s aceito: o mesmo código não vale duas vezes */
  @Column({ type: 'integer', nullable: true }) totpLastStep: number | null;
  @CreateDateColumn() createdAt: Date;
}

@Entity('sessions')
export class Session {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column() userId: number;
  @Column() userName: string;
  @Column({ type: 'varchar', nullable: true }) userAgent: string | null;
  @Column({ type: 'varchar', nullable: true }) ip: string | null;
  @Column({ type: 'datetime', nullable: true }) revokedAt: Date | null;
  @CreateDateColumn() createdAt: Date;
}

@Entity('distributors')
export class Distributor {
  @PrimaryGeneratedColumn() id: number;
  @Column() name: string;
  @Index({ unique: true }) @Column() code: string;
  @Column() cnpj: string;
  @Column() responsible: string;
  @Column() region: string;
  @Column({ type: 'integer', nullable: true }) focalUserId: number | null;
  @Column({ type: 'varchar', default: 'active' }) status: 'active' | 'inactive';
  @CreateDateColumn() createdAt: Date;
}

@Entity('teams')
export class Team {
  @PrimaryGeneratedColumn() id: number;
  @Column() name: string;
  @Index() @Column() distributorId: number;
  @Index() @Column({ type: 'integer', nullable: true }) managerId: number | null;
  /** meta mensal da equipe, em centavos */
  @Column({ type: 'integer', default: 0 }) goalCents: number;
  @Column({ type: 'varchar', default: 'active' }) status: 'active' | 'inactive';
  @CreateDateColumn() createdAt: Date;
}

/**
 * Meta mensal da equipe por competência (AAAA-MM). Team.goalCents é só o valor
 * padrão sugerido ao definir a meta de um mês novo.
 */
@Entity('team_goals')
@Index(['teamId', 'competence'], { unique: true })
export class TeamGoal {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column() teamId: number;
  @Index() @Column() competence: string;
  @Column({ type: 'integer' }) goalCents: number;
  @Column() createdByName: string;
  @UpdateDateColumn() updatedAt: Date;
  @CreateDateColumn() createdAt: Date;
}

@Entity('products')
export class Product {
  @PrimaryGeneratedColumn() id: number;
  @Index({ unique: true }) @Column() sku: string;
  @Column() name: string;
  @Column() category: string;
  @Column({ type: 'integer' }) priceCents: number;
  @Column({ type: 'varchar', default: 'active' }) status: 'active' | 'inactive';
}

export type CampaignStatus = 'draft' | 'scheduled' | 'active' | 'paused' | 'ended';

@Entity('campaigns')
export class Campaign {
  @PrimaryGeneratedColumn() id: number;
  @Column() name: string;
  @Column({ type: 'text', default: '' }) description: string;
  @Column({ type: 'date' }) startDate: string;
  @Column({ type: 'date' }) endDate: string;
  @Index() @Column({ type: 'varchar', default: 'draft' }) status: CampaignStatus;
  /** vazio = todas */
  @Column({ type: 'simple-json' }) distributorIds: number[];
  @Column({ type: 'simple-json' }) audience: ProfileKey[];
  @Column({ type: 'simple-json' }) productIds: number[];
  @Column({ type: 'simple-json' }) rewards: string[];
  @Column({ type: 'integer', default: 0 }) goalCents: number;
  @Column({ type: 'varchar', nullable: true }) banner: string | null;
  @CreateDateColumn() createdAt: Date;
}

export type CalcType = 'per_unit' | 'per_amount' | 'goal_bonus' | 'multiplier';

/**
 * Regra versionada: editar cria nova linha (version+1) e a anterior vira
 * 'superseded'. Pontos já creditados guardam o ruleId da versão usada e nunca
 * são recalculados, então mudar regra não altera nada retroativamente.
 */
@Entity('point_rules')
export class PointRule {
  @PrimaryGeneratedColumn() id: number;
  /** identifica a regra através das versões */
  @Index() @Column() ruleKey: string;
  @Column({ type: 'integer', default: 1 }) version: number;
  @Column() name: string;
  @Index() @Column() campaignId: number;
  @Column({ type: 'integer', nullable: true }) productId: number | null;
  @Column({ type: 'integer', nullable: true }) distributorId: number | null;
  @Column({ type: 'varchar' }) calcType: CalcType;
  /** per_unit: pontos/un · per_amount: pontos a cada amountStepCents · goal_bonus: pontos · multiplier: fator (x100) */
  @Column({ type: 'integer' }) value: number;
  @Column({ type: 'integer', nullable: true }) amountStepCents: number | null;
  @Column({ type: 'date' }) startDate: string;
  @Column({ type: 'date' }) endDate: string;
  @Column({ type: 'integer', default: 0 }) priority: number;
  @Index() @Column({ type: 'varchar', default: 'active' }) status: 'active' | 'inactive' | 'superseded';
  @Column() createdByName: string;
  @CreateDateColumn() createdAt: Date;
}

export type BatchStatus =
  | 'received'
  | 'validating'
  | 'with_errors'
  | 'awaiting_confirmation'
  | 'queued'
  | 'processing'
  | 'done'
  | 'failed'
  | 'replaced'
  | 'returned';

@Entity('import_batches')
export class ImportBatch {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column() distributorId: number;
  @Column() distributorName: string;
  /** AAAA-MM */
  @Index() @Column() competence: string;
  @Column() fileName: string;
  @Column() userId: number;
  @Column() userName: string;
  @Index() @Column({ type: 'varchar', default: 'received' }) status: BatchStatus;
  @Column({ type: 'integer', default: 0 }) total: number;
  @Column({ type: 'integer', default: 0 }) valid: number;
  @Column({ type: 'integer', default: 0 }) invalid: number;
  @Column({ type: 'integer', default: 0 }) duplicates: number;
  /** linhas que corrigem uma venda já pontuada */
  @Column({ type: 'integer', default: 0 }) corrections: number;
  @Column({ type: 'integer', default: 0 }) predictedPoints: number;
  @Column({ type: 'integer', default: 0 }) creditedPoints: number;
  @Column({ type: 'varchar', nullable: true }) error: string | null;
  /** lote que este substituiu (reenvio corrigido) */
  @Column({ type: 'integer', nullable: true }) replacesBatchId: number | null;
  @Column({ type: 'datetime', nullable: true }) processedAt: Date | null;
  /** quem confirmou (vira o responsável dos lançamentos) */
  @Column({ type: 'integer', nullable: true }) confirmedById: number | null;
  @Column({ type: 'varchar', nullable: true }) confirmedByName: string | null;
  @Column({ type: 'datetime', nullable: true }) confirmedAt: Date | null;
  /** resultado do último processamento (idempotente: reprocessar só soma o que faltava) */
  @Column({ type: 'integer', default: 0 }) newCount: number;
  @Column({ type: 'integer', default: 0 }) skippedCount: number;
  @Column({ type: 'integer', default: 0 }) correctedCount: number;
  /** soma dos ajustes (+) e estornos (−) gerados por correções */
  @Column({ type: 'integer', default: 0 }) adjustmentPoints: number;
  @Column({ type: 'integer', default: 0 }) reprocessCount: number;
  /** devolvido para quem enviou corrigir (com justificativa) */
  @Column({ type: 'varchar', nullable: true }) returnReason: string | null;
  @Column({ type: 'integer', nullable: true }) returnedById: number | null;
  @Column({ type: 'varchar', nullable: true }) returnedByName: string | null;
  @Column({ type: 'datetime', nullable: true }) returnedAt: Date | null;
  /** quando quem enviou viu o aviso (modal em tempo real) */
  @Column({ type: 'datetime', nullable: true }) returnSeenAt: Date | null;
  @Index() @CreateDateColumn() createdAt: Date;
}

export type RowStatus = 'valid' | 'invalid' | 'duplicate' | 'already_imported' | 'correction';

@Entity('import_rows')
export class ImportRow {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column() batchId: number;
  @Column() line: number;
  @Column({ type: 'simple-json' }) data: Record<string, string>;
  /** code: chave do tipo de inconsistência (import.ts ERROR_INFO) */
  @Column({ type: 'simple-json' }) errors: { code: string; message: string }[];
  @Index() @Column({ type: 'varchar' }) status: RowStatus;
  /** distribuidora:documento:item — chave de idempotência da venda */
  @Column({ type: 'varchar', nullable: true }) externalId: string | null;
  @Column({ type: 'integer', nullable: true }) sellerId: number | null;
  @Column({ type: 'integer', nullable: true }) productId: number | null;
  @Column({ type: 'varchar', nullable: true }) document: string | null;
  @Column({ type: 'varchar', nullable: true }) date: string | null;
  @Column({ type: 'integer', nullable: true }) quantity: number | null;
  @Column({ type: 'integer', nullable: true }) amountCents: number | null;
  @Column({ type: 'integer', default: 0 }) points: number;
  /** correção: pontos da venda original */
  @Column({ type: 'integer', nullable: true }) previousPoints: number | null;
}

/**
 * Venda pontuada. externalId é único entre as vendas ativas: reenviar o mesmo
 * arquivo nunca duplica. Correção marca a anterior como 'replaced' e cria nova.
 */
@Entity('sales')
@Index(['externalId'], { unique: true, where: "status = 'active'" })
export class Sale {
  @PrimaryGeneratedColumn() id: number;
  @Column() externalId: string;
  @Index() @Column() batchId: number;
  @Index() @Column() distributorId: number;
  @Index() @Column() sellerId: number;
  @Index() @Column() productId: number;
  @Index() @Column({ type: 'integer', nullable: true }) campaignId: number | null;
  @Column() document: string;
  @Index() @Column({ type: 'date' }) date: string;
  @Index() @Column() competence: string;
  @Column({ type: 'integer' }) quantity: number;
  @Column({ type: 'integer' }) amountCents: number;
  @Column({ type: 'integer' }) points: number;
  @Column({ type: 'integer', nullable: true }) ruleId: number | null;
  @Index() @Column({ type: 'varchar', default: 'active' }) status: 'active' | 'replaced';
  @Column({ type: 'integer', nullable: true }) replacedBySaleId: number | null;
  @CreateDateColumn() createdAt: Date;
}

export type EntryType = 'credit' | 'debit' | 'reversal' | 'adjustment' | 'bonus';

/** extrato: só insere, nunca apaga nem edita */
@Entity('point_entries')
export class PointEntry {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column() sellerId: number;
  @Column() sellerName: string;
  @Index() @Column({ type: 'integer', nullable: true }) distributorId: number | null;
  @Index() @Column({ type: 'integer', nullable: true }) campaignId: number | null;
  @Index() @Column({ type: 'varchar' }) type: EntryType;
  @Column({ type: 'integer' }) points: number;
  @Column() origin: string;
  @Column({ type: 'integer', nullable: true }) ruleId: number | null;
  @Column({ type: 'varchar', nullable: true }) ruleLabel: string | null;
  @Index() @Column({ type: 'varchar', nullable: true }) saleExternalId: string | null;
  @Column({ type: 'integer', nullable: true }) batchId: number | null;
  /** lançamento que este estorna/ajusta */
  @Column({ type: 'integer', nullable: true }) relatedEntryId: number | null;
  @Column({ type: 'varchar', nullable: true }) reason: string | null;
  /** chave de idempotência de bônus (ex.: GOAL:2026-09:T12): o mesmo bônus não sai duas vezes */
  @Index() @Column({ type: 'varchar', nullable: true }) bonusKey: string | null;
  @Column() actorName: string;
  @Index() @CreateDateColumn() createdAt: Date;
}

export type MenuType = 'page' | 'link' | 'report' | 'content' | 'feature';

@Entity('menus')
export class Menu {
  @PrimaryGeneratedColumn() id: number;
  @Column() title: string;
  @Column({ default: 'Circle' }) icon: string;
  @Column({ type: 'varchar', default: 'page' }) type: MenuType;
  @Column({ default: '' }) target: string;
  @Index() @Column({ type: 'integer', nullable: true }) parentId: number | null;
  @Column({ type: 'integer', default: 0 }) order: number;
  @Index() @Column({ type: 'varchar', default: 'active' }) status: 'active' | 'inactive';
  @Column({ type: 'date', nullable: true }) startDate: string | null;
  @Column({ type: 'date', nullable: true }) endDate: string | null;
  /** vazio = todos */
  @Column({ type: 'simple-json' }) profiles: ProfileKey[];
  @Column({ type: 'simple-json' }) distributorIds: number[];
  @Column({ type: 'simple-json' }) groups: string[];
  @Column({ type: 'varchar', nullable: true }) permission: string | null;
  /** item principal do menu próprio de distribuidora(s): quem é dela vê só esse menu, não o geral */
  @Column({ default: false }) ownMenu: boolean;
  @UpdateDateColumn() updatedAt: Date;
  @CreateDateColumn() createdAt: Date;
}

@Entity('menu_templates')
export class MenuTemplate {
  @PrimaryGeneratedColumn() id: number;
  @Column() name: string;
  @Column({ type: 'text', default: '' }) description: string;
  /** árvore serializada (sem ids), aplicável em qualquer lugar */
  @Column({ type: 'simple-json' }) items: any[]; // eslint-disable-line
  @Column() createdByName: string;
  @CreateDateColumn() createdAt: Date;
}

/**
 * Módulos secundários (notícias, banners, treinamentos, quiz, missões, prêmios,
 * chamados...) num registro genérico: kind + campos comuns + data em JSON.
 * ponytail: tabela única; ganha tabela própria quando precisar de consulta/índice por campo de data.
 */
@Entity('records')
export class RecordItem {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column() kind: string;
  @Column() title: string;
  @Index() @Column({ type: 'varchar', default: 'draft' }) status: string;
  @Column({ type: 'simple-json' }) data: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  @Column({ type: 'simple-json' }) history: { at: string; by: string; action: string }[];
  @UpdateDateColumn() updatedAt: Date;
  @Index() @CreateDateColumn() createdAt: Date;
}

@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn() id: number;
  @Index() @Column() action: string;
  @Column() actorId: number;
  @Column() actorName: string;
  @Index() @Column() targetType: string;
  @Index() @Column() targetId: string;
  @Column() description: string;
  @Column({ type: 'simple-json', nullable: true }) before: any; // eslint-disable-line
  @Column({ type: 'simple-json', nullable: true }) after: any; // eslint-disable-line
  @Index() @CreateDateColumn() createdAt: Date;
}

/** progresso do usuário num treinamento (records kind=training) */
@Entity('training_progress')
@Index(['userId', 'trainingId'], { unique: true })
export class TrainingProgress {
  @PrimaryGeneratedColumn() id: number;
  @Column() userId: number;
  @Index() @Column() trainingId: number;
  /** chaves "módulo.aula" assistidas */
  @Column({ type: 'simple-json' }) lessonsDone: string[];
  @Column({ default: false }) favorite: boolean;
  @Column({ type: 'datetime', nullable: true }) completedAt: Date | null;
  @UpdateDateColumn() updatedAt: Date;
}

/** tentativa de quiz ou voto de enquete (records kind=quiz|poll) */
@Entity('quiz_attempts')
@Index(['userId', 'recordId'])
export class QuizAttempt {
  @PrimaryGeneratedColumn() id: number;
  @Column() userId: number;
  @Column() recordId: number;
  /** índice escolhido por pergunta (enquete: [opção]); null = em andamento */
  @Column({ type: 'simple-json', nullable: true }) answers: number[] | null;
  @Column({ type: 'integer', default: 0 }) score: number;
  @Column({ type: 'integer', default: 0 }) total: number;
  @Column({ default: false }) passed: boolean;
  @CreateDateColumn() startedAt: Date;
  @Column({ type: 'datetime', nullable: true }) finishedAt: Date | null;
}

export const ENTITIES = [
  QuizAttempt,
  TrainingProgress,
  Profile,
  User,
  Session,
  Distributor,
  Team,
  TeamGoal,
  Product,
  Campaign,
  PointRule,
  ImportBatch,
  ImportRow,
  Sale,
  PointEntry,
  Menu,
  MenuTemplate,
  RecordItem,
  AuditLog,
];

export type Actor = { id: number; name: string };

export const audit = (
  manager: EntityManager,
  actor: Actor,
  action: string,
  targetType: string,
  targetId: string | number,
  description: string,
  before: any = null, // eslint-disable-line
  after: any = null, // eslint-disable-line
) =>
  manager.insert(AuditLog, {
    action,
    actorId: actor.id,
    actorName: actor.name,
    targetType,
    targetId: String(targetId),
    description,
    before,
    after,
  });
