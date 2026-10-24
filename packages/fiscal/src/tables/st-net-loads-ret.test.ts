import { describe, expect, it } from 'vitest';
import {
  CE_INFORMATICS_LIST,
  ST_NET_LOAD_REGIMES,
  ceInformaticsListed,
  stNetLoadAmount,
  stNetLoadExit,
  stNetLoadExitMessage,
  stNetLoadFor,
  stNetLoadMessage,
  type StNetLoadInput,
} from './st-net-loads';

/**
 * F3-26.d.CE.d: RET, transferências, retenção da indústria e a lista de informática do Ceará.
 * Cada número foi conferido no texto consolidado do decreto (SefazLegis) ou no Diário Oficial.
 */

const regime = (act: string) => ST_NET_LOAD_REGIMES.find((r) => r.act === act)!;
const calc = (input: Partial<StNetLoadInput> & { buyerCnae: string; originUf: string }) =>
  stNetLoadFor({ uf: 'CE', date: '2026-10-23', goodsClass: 'rate-20', ...input });

describe('dados lidos dos decretos', () => {
  it('transferência: a forma e a margem de cada decreto', () => {
    expect(regime('Decreto 30.519/2011 (CE)').transfer).toEqual({
      basis: 'caput',
      interstateOnly: false,
      internalMva: '80',
      interstateMva: '80',
    });
    expect(regime('Decreto 34.256/2021 (CE)').transfer).toEqual({
      basis: 'document',
      interstateOnly: false,
      internalMva: '60',
      interstateMva: '100',
    });
    expect(regime('Decreto 36.617/2025 (CE)').transfer).toMatchObject({
      basis: 'document',
      interstateOnly: true,
      interstateMva: '49.08',
    });
    expect(regime('Decreto 31.270/2013 (CE)').transfer).toMatchObject({
      basis: 'caput',
      interstateOnly: true,
      interstateMva: '50',
    });
    expect(regime('Decreto 32.900/2018 (CE)').transfer.interstateMva).toBe('40');
    expect(regime('Decreto 31.066/2012 (CE)').transfer.internalMva).toBe('30');
  });

  it('RET: Anexo III nos quatro decretos que têm o artigo; tabela própria nos farmacêuticos', () => {
    expect(regime('Decreto 30.519/2011 (CE)').specialRegime).toEqual({
      kind: 'annex-iii',
      article: 'art. 4º',
      adjustable: false,
    });
    expect(regime('Decreto 31.066/2012 (CE)').specialRegime).toMatchObject({ article: 'art. 5º' });
    expect(regime('Decreto 31.270/2013 (CE)').specialRegime).toMatchObject({ adjustable: true });
    expect(regime('Decreto 32.900/2018 (CE)').specialRegime).toMatchObject({ adjustable: true });
    expect(regime('Decreto 34.256/2021 (CE)').specialRegime).toBeNull();
    const farma = regime('Decreto 36.617/2025 (CE)').specialRegime;
    expect(farma).toMatchObject({
      kind: 'own-table',
      entry: { 'n-ne-co-es': '1.37', 's-se-except-es': '2.16' },
      transfer: { 'n-ne-co-es': '1.49', 's-se-except-es': '2.38' },
      simplesAddition: { internal: '3', 'n-ne-co-es': '6', 's-se-except-es': '4' },
      distributionCenter: { 'n-ne-co-es': '1.00', 's-se-except-es': '1.33' },
      internalBetweenWholesalersDeferred: true,
      importedAt4Deferred: true,
    });
    if (farma?.kind !== 'own-table') throw new Error('farmacêuticos sem tabela própria');
    expect(farma.exits.map((t) => [t.channel, t.sale.map((r) => r.percent)])).toEqual([
      ['hospital', ['2.38', '3.56', '7.08']],
      ['pharma', ['3.20', '6.08', '9.30']],
      ['distribution-center', ['4.44', '8.42', '12.87']],
    ]);
    expect(farma.exits[0]).toMatchObject({
      validFrom: '2025-06-01',
      importAddition: '2.52',
      interstateImportAddition: '0.87',
    });
    expect(farma.exits[1]!.transfer!.map((r) => r.percent)).toEqual(['4.44', '8.42', '12.87']);
  });

  it('indústria (art. 2º): informática e construção com carga fixa; móveis pelo Anexo III', () => {
    expect(regime('Decreto 31.066/2012 (CE)').industry).toMatchObject({
      kind: 'fixed',
      validFrom: '2024-01-01',
      load: '4.11',
      unlistedLoad: '4.34',
      mva: '30',
      headOfficeWithoutMva: true,
    });
    expect(regime('Decreto 31.270/2013 (CE)').industry).toMatchObject({
      load: '7.64',
      mva: '45',
      referenceRate: '20',
      optional: { article: 'art. 2º-A', cnaes: ['2342702', '2349499'], load: '4.49' },
      simplesExcluded: true,
    });
    // Móveis (F3-26.d.CE.e): linha do Anexo I, coluna do próprio Estado; a redação original do
    // art. 2º dava 6,93%, a célula atacadista / 18% / próprio Estado da tabela de 2019.
    expect(regime('Decreto 32.900/2018 (CE)').industry).toMatchObject({
      kind: 'annex-iii',
      validFrom: '2024-01-01',
      mva: '40',
      referenceRate: '20',
      annexRow: { group: 'wholesale', origin: 'internal', formerLoad: '6.93' },
      simplesRecipientExcluded: true,
    });
    expect(regime('Decreto 30.519/2011 (CE)').industry).toBeNull();
  });
});

