import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeChange, parseDate, validateRows, type ImportContext } from './import.ts';

// CPFs válidos (dígito verificador ok)
const CPF_A = '52998224725';
const CPF_B = '11144477735';
const CPF_C = '39053344705';

const ctx: ImportContext = {
  distributorId: 1,
  distributorCode: 'DIST01',
  competence: '2026-09',
  sellersByCpf: new Map([
    [CPF_A, { id: 10, name: 'Ana', distributorId: 1, active: true }],
    [CPF_B, { id: 11, name: 'Bruno', distributorId: 2, active: true }],
    [CPF_C, { id: 12, name: 'Carla', distributorId: 1, active: false }],
  ]),
  productsBySku: new Map([['PRD-A', { id: 1 }]]),
  existing: new Map([
    ['DIST01:NF1:1', { sellerId: 10, productId: 1, date: '2026-09-10', quantity: 2, amountCents: 20000, points: 20 }],
    ['DIST01:NF2:1', { sellerId: 10, productId: 1, date: '2026-09-10', quantity: 2, amountCents: 20000, points: 20 }],
  ]),
  points: (s) => s.quantity * 10,
};

const row = (o: Record<string, string> = {}) => ({
  documento: 'NF9', item: '1', cpf_vendedor: CPF_A, sku: 'prd-a', data: '15/09/2026', quantidade: '3', valor: '300,00', ...o,
});
const codes = (o: Record<string, string>) => validateRows([row(o)], ctx)[0].errors.map((e) => e.code);

test('parseDate', () => {
  assert.equal(parseDate('15/09/2026'), '2026-09-15');
  assert.equal(parseDate('2026-09-15'), '2026-09-15');
  assert.equal(parseDate('31/02/2026'), null);
  assert.equal(parseDate('ontem'), null);
});

test('linha válida calcula pontos e chave de idempotência', () => {
  const [r] = validateRows([row()], ctx);
  assert.equal(r.status, 'valid');
  assert.equal(r.externalId, 'DIST01:NF9:1');
  assert.equal(r.points, 30);
  assert.equal(r.line, 2);
});

test('cada inconsistência', () => {
  assert.deepEqual(codes({ sku: '' }), ['required']);
  assert.deepEqual(codes({ cpf_vendedor: '123.456.789-00' }), ['cpf_invalid']);
  assert.deepEqual(codes({ cpf_vendedor: '87748248800' }), ['seller_not_found']);
  assert.deepEqual(codes({ cpf_vendedor: CPF_B }), ['seller_other_distributor']);
  assert.deepEqual(codes({ cpf_vendedor: CPF_C }), ['seller_inactive']);
  assert.deepEqual(codes({ sku: 'XYZ' }), ['product_not_found']);
  assert.deepEqual(codes({ data: '31/02/2026' }), ['date_invalid']);
  assert.deepEqual(codes({ data: '01/08/2026' }), ['date_out_of_competence']);
  assert.deepEqual(codes({ quantidade: '-2' }), ['quantity_invalid']);
  assert.deepEqual(codes({ quantidade: '1,5' }), ['quantity_invalid']);
  assert.deepEqual(codes({ valor: '0' }), ['value_invalid']);
});

test('duplicada no arquivo, já importada e correção', () => {
  const rows = validateRows(
    [
      row(),
      row(),
      row({ documento: 'NF1', data: '10/09/2026', quantidade: '2', valor: '200,00' }),
      row({ documento: 'NF2', data: '10/09/2026', quantidade: '5', valor: '500,00' }),
    ],
    ctx,
  );
  assert.deepEqual(rows.map((r) => r.status), ['valid', 'duplicate', 'already_imported', 'correction']);
  assert.equal(rows[2].points, 0);
  assert.equal(rows[3].points, 50);
  assert.equal(rows[3].previousPoints, 20);
});

test('describeChange', () => {
  const before = { sellerId: 1, productId: 1, date: '2026-09-10', quantity: 2, amountCents: 20000, points: 20 };
  assert.equal(describeChange(before, { ...before, quantity: 5, amountCents: 50000 }), 'qtd 2→5, valor R$ 200.00→R$ 500.00');
});
