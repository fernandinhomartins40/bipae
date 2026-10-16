import { describe, expect, it } from 'vitest';
import { averageIntervalDays, crmSegment } from './crm';

/** F6-08.a: segmentos do CRM pelas compras. */

const now = new Date('2026-10-16T12:00:00Z');
const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60_000);

describe('segmentos do CRM', () => {
  it('novo, frequente, sumido e ativo', () => {
    expect(
      crmSegment(
        { firstPurchaseAt: daysAgo(10), lastPurchaseAt: daysAgo(1), recentPurchases: 6 },
        now,
      ),
    ).toBe('novo');
    expect(
      crmSegment(
        { firstPurchaseAt: daysAgo(200), lastPurchaseAt: daysAgo(3), recentPurchases: 4 },
        now,
      ),
    ).toBe('frequente');
    expect(
      crmSegment(
        { firstPurchaseAt: daysAgo(200), lastPurchaseAt: daysAgo(61), recentPurchases: 1 },
        now,
      ),
    ).toBe('sumido');
    expect(
      crmSegment(
        { firstPurchaseAt: daysAgo(200), lastPurchaseAt: daysAgo(20), recentPurchases: 2 },
        now,
      ),
    ).toBe('ativo');
    // Os limites: 30 dias ainda é novo; 60 dias ainda não é sumido.
    expect(
      crmSegment(
        { firstPurchaseAt: daysAgo(30), lastPurchaseAt: daysAgo(30), recentPurchases: 1 },
        now,
      ),
    ).toBe('novo');
    expect(
      crmSegment(
        { firstPurchaseAt: daysAgo(90), lastPurchaseAt: daysAgo(60), recentPurchases: 1 },
        now,
      ),
    ).toBe('ativo');
  });

  it('intervalo médio entre compras', () => {
    expect(averageIntervalDays(daysAgo(30), daysAgo(0), 4)).toBe(10);
    expect(averageIntervalDays(daysAgo(30), daysAgo(30), 1)).toBeNull();
  });
});
