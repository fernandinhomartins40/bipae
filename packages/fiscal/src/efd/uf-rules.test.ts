import { describe, expect, it } from 'vitest';
import { EFD_1601_BY_UF, EFD_SIMPLES_BY_UF, efdUfRule } from './uf-rules';

/** F4-14.b.4: regras da EFD por UF, só com fonte oficial lida (dúvidas D-031 e D-038). */
describe('EFD por UF', () => {
  it('cada linha tem fonte oficial, data e explicação', () => {
    for (const r of [...EFD_SIMPLES_BY_UF, ...EFD_1601_BY_UF]) {
      expect(r.uf, r.act).toMatch(/^[A-Z]{2}$/);
      expect(r.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (r.to !== undefined) {
        expect(r.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(r.from <= r.to, r.act).toBe(true);
      }
      // Só site de governo (SEFAZ, legislação estadual).
      expect(r.url).toMatch(/^https?:\/\/[a-z0-9.-]+\.gov\.br\//);
      expect(r.note.length).toBeGreaterThan(20);
    }
  });

  it('linhas da mesma UF não se sobrepõem no tempo', () => {
    for (const table of [EFD_SIMPLES_BY_UF, EFD_1601_BY_UF]) {
      for (const a of table) {
        for (const b of table) {
          if (a === b || a.uf !== b.uf) continue;
          // As duas valem no primeiro dia da mais nova? Então a mais antiga precisa ter fim antes.
          const [older, newer] = a.from <= b.from ? [a, b] : [b, a];
          expect(older.to !== undefined && older.to < newer.from, `${a.uf}: ${a.act}`).toBe(true);
        }
      }
    }
  });

  it('Simples: a Paraíba obriga desde 2020, o Amazonas dispensa, e o resto não é suposto', () => {
    expect(efdUfRule(EFD_SIMPLES_BY_UF, 'pb', '2026-10-31')?.status).toBe('required');
    expect(efdUfRule(EFD_SIMPLES_BY_UF, 'PB', '2019-12-31')).toBeNull();
    expect(efdUfRule(EFD_SIMPLES_BY_UF, 'AM', '2026-10-31')?.status).toBe('exempt');
    expect(efdUfRule(EFD_SIMPLES_BY_UF, 'MS', '2026-10-31')?.status).toBe('partial');
    expect(efdUfRule(EFD_SIMPLES_BY_UF, 'RJ', '2026-10-31')).toBeNull();
  });

  it('Simples: SP, BA, PE, PA, MG, ES, SC e MT dispensam, cada um desde a data da sua norma', () => {
    for (const uf of ['SP', 'BA', 'PE', 'PA', 'MG', 'ES', 'SC', 'MT']) {
      expect(efdUfRule(EFD_SIMPLES_BY_UF, uf, '2026-10-31')?.status, uf).toBe('exempt');
    }
    // A Bahia chegou a prever a obrigação do Simples para 2016, mas o Decreto 16.284/2015 a tirou.
    expect(efdUfRule(EFD_SIMPLES_BY_UF, 'BA', '2015-08-31')).toBeNull();
    expect(efdUfRule(EFD_SIMPLES_BY_UF, 'BA', '2016-01-31')?.act).toMatch(/16\.284\/2015/);
    // Minas: o RICMS/2023 vale desde 01/07/2023; antes disso não está confirmado.
    expect(efdUfRule(EFD_SIMPLES_BY_UF, 'MG', '2023-06-30')).toBeNull();
    expect(efdUfRule(EFD_SIMPLES_BY_UF, 'PA', '2026-10-31')?.note).toMatch(/sublimite/);
  });

  it('registro 1601: MS exige, SC dispensa o perfil A, BA dispensa', () => {
    expect(efdUfRule(EFD_1601_BY_UF, 'MS', '2026-10-31')?.status).toBe('required');
    expect(efdUfRule(EFD_1601_BY_UF, 'SC', '2026-10-31')?.note).toMatch(/perfil A/);
    expect(efdUfRule(EFD_1601_BY_UF, 'BA', '2026-10-31')?.status).toBe('exempt');
    expect(efdUfRule(EFD_1601_BY_UF, 'RJ', '2026-10-31')).toBeNull();
  });

  it('registro 1601: CE, PE, GO, DF e PB exigem; SP, PR, MG, PA e MT dispensam', () => {
    for (const uf of ['CE', 'PE', 'GO', 'DF', 'PB']) {
      expect(efdUfRule(EFD_1601_BY_UF, uf, '2026-10-31')?.status, uf).toBe('required');
    }
    for (const uf of ['SP', 'PR', 'MG', 'PA', 'MT']) {
      expect(efdUfRule(EFD_1601_BY_UF, uf, '2026-10-31')?.status, uf).toBe('exempt');
    }
    // Ceará: obrigatório a partir de 01/03/2023.
    expect(efdUfRule(EFD_1601_BY_UF, 'CE', '2023-02-28')).toBeNull();
    // Pernambuco: só o CNAE 3514-0/00 é dispensado.
    expect(efdUfRule(EFD_1601_BY_UF, 'PE', '2026-10-31')?.note).toMatch(/3514-0\/00/);
  });

  it('terceira rodada: Simples dispensado em RS, AC, TO e SE; obrigado em RN e AL', () => {
    for (const uf of ['RS', 'AC', 'TO', 'SE']) {
      expect(efdUfRule(EFD_SIMPLES_BY_UF, uf, '2026-10-31')?.status, uf).toBe('exempt');
    }
    for (const uf of ['RN', 'AL']) {
      expect(efdUfRule(EFD_SIMPLES_BY_UF, uf, '2026-10-31')?.status, uf).toBe('required');
    }
    // RN dispensou o Simples só até 31/12/2013 (Decreto 24.120/2013).
    expect(efdUfRule(EFD_SIMPLES_BY_UF, 'RN', '2013-12-31')).toBeNull();
    // AL obriga o Simples desde 01/01/2016.
    expect(efdUfRule(EFD_SIMPLES_BY_UF, 'AL', '2015-12-31')).toBeNull();
  });

  it('terceira rodada: 1601 em RS, RN, ES, AL e SE', () => {
    expect(efdUfRule(EFD_1601_BY_UF, 'RS', '2026-10-31')?.status).toBe('exempt');
    expect(efdUfRule(EFD_1601_BY_UF, 'RN', '2024-06-30')?.status).toBe('optional');
    expect(efdUfRule(EFD_1601_BY_UF, 'RN', '2025-01-31')?.status).toBe('required');
    expect(efdUfRule(EFD_1601_BY_UF, 'RN', '2023-06-30')).toBeNull();
    expect(efdUfRule(EFD_1601_BY_UF, 'ES', '2026-10-31')?.status).toBe('optional');
    expect(efdUfRule(EFD_1601_BY_UF, 'AL', '2023-01-31')).toBeNull();
    expect(efdUfRule(EFD_1601_BY_UF, 'AL', '2023-02-28')?.status).toBe('required');
    // Sergipe: só atividades mistas (ICMS e ISS), desde 2025; 2023 e 2024 não estão confirmados.
    expect(efdUfRule(EFD_1601_BY_UF, 'SE', '2026-10-31')?.note).toMatch(/ISS/);
    expect(efdUfRule(EFD_1601_BY_UF, 'SE', '2024-06-30')).toBeNull();
  });

  it('registro 1601 com vigência fechada: PB facultativo em 2023 e RO dispensado em 2022 e 2023', () => {
    expect(efdUfRule(EFD_1601_BY_UF, 'PB', '2023-12-31')?.status).toBe('optional');
    expect(efdUfRule(EFD_1601_BY_UF, 'PB', '2024-01-31')?.status).toBe('required');
    expect(efdUfRule(EFD_1601_BY_UF, 'RO', '2023-06-30')?.status).toBe('exempt');
    // Depois de 2023 a regra de Rondônia não está confirmada (D-038).
    expect(efdUfRule(EFD_1601_BY_UF, 'RO', '2024-01-31')).toBeNull();
  });
});
