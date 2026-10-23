import { describe, expect, it } from 'vitest';
import {
  ST_NET_LOAD_ORIGINS,
  ST_NET_LOAD_REGIMES,
  ST_NET_LOAD_UFS,
  NET_LOAD_OUTSIDE,
  isNetLoadGoodsClass,
  netLoadOriginOf,
  stNetLoadAmount,
  stNetLoadFor,
  stNetLoadMessage,
  stNetLoadOutputNote,
  stNetLoadRegimesFor,
  type StNetLoadInput,
} from './st-net-loads';

/**
 * F3-26.d.CE.b: ST com carga líquida no Ceará (Lei 14.237/2008). Cada valor esperado foi
 * conferido no texto consolidado do decreto no SefazLegis (Anexo III na redação indicada).
 */

const regime = (act: string) => ST_NET_LOAD_REGIMES.find((r) => r.act === act)!;

/** Só o percentual, ou a situação quando não se aplica. */
function load(input: Partial<StNetLoadInput> & { buyerCnae: string; originUf: string }) {
  const result = stNetLoadFor({ uf: 'CE', date: '2026-10-23', ...input });
  return result.status === 'applies' ? result.totalPercent : result.status;
}

describe('carga líquida no Ceará: a tabela gerada dos decretos', () => {
  it('seis decretos, todos do Ceará e pela CNAE principal', () => {
    expect(ST_NET_LOAD_UFS).toEqual(['CE']);
    expect(ST_NET_LOAD_REGIMES.map((r) => r.act)).toEqual([
      'Decreto 30.519/2011 (CE)',
      'Decreto 31.066/2012 (CE)',
      'Decreto 31.270/2013 (CE)',
      'Decreto 32.900/2018 (CE)',
      'Decreto 34.256/2021 (CE)',
      'Decreto 36.617/2025 (CE)',
    ]);
    for (const r of ST_NET_LOAD_REGIMES) {
      expect(r.cnaeBasis).toBe('principal');
      expect(r.url).toMatch(/^https:\/\/sefazlegis\.sefaz\.ce\.gov\.br\/api\/openFile\?id=/);
      for (const b of r.buyers) expect(b.cnae, r.act).toMatch(/^\d{7}$/);
      for (const v of r.versions) {
        for (const l of v.loads) {
          for (const p of Object.values(l.percents))
            expect(p, l.label).toMatch(/^\d{1,2}(\.\d{1,2})?$/);
        }
      }
    }
  });

  it('nenhuma CNAE está em dois decretos', () => {
    const all = ST_NET_LOAD_REGIMES.flatMap((r) => r.buyers.map((b) => b.cnae));
    expect(new Set(all).size).toBe(all.length);
  });

  it('as origens das colunas pelas regiões do IBGE', () => {
    expect(ST_NET_LOAD_ORIGINS.map((o) => o.key)).toEqual([
      'internal',
      'n-ne-co-es',
      's-se-except-es',
    ]);
    expect(netLoadOriginOf('CE')?.key).toBe('internal');
    expect(netLoadOriginOf('EX')?.key).toBe('internal');
    // "Regiões Norte, Nordeste, Centro Oeste e Estado do Espírito Santo": 20 UFs sem o Ceará.
    expect(ST_NET_LOAD_ORIGINS[1]!.ufs).toHaveLength(20);
    expect(netLoadOriginOf('ES')?.key).toBe('n-ne-co-es');
    expect(netLoadOriginOf('DF')?.key).toBe('n-ne-co-es');
    // "Regiões Sul e Sudeste, exceto o Estado do Espírito Santo".
    expect(ST_NET_LOAD_ORIGINS[2]!.ufs).toEqual(['MG', 'PR', 'RJ', 'RS', 'SC', 'SP']);
    expect(netLoadOriginOf('XX')).toBeNull();
  });
});

