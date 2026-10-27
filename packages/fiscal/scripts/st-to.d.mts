/** Tipos do leitor do RICMS/TO (F3-26.d.TO), usados nos testes. */
export interface LegisWebPending {
  annex: string;
  message: string;
}
export function parseToRicms(
  buffer: Uint8Array,
  knownCest: Set<string>,
): {
  sections: {
    annex: string;
    label: string;
    name: string;
    items: { item: string; cest: string; ncms: string[]; mva: string | null; validFrom: string }[];
    revoked: { cest: string; from: string; by: string }[];
  }[];
  pending: LegisWebPending[];
};
