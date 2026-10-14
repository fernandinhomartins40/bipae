import { describe, expect, it } from 'vitest';
import { COMPANY_REGIMES, type CompanyRegime } from './regimes';
import {
  calculateSaleItemTaxes,
  saleTaxSummaries,
  sameTaxSummary,
  summarizeSaleItemTaxes,
  type SaleFiscalProfile,
} from './sale';
import { ICMS_GENERAL_RATES, UFS } from './tables/icms-uf';

const HOJE = '2026-06-15';
const CEM_REAIS = { operationCents: 10_000 };

// Perfis de revenda comuns: um para quem usa CSOSN e outro para quem usa CST.
const REVENDA: SaleFiscalProfile = {
  cfopInterna: '5102',
  cfopInterestadual: '6102',
  csosn: '102',
  cstIcms: '00',
  cstPisCofins: '01',
  cClassTrib: '000001',
};

const venda = (regime: CompanyRegime | null, uf: string | null, extra: Partial<Parameters<typeof calculateSaleItemTaxes>[0]> = {}) =>
  calculateSaleItemTaxes({ company: { uf, regime }, profile: REVENDA, item: CEM_REAIS, date: HOJE, ...extra });

describe('impostos do item de venda, por regime (empresa de SP)', () => {
  it('MEI: CRT 4, CSOSN sem destaque, PIS e COFINS no DAS', () => {
    const r = venda('mei', 'SP');
    expect(r).toMatchObject({ crt: 4, cfop: '5102', complete: true, pending: [] });
    expect(r.icms).toMatchObject({ status: 'calculado', result: { csosn: '102', amountCents: 0 } });
    expect(r.pis).toMatchObject({ status: 'nao-se-aplica' });
    expect(r.cofins.status).toBe('nao-se-aplica');
    // IBS/CBS de teste em 2026 sobre o valor cheio: não há ICMS destacado para tirar da base.
    expect(r.ibsCbs).toMatchObject({ status: 'calculado', result: { baseCents: 10_000, cbsAmountCents: 90, ibsAmountCents: 10 } });
  });

  it('Simples Nacional: CRT 1, igual ao MEI no cálculo', () => {
    const r = venda('simples', 'SP');
    expect(r).toMatchObject({ crt: 1, complete: true });
    expect(r.icms).toMatchObject({ status: 'calculado', result: { group: 'ICMSSN102' } });
  });

  it('Simples acima do sublimite: CRT 2, ICMS por CST com a alíquota da UF, PIS e COFINS no DAS', () => {
    const r = venda('simples-excesso', 'SP');
    expect(r).toMatchObject({ crt: 2, complete: true });
    expect(r.icms).toMatchObject({ status: 'calculado', result: { cst: '00', rate: '18.00', amountCents: 1800 } });
    expect(r.pis.status).toBe('nao-se-aplica');
    // Só o ICMS sai da base do IBS/CBS: 100,00 − 18,00.
    expect(r.ibsCbs).toMatchObject({ status: 'calculado', result: { baseCents: 8200 } });
  });

  it('Lucro Presumido: CRT 3, PIS 0,65% e COFINS 3% sobre o valor cheio', () => {
    const r = venda('presumido', 'SP');
    expect(r).toMatchObject({ crt: 3, complete: true });
    expect(r.icms).toMatchObject({ status: 'calculado', result: { amountCents: 1800 } });
    expect(r.pis).toMatchObject({ status: 'calculado', result: { baseCents: 10_000, amountCents: 65 } });
    expect(r.cofins).toMatchObject({ status: 'calculado', result: { amountCents: 300 } });
    // 100,00 − 18,00 − 0,65 − 3,00 = 78,35
    expect(r.ibsCbs).toMatchObject({ status: 'calculado', result: { baseCents: 7835 } });
    expect(r.assumptions.join(' ')).toContain('dúvida D-019');
  });

  it('Lucro Real: PIS 1,65% e COFINS 7,6% sem o ICMS na base', () => {
    const r = venda('real', 'SP');
    expect(r).toMatchObject({ crt: 3, complete: true });
    expect(r.pis).toMatchObject({ status: 'calculado', result: { baseCents: 8200, amountCents: 135 } });
    expect(r.cofins).toMatchObject({ status: 'calculado', result: { baseCents: 8200, amountCents: 623 } });
    expect(r.assumptions.join(' ')).not.toContain('D-019');
  });

  it('avisa que usou a alíquota geral da UF', () => {
    expect(venda('real', 'SP').assumptions[0]).toBe(
      'ICMS pela alíquota geral de SP (18%). Produto com alíquota própria precisa de regra específica.',
    );
    // No Simples com CSOSN 102 a alíquota não entra na conta, então não há o que avisar.
    expect(venda('simples', 'SP').assumptions).toEqual([]);
    expect(venda('real', 'BA').icms).toMatchObject({ status: 'calculado', result: { rate: '20.50', amountCents: 2050 } });
  });
});

