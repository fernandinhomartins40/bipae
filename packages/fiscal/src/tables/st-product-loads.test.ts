import { describe, expect, it } from 'vitest';
import { isNetLoadGoodsClass } from './st-net-loads';
import {
  MA_CATTLE,
  MA_MEAT,
  productLoadVersionOn,
  ST_PRODUCT_LOAD_REGIMES,
  stProductLoadExit,
  stProductLoadExitMessage,
  stProductLoadFor,
  stProductLoadMessage,
  stProductLoadOutputNote,
  stProductLoadRegimeOf,
} from './st-product-loads';

/** F3-26.d.MA.d: carnes do Maranhão por carga fixa (Anexo 4.4 do RICMS/MA). */

const DIA = '2026-10-24';
const compra = (over: Partial<Parameters<typeof stProductLoadFor>[0]> = {}) =>
  stProductLoadFor({
    uf: 'MA',
    originUf: 'PA',
    date: DIA,
    goodsClass: MA_MEAT,
    ncm: '02013000',
    ...over,
  });

describe('tabela gerada do Anexo 4.4', () => {
  it('margem de 25% e cargas de 3%, 1% e 0,75% lidas do texto em vigor e dos decretos de 2025', () => {
    const ma = stProductLoadRegimeOf('ma')!;
    expect(ma).toMatchObject({
      act: 'RICMS/MA, Anexo 4.4',
      source: 'stMaAnexo4_4',
      mva: '25',
      outputNote: 'ICMS retido por substituição tributária',
      accreditation: { act: 'Portaria 178/2025-GABIN', validFrom: '2025-05-23' },
    });
    expect(ma.versions).toEqual([
      expect.objectContaining({
        validFrom: '2025-03-18',
        interstateEntry: '3',
        interstateExitAccredited: '1',
        internalAccredited: '0.75',
      }),
    ]);
    expect(ma.classes.map((c) => c.goodsClass)).toEqual([MA_CATTLE, MA_MEAT]);
    // Para perguntar a classe: bovinos vivos e os NCM dos CEST 17.083.00 e 17.084.00.
    expect(ma.askNcm).toEqual(expect.arrayContaining(['0102', '0201', '0202', '0206']));
    expect(productLoadVersionOn(ma, '2025-03-17')).toBeNull();
    expect(stProductLoadRegimeOf('CE')).toBeNull();
    expect(stProductLoadRegimeOf(null)).toBeNull();
    expect(ST_PRODUCT_LOAD_REGIMES.map((r) => r.uf)).toEqual(['MA']);
  });

  it('as classes do anexo são aceitas no cadastro do produto', () => {
    expect(isNetLoadGoodsClass(MA_MEAT)).toBe(true);
    expect(isNetLoadGoodsClass(MA_CATTLE)).toBe(true);
    expect(isNetLoadGoodsClass('ma-frango')).toBe(false);
  });
});

