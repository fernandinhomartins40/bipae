import { describe, expect, it } from 'vitest';
import { revenueAlerts, simplesLimit, SIMPLES_LIMITS } from './simples-limits';

/** F3-29: limites do MEI e do Simples e o sublimite do ICMS e do ISS, com a fonte de cada um. */

describe('limites do Simples Nacional', () => {
  it('cada limite tem fonte e o sublimite de 2026 é R$ 3,6 milhões em todas as UFs', () => {
    for (const limit of SIMPLES_LIMITS) {
      expect(limit.source).not.toBe('');
      expect(limit.url).toMatch(/^https:\/\//);
    }
    expect(simplesLimit('sublimite', '2026-10-14')?.cents).toBe(360_000_000);
    expect(simplesLimit('mei', '2026-10-14')?.cents).toBe(8_100_000);
    expect(simplesLimit('simples', '2026-10-14')?.cents).toBe(480_000_000);
    // 2027 ainda sem portaria conferida: não há número suposto.
    expect(simplesLimit('sublimite', '2027-01-01')).toBeNull();
  });

  it('Simples acima do sublimite: avisa para mudar para o CRT 2', () => {
    const [alerta] = revenueAlerts({
      regime: 'simples',
      yearRevenueCents: 361_000_000,
      date: '2026-10-14',
    });
    expect(alerta).toMatchObject({ level: 'critical' });
    expect(alerta!.message).toContain('CRT 2');
    expect(alerta!.message).toContain('R$ 3.610.000,00 no ano');
  });

  it('chegando a 90% do limite vira atenção; abaixo disso, nada', () => {
    expect(
      revenueAlerts({ regime: 'simples', yearRevenueCents: 324_000_000, date: '2026-10-14' })[0]
        ?.level,
    ).toBe('warning');
    expect(
      revenueAlerts({ regime: 'simples', yearRevenueCents: 100_000_000, date: '2026-10-14' }),
    ).toEqual([]);
  });

  it('MEI, teto do Simples e regimes normais', () => {
    expect(
      revenueAlerts({ regime: 'mei', yearRevenueCents: 8_200_000, date: '2026-05-01' })[0]?.message,
    ).toContain('limite do MEI');
    const teto = revenueAlerts({
      regime: 'simples-excesso',
      yearRevenueCents: 500_000_000,
      date: '2026-05-01',
    });
    expect(teto).toHaveLength(1);
    expect(teto[0]!.message).toContain('teto do Simples');
    expect(
      revenueAlerts({ regime: 'real', yearRevenueCents: 900_000_000, date: '2026-05-01' }),
    ).toEqual([]);
  });

  it('ano sem sublimite conferido avisa que falta a fonte', () => {
    const [alerta] = revenueAlerts({
      regime: 'simples',
      yearRevenueCents: 10_000,
      date: '2027-02-01',
    });
    expect(alerta).toMatchObject({ level: 'info', limit: null });
    expect(alerta!.message).toContain('sublimite do ICMS e do ISS de 2027');
  });
});