describe('transferência na entrada', () => {
  it('autopeças: a base do caput (sem margem) acrescida de 80%', () => {
    const r = calc({ buyerCnae: '2910701', originUf: 'SP', transfer: true });
    expect(r).toMatchObject({ status: 'applies', totalPercent: '21.00', mva: '80' });
    // R$ 10.000,00 × 1,80 = R$ 18.000,00; × 21% = R$ 3.780,00.
    expect(stNetLoadAmount({ documentCents: 1_000_000, mva: '80', loadPercent: '21.00' })).toEqual({
      baseCents: 1_800_000,
      stCents: 378_000,
    });
  });

  it('vestuário: 60% na interna e 100% na interestadual, no lugar dos 50%', () => {
    expect(calc({ buyerCnae: '4781400', originUf: 'CE', transfer: true })).toMatchObject({
      status: 'applies',
      totalPercent: '5.71',
      mva: '60',
    });
    expect(calc({ buyerCnae: '4781400', originUf: 'SP', transfer: true })).toMatchObject({
      mva: '100',
      totalPercent: '15.60',
    });
  });

  it('farmacêuticos: 49,08% só na transferência de outra UF', () => {
    const base = { buyerCnae: '4644301', cest: '1300100', transfer: true };
    expect(calc({ ...base, originUf: 'SP' })).toMatchObject({
      mva: '49.08',
      totalPercent: '20.70',
    });
    const interna = calc({ ...base, originUf: 'CE' });
    expect(interna).toMatchObject({ status: 'applies', mva: '33.05' });
    expect(interna.status === 'applies' && interna.warnings.join(' ')).toMatch(
      /só dá margem própria para a transferência vinda de outra UF/,
    );
  });

  it('caput com margem e "acrescida de X%": falta configurar (dúvida D-042)', () => {
    const info = calc({ buyerCnae: '4651601', originUf: 'SP', transfer: true });
    expect(info).toMatchObject({ status: 'missing', topic: 'transfer' });
    expect(stNetLoadMessage(info)).toMatch(/caput já tem margem de 30%/);
    expect(calc({ buyerCnae: '4741500', originUf: 'SP', transfer: true }).status).toBe('missing');
    // Construção e móveis só falam da transferência vinda de outra UF: a interna segue o caput.
    expect(calc({ buyerCnae: '4741500', originUf: 'CE', transfer: true })).toMatchObject({
      status: 'applies',
      mva: '35',
    });
  });
});

