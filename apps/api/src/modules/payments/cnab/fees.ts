/**
 * Multa e juros de boleto pago depois do vencimento (F4-15.b). TypeScript puro, só inteiros:
 * dinheiro em centavos, taxas em pontos-base (100 bps = 1%), arredondamento "meio para cima"
 * explícito. As taxas são o que o CEDENTE combinou com o cliente (contrato), não uma regra do
 * código: vêm como configuração. Os feriados bancários também chegam de fora (`holidays`).
 */
export interface BoletoFeeTerms {
  /** Multa única, em pontos-base do valor do boleto (200 = 2%). 0 = sem multa. */
  fineBps: number;
  /** Juros de mora ao mês, em pontos-base (100 = 1% a.m.), proporcionais por dia (mês de 30 dias). */
  interestMonthlyBps: number;
  /** Dias de tolerância depois do vencimento antes de cobrar (0 = cobra no dia seguinte). */
  graceDays?: number;
}

export interface BoletoFeeInput extends BoletoFeeTerms {
  amountCents: number;
  /** AAAA-MM-DD */
  dueDate: string;
  /** AAAA-MM-DD */
  payDate: string;
  /** Feriados (AAAA-MM-DD) em que o banco não abre: o vencimento passa para o dia útil seguinte. */
  holidays?: ReadonlySet<string> | readonly string[];
}

export interface BoletoFees {
  /** Vencimento efetivo, já empurrado para o próximo dia útil. */
  effectiveDueDate: string;
  daysLate: number;
  fineCents: number;
  interestCents: number;
  totalCents: number;
}

const DAY = 86_400_000;

function toUtc(iso: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error(`Data inválida: ${iso}`);
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const t = Date.UTC(y, m - 1, d);
  if (new Date(t).toISOString().slice(0, 10) !== iso) throw new Error(`Data inválida: ${iso}`);
  return t;
}

function toIso(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

/** Divisão inteira arredondando meio para cima (valores não negativos). */
function divRound(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (denominator * 2n);
}

/** Vencimento que cai em sábado, domingo ou feriado vale no próximo dia útil. */
export function nextBusinessDay(
  iso: string,
  holidays: ReadonlySet<string> | readonly string[] = [],
) {
  const set = holidays instanceof Set ? holidays : new Set(holidays);
  let t = toUtc(iso);
  for (;;) {
    const wd = new Date(t).getUTCDay();
    if (wd !== 0 && wd !== 6 && !set.has(toIso(t))) return toIso(t);
    t += DAY;
  }
}

export function calcBoletoFees(input: BoletoFeeInput): BoletoFees {
  const { amountCents, fineBps, interestMonthlyBps } = input;
  for (const [name, v] of [
    ['valor', amountCents],
    ['multa', fineBps],
    ['juros', interestMonthlyBps],
  ] as const) {
    if (!Number.isInteger(v) || v < 0) throw new Error(`Valor inválido em ${name}.`);
  }
  const effectiveDueDate = nextBusinessDay(input.dueDate, input.holidays);
  const late = Math.round((toUtc(input.payDate) - toUtc(effectiveDueDate)) / DAY);
  const grace = input.graceDays ?? 0;
  if (late <= grace) {
    return {
      effectiveDueDate,
      daysLate: Math.max(0, late),
      fineCents: 0,
      interestCents: 0,
      totalCents: amountCents,
    };
  }
  const amount = BigInt(amountCents);
  const fine = divRound(amount * BigInt(fineBps), 10_000n);
  // Juros simples pro rata: valor x taxa mensal / 30 x dias de atraso, arredondado uma vez só.
  const interest = divRound(amount * BigInt(interestMonthlyBps) * BigInt(late), 10_000n * 30n);
  return {
    effectiveDueDate,
    daysLate: late,
    fineCents: Number(fine),
    interestCents: Number(interest),
    totalCents: amountCents + Number(fine) + Number(interest),
  };
}
