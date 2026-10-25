import { COMPANY_REGIMES, findCompanyRegime } from '../regimes';
import { isImportedOrigin } from '../tables/icms-uf';
import {
  stNetLoadAmount,
  stNetLoadFor,
  stNetLoadMessage,
  type StNetLoadOptions,
  type StNetLoadResult,
} from '../tables/st-net-loads';
import {
  stProductLoadFor,
  stProductLoadMessage,
  stProductLoadRegimeOf,
} from '../tables/st-product-loads';
import type { PurchaseItem, PurchaseNfe } from './read';

/**
 * ST de entrada pela carga líquida na compra (F3-26.d.CE.c): com a CNAE principal da empresa, a
 * classe da mercadoria do produto e a origem da nota, `stNetLoadFor` diz se o regime se aplica e
 * com qual percentual. Tudo o que decide vem da tabela gerada dos decretos ou do próprio XML; o que
 * não dá para calcular volta como situação, com a mensagem. Nunca impede a compra.
 */

export interface PurchaseNetLoadCompany {
  uf: string | null;
  /** CNAE-Fiscal principal (7 dígitos). */
  cnae: string | null;
  /** Regime tributário da empresa (mei, simples, simples-excesso, presumido, real). */
  regime: string | null;
  /** Regime Especial de Tributação (RET) com a SEFAZ. */
  specialRegime: boolean;
  /** CNPJ ou CPF da empresa, para reconhecer a transferência entre estabelecimentos. */
  taxId: string | null;
  /** Escolhas da empresa onde o texto dos decretos deixa margem (F3-26.d.CE.e, D-042). */
  options?: StNetLoadOptions | null;
}

export interface PurchaseNetLoad {
  status: StNetLoadResult['status'] | 'supplier-retained' | 'supplier-responsible';
  /** Decreto do regime, quando a CNAE está em um. */
  act: string | null;
  goodsClass: string | null;
  /** Percentual total (carga mais acréscimos), quando se aplica. */
  totalPercent: string | null;
  mva: string | null;
  /** Valor da nota de entrada do item (com IPI, frete, seguro e outras despesas, sem desconto). */
  documentCents: number;
  baseCents: number;
  stCents: number;
  message: string;
  warnings: string[];
}

const digits = (text: string | null | undefined) => (text ?? '').replace(/\D/g, '');

/** Raiz do CNPJ (também o alfanumérico); null para CPF ou vazio. */
function cnpjRoot(taxId: string | null | undefined): string | null {
  const clean = (taxId ?? '').replace(/[^0-9A-Z]/gi, '').toUpperCase();
  return clean.length === 14 ? clean.slice(0, 8) : null;
}

/** O emitente é optante pelo Simples Nacional, pelo CRT da nota (tabela dos regimes). */
export function crtIsSimples(crt: string | null | undefined): boolean {
  return COMPANY_REGIMES.some((r) => String(r.crt) === crt && r.taxRegime === 'simples');
}

/**
 * Valor do documento fiscal de entrada do item, como os decretos mandam ("incluídos os valores do
 * IPI, frete e carreto, seguro e outros encargos transferidos ao destinatário").
 */
export function netLoadDocumentCents(item: PurchaseItem): number {
  return (
    item.totalCents -
    item.discountCents +
    item.freightCents +
    item.insuranceCents +
    item.otherCents +
    item.ipiCents
  );
}

/**
 * Carga líquida de um item da compra. Null quando a empresa não tem UF ou CNAE principal (nada a
 * calcular e nada a avisar).
 */
