/** Tipos do leitor de texto de norma do LegisWeb (F3-26.d.TO e F3-26.d.AP), usados nos testes. */
export interface LegisWebNote {
  kind: 'redacao' | 'revogado' | 'excluido';
  decree: string;
  decreeDate: string;
  effectDate: string | null;
  text: string;
}
export function legisWebNotes(text: string): LegisWebNote[];
export function withoutNotes(text: string): string;
export function legisWebNcms(text: string): { ncms: string[]; invalid: string[] };
export function legisWebDescriptionDates(description: string): {
  from: string | null;
  until: string | null;
};
export function percent(text: string): string;
export function cestOf(text: string): string | null;
export function legisWebHtml(buffer: Uint8Array): string;
