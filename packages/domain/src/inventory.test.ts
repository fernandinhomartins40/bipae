import { describe, expect, it } from 'vitest';
import { inventoryCountInput, labelsInput, stockTransferInput } from './contracts';

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
