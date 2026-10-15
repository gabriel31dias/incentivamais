// Planilha de vendas da distribuidora: colunas, leitura e validação linha a linha.
// Puro (sem banco): o controller monta o contexto e grava o resultado.
import type { RowStatus } from './entities';

// ponytail: cópia de isValidCpf/parseAmountCents do common.ts. common.ts tem
// decorators (class-validator) e o node --test não carrega decorators sem
// build; unificar quando common.ts separar os helpers puros num arquivo próprio.
function isValidCpf(value: string) {
  const cpf = value.replace(/\D/g, '');
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;
  for (const size of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < size; i++) sum += Number(cpf[i]) * (size + 1 - i);
    if (((sum * 10) % 11) % 10 !== Number(cpf[size])) return false;
  }
  return true;
}

// aceita "1.250,00", "R$ 1250,5", "1250.50" e número vindo do Excel
function parseAmountCents(value: string): number | null {
  const clean = value.replace(/[^\d,.-]/g, '');
  if (!clean) return null;
  const lastComma = clean.lastIndexOf(',');
  const lastDot = clean.lastIndexOf('.');
  const normalized = lastComma > lastDot ? clean.replace(/\./g, '').replace(',', '.') : clean.replace(/,/g, '');
  const number = Number(normalized);
  return Number.isFinite(number) ? Math.round(number * 100) : null;
}

export const IMPORT_COLUMNS = ['documento', 'item', 'cpf_vendedor', 'sku', 'data', 'quantidade', 'valor'] as const;
/** item é opcional (padrão 1) */
export const REQUIRED_COLUMNS = ['documento', 'cpf_vendedor', 'sku', 'data', 'quantidade', 'valor'];
export const TEXT_COLUMNS = ['documento', 'item', 'cpf_vendedor', 'sku', 'data'];
export const MAX_ROWS = 20000;

/** tipos de inconsistência: rótulo + orientação de correção (aparece no relatório e no CSV de erros) */
export const ERROR_INFO: Record<string, { label: string; hint: string }> = {
  required: { label: 'Campo obrigatório vazio', hint: 'Preencha documento, CPF do vendedor, SKU, data, quantidade e valor em todas as linhas.' },
  cpf_invalid: { label: 'CPF inválido', hint: 'Confira os 11 dígitos do CPF do vendedor (os dígitos verificadores não batem).' },
  seller_not_found: { label: 'Vendedor inexistente', hint: 'O CPF não pertence a nenhum vendedor cadastrado. Cadastre o vendedor antes ou corrija o CPF.' },
  seller_other_distributor: { label: 'Vendedor de outra distribuidora', hint: 'O vendedor está vinculado a outra distribuidora. Envie a venda pela distribuidora correta ou peça a transferência.' },
  seller_inactive: { label: 'Vendedor inativo', hint: 'O vendedor está inativo ou bloqueado. Reative o cadastro antes de pontuar a venda.' },
  product_not_found: { label: 'Produto inexistente', hint: 'O SKU não existe no catálogo. Use os SKUs do modelo (ex.: PRD-A).' },
  date_invalid: { label: 'Data inválida', hint: 'Use o formato DD/MM/AAAA (ex.: 15/09/2026).' },
  date_out_of_competence: { label: 'Data fora da competência', hint: 'A data da venda precisa estar dentro do mês da competência informada no envio.' },
  quantity_invalid: { label: 'Quantidade inválida', hint: 'Informe um número inteiro maior que zero.' },
  value_invalid: { label: 'Valor inválido', hint: 'Informe o valor total da venda maior que zero (ex.: 1.250,00).' },
  duplicate: { label: 'Documento duplicado no arquivo', hint: 'O mesmo documento + item aparece mais de uma vez. Remova a linha repetida.' },
  already_imported: { label: 'Venda já importada', hint: 'Esta venda já foi pontuada com os mesmos dados e será ignorada (sem pontos em dobro).' },
  layout: { label: 'Divergência de layout', hint: 'Baixe o modelo de planilha e mantenha os nomes das colunas na primeira linha.' },
};

export type SellerRef = { id: number; name: string; distributorId: number | null; active: boolean };
export type ProductRef = { id: number };
export type SaleRef = { sellerId: number; productId: number; date: string; quantity: number; amountCents: number; points: number };

export type ImportContext = {
  distributorId: number;
  distributorCode: string;
  /** AAAA-MM */
  competence: string;
  sellersByCpf: Map<string, SellerRef>;
  productsBySku: Map<string, ProductRef>;
  /** vendas ativas já pontuadas, por externalId */
  existing: Map<string, SaleRef>;
  points: (s: { productId: number; quantity: number; amountCents: number; date: string }) => number;
};

export type ParsedRow = {
  line: number;
  data: Record<string, string>;
  errors: { code: string; message: string }[];
  status: RowStatus;
  externalId: string | null;
  sellerId: number | null;
  productId: number | null;
  document: string | null;
  date: string | null;
  quantity: number | null;
  amountCents: number | null;
  points: number;
  previousPoints: number | null;
};

