/** Tipos do leitor de texto de PDF oficial (pdf-text.mjs), usados nos testes. */
export function pdfLines(
  bytes: Uint8Array,
  options?: { withoutStruck?: boolean; pages?: [number, number] },
): Promise<string[]>;
