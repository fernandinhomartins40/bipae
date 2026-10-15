import { describe, expect, it } from 'vitest';
import { applyPromotions, gross, isActiveOn, type Promotion, type PromotionLine } from './engine';

const hoje = '2026-10-15';
const linha = (
  line: number,
  productId: string,
  unitPriceCents: number,
  quantityMilli: number,
  extra: Partial<PromotionLine> = {},
): PromotionLine => ({
  line,
  productId,
  unitPriceCents,
  quantityMilli,
  isWeighable: false,
  eligible: true,
  ...extra,
});
const promo = (id: string, rule: Promotion['rule'], extra: Partial<Promotion> = {}): Promotion => ({
  id,
  name: `Promoção ${id}`,
  startsOn: '2026-10-01',
  endsOn: null,
  rule,
  ...extra,
});

describe('leve X pague Y', () => {
  it('leve 3 pague 2: a unidade mais barata do grupo sai de graça, misturando sabores', () => {
    const r = applyPromotions(
      [linha(1, 'uva', 899, 2000), linha(2, 'laranja', 799, 2000)],
      [promo('p1', { kind: 'buy_x_pay_y', productIds: ['uva', 'laranja'], buy: 3, pay: 2 })],
      hoje,
    );
    // 4 unidades: 899, 899, 799 | 799 → um grupo completo; a laranja de 7,99 sai de graça.
    expect(r.byLine).toEqual(new Map([[2, 799]]));
    expect(r.applied).toEqual([{ promotionId: 'p1', name: 'Promoção p1', discountCents: 799 }]);
  });

  it('dois grupos completos dão dois descontos; regra sem sentido é ignorada', () => {
    const r = applyPromotions(
      [linha(1, 'suco', 500, 6000)],
      [
        promo('p1', { kind: 'buy_x_pay_y', productIds: ['suco'], buy: 3, pay: 2 }),
        promo('p2', { kind: 'buy_x_pay_y', productIds: ['suco'], buy: 2, pay: 2 }),
      ],
      hoje,
    );
    expect(r.byLine.get(1)).toBe(1000);
  });

  it('produto pesado e item com desconto manual ficam de fora', () => {
    const r = applyPromotions(
      [
        linha(1, 'queijo', 4990, 3000, { isWeighable: true }),
        linha(2, 'suco', 500, 3000, { eligible: false }),
      ],
      [promo('p1', { kind: 'buy_x_pay_y', productIds: ['queijo', 'suco'], buy: 3, pay: 2 })],
      hoje,
    );
    expect(r.byLine.size).toBe(0);
    expect(r.applied).toEqual([]);
  });
});

describe('faixa de quantidade', () => {
  const faixa = promo('t1', {
    kind: 'quantity_tier',
    productIds: ['refri-cola', 'refri-guarana'],
    tiers: [
      { minQuantityMilli: 6000, unitPriceCents: 799 },
      { minQuantityMilli: 12_000, unitPriceCents: 749 },
    ],
  });

  it('a partir de 6 do grupo, cada um sai por R$ 7,99; com 12, pela faixa maior', () => {
    const seis = applyPromotions(
      [linha(1, 'refri-cola', 899, 4000), linha(2, 'refri-guarana', 899, 2000)],
      [faixa],
      hoje,
    );
    expect(seis.byLine).toEqual(
      new Map([
        [1, 400],
        [2, 200],
      ]),
    );
    const doze = applyPromotions([linha(1, 'refri-cola', 899, 12_000)], [faixa], hoje);
    expect(doze.byLine.get(1)).toBe(1800);
    expect(applyPromotions([linha(1, 'refri-cola', 899, 5000)], [faixa], hoje).byLine.size).toBe(0);
  });

  it('vale para produto pesado, com arredondamento meio para cima', () => {
    const r = applyPromotions(
      [linha(1, 'carne', 4999, 2345, { isWeighable: true })],
      [
        promo('t2', {
          kind: 'quantity_tier',
          productIds: ['carne'],
          tiers: [{ minQuantityMilli: 2000, unitPriceCents: 4499 }],
        }),
      ],
      hoje,
    );
    expect(r.byLine.get(1)).toBe(gross(4999, 2345) - gross(4499, 2345));
  });

  it('faixa que não baixa o preço não muda nada', () => {
    const r = applyPromotions([linha(1, 'refri-cola', 699, 6000)], [faixa], hoje);
    expect(r.applied).toEqual([]);
  });
});

