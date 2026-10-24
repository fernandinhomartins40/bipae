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
    // 2023: redação original do § 15, II (Decreto 32.137/2022), confirmada na quarta rodada.
    expect(efdUfRule(EFD_1601_BY_UF, 'RN', '2023-06-30')?.status).toBe('required');
    expect(efdUfRule(EFD_1601_BY_UF, 'RN', '2022-12-31')).toBeNull();
    expect(efdUfRule(EFD_1601_BY_UF, 'ES', '2026-10-31')?.status).toBe('optional');
    expect(efdUfRule(EFD_1601_BY_UF, 'AL', '2023-01-31')).toBeNull();
    expect(efdUfRule(EFD_1601_BY_UF, 'AL', '2023-02-28')?.status).toBe('required');
    // Sergipe: hoje só atividades mistas (ICMS e ISS); 2024 segue sem confirmação (D-050).
    expect(efdUfRule(EFD_1601_BY_UF, 'SE', '2026-10-31')?.note).toMatch(/ISS/);
    expect(efdUfRule(EFD_1601_BY_UF, 'SE', '2024-06-30')).toBeNull();
  });

  it('registro 1601 com vigência fechada: PB facultativo em 2023 e exigido desde 2024', () => {
    expect(efdUfRule(EFD_1601_BY_UF, 'PB', '2023-12-31')?.status).toBe('optional');
    expect(efdUfRule(EFD_1601_BY_UF, 'PB', '2024-01-31')?.status).toBe('required');
  });

  it('quarta rodada: Simples dispensado em GO, CE, PR e RO; o DF obriga com exceções', () => {
    for (const uf of ['GO', 'CE', 'PR', 'RO']) {
      expect(efdUfRule(EFD_SIMPLES_BY_UF, uf, '2026-10-31')?.status, uf).toBe('exempt');
    }
    // Goiás: "não alcança o estabelecimento ... ME e EPP optantes pelo Simples Nacional, salvo o que
    // estiver impedido de recolher o ICMS por este regime" (art. 356-D, § 4º, Decreto 8.117/2013).
    expect(efdUfRule(EFD_SIMPLES_BY_UF, 'GO', '2026-10-31')?.note).toMatch(/impedidas/);
    expect(efdUfRule(EFD_SIMPLES_BY_UF, 'GO', '2012-06-30')?.act).toMatch(/7\.402\/2011/);
    expect(efdUfRule(EFD_SIMPLES_BY_UF, 'GO', '2011-06-30')).toBeNull();
    // Distrito Federal: "A obrigatoriedade de que trata o caput não se aplica aos contribuintes
    // enquadrados no ... Simples Nacional: I - como Microempreendedor Individual ..." (Portaria 192/2019).
    const df = efdUfRule(EFD_SIMPLES_BY_UF, 'DF', '2026-10-31');
    expect(df?.status).toBe('partial');
    expect(df?.note).toMatch(/MEI/);
    expect(efdUfRule(EFD_SIMPLES_BY_UF, 'DF', '2019-06-30')).toBeNull();
    // Ceará: "ficam desobrigados da entrega da EFD ICMS/IPI ... os contribuintes ME e EPP, optantes
    // do Simples Nacional ... todos a partir de janeiro de 2017" (SEFAZ-CE, Comunicado COATE 27/2022).
    expect(efdUfRule(EFD_SIMPLES_BY_UF, 'CE', '2016-12-31')).toBeNull();
    // Paraná: "exceto os estabelecimentos de MEI ..., de ME ... e de EPP ... optantes ... Simples
    // Nacional ... para o período em que estiver enquadrado neste regime" (NPF 056/2015, item 9).
    expect(efdUfRule(EFD_SIMPLES_BY_UF, 'PR', '2026-10-31')?.note).toMatch(/desenquadramento/);
    // Rondônia: "exceto produtor rural pessoa física, MEI e aos optantes pelo Simples Nacional"
    // (Anexo XIII do RICMS-RO, art. 107, parágrafo único), desde 01/05/2018.
    expect(efdUfRule(EFD_SIMPLES_BY_UF, 'RO', '2018-04-30')).toBeNull();
  });

  it('quarta rodada: 1601 dispensado em RO desde 2022 e em MT desde 2023; RN e SE exigiam em 2023', () => {
    // Rondônia: item 9 do Manual da EFD lista o 1601 entre os registros "que não precisam ser
    // apresentados"; a IN 75/2023 revogou a volta da exigência em 2024.
    for (const d of ['2022-01-31', '2024-01-31', '2026-10-31']) {
      expect(efdUfRule(EFD_1601_BY_UF, 'RO', d)?.status, d).toBe('exempt');
    }
    expect(efdUfRule(EFD_1601_BY_UF, 'RO', '2021-12-31')).toBeNull();
    // Mato Grosso: Portaria 089/2023 "retroagindo seus efeitos a 1° de janeiro de 2023" adiou a
    // exigência para 2024, e a Portaria 236/2023 a revogou.
    expect(efdUfRule(EFD_1601_BY_UF, 'MT', '2023-06-30')?.act).toMatch(/089\/2023/);
    expect(efdUfRule(EFD_1601_BY_UF, 'MT', '2024-06-30')?.act).toMatch(/236\/2023/);
    // Rio Grande do Norte: "II - é obrigatório a partir de 1º de janeiro de 2023" (redação original).
    expect(efdUfRule(EFD_1601_BY_UF, 'RN', '2023-12-31')?.act).toMatch(/32\.137\/2022/);
    // Sergipe: § 10 original exigia de todos em 2023; § 10-A exigiu de todos em 2025 até a revogação
    // de 07/11/2025; depois, só atividades mistas.
    expect(efdUfRule(EFD_1601_BY_UF, 'SE', '2023-06-30')?.status).toBe('required');
    expect(efdUfRule(EFD_1601_BY_UF, 'SE', '2025-10-31')?.status).toBe('required');
    expect(efdUfRule(EFD_1601_BY_UF, 'SE', '2025-11-30')?.status).toBe('partial');
  });
});
