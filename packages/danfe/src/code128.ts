/**
 * Código de barras CODE-128C da chave de acesso (Anexo II do MOC 7.0, item 2): Start C, os
 * dígitos em pares, o dígito verificador módulo 103 e o Stop. Cada símbolo é a largura de barra,
 * espaço, barra... em módulos (6 elementos que somam 11; o Stop tem 7 que somam 13).
 */
// prettier-ignore
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
export const CODE128_PATTERNS: readonly string[] = PATTERNS;

const START_C = 105;
const STOP = 106;

/** Dígito verificador: soma ponderada (Start com peso 1) módulo 103. */
export function code128cCheck(values: number[]): number {
  return values.reduce((sum, value, i) => sum + value * (i + 1), START_C) % 103;
}

/** Valores dos símbolos: Start C, pares de dígitos, verificador e Stop. */
export function code128cValues(digits: string): number[] {
  if (!/^(\d\d)+$/.test(digits))
    throw new Error('O CODE-128C codifica só dígitos, em quantidade par.');
  const pairs = digits.match(/\d\d/g)!.map(Number);
  return [START_C, ...pairs, code128cCheck(pairs), STOP];
}

/** Larguras alternadas (barra, espaço, barra...) em módulos, sem as margens claras. */
export function code128cModules(digits: string): number[] {
  return toModules(code128cValues(digits));
}

const CODE_A = 101; // no conjunto C, muda para o A
const CODE_C = 99; // no conjunto A, muda para o C

/**
 * Chave de acesso com o CNPJ alfanumérico (NT Conjunta 2025.001, seção 6): o modelo híbrido
 * começa no CODE-128C e passa ao CODE-128A (código 101) quando aparece letra, voltando ao C
 * (código 99) nos grupos de dígitos. As trocas seguem as orientações da própria NT:
 * dígito ímpar antes de uma letra vai no conjunto A; no A, um grupo de quatro ou mais dígitos
 * (ou os dígitos que fecham a chave) volta ao C, e, se o grupo for ímpar, o primeiro dígito
 * fica no A. Chave só com dígitos sai igual ao CODE-128C puro.
 */
export function code128KeyValues(key: string): number[] {
  if (!/^[0-9A-Z]+$/.test(key)) {
    throw new Error('A chave de acesso tem só dígitos e letras maiúsculas.');
  }
  if (!/^\d\d/.test(key)) throw new Error('A chave de acesso começa com dígitos (Start C).');
  const isDigit = (i: number) => i < key.length && key[i]! >= '0' && key[i]! <= '9';
  const runFrom = (i: number) => {
    let j = i;
    while (isDigit(j)) j++;
    return j - i;
  };
  const data: number[] = [];
  let mode: 'A' | 'C' = 'C';
  let i = 0;
  while (i < key.length) {
    if (mode === 'C') {
      if (isDigit(i) && isDigit(i + 1)) {
        data.push(Number(key.slice(i, i + 2)));
        i += 2;
      } else {
        data.push(CODE_A);
        mode = 'A';
      }
      continue;
    }
    const run = runFrom(i);
    if (run >= 4 || (run >= 2 && i + run === key.length)) {
      if (run % 2 === 1) {
        data.push(key.charCodeAt(i) - 32);
        i++;
      }
      data.push(CODE_C);
      mode = 'C';
      continue;
    }
    data.push(key.charCodeAt(i) - 32); // conjunto A: ASCII 32 a 95 valem 0 a 63
    i++;
  }
  return [START_C, ...data, code128cCheck(data), STOP];
}

/** Larguras do código de barras da chave, numérica ou alfanumérica. */
export function code128KeyModules(key: string): number[] {
  return toModules(code128KeyValues(key));
}

function toModules(values: number[]): number[] {
  return values.flatMap((value) => [...PATTERNS[value]!].map(Number));
}