describe('RET na entrada', () => {
  it('atacadista do Anexo I: carga do Anexo III, com aviso sobre o termo', () => {
    const r = calc({ buyerCnae: '2910701', originUf: 'SP', specialRegime: true });
    expect(r).toMatchObject({ status: 'applies', totalPercent: '21.00' });
    expect(r.status === 'applies' && r.warnings.join(' ')).toMatch(
      /art\. 4º.*na entrada, na saída ou misto/,
    );
    const construcao = calc({ buyerCnae: '4649406', originUf: 'SP', specialRegime: true });
    expect(construcao.status === 'applies' && construcao.warnings.join(' ')).toMatch(
      /pode ajustar até a carga tributária efetiva/,
    );
  });

  it('varejista com RET: o regime do decreto é do atacadista, vale a carga do varejista', () => {
    const r = calc({ buyerCnae: '4751201', originUf: 'SP', specialRegime: true });
    expect(r).toMatchObject({ status: 'applies', totalPercent: '17.00' });
    expect(r.status === 'applies' && r.warnings.join(' ')).toMatch(/atacadista do Anexo I/);
  });

  it('farmacêuticos com RET: cargas do art. 6º sobre o documento, sem margem', () => {
    const base = { buyerCnae: '4644301', cest: '1300100', specialRegime: true };
    expect(calc({ ...base, originUf: 'SP' })).toMatchObject({
      status: 'applies',
      totalPercent: '2.16',
      mva: null,
    });
    expect(calc({ ...base, originUf: 'BA' })).toMatchObject({ totalPercent: '1.37' });
    expect(calc({ ...base, originUf: 'SP', supplierSimples: true })).toMatchObject({
      totalPercent: '6.16',
    });
    expect(calc({ ...base, originUf: 'SP', transfer: true })).toMatchObject({
      totalPercent: '2.38',
    });
    // Sem classe da mercadoria a carga do RET é a mesma: só a origem conta.
    expect(calc({ ...base, originUf: 'SP', goodsClass: null })).toMatchObject({
      totalPercent: '2.16',
    });
    const interna = calc({ ...base, originUf: 'CE' });
    expect(interna).toMatchObject({ status: 'missing', topic: 'special-regime' });
    expect(stNetLoadMessage(interna)).toMatch(/diferido para a saída \(art\. 11\)/);
    const importado = calc({ ...base, originUf: 'SP', importedAt4: true });
    expect(importado.status).toBe('deferred');
    expect(stNetLoadMessage(importado)).toMatch(/art\. 12/);
    expect(stNetLoadAmount({ documentCents: 1_000_000, mva: null, loadPercent: '2.16' })).toEqual({
      baseCents: 1_000_000,
      stCents: 21_600,
    });
    expect(calc({ ...base, originUf: 'SP', date: '2025-01-01' }).status).toBe('no-table');
    expect(calc({ ...base, originUf: 'ZZ' }).status).toBe('unknown-origin');
  });
});

