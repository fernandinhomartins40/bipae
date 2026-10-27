/** Utilitários de campos de posição fixa dos arquivos CNAB (F4-15.b). Puro e testável. */

/** Maiúsculas, sem acento e só ASCII imprimível: o CNAB não aceita mais do que isso. */
export function cnabText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^\x20-\x7E]/g, ' ');
}

/** Campo alfanumérico: alinhado à esquerda, completado com espaços e cortado no tamanho. */
export function alpha(value: string | undefined, size: number): string {
  return cnabText(value ?? '')
    .padEnd(size, ' ')
    .slice(0, size);
}

/** Campo numérico: zeros à esquerda; estoura com erro em vez de cortar um valor em dinheiro. */
export function num(value: number | string | undefined, size: number): string {
  const text = String(value ?? 0).replace(/\D/g, '') || '0';
  if (text.length > size) throw new Error(`Número ${text} não cabe em ${size} posições.`);
  return text.padStart(size, '0');
}

export function blank(size: number): string {
  return ' '.repeat(size);
}

/** Centavos inteiros para o campo (sem vírgula, casas já embutidas). */
export function money(cents: number, size: number): string {
  if (!Number.isInteger(cents) || cents < 0) throw new Error('Valor em centavos inválido.');
  return num(cents, size);
}

/** AAAA-MM-DD para DDMMAAAA (ou DDMMAA com `short`); vazio vira zeros. */
export function dateField(iso: string | undefined | null, short = false): string {
  if (!iso) return '0'.repeat(short ? 6 : 8);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`Data inválida: ${iso}`);
  return `${m[3]}${m[2]}${short ? m[1]!.slice(2) : m[1]}`;
}

/** DDMMAAAA (ou DDMMAA, assumindo 20AA) para AAAA-MM-DD; zeros viram null. */
export function parseDate(text: string): string | null {
  if (!/^\d+$/.test(text) || /^0+$/.test(text)) return null;
  if (text.length === 8) return `${text.slice(4)}-${text.slice(2, 4)}-${text.slice(0, 2)}`;
  if (text.length === 6) return `20${text.slice(4)}-${text.slice(2, 4)}-${text.slice(0, 2)}`;
  return null;
}

/** Pedaço do registro pela posição 1-based do manual (inclusive nas duas pontas). */
export function pick(line: string, from: number, to: number): string {
  return line.slice(from - 1, to);
}

/** Monta o registro a partir de campos e garante o tamanho exato (erro de layout aparece no teste). */
export function record(size: number, parts: string[]): string {
  const line = parts.join('');
  if (line.length !== size) {
    throw new Error(`Registro CNAB com ${line.length} posições; o layout pede ${size}.`);
  }
  return line;
}
