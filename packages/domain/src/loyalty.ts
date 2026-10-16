/**
 * Programa de fidelidade (F6-08.b). Regras simples e explícitas: o cliente ganha pontos pelo
 * valor das compras com CPF/CNPJ, cada ponto vale um tanto de desconto, e os pontos vencem
 * alguns meses depois da compra que os gerou. O saldo é calculado em ordem (primeiro a vencer,
 * primeiro a ser usado), sempre em inteiros.
 */
export interface LoyaltyProgram {
  active: boolean;
  /** Quantos centavos de compra valem 1 ponto (100 = 1 ponto a cada R$ 1,00). */
  centsPerPoint: number;
  /** Quanto vale 1 ponto no resgate, em centavos. */
  pointValueCents: number;
  /** Os pontos vencem estes meses depois da compra. */
  expiryMonths: number;
  /** Mínimo de pontos para usar no caixa. */
  minRedeemPoints: number;
}

export type LoyaltyEntryKind = 'earn' | 'redeem' | 'reverse_earn' | 'reverse_redeem';

export interface LoyaltyEntry {
  kind: LoyaltyEntryKind;
  /** Positivo para ganho e devolução de resgate; negativo para resgate e estorno de ganho. */
  points: number;
  at: Date;
  /** Só nos ganhos (e nos resgates devolvidos): quando vencem. */
  expiresAt?: Date | null;
}

/** Pontos de uma compra: só pontos inteiros (o que sobra não acumula). */
export function pointsEarned(totalCents: number, program: LoyaltyProgram): number {
  if (!program.active || totalCents <= 0 || program.centsPerPoint <= 0) return 0;
  return Math.floor(totalCents / program.centsPerPoint);
}

/** Data de vencimento: mesmo dia, N meses depois. */
export function loyaltyExpiry(at: Date, months: number): Date {
  const d = new Date(at.getTime());
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

/**
 * Saldo na data: cada ganho é um "lote" que vence; resgates e estornos consomem os lotes que
 * vencem primeiro e que ainda valiam no momento do resgate. Nunca fica negativo.
 */
export function loyaltyBalance(entries: readonly LoyaltyEntry[], now: Date): number {
  const ordered = [...entries].sort((a, b) => a.at.getTime() - b.at.getTime());
  const lots: { remaining: number; expiresAt: number }[] = [];
  for (const e of ordered) {
    if (e.points > 0) {
      lots.push({
        remaining: e.points,
        expiresAt: e.expiresAt ? e.expiresAt.getTime() : Number.POSITIVE_INFINITY,
      });
      lots.sort((a, b) => a.expiresAt - b.expiresAt);
      continue;
    }
    let toTake = -e.points;
    for (const lot of lots) {
      if (toTake === 0) break;
      if (lot.expiresAt <= e.at.getTime() || lot.remaining === 0) continue;
      const take = Math.min(lot.remaining, toTake);
      lot.remaining -= take;
      toTake -= take;
    }
  }
  return lots.filter((l) => l.expiresAt > now.getTime()).reduce((sum, l) => sum + l.remaining, 0);
}

/**
 * Quanto dá para usar numa venda: todos os pontos possíveis sem passar do valor da venda.
 * Abaixo do mínimo do programa, nada.
 */
export function maxRedeem(
  balance: number,
  netTotalCents: number,
  program: LoyaltyProgram,
): { points: number; discountCents: number } {
  if (!program.active || program.pointValueCents <= 0) return { points: 0, discountCents: 0 };
  const points = Math.min(balance, Math.floor(netTotalCents / program.pointValueCents));
  if (points < Math.max(1, program.minRedeemPoints)) return { points: 0, discountCents: 0 };
  return { points, discountCents: points * program.pointValueCents };
}
