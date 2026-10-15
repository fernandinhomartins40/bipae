import { describe, expect, it } from 'vitest';
import {
  buildScaleLabelCode,
  EAN13_PARITY,
  EAN_G,
  EAN_L,
  EAN_R,
  eanModules,
  weighedTotalCents,
} from './labels';
import { parseScan, type ScaleLabelLayout } from './scan';

const ones = (s: string) => [...s].filter((c) => c === '1').length;

/** Lê as barras de volta para os dígitos, como um leitor faria (só para o teste). */
function decode(modules: string): string {
  if (modules.length === 95) {
    const left = Array.from({ length: 6 }, (_, i) => modules.slice(3 + i * 7, 10 + i * 7));
    const right = Array.from({ length: 6 }, (_, i) => modules.slice(50 + i * 7, 57 + i * 7));
    let parity = '';
    const leftDigits = left.map((m) => {
      const l = EAN_L.indexOf(m);
      parity += l >= 0 ? 'L' : 'G';
      return l >= 0 ? l : EAN_G.indexOf(m);
    });
    return [
      EAN13_PARITY.indexOf(parity),
      ...leftDigits,
      ...right.map((m) => EAN_R.indexOf(m)),
    ].join('');
  }
  const left = Array.from({ length: 4 }, (_, i) =>
    EAN_L.indexOf(modules.slice(3 + i * 7, 10 + i * 7)),
  );
  const right = Array.from({ length: 4 }, (_, i) =>
    EAN_R.indexOf(modules.slice(36 + i * 7, 43 + i * 7)),
  );
  return [...left, ...right].join('');
}

describe('barras EAN (F5-01)', () => {
  it('as tabelas seguem a regra da GS1: L ímpar, G e R pares, R é o complemento de L e G é R ao contrário', () => {
    for (let n = 0; n < 10; n++) {
      expect(ones(EAN_L[n]!) % 2).toBe(1);
      expect(ones(EAN_G[n]!) % 2).toBe(0);
      expect(EAN_R[n]).toBe([...EAN_L[n]!].map((c) => (c === '1' ? '0' : '1')).join(''));
      expect(EAN_G[n]).toBe([...EAN_R[n]!].reverse().join(''));
      expect(EAN_L[n]!.startsWith('0') && EAN_L[n]!.endsWith('1')).toBe(true);
    }
    expect(new Set(EAN13_PARITY).size).toBe(10);
  });

  it('EAN-13, UPC-A e EAN-8 saem com as guardas e voltam aos mesmos dígitos', () => {
    const ean13 = eanModules('7891000315507')!;
    expect(ean13).toHaveLength(95);
    expect(
      ean13.startsWith('101') && ean13.endsWith('101') && ean13.slice(45, 50) === '01010',
    ).toBe(true);
    expect(decode(ean13)).toBe('7891000315507');
    expect(decode(eanModules('036000291452')!)).toBe('0036000291452');
    const ean8 = eanModules('96385074')!;
    expect(ean8).toHaveLength(67);
    expect(decode(ean8)).toBe('96385074');
  });

  it('código inválido ou GTIN-14 fica sem barras', () => {
    expect(eanModules('7891000315508')).toBeNull();
    expect(eanModules('17891000315504')).toBeNull();
    expect(eanModules('ABC')).toBeNull();
  });
});

describe('etiqueta de balança (F5-01)', () => {
  it('o caixa lê de volta o que a etiqueta imprime (preço)', () => {
    const code = buildScaleLabelCode({ plu: '00042', totalCents: 1599 });
    expect(code.slice(0, 12)).toBe('200042001599');
    expect(parseScan(code)).toEqual({ kind: 'scale-label', plu: '42', totalCents: 1599 });
  });

  it('layout por peso também faz o caminho de volta', () => {
    const layout: ScaleLabelLayout = {
      prefix: '2',
      pluStart: 1,
      pluLength: 6,
      valueStart: 7,
      valueLength: 5,
      valueKind: 'weight',
    };
    const code = buildScaleLabelCode({ plu: '123', grams: 1250 }, layout);
    expect(parseScan(code, layout)).toEqual({
      kind: 'scale-label',
      plu: '123',
      quantityMilli: 1250,
    });
  });

  it('recusa código interno com letra ou longo demais e valor que não cabe', () => {
    expect(() => buildScaleLabelCode({ plu: 'BAN', totalCents: 100 })).toThrow(
      'O código interno precisa ter só números, até 5 dígitos, para ir na etiqueta da balança.',
    );
    expect(() => buildScaleLabelCode({ plu: '123456', totalCents: 100 })).toThrow();
    expect(() => buildScaleLabelCode({ plu: '1', totalCents: 1_000_000 })).toThrow(
      'O total passa do que cabe na etiqueta da balança.',
    );
    expect(() => buildScaleLabelCode({ plu: '1' })).toThrow('Valor da etiqueta inválido.');
    expect(() =>
      buildScaleLabelCode(
        { plu: '1', grams: 1_000_000 },
        {
          ...{ prefix: '2', pluStart: 1, pluLength: 5, valueStart: 6, valueLength: 6 },
          valueKind: 'weight',
        },
      ),
    ).toThrow('O peso passa do que cabe na etiqueta da balança.');
  });

  it('total do pesado arredonda meio para cima', () => {
    expect(weighedTotalCents(1250, 1279)).toBe(1599); // 1,25 kg × R$ 12,79 = 15,9875
    expect(weighedTotalCents(500, 999)).toBe(500); // 4,995 → 5,00
  });
});
