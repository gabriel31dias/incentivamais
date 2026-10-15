import type { Campaign, CampaignStatus, PointRule } from './entities';

export type SaleInput = {
  productId: number;
  distributorId: number;
  quantity: number;
  amountCents: number;
  /** AAAA-MM-DD */
  date: string;
};

const inWindow = (date: string, start: string, end: string) => date >= start && date <= end;

/** status efetivo: agendada vira ativa ao chegar a data; ativa/pausada vira encerrada depois do fim */
export function effectiveStatus(c: Pick<Campaign, 'status' | 'startDate' | 'endDate'>): CampaignStatus {
  const t = new Date().toISOString().slice(0, 10);
  if (c.status === 'scheduled' && c.startDate <= t) return c.endDate < t ? 'ended' : 'active';
  if ((c.status === 'active' || c.status === 'paused') && c.endDate < t) return 'ended';
  return c.status;
}

/** campanha ativa que cobre a venda (data + distribuidora + produto) */
export function campaignFor(campaigns: Campaign[], s: SaleInput) {
  return campaigns.find(
    (c) =>
      ['active', 'paused', 'ended'].includes(effectiveStatus(c)) &&
      inWindow(s.date, c.startDate, c.endDate) &&
      (!c.distributorIds.length || c.distributorIds.includes(s.distributorId)) &&
      (!c.productIds.length || c.productIds.includes(s.productId)),
  );
}

export const ruleLabel = (r: PointRule) => `${r.name} (v${r.version})`;

/**
 * Pontos de uma venda. Regra base (por unidade ou por valor) de maior
 * prioridade; depois o multiplicador de maior prioridade, se houver.
 * Bônus de meta não entra aqui: é lançado à parte.
 */
export function computePoints(rules: PointRule[], campaignId: number | null, s: SaleInput) {
  const matches = rules
    .filter(
      (r) =>
        r.status === 'active' &&
        r.campaignId === campaignId &&
        inWindow(s.date, r.startDate, r.endDate) &&
        (r.productId == null || r.productId === s.productId) &&
        (r.distributorId == null || r.distributorId === s.distributorId),
    )
    // prioridade maior primeiro; empate: regra específica de produto vence a genérica
    .sort((a, b) => b.priority - a.priority || Number(b.productId != null) - Number(a.productId != null) || b.id - a.id);

  const base = matches.find((r) => r.calcType === 'per_unit' || r.calcType === 'per_amount');
  if (!base) return { points: 0, rule: null as PointRule | null, breakdown: ['Nenhuma regra aplicável'] };

  let points =
    base.calcType === 'per_unit'
      ? s.quantity * base.value
      : Math.floor(s.amountCents / (base.amountStepCents || 10000)) * base.value;
  const breakdown = [
    base.calcType === 'per_unit'
      ? `${ruleLabel(base)}: ${s.quantity} un × ${base.value} pts = ${points} pts`
      : `${ruleLabel(base)}: ${Math.floor(s.amountCents / (base.amountStepCents || 10000))} × R$ ${(base.amountStepCents || 10000) / 100} → ${points} pts`,
  ];

  const multiplier = matches.find((r) => r.calcType === 'multiplier');
  if (multiplier && points > 0) {
    const before = points;
    points = Math.round((points * multiplier.value) / 100);
    breakdown.push(`${ruleLabel(multiplier)}: ${before} × ${multiplier.value / 100} = ${points} pts`);
  }
  return { points, rule: base, breakdown };
}
