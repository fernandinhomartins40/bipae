import { isValidOn, type Validity } from '../validity';
import type { CompanyRegime } from '../regimes';
import data from './data/simples-limits.json';

/**
 * Limites de receita bruta anual do MEI e do Simples Nacional e o sublimite do ICMS e do ISS,
 * por vigência e com a fonte de cada um. O sublimite é publicado todo ano pelo Comitê Gestor do
 * Simples Nacional; ano sem portaria conferida fica sem número (o aviso diz que falta a fonte).
 */
export interface SimplesLimit {
  id: 'mei' | 'simples' | 'sublimite';
  label: string;
  cents: number;
  validity: Validity;
  source: string;
  url: string;
}

export const SIMPLES_LIMITS: readonly SimplesLimit[] = data.limits as SimplesLimit[];
export const SIMPLES_LIMITS_CHECKED_AT: string = data.checkedAt;

/** O limite que vale na data (AAAA-MM-DD); null quando ainda não há fonte conferida para ela. */
export function simplesLimit(id: SimplesLimit['id'], date: string): SimplesLimit | null {
  return SIMPLES_LIMITS.find((limit) => limit.id === id && isValidOn(limit.validity, date)) ?? null;
}

export interface RevenueAlert {
  level: 'info' | 'warning' | 'critical';
  /** Limite envolvido; null quando o problema é a falta da fonte. */
  limit: SimplesLimit | null;
  message: string;
}

/** "R$ 3.600.000,00", só com inteiros (centavos). */
const brl = (cents: number) => {
  const reais = Math.floor(cents / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `R$ ${reais},${String(cents % 100).padStart(2, '0')}`;
};

/**
 * Avisos sobre a receita do ano da empresa frente aos limites do regime. O Bipaê só avisa: a
 * mudança de regime é decisão da empresa com o contador (data de efeito, excesso de até 20% etc.).
 * A receita é a que o Bipaê conhece (vendas registradas nele); o aviso deixa isso claro.
 */
export function revenueAlerts(input: {
  regime: CompanyRegime;
  /** Receita bruta acumulada no ano-calendário, em centavos. */
  yearRevenueCents: number;
  date: string;
}): RevenueAlert[] {
  const { regime, yearRevenueCents: revenue, date } = input;
  if (regime === 'presumido' || regime === 'real') return [];
  const alerts: RevenueAlert[] = [];
  const check = (id: SimplesLimit['id'], over: string, near: string) => {
    const limit = simplesLimit(id, date);
    if (!limit) {
      alerts.push({
        level: 'info',
        limit: null,
        message: `O ${id === 'sublimite' ? 'sublimite do ICMS e do ISS' : 'limite'} de ${date.slice(0, 4)} ainda não foi conferido em fonte oficial pelo Bipaê. Confira com o contador.`,
      });
      return false;
    }
    if (revenue > limit.cents) {
      alerts.push({
        level: 'critical',
        limit,
        message: `${over} (${brl(revenue)} no ano; ${limit.label}: ${brl(limit.cents)}).`,
      });
      return true;
    }
    // A partir de 90% do limite (conta em inteiros: receita × 10 ≥ limite × 9).
    if (revenue * 10 >= limit.cents * 9) {
      alerts.push({
        level: 'warning',
        limit,
        message: `${near} (${brl(revenue)} de ${brl(limit.cents)}).`,
      });
    }
    return false;
  };

  if (regime === 'mei') {
    check(
      'mei',
      'A receita do ano passou do limite do MEI. Fale com o contador sobre o desenquadramento e a data em que ele vale',
      'A receita do ano está chegando ao limite do MEI',
    );
    return alerts;
  }
  const excluded = check(
    'simples',
    'A receita do ano passou do teto do Simples Nacional. Fale com o contador sobre a exclusão do Simples',
    'A receita do ano está chegando ao teto do Simples Nacional',
  );
  if (regime === 'simples' && !excluded) {
    check(
      'sublimite',
      'A receita do ano passou do sublimite: o ICMS sai do Simples. Com o contador, mude o regime para "Simples Nacional acima do sublimite" (CRT 2) na data certa',
      'A receita do ano está chegando ao sublimite do ICMS e do ISS do Simples',
    );
  }
  return alerts;
}
