import { completeGtin } from '@bipae/domain';
import { describe, expect, it } from 'vitest';
import {
  addItem,
  buildReceipt,
  cashSuggestions,
  closeBlind,
  discountNeedsAuthorization,
  DRAWER_PULSE,
  EMPTY_CART,
  encodeReceipt,
  encodeText,
  expectedBySession,
  lineGross,
  parseScaleResponse,
  parseScan,
  percentOf,
  quantityFromLabelPrice,
  receiptToText,
  removeLine,
  repriceLines,
  setLineDiscount,
  setQuantity,
  setSaleDiscount,
  summarizePayments,
  totals,
  zeroByMethod,
  type CatalogItem,
} from './index';

const rice: CatalogItem = {
  id: 'r',
  name: 'Arroz 5kg',
  unit: 'UN',
  priceCents: 2890,
  isWeighable: false,
};
const banana: CatalogItem = {
  id: 'b',
  name: 'Banana prata',
  unit: 'KG',
  priceCents: 699,
  isWeighable: true,
};
const gum: CatalogItem = {
  id: 'g',
  name: 'Chiclete',
  unit: 'UN',
  priceCents: 33,
  isWeighable: false,
};

describe('cart', () => {
  it('merges repeated units and keeps weighed items on separate lines', () => {
    let cart = addItem(EMPTY_CART, rice);
    cart = addItem(cart, rice, 2000);
    cart = addItem(cart, banana, 1250);
    cart = addItem(cart, banana, 500);
    expect(cart.lines.map((l) => [l.name, l.quantityMilli])).toEqual([
      ['Arroz 5kg', 3000],
      ['Banana prata', 1250],
      ['Banana prata', 500],
    ]);
    // 1,250 kg × R$ 6,99 = 8,7375 → R$ 8,74 (half up)
    expect(lineGross(699, 1250)).toBe(874);
    expect(totals(cart).totalCents).toBe(3 * 2890 + 874 + 350);
  });

  it('validates quantities', () => {
    const cart = addItem(EMPTY_CART, rice);
    expect(() => setQuantity(cart, 1, 1500)).toThrow('vendido por unidade inteira');
    expect(() => setQuantity(cart, 1, 0)).toThrow('Quantidade inválida');
    expect(() => addItem(cart, rice, -1)).toThrow('Quantidade inválida');
    expect(() => setQuantity(cart, 99, 1000)).toThrow('Item não encontrado');
    expect(removeLine(cart, 1).lines).toHaveLength(0);
  });

  it('allocates a sale discount so line totals always add up', () => {
    let cart = addItem(EMPTY_CART, gum, 3000); // 0,99
    cart = addItem(cart, rice); // 28,90
    cart = addItem(cart, banana, 333); // 2,33
    cart = setSaleDiscount(cart, 100);
    const t = totals(cart);
    expect(t.items.reduce((a, i) => a + i.totalCents, 0)).toBe(t.totalCents);
    expect(t.items.reduce((a, i) => a + i.discountCents, 0)).toBe(100);
    expect(t.totalCents).toBe(99 + 2890 + 233 - 100);
  });

  it('item and sale discounts with limits', () => {
    let cart = addItem(EMPTY_CART, rice);
    expect(() => setLineDiscount(cart, 1, 3000)).toThrow('maior que o valor do item');
    cart = setLineDiscount(cart, 1, 289);
    expect(discountNeedsAuthorization(cart, 10)).toBe(false);
    cart = setLineDiscount(cart, 1, 290);
    expect(discountNeedsAuthorization(cart, 10)).toBe(true);
    expect(() => setSaleDiscount(cart, 999999)).toThrow('maior que o total');
    expect(percentOf(2890, 10)).toBe(289);
    expect(discountNeedsAuthorization(addItem(EMPTY_CART, rice), 0)).toBe(false);
  });

  it('reducing quantity caps an item discount', () => {
    let cart = addItem(EMPTY_CART, rice, 2000);
    cart = setLineDiscount(cart, 1, 5000);
    cart = setQuantity(cart, 1, 1000);
    expect(cart.lines[0]!.discountCents).toBe(2890);
  });
});