describe('combo', () => {
  const combo = promo('c1', {
    kind: 'combo',
    items: [
      { productId: 'lanche', quantityMilli: 1000 },
      { productId: 'refri', quantityMilli: 1000 },
    ],
    priceCents: 2500,
  });

  it('lanche + refri por R$ 25,00: o desconto é repartido entre os itens e soma certo', () => {
    const r = applyPromotions(
      [linha(1, 'lanche', 2290, 2000), linha(2, 'refri', 690, 1000)],
      [combo],
      hoje,
    );
    // Um combo só (um refri): 22,90 + 6,90 = 29,80 → 25,00; desconto de 4,80.
    const total = [...r.byLine.values()].reduce((a, b) => a + b, 0);
    expect(total).toBe(480);
    expect(r.byLine.get(1)! + r.byLine.get(2)!).toBe(480);
    expect(r.byLine.get(1)).toBe(Math.round((480 * 2290) / 2980));
  });

  it('combo que sairia mais caro não é aplicado e não prende os itens', () => {
    const caro = promo('c2', {
      kind: 'combo',
      items: [
        { productId: 'lanche', quantityMilli: 1000 },
        { productId: 'refri', quantityMilli: 1000 },
      ],
      priceCents: 9999,
    });
    const r = applyPromotions(
      [linha(1, 'lanche', 2290, 1000), linha(2, 'refri', 690, 3000)],
      [caro, promo('p9', { kind: 'buy_x_pay_y', productIds: ['refri'], buy: 3, pay: 2 })],
      hoje,
    );
    expect(r.applied.map((a) => a.promotionId)).toEqual(['p9']);
  });

  it('faltando um item do combo, nada acontece', () => {
    expect(applyPromotions([linha(1, 'lanche', 2290, 1000)], [combo], hoje).byLine.size).toBe(0);
    const quebrado = promo('c3', {
      kind: 'combo',
      items: [{ productId: 'lanche', quantityMilli: 500 }],
      priceCents: 100,
    });
    expect(applyPromotions([linha(1, 'lanche', 2290, 1000)], [quebrado], hoje).applied).toEqual([]);
  });
});

describe('ordem, acúmulo e vigência', () => {
  it('não acumula: a unidade usada no combo não entra no leve-pague', () => {
    const r = applyPromotions(
      [linha(1, 'lanche', 2000, 1000), linha(2, 'refri', 600, 3000)],
      [
        promo('z-leve', { kind: 'buy_x_pay_y', productIds: ['refri'], buy: 3, pay: 2 }),
        promo('a-combo', {
          kind: 'combo',
          items: [
            { productId: 'lanche', quantityMilli: 1000 },
            { productId: 'refri', quantityMilli: 1000 },
          ],
          priceCents: 2200,
        }),
      ],
      hoje,
    );
    // O combo vem primeiro e usa 1 refri; sobram 2, que não fecham o "leve 3".
    expect(r.applied.map((a) => a.promotionId)).toEqual(['a-combo']);
  });

  it('só vale dentro da vigência (último dia incluído)', () => {
    const p = promo(
      'v',
      { kind: 'buy_x_pay_y', productIds: ['suco'], buy: 2, pay: 1 },
      { startsOn: '2026-10-10', endsOn: '2026-10-15' },
    );
    expect(isActiveOn(p, '2026-10-09')).toBe(false);
    expect(isActiveOn(p, '2026-10-15')).toBe(true);
    expect(isActiveOn(p, '2026-10-16')).toBe(false);
    expect(applyPromotions([linha(1, 'suco', 500, 2000)], [p], '2026-10-16').byLine.size).toBe(0);
  });
});