export function purchaseNetLoad(input: {
  company: PurchaseNetLoadCompany;
  nfe: Pick<PurchaseNfe, 'supplier'>;
  item: PurchaseItem;
  /** Classe da mercadoria do produto (configuração), quando o produto já existe. */
  goodsClass: string | null;
  /** CEST do produto, ou o da nota quando o produto não tem. */
  cest: string | null;
  /** Data da entrada (AAAA-MM-DD). */
  date: string;
}): PurchaseNetLoad | null {
  const { company, nfe, item } = input;
  if (!company.uf) return null;
  // Carga fixa por produto (carnes do Maranhão, F3-26.d.MA.d): vale para qualquer adquirente.
  if (stProductLoadRegimeOf(company.uf)) return purchaseProductLoad(input);
  if (!digits(company.cnae)) return null;
  const supplierUf = nfe.supplier.address?.uf || '';
  const interstate = supplierUf !== '' && supplierUf.toUpperCase() !== company.uf.toUpperCase();
  // Transferência: mesmo titular, ou seja, a mesma raiz (8 primeiros caracteres) do CNPJ.
  const supplierRoot = cnpjRoot(nfe.supplier.cnpj);
  const companyRoot = cnpjRoot(company.taxId);
  const regime = company.regime ? findCompanyRegime(company.regime) : null;
  const documentCents = netLoadDocumentCents(item);
  const result = stNetLoadFor({
    uf: company.uf,
    buyerCnae: company.cnae!,
    originUf: supplierUf,
    date: input.date,
    goodsClass: input.goodsClass,
    cest: input.cest,
    supplierSimples: crtIsSimples(nfe.supplier.crt),
    importedAt4: interstate && isImportedOrigin(item.taxes.icms?.cst.slice(0, 1)),
    buyerSimples: regime?.taxRegime === 'simples',
    transfer: supplierRoot !== null && supplierRoot === companyRoot,
    specialRegime: company.specialRegime,
    ncm: item.ncm || null,
    options: company.options ?? null,
  });
  const base = {
    act: 'regime' in result ? result.regime.act : null,
    goodsClass: input.goodsClass,
    documentCents,
  };
  if (result.status !== 'applies') {
    return {
      ...base,
      status: result.status,
      totalPercent: null,
      mva: null,
      baseCents: 0,
      stCents: 0,
      message: stNetLoadMessage(result),
      warnings: [],
    };
  }
  // A ST já veio retida pelo fornecedor: mercadoria em regime de ST específico, que os decretos
  // excluem da carga líquida. Não calcula de novo; a empresa confere.
  if (item.stCents > 0) {
    return {
      ...base,
      status: 'supplier-retained',
      totalPercent: result.totalPercent,
      mva: result.mva,
      baseCents: 0,
      stCents: 0,
      message: `O fornecedor já reteve a ST neste item: a carga líquida do ${result.regime.act} não é somada. Confira com o contador.`,
      warnings: result.warnings,
    };
  }
  const amount = stNetLoadAmount({
    documentCents,
    mva: result.mva,
    loadPercent: result.totalPercent,
  });
  return {
    ...base,
    status: 'applies',
    totalPercent: result.totalPercent,
    mva: result.mva,
    ...amount,
    message: stNetLoadMessage(result),
    warnings: result.warnings,
  };
}

/**
 * Carga fixa por produto na compra (F3-26.d.MA.d, Anexo 4.4 do RICMS/MA): base é o valor da
 * operação com seguro e outros encargos (frete e IPI só com a escolha da empresa, D-051) mais a
 * margem, vezes a carga. O que não se calcula volta como situação, com a mensagem.
 */
function purchaseProductLoad(input: Parameters<typeof purchaseNetLoad>[0]): PurchaseNetLoad {
  const { company, nfe, item } = input;
  const extras = item.freightCents + item.ipiCents;
  const result = stProductLoadFor({
    uf: company.uf!,
    originUf: nfe.supplier.address?.uf || company.uf!,
    date: input.date,
    goodsClass: input.goodsClass,
    ncm: item.ncm || null,
    hasFreightOrIpi: extras > 0,
    options: company.options ?? null,
  });
  const documentCents =
    item.totalCents - item.discountCents + item.insuranceCents + item.otherCents;
  const base = {
    act: 'regime' in result ? result.regime.act : null,
    goodsClass: input.goodsClass,
    documentCents,
    totalPercent: null,
    mva: null,
    baseCents: 0,
    stCents: 0,
    message: stProductLoadMessage(result),
    warnings: [] as string[],
  };
  if (result.status !== 'applies') {
    if (result.status === 'supplier-responsible' && item.stCents > 0) {
      return {
        ...base,
        status: 'supplier-retained',
        message: `O fornecedor já reteve a ST neste item (${result.regime.act}, art. 2º).`,
      };
    }
    return { ...base, status: result.status };
  }
  if (item.stCents > 0) {
    return {
      ...base,
      status: 'supplier-retained',
      totalPercent: result.loadPercent,
      mva: result.mva,
      message: `O fornecedor já reteve a ST neste item: a carga do ${result.regime.act} não é somada. Confira com o contador.`,
      warnings: result.warnings,
    };
  }
  const document = documentCents + (result.includeCharges ? extras : 0);
  return {
    ...base,
    status: 'applies',
    documentCents: document,
    totalPercent: result.loadPercent,
    mva: result.mva,
    ...stNetLoadAmount({
      documentCents: document,
      mva: result.mva,
      loadPercent: result.loadPercent,
    }),
    warnings: result.warnings,
  };
}
