import { describe, expect, it } from 'vitest';
import { explainRejection, SEFAZ_REJECTIONS } from './sefaz-rejections';

describe('rejeições da SEFAZ explicadas (F3-18)', () => {
  it('cada código aparece uma vez, com o texto oficial, a causa e o que fazer', () => {
    expect(new Set(SEFAZ_REJECTIONS.map((r) => r.code)).size).toBe(SEFAZ_REJECTIONS.length);
    for (const r of SEFAZ_REJECTIONS) {
      expect(r.code, r.code).toMatch(/^\d{3,4}$/);
      expect(r.official, r.code).toMatch(/^(Rejeição|Uso Denegado):/);
      expect(r.cause.length, r.code).toBeGreaterThan(10);
      expect(r.fix.length, r.code).toBeGreaterThan(10);
    }
  });

  it('explica o código conhecido e, no desconhecido, usa o motivo da SEFAZ', () => {
    expect(explainRejection('281')).toMatchObject({ area: 'certificado', next: 'corrigir' });
    expect(explainRejection('1105', 'Rejeição: Valor total do Item (vItem) difere')).toMatchObject({
      code: '1105',
      cause: 'Rejeição: Valor total do Item (vItem) difere',
      next: 'suporte',
    });
    expect(explainRejection('9999').cause).toBe('A SEFAZ recusou a nota.');
  });
});