describe('autopeças (Decreto 30.519/2011)', () => {
  it('Anexo III do Decreto 35.807 (desde 01/01/2024): atacadista e varejista por origem', () => {
    // Varejo de peças novas (Anexo II), mercadoria a 20%: 8,00% / 19,71% / 21,00%.
    expect(load({ buyerCnae: '4530-7/03', originUf: 'CE', goodsClass: 'rate-20' })).toBe('8.00');
    expect(load({ buyerCnae: '4530703', originUf: 'PE', goodsClass: 'rate-20' })).toBe('19.71');
    expect(load({ buyerCnae: '4530703', originUf: 'SP', goodsClass: 'rate-20' })).toBe('21.00');
    // Atacado (Anexo I), cesta básica a 7%: 2,96% / 5,50% / 7,25%; varejo 1,54%.
    expect(load({ buyerCnae: '4530701', originUf: 'BA', goodsClass: 'basket-7' })).toBe('5.50');
    expect(load({ buyerCnae: '4530703', originUf: 'CE', goodsClass: 'basket-7' })).toBe('1.54');
    // 28%: 11,20% / 30,39% / 37,80%.
    expect(load({ buyerCnae: '4530701', originUf: 'RS', goodsClass: 'rate-28' })).toBe('37.80');
  });

  it('sem margem: a base é o valor da nota (art. 2º)', () => {
    expect(regime('Decreto 30.519/2011 (CE)').mva).toBeNull();
    const r = stNetLoadFor({
      uf: 'CE',
      buyerCnae: '4530703',
      originUf: 'SP',
      date: '2026-10-23',
      goodsClass: 'rate-20',
    });
    expect(r.status).toBe('applies');
    if (r.status !== 'applies') return;
    expect(
      stNetLoadAmount({ documentCents: 100_000, mva: r.mva, loadPercent: r.totalPercent }),
    ).toEqual({ baseCents: 100_000, stCents: 21_000 });
  });

  it('fornecedor do Simples: + 3% (interna), 6% (N/NE/CO e ES), 4% (Sul e Sudeste)', () => {
    const simples = { goodsClass: 'rate-20', supplierSimples: true };
    expect(load({ buyerCnae: '4530703', originUf: 'CE', ...simples })).toBe('11');
    expect(load({ buyerCnae: '4530703', originUf: 'PE', ...simples })).toBe('25.71');
    expect(load({ buyerCnae: '4530703', originUf: 'SP', ...simples })).toBe('25');
  });

  it('redação do Decreto 32.236 (01/04/2017 a 31/12/2023), com a linha de 18%', () => {
    const in2023 = { date: '2023-06-01', buyerCnae: '4530703' };
    expect(load({ ...in2023, originUf: 'SP', goodsClass: 'rate-18' })).toBe('18.20');
    expect(load({ ...in2023, originUf: 'CE', goodsClass: 'basket-7' })).toBe('1.40');
    // A linha de 20% só existe desde 2024: a empresa precisa escolher a classe certa.
    expect(load({ ...in2023, originUf: 'SP', goodsClass: 'rate-20' })).toBe('choose-class');
    // Antes da redação de 2017 (tabelas antigas, em outro formato), não há tabela no Bipaê.
    expect(
      load({ date: '2016-01-01', buyerCnae: '4530703', originUf: 'SP', goodsClass: 'rate-18' }),
    ).toBe('no-table');
  });

  it('o importado a 4% não tem acréscimo neste decreto: avisa em vez de supor', () => {
    const r = stNetLoadFor({
      uf: 'CE',
      buyerCnae: '4530703',
      originUf: 'SP',
      date: '2026-10-23',
      goodsClass: 'rate-20',
      importedAt4: true,
    });
    expect(r.status === 'applies' && r.totalPercent).toBe('21.00');
    expect(r.status === 'applies' && r.warnings[0]).toMatch(/importado a 4%/);
  });
});