describe('compra de carne no Maranhão', () => {
  it('entrada interestadual de carne: 3% sobre o valor + 25%, para qualquer comprador', () => {
    const r = compra();
    expect(r).toMatchObject({
      status: 'applies',
      loadPercent: '3',
      mva: '25',
      includeCharges: false,
    });
    expect(stProductLoadMessage(r)).toBe(
      'Carga de 3% sobre o valor mais 25% (RICMS/MA, Anexo 4.4, Produtos comestíveis da matança de gado bovino ou bubalino (Anexo 4.4), entrada interestadual (art. 6º, I)).',
    );
    if (r.status === 'applies') expect(r.warnings.join(' ')).toMatch(/preço de referência/);
  });

  it('sem classe: pergunta só quando o NCM lembra o anexo; fora dele, nada a dizer', () => {
    const pergunta = compra({ goodsClass: null });
    expect(pergunta).toMatchObject({ status: 'choose-class' });
    expect(stProductLoadMessage(pergunta)).toMatch(/Falta configurar: diga no produto/);
    // Carne ovina (0204) está no CEST 17.084.00 mas não no anexo: a empresa decide.
    expect(compra({ goodsClass: null, ncm: '02041000' }).status).toBe('choose-class');
    expect(compra({ goodsClass: null, ncm: '10063021' })).toEqual({ status: 'not-listed' });
    expect(compra({ goodsClass: 'rate-20', ncm: null })).toEqual({ status: 'not-listed' });
    expect(stProductLoadMessage({ status: 'not-listed' })).toMatch(/fora dos regimes/);
    const fora = compra({ goodsClass: 'outside' });
    expect(fora.status).toBe('product-out');
    expect(stProductLoadMessage(fora)).toBe('Produto fora do RICMS/MA, Anexo 4.4.');
    expect(compra({ uf: 'SP' })).toEqual({ status: 'not-listed' });
  });

  it('frete ou IPI no item: falta configurar até a empresa escolher (D-051)', () => {
    const r = compra({ hasFreightOrIpi: true });
    expect(r.status).toBe('missing');
    expect(stProductLoadMessage(r)).toMatch(/não cita frete nem IPI.*D-051/);
    const dentro = compra({ hasFreightOrIpi: true, options: { meatBaseCharges: 'include' } });
    expect(dentro).toMatchObject({ status: 'applies', includeCharges: true });
    if (dentro.status === 'applies')
      expect(dentro.warnings.join(' ')).toMatch(/Frete e IPI na base/);
    const fora = compra({ hasFreightOrIpi: true, options: { meatBaseCharges: 'exclude' } });
    expect(fora).toMatchObject({ status: 'applies', includeCharges: false });
    if (fora.status === 'applies') expect(fora.warnings.join(' ')).toMatch(/fora da base/);
  });

  it('gado: diferido para frigorífico regular (art. 3º); sem a situação da empresa, falta configurar', () => {
    const gado = (meatPlant?: 'none' | 'regular' | 'accredited') =>
      compra({ goodsClass: MA_CATTLE, ncm: '01022990', options: meatPlant ? { meatPlant } : null });
    expect(stProductLoadMessage(gado())).toMatch(
      /Diga em Empresas e lojas se a empresa é frigorífico/,
    );
    expect(gado('regular').status).toBe('deferred');
    expect(stProductLoadMessage(gado('accredited'))).toMatch(/diferidos \(art\. 3º/);
    const comum = gado('none');
    expect(comum).toMatchObject({ status: 'applies', loadPercent: '3' });
    if (comum.status === 'applies') expect(comum.warnings.join(' ')).toMatch(/matadouro público/);
  });

  it('compra dentro do Maranhão: quem retém é o remetente (art. 2º)', () => {
    const r = compra({ originUf: 'ma' });
    expect(r.status).toBe('supplier-responsible');
    expect(stProductLoadMessage(r)).toMatch(/estabelecimento produtor \(art\. 2º.*0,75%/);
  });

  it('importação e data sem redação: falta configurar e sem tabela', () => {
    expect(stProductLoadMessage(compra({ originUf: 'EX' }))).toMatch(/importação/);
    const antes = compra({ date: '2024-01-10' });
    expect(antes.status).toBe('no-table');
    expect(stProductLoadMessage(antes)).toMatch(/não tem a redação/);
  });
});

describe('saída de carne no Maranhão', () => {
  const nota = (over: Partial<Parameters<typeof stProductLoadOutputNote>[0]> = {}) =>
    stProductLoadOutputNote({
      uf: 'MA',
      destinationUf: 'MA',
      date: DIA,
      goodsClass: MA_MEAT,
      recipientContributor: true,
      transfer: false,
      ...over,
    });

  it('a expressão vai na venda interna a contribuinte e na transferência interna (§§ 1º e 2º)', () => {
    expect(nota()?.note).toBe('ICMS retido por substituição tributária');
    expect(nota({ recipientContributor: false, transfer: true })?.note).toBeDefined();
    expect(nota({ recipientContributor: false })).toBeNull();
    expect(nota({ destinationUf: 'PI' })).toBeNull();
    expect(nota({ goodsClass: 'outside' })).toBeNull();
    expect(nota({ uf: 'CE' })).toBeNull();
    expect(nota({ date: '2024-01-10' })).toBeNull();
  });

  const saida = (over: Partial<Parameters<typeof stProductLoadExit>[0]> = {}) =>
    stProductLoadExit({
      uf: 'MA',
      destinationUf: 'MA',
      date: DIA,
      goodsClass: MA_MEAT,
      operationCents: 100_000,
      options: { meatPlant: 'accredited' },
      ...over,
    });

  it('frigorífico credenciado: 0,75% na interna e 1% na interestadual, sobre o valor + 25%', () => {
    const interna = saida();
    expect(interna).toMatchObject({
      status: 'retains',
      loadPercent: '0.75',
      baseCents: 125_000,
      stCents: 938,
    });
    expect(stProductLoadExitMessage(interna!)).toBe(
      'Retenção na saída, art. 6º, III do RICMS/MA, Anexo 4.4 (frigorífico credenciado): base R$ 1.250,00 (com margem de 25%), carga 0,75%, ICMS retido R$ 9,38. Fica nas observações: o anexo não diz como lançar a carga nos campos da ST da nota (dúvida D-052).',
    );
    const fora = saida({ destinationUf: 'PI' });
    expect(fora).toMatchObject({ status: 'retains', loadPercent: '1', stCents: 1_250 });
    expect(stProductLoadExitMessage(fora!)).toMatch(/Sem crédito das entradas interestaduais/);
  });

  it('frete na operação: a escolha da empresa decide (D-051)', () => {
    expect(stProductLoadExitMessage(saida({ freightCents: 10_000 })!)).toMatch(/D-051/);
    expect(
      saida({
        freightCents: 10_000,
        options: { meatPlant: 'accredited', meatBaseCharges: 'exclude' },
      }),
    ).toMatchObject({ baseCents: 112_500 });
    expect(
      saida({
        freightCents: 10_000,
        options: { meatPlant: 'accredited', meatBaseCharges: 'include' },
      }),
    ).toMatchObject({ baseCents: 125_000 });
  });

  it('sem credenciamento, antes da portaria ou sem redação: falta configurar; não frigorífico: nada', () => {
    expect(stProductLoadExitMessage(saida({ options: { meatPlant: 'regular' } })!)).toMatch(
      /frigorífico credenciado \(Portaria 178\/2025-GABIN\).*D-052/,
    );
    expect(saida({ date: '2025-04-01' })?.status).toBe('missing');
    expect(stProductLoadExitMessage(saida({ date: '2024-01-10' })!)).toMatch(/não tem a redação/);
    expect(saida({ options: { meatPlant: 'none' } })).toBeNull();
    expect(saida({ options: null })).toBeNull();
    expect(saida({ goodsClass: MA_CATTLE })).toBeNull();
    expect(saida({ uf: 'CE' })).toBeNull();
  });
});
