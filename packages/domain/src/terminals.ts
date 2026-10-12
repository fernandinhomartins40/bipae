/**
 * NFC-e series allocation per terminal (ADR-0012, D-010).
 * Every terminal (web or desktop) gets its own series so offline terminals never
 * produce the same document number. Series are never reused, even after a terminal is revoked.
 */
export interface SeriesRange {
  min: number;
  max: number;
}

/** Provisional range pending D-010 (series 890–899 are reserved for "nota avulsa"). */
export const DEFAULT_NFCE_SERIES_RANGE: SeriesRange = { min: 1, max: 889 };

export function allocateNfceSeries(
  alreadyAllocated: Iterable<number>,
  range: SeriesRange = DEFAULT_NFCE_SERIES_RANGE,
): number {
  const used = new Set(alreadyAllocated);
  for (let series = range.min; series <= range.max; series++) {
    if (!used.has(series)) return series;
  }
  throw new Error(
    `Não há séries de NFC-e livres entre ${range.min} e ${range.max} para esta empresa`,
  );
}

export const TERMINAL_PLATFORMS = ['web', 'desktop'] as const;
export type TerminalPlatform = (typeof TERMINAL_PLATFORMS)[number];
