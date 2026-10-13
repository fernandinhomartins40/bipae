/**
 * Numeração da NFC-e (F3-12): cada caixa tem a sua série (única na empresa) e o número da nota é o
 * número da venda no caixa (`terminalSeq`). Assim dois caixas nunca repetem número, mesmo sem
 * internet. Números que não viram nota (devolução, venda cancelada antes de emitir) deixam
 * buracos na série, que são inutilizados junto à SEFAZ (F3-17).
 */
export function nfceNumbering(input: { series: number; terminalSeq: number }): { series: number; number: number } {
  if (!Number.isInteger(input.series) || input.series < 1 || input.series > 999) {
    throw new Error(`Série da NFC-e fora de 1 a 999: ${input.series}`);
  }
  if (!Number.isInteger(input.terminalSeq) || input.terminalSeq < 1 || input.terminalSeq > 999_999_999) {
    throw new Error(`Número da venda fora do intervalo da NFC-e (1 a 999.999.999): ${input.terminalSeq}`);
  }
  return { series: input.series, number: input.terminalSeq };
}