describe('informática (Decreto 31.066/2012)', () => {
  it('produtos de informática: 4,11% / 5,33% / 5,33%, com margem de 30%', () => {
    expect(regime('Decreto 31.066/2012 (CE)').mva).toBe('30');
    expect(load({ buyerCnae: '4751201', originUf: 'CE', goodsClass: 'informatics' })).toBe('4.11');
    expect(load({ buyerCnae: '4751201', originUf: 'SP', goodsClass: 'informatics' })).toBe('5.33');
    // Varejista, 20%: 4,00% / 12,00% / 17,00%; atacadista: 7,70% / 15,70% / 20,70%.
    expect(load({ buyerCnae: '4751201', originUf: 'GO', goodsClass: 'rate-20' })).toBe('12.00');
    expect(load({ buyerCnae: '4651601', originUf: 'GO', goodsClass: 'rate-20' })).toBe('15.70');
    // Simples: + 1% / 2% / 3% (art. 3º, § 2º).
    expect(
      load({
        buyerCnae: '4751201',
        originUf: 'SP',
        goodsClass: 'informatics',
        supplierSimples: true,
      }),
    ).toBe('8.33');
    const { stCents, baseCents } = stNetLoadAmount({
      documentCents: 100_000,
      mva: '30',
      loadPercent: '5.33',
    });
    expect([baseCents, stCents]).toEqual([130_000, 6_929]);
  });

  it('a indústria do Anexo I fica no regime normal na entrada (linha "Normal")', () => {
    expect(load({ buyerCnae: '2621300', originUf: 'SP', goodsClass: 'informatics' })).toBe(
      'industry',
    );
    expect(regime('Decreto 31.066/2012 (CE)').versions[0]!.industryNormal).toBe(true);
  });

  it('redação do Decreto 32.262 (01/04/2017 a 31/12/2023): 3,70% / 4,80% / 4,80%', () => {
    expect(
      load({ date: '2020-01-01', buyerCnae: '4751201', originUf: 'CE', goodsClass: 'informatics' }),
    ).toBe('3.70');
  });
});

describe('material de construção (Decreto 31.270/2013)', () => {
  it('margem de 35% e 20%: 7,70% / 19,71% / 21%', () => {
    expect(regime('Decreto 31.270/2013 (CE)').mva).toBe('35');
    expect(load({ buyerCnae: '4744099', originUf: 'BA', goodsClass: 'rate-20' })).toBe('19.71');
    expect(load({ buyerCnae: '4744-0/99', originUf: 'CE', goodsClass: 'rate-20' })).toBe('7.70');
    // R$ 100,00 + 35% = R$ 135,00; × 19,71% = R$ 26,6085 → R$ 26,61.
    expect(stNetLoadAmount({ documentCents: 10_000, mva: '35', loadPercent: '19.71' })).toEqual({
      baseCents: 13_500,
      stCents: 2_661,
    });
  });

  it('importado a 4% de outra UF: + 3% (Sul e Sudeste) ou 8% (N/NE/CO e ES)', () => {
    const imported = { buyerCnae: '4744099', goodsClass: 'rate-20', importedAt4: true };
    expect(load({ ...imported, originUf: 'SP' })).toBe('24');
    expect(load({ ...imported, originUf: 'PE' })).toBe('27.71');
  });

  it('madeira (4671-1/00 e 4744-0/02) só desde 01/01/2018 (Decreto 32.411/2017)', () => {
    expect(
      load({ date: '2017-06-01', buyerCnae: '4671100', originUf: 'SP', goodsClass: 'rate-18' }),
    ).toBe('not-listed');
    expect(
      load({ date: '2018-06-01', buyerCnae: '4671100', originUf: 'SP', goodsClass: 'rate-18' }),
    ).toBe('18.20');
  });

  it('fabricação do Anexo I ("Indústria e Comércio Atacadista") não recolhe na entrada', () => {
    expect(load({ buyerCnae: '2342701', originUf: 'SP', goodsClass: 'rate-20' })).toBe('industry');
  });
});

