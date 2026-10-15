import { describe, expect, it } from 'vitest';
import { inventoryCountInput } from './contracts';

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
