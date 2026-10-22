import { describe, expect, it } from 'vitest';
import { EFD_1601_BY_UF, EFD_SIMPLES_BY_UF, efdUfRule } from './uf-rules';

/** F4-14.b.4: regras da EFD por UF, só com fonte oficial lida (dúvidas D-031 e D-038). */
describe('EFD por UF', () => {
  it('cada linha tem fonte oficial, data e explicação', () => {
    for (const r of [...EFD_SIMPLES_BY_UF, ...EFD_1601_BY_UF]) {
      expect(r.uf, r.act).toMatch(/^[A-Z]{2}$/);
      expect(r.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // Só site de governo (SEFAZ, legislação estadual).
      expect(r.url).toMatch(/^https?:\/\/[a-z0-9.-]+\.gov\.br\//);
      expect(r.note.length).toBeGreaterThan(20);
    }
  });

  it('Simples: a Paraíba obriga desde 2020, o Amazonas dispensa, e o resto não é suposto', () => {
    expect(efdUfRule(EFD_SIMPLES_BY_UF, 'pb', '2026-10-31')?.status).toBe('required');
    expect(efdUfRule(EFD_SIMPLES_BY_UF, 'PB', '2019-12-31')).toBeNull();
    expect(efdUfRule(EFD_SIMPLES_BY_UF, 'AM', '2026-10-31')?.status).toBe('exempt');
    expect(efdUfRule(EFD_SIMPLES_BY_UF, 'MS', '2026-10-31')?.status).toBe('partial');
    expect(efdUfRule(EFD_SIMPLES_BY_UF, 'SP', '2026-10-31')).toBeNull();
  });

  it('registro 1601: MS exige, SC dispensa o perfil A, BA dispensa', () => {
    expect(efdUfRule(EFD_1601_BY_UF, 'MS', '2026-10-31')?.status).toBe('required');
    expect(efdUfRule(EFD_1601_BY_UF, 'SC', '2026-10-31')?.note).toMatch(/perfil A/);
    expect(efdUfRule(EFD_1601_BY_UF, 'BA', '2026-10-31')?.status).toBe('exempt');
    expect(efdUfRule(EFD_1601_BY_UF, 'RJ', '2026-10-31')).toBeNull();
  });
});