describe('móveis e eletro (Decreto 32.900/2018)', () => {
  it('margem de 40%; varejista a 20%: 5,71% / 12,46% / 15,88%', () => {
    expect(regime('Decreto 32.900/2018 (CE)').mva).toBe('40');
    expect(load({ buyerCnae: '4754701', originUf: 'SP', goodsClass: 'rate-20' })).toBe('15.88');
    expect(load({ buyerCnae: '4753900', originUf: 'CE', goodsClass: 'rate-20' })).toBe('5.71');
    expect(load({ buyerCnae: '4649404', originUf: 'PB', goodsClass: 'rate-20' })).toBe('19.71');
  });

  it('redação do Decreto 32.984 (01/01/2019 a 31/12/2023): varejista a 18%, 13,59% do Sul', () => {
    expect(
      load({ date: '2021-01-01', buyerCnae: '4754701', originUf: 'SP', goodsClass: 'rate-18' }),
    ).toBe('13.59');
  });

  it('colchões (3104-7/00) entram em 01/03/2019, como indústria', () => {
    const colchoes = regime('Decreto 32.900/2018 (CE)').buyers.find((b) => b.cnae === '3104700');
    expect(colchoes).toMatchObject({ validFrom: '2019-03-01', group: 'industry' });
  });
});

describe('vestuário (Decreto 34.256/2021)', () => {
  it('Anexo III do Decreto 35.957 (efeitos desde 01/01/2024) no lugar do 35.807', () => {
    const current = regime('Decreto 34.256/2021 (CE)').versions[0]!;
    expect(current).toMatchObject({ validFrom: '2024-01-01', amendedBy: 'Decreto 35.957' });
    // Varejista a 20%: 5,71% / 12,00% / 15,60% (o 35.807 dizia 13,71% e 18,71%).
    expect(load({ buyerCnae: '4781400', originUf: 'MG', goodsClass: 'rate-20' })).toBe('15.60');
    expect(load({ buyerCnae: '4781400', originUf: 'RN', goodsClass: 'rate-20' })).toBe('12.00');
    // Atacadista a 20%: 7,70% / 18,54% / 20,44%.
    expect(load({ buyerCnae: '4642701', originUf: 'RN', goodsClass: 'rate-20' })).toBe('18.54');
    expect(regime('Decreto 34.256/2021 (CE)').mva).toBe('50');
  });

  it('redação do Decreto 34.486 (01/10/2021 a 31/12/2023): varejista a 18%, 13,60%', () => {
    expect(
      load({ date: '2022-05-01', buyerCnae: '4781400', originUf: 'SP', goodsClass: 'rate-18' }),
    ).toBe('13.60');
  });
});

describe('comprador do Simples e expressão da nota de saída (F3-26.d.CE.c)', () => {
  it('vestuário não se aplica ao comprador do Simples (art. 3º)', () => {
    expect(regime('Decreto 34.256/2021 (CE)').simplesBuyer).toEqual({
      rule: 'excluded',
      mva: null,
    });
    expect(
      load({ buyerCnae: '4781400', originUf: 'SP', goodsClass: 'rate-20', buyerSimples: true }),
    ).toBe('simples-excluded');
  });

  it('móveis: margem de 27% para o comprador do Simples (art. 3º, § 8º)', () => {
    expect(regime('Decreto 32.900/2018 (CE)').simplesBuyer).toEqual({ rule: 'mva', mva: '27' });
    const r = stNetLoadFor({
      uf: 'CE',
      buyerCnae: '4754701',
      originUf: 'SP',
      date: '2026-10-23',
      goodsClass: 'rate-20',
      buyerSimples: true,
    });
    expect(r.status === 'applies' && r.mva).toBe('27');
    expect(r.status === 'applies' && r.warnings.join(' ')).toMatch(/margem de 27%/);
    // Os outros decretos não têm regra própria: a margem do artigo do cálculo.
    expect(regime('Decreto 31.270/2013 (CE)').simplesBuyer).toBeNull();
    expect(
      load({ buyerCnae: '4744099', originUf: 'BA', goodsClass: 'rate-20', buyerSimples: true }),
    ).toBe('19.71');
  });

  it('cada decreto traz a expressão "ICMS retido por substituição tributária" com o número', () => {
    for (const r of ST_NET_LOAD_REGIMES) {
      const number = /Decreto ([\d.]+\/\d{4})/.exec(r.act)![1];
      expect(r.outputNote).toBe(`ICMS retido por substituição tributária - Decreto nº ${number}`);
    }
  });

  it('a expressão só na saída interna, do comprador do regime, com o produto nele', () => {
    const base = {
      uf: 'CE',
      sellerCnae: '4781400',
      destinationUf: 'CE',
      date: '2026-10-23',
      goodsClass: 'rate-20',
    };
    expect(stNetLoadOutputNote(base)?.note).toMatch(/Decreto nº 34\.256\/2021$/);
    // Sem classe, a empresa não confirmou que o produto está no regime: sem expressão. Uma classe
    // que não é a da tabela do vendedor ainda põe o produto no regime (a expressão não depende dela).
    expect(stNetLoadOutputNote({ ...base, goodsClass: null })).toBeNull();
    expect(stNetLoadOutputNote({ ...base, goodsClass: 'qualquer' })?.regime.act).toBe(
      'Decreto 34.256/2021 (CE)',
    );
    expect(stNetLoadOutputNote({ ...base, destinationUf: 'PE' })).toBeNull();
    expect(stNetLoadOutputNote({ ...base, goodsClass: NET_LOAD_OUTSIDE })).toBeNull();
    expect(stNetLoadOutputNote({ ...base, sellerCnae: null })).toBeNull();
    expect(stNetLoadOutputNote({ ...base, sellerSimples: true })).toBeNull();
  });
});

