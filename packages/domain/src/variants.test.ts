import { describe, expect, it } from 'vitest';
import {
  parseVariantValues,
  sameVariant,
  variantCombinations,
  variantGrid,
  variantName,
} from './variants';

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

describe('grade em matriz (F5-12.a)', () => {
  // IDs em ordem crescente, como os UUIDv7 criados um depois do outro.
  let seq = 0;
  const v = (name: string, attributes: Record<string, string> | null) => ({
    id: `${String(++seq).padStart(3, '0')}-${name}`,
    attributes,
  });
  const nome = (x: { id: string } | null) => x?.id.slice(4);

  it('tamanho nas linhas e cor nas colunas, na ordem do cadastro', () => {
    const grade = variantGrid([
      v('pa', { Tamanho: 'P', Cor: 'Azul' }),
      v('pp', { Tamanho: 'P', Cor: 'Preto' }),
      v('ma', { Tamanho: 'M', Cor: 'Azul' }),
      v('ga', { Tamanho: 'G', Cor: 'azul ' }),
    ])!;
    expect(grade).toMatchObject({
      rowName: 'Tamanho',
      colName: 'Cor',
      rows: ['P', 'M', 'G'],
      cols: ['Azul', 'Preto'],
    });
    expect(nome(grade.cell('P', 'Preto'))).toBe('pp');
    expect(nome(grade.cell('g', 'AZUL'))).toBe('ga');
    // Combinação que não foi criada fica vazia.
    expect(grade.cell('M', 'Preto')).toBeNull();
    // Trocar linhas e colunas.
    const trocada = variantGrid(
      [v('pa', { Tamanho: 'P', Cor: 'Azul' }), v('pp', { Tamanho: 'P', Cor: 'Preto' })],
      true,
    )!;
    expect(trocada).toMatchObject({ rowName: 'Tamanho', colName: 'Cor' });
  });

  it('o banco não guarda a ordem dos atributos: o que tem mais valores vai nas linhas', () => {
    // O jsonb do PostgreSQL devolve "Cor" antes de "Tamanho".
    const grade = variantGrid([
      v('pa', { Cor: 'Azul', Tamanho: 'P' }),
      v('ma', { Cor: 'Azul', Tamanho: 'M' }),
      v('ga', { Cor: 'Azul', Tamanho: 'G' }),
      v('pp', { Cor: 'Preto', Tamanho: 'P' }),
    ])!;
    expect(grade).toMatchObject({
      rowName: 'Tamanho',
      rows: ['P', 'M', 'G'],
      cols: ['Azul', 'Preto'],
    });
    expect(variantGrid([v('pa', { Cor: 'Azul', Tamanho: 'P' })])).toMatchObject({ rowName: 'Cor' });
  });

  it('a API devolve por nome (G, M, P), mas a grade segue a ordem de criação', () => {
    const p = v('p', { Tamanho: 'P' });
    const m = v('m', { Tamanho: 'M' });
    const g = v('g', { Tamanho: 'G' });
    expect(variantGrid([g, m, p])!.rows).toEqual(['P', 'M', 'G']);
  });

  it('um atributo vira uma coluna só', () => {
    const grade = variantGrid([v('p', { Tamanho: 'P' }), v('m', { Tamanho: 'M' })])!;
    expect(grade).toMatchObject({ rowName: 'Tamanho', colName: '', rows: ['P', 'M'], cols: [''] });
    expect(nome(grade.cell('M', ''))).toBe('m');
  });

  it('sem atributos, com três ou misturado, a tela usa a lista', () => {
    expect(variantGrid([])).toBeNull();
    expect(variantGrid([v('x', null)])).toBeNull();
    expect(variantGrid([v('x', { Tamanho: 'P', Cor: 'Azul', Tecido: 'Algodão' })])).toBeNull();
    expect(
      variantGrid([v('a', { Tamanho: 'P', Cor: 'Azul' }), v('b', { Tamanho: 'M' })]),
    ).toBeNull();
  });
});
