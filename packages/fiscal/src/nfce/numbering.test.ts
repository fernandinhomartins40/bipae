import { describe, expect, it } from 'vitest';
import { nfceNumbering } from './numbering';

describe('numeração da NFC-e', () => {
  it('a série é a do caixa e o número é o da venda no caixa', () => {
    expect(nfceNumbering({ series: 3, terminalSeq: 1542 })).toEqual({ series: 3, number: 1542 });
  });

  it('recusa série ou número fora do que a NFC-e aceita', () => {
    expect(() => nfceNumbering({ series: 0, terminalSeq: 1 })).toThrow('Série');
    expect(() => nfceNumbering({ series: 1000, terminalSeq: 1 })).toThrow('Série');
    expect(() => nfceNumbering({ series: 1, terminalSeq: 0 })).toThrow('intervalo');
    expect(() => nfceNumbering({ series: 1, terminalSeq: 1_000_000_000 })).toThrow('intervalo');
  });
});