describe('farmacêuticos (Decreto 36.617/2025)', () => {
  const farma = { buyerCnae: '4771701', cest: '1300100' };

  it('CEST do segmento 13, margem de 33,05%, tabela do Decreto 36.734 (desde 01/06/2025)', () => {
    const r = regime('Decreto 36.617/2025 (CE)');
    expect(r).toMatchObject({ cestSegments: ['13'], mva: '33.05' });
    expect(r.buyers.map((b) => b.cnae)).toEqual(['4644301', '4771701', '4771703']);
    // 20%: 7,70% / 15,70% / 20,70%; cesta a 7%: 2,96% / 5,50% / 7,25%.
    expect(load({ ...farma, originUf: 'SP', goodsClass: 'rate-20' })).toBe('20.70');
    expect(load({ ...farma, originUf: 'CE', goodsClass: 'rate-20' })).toBe('7.70');
    expect(load({ ...farma, originUf: 'PE', goodsClass: 'basket-7' })).toBe('5.50');
    // Álcool em gel antisséptico até 1 L: 2,82% / 10,05% / 12,83%.
    expect(load({ ...farma, originUf: 'SP', goodsClass: 'alcohol-gel-antiseptic' })).toBe('12.83');
  });

  it('fora do segmento 13 do CEST, ou antes de 01/06/2025, não se aplica', () => {
    expect(
      load({ buyerCnae: '4771701', cest: '2003900', originUf: 'SP', goodsClass: 'rate-20' }),
    ).toBe('product-out');
    expect(load({ buyerCnae: '4771701', originUf: 'SP', goodsClass: 'rate-20' })).toBe(
      'product-out',
    );
    expect(load({ ...farma, date: '2025-05-31', originUf: 'SP', goodsClass: 'rate-20' })).toBe(
      'no-table',
    );
  });

  it('base com a margem: R$ 100,00 × 1,3305 × 20,70%', () => {
    expect(stNetLoadAmount({ documentCents: 10_000, mva: '33.05', loadPercent: '20.70' })).toEqual({
      baseCents: 13_305,
      stCents: 2_754,
    });
  });
});