describe('scan input', () => {
  it('reads barcodes, multipliers and searches', () => {
    expect(parseScan('7891000315507')).toEqual({
      kind: 'barcode',
      code: '7891000315507',
      quantityMilli: 1000,
    });
    expect(parseScan('3*7891000315507')).toMatchObject({ kind: 'barcode', quantityMilli: 3000 });
    expect(parseScan('0,5x banana')).toEqual({
      kind: 'search',
      text: 'banana',
      quantityMilli: 500,
    });
    expect(parseScan('   ')).toBeNull();
    expect(parseScan('0*arroz')).toBeNull();
  });

  it('decodes scale price labels (prefix 2)', () => {
    const label = completeGtin('200123001234'); // PLU 00123, total R$ 12,34
    expect(parseScan(label)).toEqual({ kind: 'scale-label', plu: '123', totalCents: 1234 });
    expect(quantityFromLabelPrice(1234, 699)).toBe(1765);
    expect(() => quantityFromLabelPrice(1, 0)).toThrow();
    const weightLabel = parseScan(label, {
      prefix: '2',
      pluStart: 1,
      pluLength: 5,
      valueStart: 6,
      valueLength: 6,
      valueKind: 'weight',
    });
    expect(weightLabel).toEqual({ kind: 'scale-label', plu: '123', quantityMilli: 1234 });
  });
});

describe('payments', () => {
  it('gives change only from cash and applies cards first', () => {
    const s = summarizePayments(5000, [
      { method: 'cash', receivedCents: 5000 },
      { method: 'debit', receivedCents: 2000, nsu: '123' },
    ]);
    expect(s.payments).toEqual([
      {
        method: 'debit',
        amountCents: 2000,
        changeCents: 0,
        nsu: '123',
        authorizationCode: null,
        provider: null,
      },
      {
        method: 'cash',
        amountCents: 3000,
        changeCents: 2000,
        nsu: null,
        authorizationCode: null,
        provider: null,
      },
    ]);
    expect(s.changeCents).toBe(2000);
    expect(s.remainingCents).toBe(0);
  });

  it('rejects overpaying with card and reports what is left', () => {
    expect(() => summarizePayments(1000, [{ method: 'credit', receivedCents: 1500 }])).toThrow(
      'Só pagamento em dinheiro',
    );
    expect(() => summarizePayments(1000, [{ method: 'pix', receivedCents: 0 }])).toThrow(
      'inválido',
    );
    expect(summarizePayments(1000, [{ method: 'pix', receivedCents: 400 }]).remainingCents).toBe(
      600,
    );
  });

  it('suggests common notes for cash', () => {
    expect(cashSuggestions(2350)).toEqual([2350, 2400, 2500, 3000]);
  });
});

describe('cash session', () => {
  it('expected amounts and blind close', () => {
    const expected = expectedBySession({
      openingCents: 10000,
      sales: [
        {
          status: 'completed',
          payments: [
            { method: 'cash', amountCents: 3000, changeCents: 2000 },
            { method: 'pix', amountCents: 1500, changeCents: 0 },
          ],
        },
        { status: 'cancelled', payments: [{ method: 'cash', amountCents: 9999, changeCents: 0 }] },
      ],
      returns: [{ refundCents: 500, refundMethod: 'cash' }],
      movements: [
        { kind: 'withdrawal', amountCents: 5000 },
        { kind: 'supply', amountCents: 1000 },
      ],
    });
    expect(expected.cash).toBe(10000 + 3000 - 500 - 5000 + 1000);
    expect(expected.pix).toBe(1500);
    const close = closeBlind(expected, { cash: 8400, pix: 1500 });
    expect(close.differenceCents).toBe(-100);
    expect(close.differences.cash).toBe(-100);
    expect(() => closeBlind(zeroByMethod(), { cash: -1 })).toThrow();
  });
});

