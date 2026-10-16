import { describe, expect, it } from 'vitest';
import { openFor, splitBill } from './tabs';

describe('comandas no caixa (F5-07)', () => {
  it('divide a conta sem perder centavo', () => {
    expect(splitBill(10_000, 4)).toEqual([2500, 2500, 2500, 2500]);
    expect(splitBill(10_001, 3)).toEqual([3334, 3334, 3333]);
    expect(splitBill(10_001, 3).reduce((a, b) => a + b, 0)).toBe(10_001);
    expect(splitBill(500, 0)).toEqual([500]);
  });

  it('mostra há quanto tempo a comanda está aberta', () => {
    const agora = new Date('2026-10-16T21:00:00-03:00');
    expect(openFor('2026-10-16T20:59:40-03:00', agora)).toBe('agora');
    expect(openFor('2026-10-16T20:35:00-03:00', agora)).toBe('há 25 min');
    expect(openFor('2026-10-16T19:40:00-03:00', agora)).toBe('há 1 h 20 min');
    expect(openFor('2026-10-16T19:00:00-03:00', agora)).toBe('há 2 h');
  });
});
