import assert from 'node:assert/strict';
import { test } from 'node:test';
import { campaignFor, computePoints } from './points.ts';

const rule = (o: Record<string, unknown>) =>
  ({ id: 1, ruleKey: 'r', version: 1, name: 'R', campaignId: 1, productId: null, distributorId: null, value: 1,
     amountStepCents: null, startDate: '2026-01-01', endDate: '2026-12-31', priority: 0, status: 'active', ...o }) as never;
const sale = { productId: 1, distributorId: 1, quantity: 3, amountCents: 25000, date: '2026-05-10' };

test('por unidade, produto específico vence genérica', () => {
  const r = computePoints([rule({ id: 1, calcType: 'per_amount', value: 5, amountStepCents: 10000 }), rule({ id: 2, productId: 1, calcType: 'per_unit', value: 10 })], 1, sale);
  assert.equal(r.points, 30);
});
test('por valor arredonda pra baixo', () => {
  assert.equal(computePoints([rule({ calcType: 'per_amount', value: 5, amountStepCents: 10000 })], 1, sale).points, 10);
});
test('multiplicador e janela de datas', () => {
  const rules = [rule({ id: 1, calcType: 'per_unit', value: 10 }), rule({ id: 2, calcType: 'multiplier', value: 200, startDate: '2026-05-01', endDate: '2026-05-31' })];
  assert.equal(computePoints(rules, 1, sale).points, 60);
  assert.equal(computePoints(rules, 1, { ...sale, date: '2026-06-01' }).points, 30);
});
test('regra inativa/substituída ou de outra campanha não conta', () => {
  assert.equal(computePoints([rule({ calcType: 'per_unit', status: 'superseded' })], 1, sale).points, 0);
  assert.equal(computePoints([rule({ calcType: 'per_unit' })], 2, sale).points, 0);
});
test('campanha agendada que já começou pega a venda; rascunho e agendada futura não', () => {
  const camp = (o: Record<string, unknown>) => ({ id: 6, startDate: '2026-01-01', endDate: '2099-12-31', distributorIds: [1], productIds: [1], ...o }) as never;
  assert.equal(campaignFor([camp({ status: 'scheduled' })], sale)?.id, 6);
  assert.equal(campaignFor([camp({ status: 'draft' })], sale), undefined);
  assert.equal(campaignFor([camp({ status: 'scheduled', startDate: '2099-01-01' })], sale), undefined);
});
