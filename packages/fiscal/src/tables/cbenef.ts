import data from './data/cbenef.json';

/**
 * Códigos de benefício fiscal (cBenef) por UF (F3-27.b), gerados da tabela oficial que a SEFAZ
 * publica (no PR, a "Tabela de Códigos de Benefício Fiscal por CST"). Serve para mostrar o que o
 * código significa e em quais CST ele vale; quem escolhe o código é a empresa.
 */
export interface CbenefCode {
  code: string;
  /** CST do ICMS em que o código vale ("40", "41"...). */
  csts: string[];
  /** Início da vigência (AAAA-MM-DD). */
  from: string | null;
  /** Fim da vigência, quando o código foi encerrado. */
  to: string | null;
  description: string;
  /** Tipo do benefício, quando a tabela traz (isenção, redução, diferimento, crédito presumido). */
  kind?: string;
}

/** Crédito presumido não vai no cBenef: tem campo próprio na nota (cCredPresumido). */
export const isPresumedCredit = (c: Pick<CbenefCode, 'kind'>) =>
  /cr[ée]dito presumido/i.test(c.kind ?? '');

export interface CbenefTable {
  uf: string;
  act: string;
  source: string;
  url: string;
  codes: CbenefCode[];
}

/**
 * UFs que, pela fonte oficial, não usam a tabela cBenef (F3-27.c). Hoje a fonte é a observação do
 * Portal Nacional da NF-e: "Os demais Estados não utilizam a tabela cBenef".
 */
export interface CbenefNotUsed {
  ufs: string[];
  act: string;
  source: string;
  url: string;
  /** Data da atualização da lista no portal (AAAA-MM-DD). */
  updatedAt: string;
}

const generated = data as { tables: CbenefTable[]; notUsed: CbenefNotUsed };

export const CBENEF_TABLES: readonly CbenefTable[] = generated.tables;

/** UFs com a tabela oficial de cBenef no Bipaê. */
export const CBENEF_UFS: readonly string[] = CBENEF_TABLES.map((t) => t.uf);

export const CBENEF_NOT_USED: CbenefNotUsed = generated.notUsed;

export interface CbenefLookup {
  uf: string;
  /** A UF tem a tabela no Bipaê? */
  covered: boolean;
  /** Quando a fonte oficial diz que a UF não usa a tabela cBenef: de onde vem essa informação. */
  notUsed: { act: string; url: string } | null;
  /** O código na tabela (ou nada, se não existe). */
  entry: (CbenefCode & { act: string; url: string }) | null;
  /** Vale na data? */
  valid: boolean;
  /** Vale para o CST informado? (nada quando o CST não foi informado) */
  cstOk: boolean | null;
}

/** O que a tabela oficial diz do código na UF, na data e (opcional) para o CST. */
export function cbenefLookup(uf: string, code: string, date: string, cst?: string): CbenefLookup {
  const table = CBENEF_TABLES.find((t) => t.uf === uf.toUpperCase());
  const wanted = code.trim().toUpperCase();
  const found = table?.codes.find((c) => c.code === wanted) ?? null;
  const valid = !!found && (!found.from || date >= found.from) && (!found.to || date <= found.to);
  return {
    uf: uf.toUpperCase(),
    covered: !!table,
    notUsed: CBENEF_NOT_USED.ufs.includes(uf.toUpperCase())
      ? { act: CBENEF_NOT_USED.act, url: CBENEF_NOT_USED.url }
      : null,
    entry: found && table ? { ...found, act: table.act, url: table.url } : null,
    valid,
    cstOk: found && cst ? found.csts.includes(cst) : null,
  };
}

/** Códigos que valem na data para o CST (e, se houver, com o texto procurado na descrição). */
export function cbenefSuggestions(uf: string, cst: string, date: string, query = ''): CbenefCode[] {
  const table = CBENEF_TABLES.find((t) => t.uf === uf.toUpperCase());
  if (!table) return [];
  const q = query.trim().toLowerCase();
  return table.codes.filter(
    (c) =>
      c.csts.includes(cst) &&
      (!c.from || date >= c.from) &&
      (!c.to || date <= c.to) &&
      (!q || c.description.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)),
  );
}
