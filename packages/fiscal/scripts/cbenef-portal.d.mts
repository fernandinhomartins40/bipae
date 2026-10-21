/** Tipos do leitor da lista de UFs do cBenef no Portal da NF-e (F3-27.c), usados nos testes. */
export const ALL_UFS: string[];
export function parseCbenefPortal(html: string): {
  updatedAt: string;
  listed: { uf: string; url: string }[];
  notUsed: string[];
  note: string;
};
