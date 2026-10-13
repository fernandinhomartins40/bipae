import { describe, expect, it } from 'vitest';
import { parseVariantValues, sameVariant, variantCombinations, variantName } from './variants';

describe('grade de variações (F1-04)', () => {
  it('lê os valores separados por vírgula, sem vazios nem repetidos', () => {
    expect(parseVariantValues('P, M ,G,, m')).toEqual(['P', 'M', 'G']);
    expect(parseVariantValues('  ')).toEqual([]);
  });

  it('gera todas as combinações dos atributos', () => {
    const combos = variantCombinations([
      { name: 'Tamanho', values: ['P', 'M'] },
      { name: 'Cor', values: ['Azul', 'Preto'] },
    ]);
    expect(combos).toEqual([
      { Tamanho: 'P', Cor: 'Azul' },
      { Tamanho: 'P', Cor: 'Preto' },
      { Tamanho: 'M', Cor: 'Azul' },
      { Tamanho: 'M', Cor: 'Preto' },
    ]);
    expect(
      variantCombinations([
        { name: 'Cor', values: ['Azul'] },
        { name: '', values: ['x'] },
      ]),
    ).toEqual([{ Cor: 'Azul' }]);
    expect(variantCombinations([])).toEqual([]);
  });

  it('dá nome à variação e reconhece a mesma combinação', () => {
    expect(variantName('Camiseta Básica', { Tamanho: 'P', Cor: 'Azul' })).toBe(
      'Camiseta Básica — P / Azul',
    );
    expect(sameVariant({ cor: 'azul', Tamanho: 'P' }, { Tamanho: 'p', Cor: 'Azul' })).toBe(true);
    expect(sameVariant({ Cor: 'Azul' }, { Cor: 'Preto' })).toBe(false);
    expect(sameVariant(null, { Cor: 'Azul' })).toBe(false);
  });
});
