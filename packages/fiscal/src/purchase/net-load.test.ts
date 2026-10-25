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

  it('transferência (mesma raiz de CNPJ): margem própria do decreto (34.256, art. 4º, § 5º, II)', () => {
    const filial = fornecedor('SP', { cnpj: '11222333000262' });
    const r = calc({ supplier: filial });
    // Interestadual: margem de 100% no lugar dos 50% do caput.
    expect(r).toMatchObject({ status: 'applies', mva: '100', totalPercent: '15.60' });
    expect(r?.warnings.join(' ')).toMatch(/Transferência: margem de 100%/);
    // Empresa com CPF não tem raiz de CNPJ: não é transferência.
    expect(calc({ company: { taxId: '123.456.789-09' } })?.status).toBe('applies');
  });

  describe('carnes do Maranhão por carga fixa (F3-26.d.MA.d)', () => {
    const ma = (
      over: {
        item?: Partial<PurchaseItem>;
        goodsClass?: string | null;
        supplierUf?: string;
        options?: PurchaseNetLoadCompany['options'];
      } = {},
    ) =>
      purchaseNetLoad({
        // Supermercado sem CNAE nos decretos do Ceará: o regime do MA vale para qualquer comprador.
        company: { ...LOJA_CE, uf: 'MA', cnae: null, options: over.options ?? null },
        nfe: { supplier: fornecedor(over.supplierUf ?? 'PA') },
        item: item({ ncm: '02013000', description: 'Carne bovina desossada', ...over.item }),
        goodsClass: over.goodsClass === undefined ? 'ma-meat' : over.goodsClass,
        cest: null,
        date: '2026-10-24',
      });

    it('entrada interestadual: R$ 1.000 + 25% × 3% = R$ 37,50, com seguro e outras despesas', () => {
      expect(ma()).toMatchObject({
        status: 'applies',
        act: 'RICMS/MA, Anexo 4.4',
        totalPercent: '3',
        mva: '25',
        documentCents: 100_000,
        baseCents: 125_000,
        stCents: 3_750,
      });
      expect(
        ma({ item: { insuranceCents: 1_000, otherCents: 1_000, discountCents: 2_000 } }),
      ).toMatchObject({ documentCents: 100_000, stCents: 3_750 });
    });

    it('frete e IPI: falta configurar sem a escolha; com ela, entram ou ficam de fora (D-051)', () => {
      const frete = { freightCents: 4_000, ipiCents: 0 };
      expect(ma({ item: frete })).toMatchObject({ status: 'missing', stCents: 0 });
      expect(ma({ item: frete, options: { meatBaseCharges: 'include' } })).toMatchObject({
        documentCents: 104_000,
        baseCents: 130_000,
        stCents: 3_900,
      });
      expect(ma({ item: frete, options: { meatBaseCharges: 'exclude' } })).toMatchObject({
        documentCents: 100_000,
      });
    });

    it('ST já retida, compra interna, sem classe e fora do regime', () => {
      expect(ma({ item: { stCents: 2_000 } })).toMatchObject({
        status: 'supplier-retained',
        totalPercent: '3',
        stCents: 0,
      });
      expect(ma({ supplierUf: 'MA' })).toMatchObject({ status: 'supplier-responsible' });
      expect(ma({ supplierUf: 'MA', item: { stCents: 900 } })?.message).toMatch(
        /já reteve a ST neste item \(RICMS\/MA, Anexo 4\.4, art\. 2º\)/,
      );
      expect(ma({ goodsClass: null })).toMatchObject({
        status: 'choose-class',
        act: 'RICMS/MA, Anexo 4.4',
      });
      expect(ma({ goodsClass: null, item: { ncm: '61091000' } })).toMatchObject({
        status: 'not-listed',
        act: null,
      });
    });
  });

  it('ST já retida pelo fornecedor: não soma a carga líquida de novo', () => {
    const r = calc({ item: { stCents: 5_000 } });
    expect(r).toMatchObject({ status: 'supplier-retained', stCents: 0, totalPercent: '15.60' });
    expect(r?.message).toMatch(/já reteve a ST/);
  });
});
