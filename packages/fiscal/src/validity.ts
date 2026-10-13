/**
 * Vigência de uma regra: intervalo semiaberto [start, end). Datas no formato AAAA-MM-DD,
 * comparadas como texto (a ordem alfabética é a ordem do calendário), sem fuso horário:
 * a data que vale é a do fato gerador.
 */
export interface Validity {
  start: string;
  /** Primeiro dia em que a regra NÃO vale mais. Ausente = sem data para acabar. */
  end?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function assertDate(date: string): string {
  if (!ISO_DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new Error(`Data inválida: "${date}" (use AAAA-MM-DD)`);
  }
  // Recusa datas que o JavaScript "conserta" (ex.: 2026-02-30 vira março).
  if (new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    throw new Error(`Data inválida: "${date}" (dia não existe)`);
  }
  return date;
}

export function assertValidity(validity: Validity): Validity {
  assertDate(validity.start);
  if (validity.end !== undefined) {
    assertDate(validity.end);
    if (validity.end <= validity.start) {
      throw new Error(`Vigência inválida: o fim (${validity.end}) precisa ser depois do início (${validity.start})`);
    }
  }
  return validity;
}

export function isValidOn(validity: Validity, date: string): boolean {
  return date >= validity.start && (validity.end === undefined || date < validity.end);
}

/** Duas vigências têm pelo menos um dia em comum? */
export function overlaps(a: Validity, b: Validity): boolean {
  const aEndsBeforeB = a.end !== undefined && a.end <= b.start;
  const bEndsBeforeA = b.end !== undefined && b.end <= a.start;
  return !aEndsBeforeB && !bEndsBeforeA;
}