/** "15/09/2026", "2026-09-15" → "2026-09-15"; null se inválida (inclui 31/02) */
export function parseDate(value: string): string | null {
  const v = value.trim();
  let y: number, m: number, d: number;
  let match = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if ((match = v.match(/^(\d{4})-(\d{2})-(\d{2})/))) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

export const missingColumns = (header: string[]) => REQUIRED_COLUMNS.filter((c) => !header.includes(c));

/**
 * Valida as linhas. Linha 1 é o cabeçalho: a primeira de dados é a 2, o
 * número bate com o Excel. Linhas inválidas não bloqueiam o lote: ficam no
 * relatório e não entram no processamento.
 */
export function validateRows(rows: Record<string, string>[], ctx: ImportContext): ParsedRow[] {
  const seen = new Set<string>();
  return rows.map((data, index) => {
    const errors: { code: string; message: string }[] = [];
    const fail = (code: string, message = ERROR_INFO[code].label) => errors.push({ code, message });
    const get = (k: string) => (data[k] ?? '').trim();

    const document = get('documento');
    const item = get('item') || '1';
    const cpf = get('cpf_vendedor').replace(/\D/g, '');
    const sku = get('sku').toUpperCase();
    const empty = REQUIRED_COLUMNS.filter((c) => !get(c));
    if (empty.length) fail('required', `Obrigatório: ${empty.join(', ')}`);

    let seller: SellerRef | undefined;
    if (get('cpf_vendedor')) {
      if (!isValidCpf(cpf)) fail('cpf_invalid', `CPF inválido: ${get('cpf_vendedor')}`);
      else if (!(seller = ctx.sellersByCpf.get(cpf))) fail('seller_not_found', `Nenhum vendedor com CPF ${get('cpf_vendedor')}`);
      else if (seller.distributorId !== ctx.distributorId) fail('seller_other_distributor', `${seller.name} pertence a outra distribuidora`);
      else if (!seller.active) fail('seller_inactive', `${seller.name} está inativo ou bloqueado`);
    }

    const product = sku ? ctx.productsBySku.get(sku) : undefined;
    if (sku && !product) fail('product_not_found', `SKU não encontrado: ${get('sku')}`);

    const date = get('data') ? parseDate(get('data')) : null;
    if (get('data') && !date) fail('date_invalid', `Data inválida: ${get('data')}`);
    else if (date && date.slice(0, 7) !== ctx.competence) fail('date_out_of_competence', `${get('data')} fora da competência ${ctx.competence}`);

    const quantity = /^\d+$/.test(get('quantidade')) ? Number(get('quantidade')) : NaN;
    if (get('quantidade') && !(quantity > 0)) fail('quantity_invalid', `Quantidade inválida: ${get('quantidade')}`);

    const amountCents = get('valor') ? parseAmountCents(get('valor')) : null;
    if (get('valor') && !(amountCents && amountCents > 0)) fail('value_invalid', `Valor inválido: ${get('valor')}`);

    const externalId = document ? `${ctx.distributorCode}:${document}:${item}` : null;
    const row: ParsedRow = {
      line: index + 2,
      data,
      errors,
      status: 'invalid',
      externalId,
      sellerId: seller?.id ?? null,
      productId: product?.id ?? null,
      document: document || null,
      date,
      quantity: quantity > 0 ? quantity : null,
      amountCents: amountCents && amountCents > 0 ? amountCents : null,
      points: 0,
      previousPoints: null,
    };

    if (externalId && seen.has(externalId)) {
      row.status = 'duplicate';
      errors.push({ code: 'duplicate', message: `Documento ${document} item ${item} repetido no arquivo` });
      return row;
    }
    if (externalId) seen.add(externalId);
    if (errors.length) return row;

    const sale = { productId: product!.id, quantity, amountCents: amountCents!, date: date! };
    const previous = ctx.existing.get(externalId!);
    if (previous) {
      const same =
        previous.sellerId === seller!.id &&
        previous.productId === sale.productId &&
        previous.date === sale.date &&
        previous.quantity === sale.quantity &&
        previous.amountCents === sale.amountCents;
      if (same) {
        row.status = 'already_imported';
        row.previousPoints = previous.points;
        return row;
      }
      row.status = 'correction';
      row.previousPoints = previous.points;
    } else row.status = 'valid';
    row.points = ctx.points(sale);
    return row;
  });
}

/** o que mudou entre a venda original e a correção (vai no motivo do ajuste) */
export function describeChange(before: SaleRef, after: Omit<SaleRef, 'points'>) {
  const parts: string[] = [];
  if (before.quantity !== after.quantity) parts.push(`qtd ${before.quantity}→${after.quantity}`);
  if (before.amountCents !== after.amountCents)
    parts.push(`valor R$ ${(before.amountCents / 100).toFixed(2)}→R$ ${(after.amountCents / 100).toFixed(2)}`);
  if (before.date !== after.date) parts.push(`data ${before.date}→${after.date}`);
  if (before.productId !== after.productId) parts.push('produto alterado');
  if (before.sellerId !== after.sellerId) parts.push('vendedor alterado');
  return parts.join(', ') || 'sem mudança de dados';
}