describe('o que falta configurar aparece com todas as letras', () => {
  it('empresa sem UF ou sem regime', () => {
    for (const r of [venda(null, 'SP'), venda('simples', null)]) {
      expect(r).toMatchObject({ crt: r.crt, cfop: null, complete: false });
      expect(r.pending).toEqual(['Informe a UF e o regime tributário da empresa em Empresas e lojas.']);
      expect(r.icms.status).toBe('falta-configurar');
      expect(r.ibsCbs.status).toBe('falta-configurar');
    }
  });

  it('produto sem perfil fiscal', () => {
    const r = venda('simples', 'SP', { profile: null });
    expect(r.pending).toEqual(['O produto não tem perfil fiscal. Escolha um no cadastro do produto.']);
    expect(r.crt).toBe(1);
  });

  it('perfil sem o código que o regime exige', () => {
    const semCsosn = venda('simples', 'SP', { profile: { ...REVENDA, csosn: null } });
    expect(semCsosn.icms).toEqual({
      status: 'falta-configurar',
      reason: 'O perfil fiscal não tem CSOSN, exigido no regime Simples Nacional.',
    });
    const semCst = venda('real', 'SP', { profile: { ...REVENDA, cstIcms: null } });
    expect(semCst.icms).toMatchObject({ reason: 'O perfil fiscal não tem CST do ICMS, exigido no regime Lucro Real.' });
    // Sem ICMS calculado, o PIS/COFINS e o IBS/CBS seguem com o que dá para calcular.
    expect(semCst.pis.status).toBe('calculado');
    expect(semCst.complete).toBe(false);
  });

  it('perfil sem CST de PIS/COFINS ou sem cClassTrib', () => {
    const r = venda('real', 'SP', { profile: { ...REVENDA, cstPisCofins: null, cClassTrib: null } });
    expect(r.pis).toMatchObject({ status: 'falta-configurar', reason: 'O perfil fiscal não tem o CST do PIS e da COFINS.' });
    expect(r.ibsCbs).toMatchObject({ status: 'falta-configurar' });
    expect(r.pending).toHaveLength(2);
    // No Simples o CST de PIS/COFINS não faz falta para o cálculo.
    expect(venda('simples', 'SP', { profile: { ...REVENDA, cstPisCofins: null } }).complete).toBe(true);
  });

  it('UF sem alíquota confirmada: pede a alíquota ao contador, sem número suposto', () => {
    const r = venda('real', 'AL');
    expect(r.icms).toEqual({
      status: 'falta-configurar',
      reason: 'A alíquota geral de ICMS de AL ainda não foi confirmada em fonte oficial. Peça a alíquota ao contador.',
    });
    expect(r.complete).toBe(false);
    // Com a alíquota informada pela empresa, o cálculo sai.
    const comRegra = venda('real', 'AL', { settings: { icms: { rate: '19' } } });
    expect(comRegra.icms).toMatchObject({ status: 'calculado', result: { amountCents: 1900 } });
    expect(comRegra.assumptions.join(' ')).not.toContain('alíquota geral');
  });

  it('situação que precisa de mais dados ou que o motor ainda não calcula', () => {
    const st = venda('real', 'SP', { profile: { ...REVENDA, cstIcms: '10' } });
    expect(st.icms).toMatchObject({ status: 'falta-configurar' });
    expect(st.pending[0]).toContain('substituição tributária');
    const comMva = venda('real', 'SP', {
      profile: { ...REVENDA, cstIcms: '10' },
      settings: { icms: { st: { mva: '40', rate: '18' } } },
    });
    expect(comMva.icms).toMatchObject({ status: 'calculado', result: { st: { amountCents: 720 } } });

    const outras = venda('real', 'SP', { profile: { ...REVENDA, cstIcms: '90' } });
    expect(outras.icms.status).toBe('nao-disponivel');
    expect(outras.complete).toBe(false);
  });

  it('em 2027: PIS e COFINS deixam de existir e a CBS sem alíquota publicada bloqueia', () => {
    const r = venda('real', 'SP', { date: '2027-03-01' });
    expect(r.pis).toMatchObject({ status: 'nao-se-aplica', reason: 'PIS extinto a partir de 2027 (EC 132/2023).' });
    expect(r.ibsCbs.status).toBe('falta-configurar');
    expect(r.pending[0]).toContain('A alíquota da CBS para 2027 ainda não está na tabela');
  });
});