describe('o que não se aplica volta como situação, nunca como suposição (D-042)', () => {
  it('CNAE fora dos anexos', () => {
    expect(load({ buyerCnae: '4711302', originUf: 'SP', goodsClass: 'rate-20' })).toBe(
      'not-listed',
    );
  });

  it('classe da mercadoria não escolhida: devolve as linhas da tabela do comprador', () => {
    const r = stNetLoadFor({ uf: 'CE', buyerCnae: '4781400', originUf: 'SP', date: '2026-10-23' });
    expect(r.status).toBe('choose-class');
    if (r.status !== 'choose-class') return;
    expect(r.classes.map((c) => c.goodsClass)).toEqual([
      'basket-7',
      'alcohol-gel-antiseptic',
      'basket-12',
      'rate-20',
      'rate-25',
      'rate-28',
    ]);
  });

  it('origem desconhecida', () => {
    expect(load({ buyerCnae: '4781400', originUf: 'ZZ', goodsClass: 'rate-20' })).toBe(
      'unknown-origin',
    );
  });

  it('classes válidas para o cadastro do produto', () => {
    expect(isNetLoadGoodsClass('rate-20')).toBe(true);
    expect(isNetLoadGoodsClass('informatics')).toBe(true);
    expect(isNetLoadGoodsClass(NET_LOAD_OUTSIDE)).toBe(true);
    expect(isNetLoadGoodsClass('rate-99')).toBe(false);
  });

  it('produto marcado como fora do regime pela empresa', () => {
    expect(load({ buyerCnae: '4781400', originUf: 'SP', goodsClass: NET_LOAD_OUTSIDE })).toBe(
      'product-out',
    );
  });

  it('RET no vestuário: o decreto não traz carga própria, falta configurar', () => {
    const base = { uf: 'CE', buyerCnae: '4781400', originUf: 'SP', date: '2026-10-23' };
    const ret = stNetLoadFor({ ...base, goodsClass: 'rate-20', specialRegime: true });
    expect(ret).toMatchObject({ status: 'missing', topic: 'special-regime' });
    expect(stNetLoadMessage(ret)).toMatch(/Regime Especial de Tributação/);
  });

  it('cada situação tem mensagem em português', () => {
    const cases: StNetLoadInput[] = [
      { uf: 'CE', buyerCnae: '4781400', originUf: 'SP', date: '2026-10-23', goodsClass: 'rate-20' },
      { uf: 'CE', buyerCnae: '4711302', originUf: 'SP', date: '2026-10-23' },
      { uf: 'CE', buyerCnae: '2621300', originUf: 'SP', date: '2026-10-23' },
      { uf: 'CE', buyerCnae: '4771701', originUf: 'SP', date: '2026-10-23', cest: '2003900' },
      { uf: 'CE', buyerCnae: '4781400', originUf: 'SP', date: '2016-01-01', goodsClass: 'rate-18' },
      { uf: 'CE', buyerCnae: '4781400', originUf: 'ZZ', date: '2026-10-23', goodsClass: 'rate-20' },
      { uf: 'CE', buyerCnae: '4781400', originUf: 'SP', date: '2026-10-23' },
      { uf: 'CE', buyerCnae: '4781400', originUf: 'SP', date: '2026-10-23', buyerSimples: true },
    ];
    const messages = cases.map((c) => stNetLoadMessage(stNetLoadFor(c)));
    expect(messages[0]).toBe('Carga líquida de 15,60% (Decreto 34.256/2021 (CE), 20%).');
    expect(messages[1]).toMatch(/vale a ST comum/);
    expect(messages[2]).toMatch(/retenção nas saídas internas \(art\. 2º\) aparece na nota/);
    expect(messages[3]).toMatch(/fora do Decreto 36\.617/);
    expect(messages[4]).toMatch(/não tem a tabela/);
    expect(messages[5]).toMatch(/Origem do fornecedor/);
    expect(messages[6]).toMatch(/escolha no produto a classe/);
    expect(messages[7]).toMatch(/não se aplica a empresas do Simples/);
    expect(stNetLoadMessage({ status: 'ambiguous', regimes: [ST_NET_LOAD_REGIMES[0]!] })).toMatch(
      /mais de um decreto/,
    );
  });

  it('regimes que podem alcançar o produto na data', () => {
    const ids = (cests: string[]) =>
      stNetLoadRegimesFor('CE', '2026-10-23', cests).map((r) => r.regime.act);
    expect(ids([])).toHaveLength(5);
    expect(ids(['1300100'])).toContain('Decreto 36.617/2025 (CE)');
    expect(stNetLoadRegimesFor('SP', '2026-10-23', [])).toEqual([]);
  });
});
