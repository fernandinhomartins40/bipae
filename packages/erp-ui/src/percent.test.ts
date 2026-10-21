import { describe, expect, it } from 'vitest';
import { formatBp, parsePercentBp } from './percent';

describe('porcentagem da comissão (F8-02)', () => {
  it('aceita vírgula, ponto e o sinal de %', () => {
    expect(parsePercentBp('2,5')).toBe(250);
    expect(parsePercentBp('2.5')).toBe(250);
    expect(parsePercentBp(' 10% ')).toBe(1000);
    expect(parsePercentBp('0')).toBe(0);
    expect(parsePercentBp('1,25')).toBe(125);
  });

  it('recusa o que não é porcentagem ou passa de 100%', () => {
    for (const bad of ['', 'abc', '-1', '100,5', '2,555', '1.000']) {
      expect(parsePercentBp(bad), bad).toBeNull();
    }
    expect(parsePercentBp('100')).toBe(10_000);
  });

  it('mostra no jeito brasileiro', () => {
    expect(formatBp(250)).toBe('2,5%');
    expect(formatBp(1000)).toBe('10%');
    expect(formatBp(125)).toBe('1,25%');
  });
});
