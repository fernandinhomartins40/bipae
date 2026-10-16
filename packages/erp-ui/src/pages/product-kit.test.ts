import { describe, expect, it } from 'vitest';
import { recipeCostCents } from './product-kit';

describe('custo da ficha técnica (F5-11)', () => {
  it('soma cada insumo vezes o custo, em centavos inteiros', () => {
    // 250 g de queijo a R$ 39,90/kg + 300 g de farinha a R$ 4,50/kg = 9,98 + 1,35.
    expect(
      recipeCostCents([
        { productId: 'q', quantity: 0.25, name: 'Queijo', costCents: 3990 },
        { productId: 'f', quantity: 0.3, name: 'Farinha', costCents: 450 },
      ]),
    ).toBe(1133);
    expect(recipeCostCents([{ productId: 'x', quantity: 2, name: 'Caixa', costCents: 100 }])).toBe(
      200,
    );
  });

  it('sem o custo de algum insumo, não inventa', () => {
    expect(
      recipeCostCents([
        { productId: 'q', quantity: 0.25, name: 'Queijo', costCents: 3990 },
        { productId: 'm', quantity: 0.1, name: 'Molho', costCents: null },
      ]),
    ).toBeNull();
  });
});