describe('venda para outra UF', () => {
  it('usa o CFOP e a alíquota interestaduais', () => {
    const paraBahia = venda('real', 'SP', { item: { operationCents: 10_000, ufDestino: 'BA' } });
    expect(paraBahia.cfop).toBe('6102');
    expect(paraBahia.icms).toMatchObject({ status: 'calculado', result: { rate: '7.00', amountCents: 700 } });
    const paraRio = venda('real', 'SP', { item: { operationCents: 10_000, ufDestino: 'RJ' } });
    expect(paraRio.icms).toMatchObject({ result: { rate: '12.00' } });
    const importado = venda('real', 'SP', { item: { operationCents: 10_000, ufDestino: 'RJ', imported: true } });
    expect(importado.icms).toMatchObject({ result: { rate: '4.00' } });
    // A alíquota interestadual não depende de a UF de origem ter a alíquota interna confirmada.
    expect(venda('real', 'AL', { item: { operationCents: 10_000, ufDestino: 'SP' } }).icms.status).toBe('calculado');
  });
});

describe('matriz de cobertura: 27 UFs × 5 regimes (F3-23)', () => {
  it('nenhuma combinação fica sem resposta: ou calcula, ou diz exatamente o que falta', () => {
    let combinacoes = 0;
    for (const uf of UFS) {
      const confirmada = ICMS_GENERAL_RATES.find((i) => i.uf === uf)!.status === 'confirmado';
      for (const regime of COMPANY_REGIMES) {
        combinacoes++;
        const r = venda(regime.id, uf);
        const caso = `${uf} × ${regime.id}`;
        expect(r.crt, caso).toBe(regime.crt);
        expect(r.cfop, caso).toBe('5102');
        // Quem usa CSOSN 102 não depende da alíquota da UF; quem usa CST 00, depende.
        const dependeDaAliquota = regime.icmsCode === 'cst';
        if (confirmada || !dependeDaAliquota) {
          expect(r.complete, caso).toBe(true);
          expect(r.icms.status, caso).toBe('calculado');
          expect(r.ibsCbs.status, caso).toBe('calculado');
        } else {
          expect(r.complete, caso).toBe(false);
          expect(r.pending, caso).toEqual([
            `A alíquota geral de ICMS de ${uf} ainda não foi confirmada em fonte oficial. Peça a alíquota ao contador.`,
          ]);
        }
        expect(r.pis.status, caso).toBe(regime.pisCofins === 'das' ? 'nao-se-aplica' : 'calculado');
      }
    }
    expect(combinacoes).toBe(135);
  });

  it('o retrato de hoje: 129 combinações completas e 6 esperando a alíquota da UF', () => {
    const completas = UFS.flatMap((uf) => COMPANY_REGIMES.map((regime) => venda(regime.id, uf).complete)).filter(Boolean);
    // 25 UFs × 5 regimes + 2 UFs pendentes × 2 regimes que não dependem da alíquota (MEI e Simples).
    expect(completas).toHaveLength(129);
  });
});

