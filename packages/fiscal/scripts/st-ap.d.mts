/** Tipos do leitor do RICMS/AP (F3-26.d.AP), usados nos testes. */
import type { LegisWebPending } from './st-to.mjs';
export function parseApRicms(
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