describe('printing', () => {
  it('encodes Portuguese accents in PC860 and falls back for others', () => {
    expect(encodeText('Ação')).toEqual([0x41, 0x87, 0x84, 0x6f]);
    expect(encodeText('ŵ€')).toEqual([0x77, 0x3f]);
  });

  it('builds a non-fiscal receipt with totals and change', () => {
    const sale = {
      terminalSeq: 42,
      createdAt: '2026-10-12T15:30:00.000Z',
      items: totals(addItem(addItem(EMPTY_CART, rice), banana, 1250)).items,
      subtotalCents: 3764,
      discountCents: 0,
      totalCents: 3764,
      payments: [{ method: 'cash' as const, amountCents: 3764, changeCents: 1236 }],
      customerTaxId: '12345678909',
    };
    const blocks = buildReceipt(
      sale,
      {
        businessName: 'Mercadinho',
        taxId: '11222333000181',
        terminalName: 'Caixa 1',
        operatorName: 'Ju',
      },
      48,
    );
    const text = receiptToText(blocks, 48).join('\n');
    expect(text).toContain('NÃO É DOCUMENTO FISCAL');
    expect(text).toContain('1,250 KG x 6,99');
    expect(text).toMatch(/Troco\s+12,36/);
    expect(text).toContain('Consumidor: 123.456.789-09');
    expect(text).toContain('Venda nº 42');
    const bytes = encodeReceipt(blocks);
    expect(Array.from(bytes.slice(0, 5))).toEqual([0x1b, 0x40, 0x1b, 0x74, 3]);
    expect(Array.from(bytes.slice(-3))).toEqual([0x56, 0x42, 0x00]);
    expect(Array.from(DRAWER_PULSE)).toEqual([0x1b, 0x70, 0x00, 0x19, 0xfa]);
    const discounted = buildReceipt(
      { ...sale, discountCents: 100, customerTaxId: null },
      { businessName: 'X', terminalName: 'C', operatorName: 'O' },
      32,
    );
    expect(receiptToText(discounted, 32).join('\n')).toContain('Descontos');
    expect(
      receiptToText(
        [
          { kind: 'text', text: 'oi', align: 'right' },
          { kind: 'feed', lines: 1 },
        ],
        4,
      ),
    ).toEqual(['  oi', '']);
  });
});

describe('scale protocol', () => {
  const frame = (s: string) =>
    Uint8Array.from([0x02, ...Array.from(s, (c) => c.charCodeAt(0)), 0x03]);
  it('parses weight and special states', () => {
    expect(parseScaleResponse(frame('01250'))).toEqual({ status: 'ok', grams: 1250 });
    expect(parseScaleResponse(frame('IIIII'))).toEqual({ status: 'unstable' });
    expect(parseScaleResponse(frame('NNNNN'))).toEqual({ status: 'negative' });
    expect(parseScaleResponse(frame('SSSSS'))).toEqual({ status: 'overload' });
    expect(parseScaleResponse(frame('12a45'))).toEqual({ status: 'invalid' });
    expect(parseScaleResponse(Uint8Array.from([0x30]))).toEqual({ status: 'invalid' });
  });
});

describe('tabelas de preço no carrinho (F1-03)', () => {
  const arroz = { id: 'arroz', name: 'Arroz', unit: 'UN', priceCents: 2890, isWeighable: false };
  const banana = { id: 'banana', name: 'Banana', unit: 'KG', priceCents: 699, isWeighable: true };

  it('recalcula os itens quando o cliente tem outra tabela', () => {
    let cart = addItem(EMPTY_CART, arroz, 2000);
    cart = addItem(cart, banana, 1255);
    const next = repriceLines(cart, new Map([['arroz', 2590]]));
    expect(next.lines.map((l) => l.unitPriceCents)).toEqual([2590, 699]);
    expect(totals(next).totalCents).toBe(2 * 2590 + 877);
  });

  it('o desconto nunca fica maior que o novo valor', () => {
    let cart = addItem(EMPTY_CART, arroz, 1000);
    cart = setLineDiscount(cart, 1, 2000);
    cart = setSaleDiscount(cart, 890);
    const next = repriceLines(cart, new Map([['arroz', 1500]]));
    expect(next.lines[0]!.discountCents).toBe(1500);
    expect(next.saleDiscountCents).toBe(0);
    expect(totals(next).totalCents).toBe(0);
  });
});