describe('lista de produtos de informática (IN SEFAZ 148/2024 e IN 135/2025)', () => {
  it('versões com a data de efeitos de cada ato', () => {
    expect(CE_INFORMATICS_LIST.versions.map((v) => [v.validFrom, v.validTo])).toEqual([
      ['2026-02-12', null],
      ['2025-10-28', '2026-02-11'],
      ['2025-03-01', '2025-10-27'],
    ]);
  });

  it('a IN 20/2026 (DOE de 12/02/2026, achada pelo monitor) leva os alto-falantes a 180 watts', () => {
    const antes = ceInformaticsListed('85182200', '2026-02-11');
    const depois = ceInformaticsListed('85182200', '2026-02-12');
    expect(antes.status === 'listed' && antes.item.description).toMatch(/50 watts/);
    expect(depois.status === 'listed' && depois.item.description).toMatch(/180 watts/);
    expect(CE_INFORMATICS_LIST.versions[0]!.amendedBy).toBe('IN SEFAZ 20/2026');
  });

  it('posição e subposição abrangem as NCM abaixo; a exceção do item fica de fora', () => {
    expect(ceInformaticsListed('8471.30.12', '2026-10-23').status).toBe('listed');
    expect(ceInformaticsListed('85176299', '2026-10-23').status).toBe('listed');
    expect(ceInformaticsListed('85176273', '2026-10-23').status).toBe('not-listed');
    expect(ceInformaticsListed('85285900', '2026-10-23').status).toBe('listed');
    expect(ceInformaticsListed('84149040', '2026-10-23').status).toBe('listed');
    expect(ceInformaticsListed('61091000', '2026-10-23').status).toBe('not-listed');
  });

  it('a IN 135/2025 acrescenta os módulos de tela e muda a descrição dos alto-falantes', () => {
    expect(ceInformaticsListed('85249100', '2025-10-01').status).toBe('not-listed');
    expect(ceInformaticsListed('85249100', '2025-10-28').status).toBe('listed');
    const antes = ceInformaticsListed('85182100', '2025-10-01');
    const depois = ceInformaticsListed('85182100', '2025-11-01');
    expect(antes.status === 'listed' && antes.item.description).not.toMatch(/50 watts/);
    expect(depois.status === 'listed' && depois.item.description).toMatch(/50 watts/);
  });

  it('antes da IN 148/2024 ou sem NCM completa: desconhecido', () => {
    expect(ceInformaticsListed('84713012', '2024-12-31').status).toBe('unknown');
    expect(ceInformaticsListed('8471', '2026-10-23').status).toBe('unknown');
    expect(ceInformaticsListed(null, '2026-10-23').status).toBe('unknown');
  });

  it('confere a classe escolhida no produto com a lista, só como aviso', () => {
    const warnings = (goodsClass: string, ncm: string) => {
      const r = calc({ buyerCnae: '4651601', originUf: 'SP', goodsClass, ncm });
      return r.status === 'applies' ? r.warnings.join(' ') : r.status;
    };
    expect(warnings('rate-20', '84713012')).toMatch(/está na lista de produtos de informática/);
    expect(warnings('informatics', '61091000')).toMatch(/não está na lista/);
    expect(warnings('informatics', '84713012')).toBe('');
    // Fora da informática o decreto não tem a classe: nada a conferir.
    expect(calc({ buyerCnae: '4781400', originUf: 'SP', ncm: '84713012' })).toMatchObject({
      warnings: [],
    });
  });
});