describe('resumo dos impostos do item', () => {
  it('leva os valores calculados e deixa nulo o que não tem destaque', () => {
    const real = summarizeSaleItemTaxes(venda('real', 'SP'));
    expect(real).toEqual({
      crt: 3,
      cfop: '5102',
      icmsCents: 1800,
      icmsStCents: null,
      fcpCents: null,
      pisCents: 135,
      cofinsCents: 623,
      // Base do IBS/CBS: 100,00 − 18,00 − 1,35 − 6,23 = 74,42.
      ibsCents: 7,
      cbsCents: 67,
      complete: true,
      pending: [],
    });
    // No Simples o PIS e a COFINS não vão na nota: nulos, e isso não é pendência.
    expect(summarizeSaleItemTaxes(venda('simples', 'SP'))).toMatchObject({
      crt: 1,
      icmsCents: 0,
      pisCents: null,
      cofinsCents: null,
      complete: true,
    });
  });

  it('leva o ICMS-ST e o FCP quando existem', () => {
    const r = summarizeSaleItemTaxes(
      venda('real', 'SP', {
        profile: { ...REVENDA, cstIcms: '10' },
        settings: { icms: { st: { mva: '40', rate: '18' }, fcpRate: '2' } },
      }),
    );
    expect(r).toMatchObject({ icmsCents: 1800, icmsStCents: 720, fcpCents: 200 });
  });

  it('o que falta configurar vira valor nulo, com o motivo', () => {
    const r = summarizeSaleItemTaxes(venda('real', 'AL'));
    expect(r.icmsCents).toBeNull();
    expect(r.complete).toBe(false);
    expect(r.pending[0]).toContain('AL ainda não foi confirmada');
  });

  it('compara dois resumos pelos números, não pelas mensagens', () => {
    const a = summarizeSaleItemTaxes(venda('real', 'SP'));
    expect(sameTaxSummary(a, { ...a, pending: ['outro texto'] })).toBe(true);
    expect(sameTaxSummary(a, { ...a, icmsCents: 1700 })).toBe(false);
    expect(sameTaxSummary(a, { ...a, cfop: '5405' })).toBe(false);
    expect(sameTaxSummary(a, summarizeSaleItemTaxes(venda('presumido', 'SP')))).toBe(false);
  });
});

describe('impostos de todos os itens da venda', () => {
  it('empresa que não informou UF nem regime: sem resumo, em vez de aviso em todo item', () => {
    expect(
      saleTaxSummaries({
        company: { uf: null, taxRegime: null },
        items: [{ operationCents: 1000, profile: REVENDA }],
        date: HOJE,
      }),
    ).toBeNull();
  });

  it('um resumo por item, na mesma ordem', () => {
    const r = saleTaxSummaries({
      company: { uf: 'SP', taxRegime: 'real' },
      items: [
        { operationCents: 10_000, profile: REVENDA },
        { operationCents: 5000, profile: null },
      ],
      date: HOJE,
    })!;
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ icmsCents: 1800, complete: true });
    expect(r[1]).toMatchObject({ icmsCents: null, complete: false });
    expect(r[1]!.pending).toEqual(['O produto não tem perfil fiscal. Escolha um no cadastro do produto.']);
  });

  it('só a UF, ou regime que o motor não conhece: pede para completar o cadastro', () => {
    for (const company of [
      { uf: 'SP', taxRegime: null },
      { uf: null, taxRegime: 'simples' },
      { uf: 'SP', taxRegime: 'regime-inexistente' },
    ]) {
      const [r] = saleTaxSummaries({ company, items: [{ operationCents: 1000, profile: REVENDA }], date: HOJE })!;
      expect(r!.complete).toBe(false);
      expect(r!.pending).toEqual(['Informe a UF e o regime tributário da empresa em Empresas e lojas.']);
    }
  });
});

describe('MEI no caixa (F3-30)', () => {
  it('perfil com CSOSN ou CFOP fora das regras do MEI vira "falta configurar" com a explicação', () => {
    const st = calculateSaleItemTaxes({
      company: { uf: 'SP', regime: 'mei' },
      profile: { ...REVENDA, csosn: '500', cfopInterna: '5405' },
      item: CEM_REAIS,
      date: HOJE,
    });
    expect(st.icms).toMatchObject({ status: 'falta-configurar' });
    expect(st.pending[0]).toContain('O MEI só usa o CSOSN 102, 300 na NFC-e');
    const cfop = calculateSaleItemTaxes({
      company: { uf: 'SP', regime: 'mei' },
      profile: { ...REVENDA, cfopInterna: '5405' },
      item: CEM_REAIS,
      date: HOJE,
    });
    expect(cfop.pending[0]).toContain('só usa o CFOP 5102');
  });
});
