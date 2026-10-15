import { describe, expect, it } from 'vitest';
import {
  companyInput,
  inventoryCountInput,
  labelsInput,
  promotionInput,
  stockTransferInput,
} from './contracts';

describe('contagem de inventário (F4-11)', () => {
  it('aceita o código bipado ou o produto escolhido', () => {
    expect(
      inventoryCountInput.safeParse({ code: '789', mode: 'add', quantityMilli: 1000 }).success,
    ).toBe(true);
    expect(
      inventoryCountInput.safeParse({
        productId: '0190a0e4-0000-7000-8000-000000000001',
        mode: 'set',
        quantityMilli: 0,
      }).success,
    ).toBe(true);
  });

  it('recusa sem produto nem código, e quantidade negativa', () => {
    const vazio = inventoryCountInput.safeParse({ mode: 'add', quantityMilli: 1000 });
    expect(vazio.success).toBe(false);
    expect(vazio.error?.issues[0]?.message).toBe('Bipe ou escolha o produto');
    expect(
      inventoryCountInput.safeParse({ code: '789', mode: 'add', quantityMilli: -1 }).success,
    ).toBe(false);
  });
});

describe('transferência entre lojas (F4-12)', () => {
  const a = '0190a0e4-0000-7000-8000-000000000001';
  const b = '0190a0e4-0000-7000-8000-000000000002';
  const p = '0190a0e4-0000-7000-8000-000000000003';

  it('aceita lojas diferentes com produtos sem repetição', () => {
    expect(
      stockTransferInput.safeParse({
        fromStoreId: a,
        toStoreId: b,
        items: [{ productId: p, quantityMilli: 1000 }],
      }).success,
    ).toBe(true);
  });

  it('recusa a mesma loja nos dois lados e produto repetido', () => {
    const mesma = stockTransferInput.safeParse({
      fromStoreId: a,
      toStoreId: a,
      items: [{ productId: p, quantityMilli: 1000 }],
    });
    expect(mesma.error?.issues[0]?.message).toBe(
      'A origem e o destino precisam ser lojas diferentes',
    );
    const repetido = stockTransferInput.safeParse({
      fromStoreId: a,
      toStoreId: b,
      items: [
        { productId: p, quantityMilli: 1000 },
        { productId: p, quantityMilli: 2000 },
      ],
    });
    expect(repetido.error?.issues[0]?.message).toBe('O mesmo produto aparece duas vezes');
  });
});

describe('etiquetas (F5-01)', () => {
  const p = '0190a0e4-0000-7000-8000-000000000003';

  it('gôndola não pede peso; balança exige o peso de cada etiqueta', () => {
    expect(labelsInput.safeParse({ kind: 'shelf', items: [{ productId: p }] }).data?.items).toEqual(
      [{ productId: p, copies: 1 }],
    );
    const semPeso = labelsInput.safeParse({ kind: 'scale', items: [{ productId: p }] });
    expect(semPeso.error?.issues[0]?.message).toBe('Informe o peso de cada etiqueta de balança');
    expect(
      labelsInput.safeParse({ kind: 'scale', items: [{ productId: p, grams: 350 }] }).success,
    ).toBe(true);
  });
});

describe('promoções (F5-02)', () => {
  const a = '0190a0e4-0000-7000-8000-000000000001';
  const b = '0190a0e4-0000-7000-8000-000000000002';
  const base = { name: 'Promo', startsOn: '2026-10-01' };
  const msg = (v: unknown) => promotionInput.safeParse(v).error?.issues[0]?.message;

  it('aceita as três regras e completa os padrões', () => {
    const ok = promotionInput.parse({
      ...base,
      rule: { kind: 'buy_x_pay_y', productIds: [a], buy: 3, pay: 2 },
    });
    expect(ok).toMatchObject({ endsOn: null, active: true });
    expect(
      promotionInput.safeParse({
        ...base,
        rule: {
          kind: 'quantity_tier',
          productIds: [a, b],
          tiers: [{ minQuantityMilli: 6000, unitPriceCents: 799 }],
        },
      }).success,
    ).toBe(true);
    expect(
      promotionInput.safeParse({
        ...base,
        endsOn: '2026-10-31',
        rule: {
          kind: 'combo',
          items: [
            { productId: a, quantityMilli: 1000 },
            { productId: b, quantityMilli: 2000 },
          ],
          priceCents: 2500,
        },
      }).success,
    ).toBe(true);
  });

  it('recusa regras sem sentido com mensagem clara', () => {
    expect(
      msg({ ...base, rule: { kind: 'buy_x_pay_y', productIds: [a, a], buy: 3, pay: 2 } }),
    ).toBe('O mesmo produto aparece duas vezes');
    expect(
      msg({
        ...base,
        rule: {
          kind: 'quantity_tier',
          productIds: [a],
          tiers: [
            { minQuantityMilli: 6000, unitPriceCents: 799 },
            { minQuantityMilli: 6000, unitPriceCents: 700 },
          ],
        },
      }),
    ).toBe('Duas faixas com a mesma quantidade');
    expect(
      msg({
        ...base,
        rule: {
          kind: 'combo',
          items: [
            { productId: a, quantityMilli: 500 },
            { productId: b, quantityMilli: 1000 },
          ],
          priceCents: 100,
        },
      }),
    ).toBe('O combo usa unidades inteiras');
    expect(
      msg({
        ...base,
        rule: {
          kind: 'combo',
          items: [
            { productId: a, quantityMilli: 1000 },
            { productId: a, quantityMilli: 1000 },
          ],
          priceCents: 100,
        },
      }),
    ).toBe('O mesmo produto aparece duas vezes');
  });
});

describe('dados do emitente da empresa (F3-14.b)', () => {
  it('limpa a máscara da IE e do CEP e recusa o que não tem tamanho certo', () => {
    expect(
      companyInput.parse({
        legalName: 'Mercadinho',
        ie: '111.222.333.444',
        cep: '01001-000',
        cityCode: '3550308',
      }),
    ).toMatchObject({ ie: '111222333444', cep: '01001000', cityCode: '3550308' });
    expect(companyInput.parse({ legalName: 'Mercadinho', ie: '', cep: '' })).toMatchObject({
      ie: null,
      cep: null,
    });
    const curto = companyInput.safeParse({ legalName: 'Mercadinho', cep: '123' });
    expect(curto.error?.issues[0]?.message).toBe('CEP deve ter 8 dígitos');
    const ie = companyInput.safeParse({ legalName: 'Mercadinho', ie: '1' });
    expect(ie.error?.issues[0]?.message).toBe('Inscrição estadual inválida');
  });
});
