import { describe, expect, it } from 'vitest';
import {
  loyaltyBalance,
  loyaltyExpiry,
  maxRedeem,
  pointsEarned,
  type LoyaltyEntry,
  type LoyaltyProgram,
} from './loyalty';

/** F6-08.b: programa de pontos. */

const program: LoyaltyProgram = {
  active: true,
  centsPerPoint: 100,
  pointValueCents: 5,
  expiryMonths: 6,
  minRedeemPoints: 100,
};
const d = (iso: string) => new Date(`${iso}T12:00:00Z`);
const earn = (points: number, at: string): LoyaltyEntry => ({
  kind: 'earn',
  points,
  at: d(at),
  expiresAt: loyaltyExpiry(d(at), 6),
});

describe('fidelidade (F6-08.b)', () => {
  it('ganha 1 ponto a cada R$ 1,00, só pontos inteiros', () => {
    expect(pointsEarned(3780, program)).toBe(37);
    expect(pointsEarned(99, program)).toBe(0);
    expect(pointsEarned(3780, { ...program, active: false })).toBe(0);
    expect(pointsEarned(-500, program)).toBe(0);
  });

  it('os pontos vencem 6 meses depois, e o resgate usa os que vencem primeiro', () => {
    expect(loyaltyExpiry(d('2026-01-31'), 1).toISOString().slice(0, 10)).toBe('2026-03-03');
    const entries: LoyaltyEntry[] = [
      earn(100, '2026-01-10'),
      earn(50, '2026-05-10'),
      { kind: 'redeem', points: -120, at: d('2026-06-01') },
    ];
    // Em junho: 150 − 120 = 30 (o lote de janeiro acabou; sobram 30 do de maio).
    expect(loyaltyBalance(entries, d('2026-06-02'))).toBe(30);
    // Em agosto, o lote de janeiro já teria vencido, mas foi usado antes: continua 30.
    expect(loyaltyBalance(entries, d('2026-08-01'))).toBe(30);
    // Em dezembro, o de maio venceu.
    expect(loyaltyBalance(entries, d('2026-12-01'))).toBe(0);
  });

  it('ponto vencido não paga resgate, e o saldo nunca fica negativo', () => {
    const entries: LoyaltyEntry[] = [
      earn(100, '2026-01-10'),
      // Resgate depois do vencimento do lote (a venda saiu de um caixa sem internet).
      { kind: 'redeem', points: -100, at: d('2026-08-01') },
      earn(40, '2026-08-02'),
    ];
    expect(loyaltyBalance(entries, d('2026-08-03'))).toBe(40);
  });

  it('venda cancelada estorna o ganho; resgate devolvido volta com nova validade', () => {
    const entries: LoyaltyEntry[] = [
      earn(200, '2026-03-01'),
      { kind: 'redeem', points: -150, at: d('2026-03-10') },
      {
        kind: 'reverse_redeem',
        points: 150,
        at: d('2026-03-11'),
        expiresAt: loyaltyExpiry(d('2026-03-11'), 6),
      },
    ];
    // Só a venda do resgate foi cancelada: os 200 pontos voltam inteiros.
    expect(loyaltyBalance(entries, d('2026-03-13'))).toBe(200);
    // Cancelada também a venda que gerou os pontos: nada sobra.
    const ambas = [
      ...entries,
      { kind: 'reverse_earn' as const, points: -200, at: d('2026-03-12') },
    ];
    expect(loyaltyBalance(ambas, d('2026-03-13'))).toBe(0);
  });

  it('o resgate não passa do valor da venda nem fica abaixo do mínimo', () => {
    expect(maxRedeem(500, 10_000, program)).toEqual({ points: 500, discountCents: 2500 });
    // Venda de R$ 10,00: no máximo 200 pontos (R$ 10,00).
    expect(maxRedeem(500, 1000, program)).toEqual({ points: 200, discountCents: 1000 });
    expect(maxRedeem(99, 10_000, program)).toEqual({ points: 0, discountCents: 0 });
    expect(maxRedeem(500, 10_000, { ...program, active: false })).toEqual({
      points: 0,
      discountCents: 0,
    });
  });
});
