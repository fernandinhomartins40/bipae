import { describe, expect, it } from 'vitest';
import {
  crtIsSimples,
  netLoadDocumentCents,
  purchaseNetLoad,
  type PurchaseNetLoadCompany,
} from './net-load';
import type { PurchaseItem, PurchaseParty } from './read';

/** F3-26.d.CE.c: a ST de entrada pela carga líquida do Ceará na compra. */

const LOJA_CE: PurchaseNetLoadCompany = {
  uf: 'CE',
  // Comércio varejista de artigos do vestuário (Anexo II do Decreto 34.256/2021).
  cnae: '4781-4/00',
  regime: 'presumido',
  specialRegime: false,
  taxId: '11.222.333/0001-81',
};

const fornecedor = (uf: string, over: Partial<PurchaseParty> = {}): PurchaseParty => ({
  cnpj: '44555666000199',
  name: 'Confecções do Sul LTDA',
  crt: '3',
  address: {
    street: 'Rua A',
    number: '1',
    district: 'Centro',
    cityCode: '3550308',
    cityName: 'São Paulo',
    uf,
  },
  ...over,
});

const item = (over: Partial<PurchaseItem> = {}): PurchaseItem => ({
  line: 1,
  supplierCode: 'CAM01',
  description: 'Camiseta de algodão',
  ncm: '61091000',
  cfop: '6102',
  unit: 'UN',
  quantity: '10.0000',
  unitPrice: '100.00',
  totalCents: 100_000,
  discountCents: 0,
  freightCents: 0,
  insuranceCents: 0,
  otherCents: 0,
  stCents: 0,
  ipiCents: 0,
  taxes: {
    icms: { cst: '000', baseCents: 100_000, rate: '7.00', amountCents: 7_000 },
    pisCents: 0,
    cofinsCents: 0,
  },
  ...over,
});

const calc = (
  over: {
    company?: Partial<PurchaseNetLoadCompany>;
    supplier?: PurchaseParty;
    item?: Partial<PurchaseItem>;
    goodsClass?: string | null;
  } = {},
) =>
  purchaseNetLoad({
    company: { ...LOJA_CE, ...over.company },
    nfe: { supplier: over.supplier ?? fornecedor('SP') },
    item: item(over.item),
    goodsClass: over.goodsClass === undefined ? 'rate-20' : over.goodsClass,
    cest: null,
    date: '2026-10-23',
  });

describe('carga líquida na entrada da compra', () => {
  it('varejista do vestuário comprando de SP: R$ 1.000 + 50% × 15,60% = R$ 234,00', () => {
    expect(calc()).toMatchObject({
      status: 'applies',
      act: 'Decreto 34.256/2021 (CE)',
      totalPercent: '15.60',
      mva: '50',
      documentCents: 100_000,
      baseCents: 150_000,
      stCents: 23_400,
    });
  });

  it('a base leva IPI, frete, seguro e outras despesas, menos o desconto', () => {
    const linha = item({
      discountCents: 1_000,
      freightCents: 2_000,
      insuranceCents: 300,
      otherCents: 200,
      ipiCents: 500,
    });
    expect(netLoadDocumentCents(linha)).toBe(102_000);
  });

  it('fornecedor do Simples (CRT 1 ou 4) soma o acréscimo do decreto', () => {
    expect(crtIsSimples('1')).toBe(true);
    expect(crtIsSimples('4')).toBe(true);
    expect(crtIsSimples('3')).toBe(false);
    expect(crtIsSimples(undefined)).toBe(false);
    // Vestuário, Sul e Sudeste: + 4% (art. 4º, § 2º, II).
    expect(calc({ supplier: fornecedor('SP', { crt: '1' }) })?.totalPercent).toBe('19.6');
  });

  it('importado (origem 1) vindo de outra UF soma o acréscimo do importado a 4%', () => {
    const importado = {
      taxes: {
        icms: { cst: '100', baseCents: 100_000, rate: '4.00', amountCents: 4_000 },
        pisCents: 0,
        cofinsCents: 0,
      },
    };
    // Vestuário, Sul e Sudeste: + 3% (art. 4º, § 3º, I).
    expect(calc({ item: importado })?.totalPercent).toBe('18.6');
  });

  it('sem CNAE ou sem UF da empresa: nada a calcular', () => {
    expect(calc({ company: { cnae: null } })).toBeNull();
    expect(calc({ company: { uf: null } })).toBeNull();
  });

  it('o que não se calcula volta como situação, com a mensagem, e sem valor', () => {
    const semClasse = calc({ goodsClass: null });
    expect(semClasse).toMatchObject({ status: 'choose-class', stCents: 0 });
    expect(semClasse?.message).toMatch(/escolha no produto a classe/);
    expect(calc({ company: { cnae: '4711302' } })).toMatchObject({
      status: 'not-listed',
      act: null,
    });
    expect(calc({ company: { regime: 'simples' } })?.status).toBe('simples-excluded');
    expect(calc({ company: { specialRegime: true } })).toMatchObject({
      status: 'missing',
      stCents: 0,
    });
  });

  it('transferência (mesma raiz de CNPJ) fica como falta configurar', () => {
    const filial = fornecedor('SP', { cnpj: '11222333000262' });
    const r = calc({ supplier: filial });
    expect(r?.status).toBe('missing');
    expect(r?.message).toMatch(/transferência/);
    // Empresa com CPF não tem raiz de CNPJ: não é transferência.
    expect(calc({ company: { taxId: '123.456.789-09' } })?.status).toBe('applies');
  });

  it('ST já retida pelo fornecedor: não soma a carga líquida de novo', () => {
    const r = calc({ item: { stCents: 5_000 } });
    expect(r).toMatchObject({ status: 'supplier-retained', stCents: 0, totalPercent: '15.60' });
    expect(r?.message).toMatch(/já reteve a ST/);
  });
});
