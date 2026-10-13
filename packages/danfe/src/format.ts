/**
 * Formatação do DANFE a partir do texto do XML, sem passar por número de ponto flutuante:
 * "1234.5" vira "1.234,50"; CNPJ, CPF, CEP e chave com as máscaras do manual.
 */
export function decimalBR(value: string | undefined, minDecimals = 2): string {
  if (value === undefined || value === '') return '';
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!m) throw new Error(`Valor decimal inválido no XML: ${value}`);
  const [, sign, int, frac = ''] = m;
  const intPart = int!.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  let decimals = frac.replace(/0+$/, '');
  if (decimals.length < minDecimals) decimals = decimals.padEnd(minDecimals, '0');
  return `${sign}${intPart}${decimals ? `,${decimals}` : ''}`;
}

/** Quantidade como no XML (até 4 casas), sem zeros sobrando: "10.0000" vira "10,00". */
export const quantityBR = (value: string) => decimalBR(value, 2);

export function taxIdBR(value: string | undefined): string {
  if (!value) return '';
  if (value.length === 14)
    return value.replace(/^(.{2})(.{3})(.{3})(.{4})(.{2})$/, '$1.$2.$3/$4-$5');
  if (value.length === 11) return value.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return value;
}

export const cepBR = (value: string | undefined) =>
  value && /^\d{8}$/.test(value) ? `${value.slice(0, 5)}-${value.slice(5)}` : (value ?? '');

export function phoneBR(value: string | undefined): string {
  if (!value) return '';
  const m = /^(\d{2})(\d{4,5})(\d{4})$/.exec(value);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : value;
}

/** Chave em 11 blocos de 4 (Anexo II, 3.1.1). */
export const accessKeyBR = (key: string) => key.match(/.{4}/g)!.join(' ');

/** Data do XML (AAAA-MM-DD ou data e hora com fuso) em dd/mm/aaaa, no fuso que veio no XML. */
export function dateBR(value: string | undefined): string {
  const m = value ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

export function timeBR(value: string | undefined): string {
  const m = value ? /T(\d{2}:\d{2}:\d{2})/.exec(value) : null;
  return m ? m[1]! : '';
}

/** Número da nota com a máscara 000.000.000. */
export const nfNumberBR = (value: string) =>
  value.padStart(9, '0').replace(/^(\d{3})(\d{3})(\d{3})$/, '$1.$2.$3');

const CRT_LABELS: Record<string, string> = {
  '1': '1 - SIMPLES NACIONAL',
  '2': '2 - SIMPLES NACIONAL - EXCESSO DE SUBLIMITE',
  '3': '3 - REGIME NORMAL',
  '4': '4 - SIMPLES NACIONAL - MEI',
};
export const crtBR = (crt: string) => CRT_LABELS[crt] ?? crt;

const FREIGHT_LABELS: Record<string, string> = {
  '0': '0 - REMETENTE (CIF)',
  '1': '1 - DESTINATÁRIO (FOB)',
  '2': '2 - TERCEIROS',
  '3': '3 - PRÓPRIO REMETENTE',
  '4': '4 - PRÓPRIO DESTINATÁRIO',
  '9': '9 - SEM TRANSPORTE',
};
export const freightBR = (mode: string) => FREIGHT_LABELS[mode] ?? mode;

/** Percentual do XML ("18.0000") como no DANFE ("18,00"). */
export const rateBR = (value: string | undefined) => decimalBR(value, 2);
