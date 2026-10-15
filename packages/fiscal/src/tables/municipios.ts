import data from './data/municipios.json';

/**
 * Municípios do IBGE (F3-14.a): o código de 7 dígitos é o cMun da NF-e e da NFC-e. Gerado da
 * lista oficial guardada em `sources` (veja o manifest); nunca editar o JSON à mão.
 */
export interface Municipio {
  code: string;
  name: string;
  uf: string;
}

const ALL: readonly Municipio[] = (data.items as [string, string, string][]).map(
  ([code, name, uf]) => ({ code, name, uf }),
);

export function findMunicipio(code: string): Municipio | null {
  return ALL.find((m) => m.code === code) ?? null;
}

const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Municípios da UF cujo nome contém o texto (sem acento e sem diferença de maiúscula). */
export function searchMunicipios(uf: string, text: string, limit = 20): Municipio[] {
  const q = fold(text);
  return ALL.filter((m) => m.uf === uf && (!q || fold(m.name).includes(q))).slice(0, limit);
}