describe('retenção na saída interna', () => {
  const exit = (over: Partial<Parameters<typeof stNetLoadExit>[0]> & { sellerCnae: string }) =>
    stNetLoadExit({
      uf: 'CE',
      destinationUf: 'CE',
      date: '2026-10-23',
      goodsClass: 'rate-20',
      operationCents: 1_000_000,
      ...over,
    });

  it('indústria de informática: 4,11% sobre o valor + 30%; 4,34% fora do ato do Secretário', () => {
    const listado = exit({ sellerCnae: '2621-3/00', goodsClass: 'informatics', ncm: '84713012' });
    expect(listado).toMatchObject({
      status: 'retains',
      option: { loadPercent: '4.11', mva: '30', baseCents: 1_300_000, stCents: 53_430 },
    });
    const fora = exit({ sellerCnae: '2621300', goodsClass: 'rate-20', ncm: '85176273' });
    expect(fora).toMatchObject({ option: { loadPercent: '4.34', stCents: 56_420 } });
    expect(stNetLoadExitMessage(fora!)).toMatch(
      /§ 4º.*base R\$ 13\.000,00 \(com margem de 30%\), carga 4,34%, ICMS retido R\$ 564,20/,
    );
    expect(stNetLoadExitMessage(listado!)).toMatch(/estabelecimento matriz/);
    // Sem a lista oficial na data, vale a classe escolhida no produto.
    const antiga = exit({ sellerCnae: '2621300', goodsClass: 'informatics', date: '2024-06-01' });
    expect(antiga).toMatchObject({ option: { loadPercent: '4.11' } });
    expect(antiga?.status === 'retains' && antiga.warnings.join(' ')).toMatch(/Sem a NCM na lista/);
  });

  it('antes da redação lida, para outro estado ou produto fora: nada calculado', () => {
    expect(exit({ sellerCnae: '2621300', date: '2023-06-01' })).toMatchObject({
      status: 'missing',
    });
    expect(exit({ sellerCnae: '2621300', destinationUf: 'PE' })).toBeNull();
    expect(exit({ sellerCnae: '2621300', goodsClass: 'outside' })).toBeNull();
    expect(exit({ sellerCnae: '4711302' })).toBeNull();
    expect(exit({ sellerCnae: null as unknown as string })).toBeNull();
    // Atacadista sem RET: a retenção é na entrada, não na saída.
    expect(exit({ sellerCnae: '4651601' })).toBeNull();
  });

  it('indústria de construção: 7,64% + 45% só para o produto de 20%', () => {
    expect(exit({ sellerCnae: '2342701' })).toMatchObject({
      option: { loadPercent: '7.64', mva: '45', baseCents: 1_450_000, stCents: 110_780 },
    });
    expect(exit({ sellerCnae: '2342701', sellerSimples: true })).toBeNull();
    const outra = exit({ sellerCnae: '2342701', goodsClass: 'rate-25' });
    expect(outra && stNetLoadExitMessage(outra)).toMatch(/ajuste proporcional/);
    const semClasse = exit({ sellerCnae: '2342701', goodsClass: null });
    expect(semClasse && stNetLoadExitMessage(semClasse)).toMatch(/escolha no produto a classe/);
    const ceramica = exit({ sellerCnae: '2342702' });
    expect(ceramica && stNetLoadExitMessage(ceramica)).toMatch(/art\. 2º-A \(4,49%\)/);
  });

  it('indústria de móveis: Anexo III, linha do Anexo I e próprio Estado (7,70% + 40%)', () => {
    const r = exit({ sellerCnae: '3101200' });
    // R$ 10.000,00 × 1,40 = R$ 14.000,00; × 7,70% = R$ 1.078,00.
    expect(r).toMatchObject({
      status: 'retains',
      option: { loadPercent: '7.70', mva: '40', baseCents: 1_400_000, stCents: 107_800 },
    });
    expect(r && stNetLoadExitMessage(r)).toMatch(/linha do Anexo I, próprio Estado/);
    expect(r && stNetLoadExitMessage(r)).toMatch(/Simples Nacional \(art\. 2º, § 2º, II\)/);
    const outra = exit({ sellerCnae: '3101200', goodsClass: 'basket-7' });
    expect(outra && stNetLoadExitMessage(outra)).toMatch(/ajuste proporcional.*não é 20%/);
    // Antes da redação de 2024 do § 5º, o Bipaê não tem a regra.
    expect(exit({ sellerCnae: '3101200', date: '2023-06-01' })).toMatchObject({
      status: 'missing',
    });
  });

  it('atacadista de farmacêuticos com RET: a carga de cada canal, sobre o valor da saída', () => {
    const base = { sellerCnae: '4644301', cest: '1300100', specialRegime: true };
    const r = exit(base);
    expect(r).toMatchObject({ status: 'channels' });
    expect(r?.status === 'channels' && r.options.map((o) => [o.loadPercent, o.stCents])).toEqual([
      ['7.08', 70_800],
      ['9.30', 93_000],
      ['12.87', 128_700],
    ]);
    expect(stNetLoadExitMessage(r!)).toMatch(
      /Canal Hospitalar \(art\. 8º\).*Canal Farma \(art\. 9º\)/,
    );
    const transf = exit({ ...base, transfer: true });
    expect(transf?.status === 'channels' && transf.options.map((o) => o.loadPercent)).toEqual([
      '12.87',
      '12.87',
      '12.87',
    ]);
    const semClasse = exit({ ...base, goodsClass: 'rate-25' });
    expect(semClasse && stNetLoadExitMessage(semClasse)).toMatch(/escolha no produto a classe/);
    expect(exit({ ...base, date: '2025-05-01' })).toMatchObject({ status: 'missing' });
    expect(exit({ ...base, specialRegime: false })).toBeNull();
  });
});
