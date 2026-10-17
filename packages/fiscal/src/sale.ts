import { companyIcmsSettings, type CompanyIcmsRule } from './company-rules';
import { findCompanyRegime, type CompanyRegime } from './regimes';
import type { Crt } from './rules';
import { icmsGeneralRate, interstateRate } from './tables/icms-uf';
import { ibsCbsNotFilled } from './tables/ibs-cbs-scope';
import { meiItemProblem } from './tables/mei';
import { pisCofinsRate } from './tables/rates';
import {
  calculateContribution,
  type ContributionResult,
  type ContributionTax,
} from './taxes/contributions';
import { calculateIbsCbs, MissingRateError, type IbsCbsResult } from './taxes/ibs-cbs';
import { calculateIcms, type IcmsEffect, type IcmsResult } from './taxes/icms';
import { TaxRuleDataError, UnsupportedTaxSituationError } from './taxes/shared';

/**
 * Impostos de um item de venda, a partir do que o lojista cadastrou: a empresa (UF e regime), o
 * perfil fiscal do produto e o valor do item. É o ponto em que o cadastro encontra o motor.
 *
 * Cada tributo sai com uma situação: calculado, "falta configurar" (com o que falta, em português),
 * "não disponível" (o motor ainda não calcula aquele caso) ou "não se aplica". Nada é suposto em
 * silêncio: quando o cálculo usa uma simplificação, ela vem listada em `assumptions`.
 */
export interface SaleCompany {
  /** UF da empresa; null enquanto não foi informada. */
  uf: string | null;
  regime: CompanyRegime | null;
}

export interface SaleFiscalProfile {
  cfopInterna: string;
  cfopInterestadual: string;
  csosn?: string | null | undefined;
  cstIcms?: string | null | undefined;
  /** CST do PIS e da COFINS (a tabela é a mesma para os dois). */
  cstPisCofins?: string | null | undefined;
  cClassTrib?: string | null | undefined;
}

export interface SaleItem {
  /** Valor do item em centavos: produto + frete + seguro + outras despesas − desconto. */
  operationCents: number;
  /** UF de destino. Na venda de balcão (NFC-e) é a própria UF da empresa. */
  ufDestino?: string;
  /** Mercadoria importada ou com conteúdo de importação acima de 40% (muda a alíquota interestadual). */
  imported?: boolean;
}

export interface SaleTaxSettings {
  /**
   * Regras próprias da empresa para o ICMS deste item (alíquota do produto, redução de base, MVA
   * da substituição tributária...). O que vier aqui vale mais que a alíquota geral da UF.
   */
  icms?: Partial<IcmsEffect>;
  /** Quando as regras da empresa estão em conflito: o ICMS fica em "falta configurar" com este motivo. */
  icmsBlocked?: string;
  /** Tirar o ICMS da base do PIS/COFINS no regime cumulativo (dúvida D-019). */
  excludeIcmsFromCumulative?: boolean;
}

export type TaxOutcome<Result> =
  | { status: 'calculado'; result: Result }
  | { status: 'falta-configurar' | 'nao-disponivel' | 'nao-se-aplica'; reason: string };

export interface SaleItemTaxes {
  /** CRT que vai na nota; null enquanto o regime não foi informado. */
  crt: Crt | null;
  /** CFOP do item: o de dentro do estado ou o de outro estado, conforme o destino. */
  cfop: string | null;
  icms: TaxOutcome<IcmsResult>;
  pis: TaxOutcome<ContributionResult>;
  cofins: TaxOutcome<ContributionResult>;
  ibsCbs: TaxOutcome<IbsCbsResult>;
  /** O que o lojista ou o contador precisa resolver para o cálculo ficar completo. */
  pending: string[];
  /** Simplificações usadas no cálculo, para ninguém tomar estimativa por valor final. */
  assumptions: string[];
  /** true quando nenhum tributo ficou em "falta configurar" ou "não disponível". */
  complete: boolean;
}

const missing = <R>(reason: string): TaxOutcome<R> => ({ status: 'falta-configurar', reason });

/** Transforma os erros do motor na situação do tributo, com a mensagem para o usuário. */
function outcome<R>(run: () => R): TaxOutcome<R> {
  try {
    return { status: 'calculado', result: run() };
  } catch (error) {
    if (error instanceof UnsupportedTaxSituationError)
      return { status: 'nao-disponivel', reason: error.message };
    if (error instanceof TaxRuleDataError || error instanceof MissingRateError)
      return missing(error.message);
    throw error;
  }
}

export function calculateSaleItemTaxes(input: {
  company: SaleCompany;
  profile: SaleFiscalProfile | null;
  item: SaleItem;
  /** Data do fato gerador (AAAA-MM-DD). */
  date: string;
  settings?: SaleTaxSettings;
  /** Modelo da nota: 65 (NFC-e do caixa, o padrão) ou 55 (NF-e da retaguarda). */
  model?: '55' | '65';
}): SaleItemTaxes {
  const { company, profile, item, date, settings = {}, model = '65' } = input;
  const assumptions: string[] = [];
  const regime = company.regime ? findCompanyRegime(company.regime) : null;

  const finish = (
    parts: Pick<SaleItemTaxes, 'icms' | 'pis' | 'cofins' | 'ibsCbs'>,
    cfop: string | null,
  ): SaleItemTaxes => {
    const outcomes = [parts.icms, parts.pis, parts.cofins, parts.ibsCbs];
    const pending = [
      ...new Set(
        outcomes.flatMap((o) =>
          o.status === 'falta-configurar' || o.status === 'nao-disponivel' ? [o.reason] : [],
        ),
      ),
    ];
    return {
      crt: regime?.crt ?? null,
      cfop,
      ...parts,
      pending,
      assumptions,
      complete: pending.length === 0,
    };
  };
  const all = (reason: string) =>
    finish(
      {
        icms: missing(reason),
        pis: missing(reason),
        cofins: missing(reason),
        ibsCbs: missing(reason),
      },
      null,
    );

  if (!company.uf || !regime)
    return all('Informe a UF e o regime tributário da empresa em Empresas e lojas.');
  if (!profile) return all('O produto não tem perfil fiscal. Escolha um no cadastro do produto.');

  const ufDestino = item.ufDestino ?? company.uf;
  const internal = ufDestino === company.uf;
  const cfop = internal ? profile.cfopInterna : profile.cfopInterestadual;

  // ---------------------------------------------------------------- ICMS
  let icms: TaxOutcome<IcmsResult>;
  const code = regime.icmsCode === 'csosn' ? profile.csosn : profile.cstIcms;
  // MEI (CRT 4): CSOSN e CFOP permitidos em cada modelo de nota (NT 2024.001).
  const meiProblem =
    regime.id === 'mei' && code && cfop ? meiItemProblem({ model, csosn: code, cfop }) : null;
  if (settings.icmsBlocked) {
    icms = missing(settings.icmsBlocked);
  } else if (meiProblem) {
    icms = missing(`${meiProblem} Ajuste o perfil fiscal do produto.`);
  } else if (!code) {
    icms = missing(
      regime.icmsCode === 'csosn'
        ? `O perfil fiscal não tem CSOSN, exigido no regime ${regime.label}.`
        : `O perfil fiscal não tem CST do ICMS, exigido no regime ${regime.label}.`,
    );
  } else {
    const effect: IcmsEffect = regime.icmsCode === 'csosn' ? { csosn: code } : { cst: code };
    let rateProblem: string | null = null;
    let usedGeneralRate: string | null = null;
    if (settings.icms?.rate === undefined) {
      if (internal) {
        const general = icmsGeneralRate(company.uf);
        if (general?.status === 'confirmado') {
          effect.rate = general.rate!;
          usedGeneralRate = general.rate!;
        } else {
          rateProblem = `A alíquota geral de ICMS de ${company.uf} ainda não foi confirmada em fonte oficial. Peça a alíquota ao contador.`;
        }
      } else {
        effect.rate = interstateRate(company.uf, ufDestino, {
          imported: item.imported ?? false,
        }).rate;
      }
    }
    Object.assign(effect, settings.icms);
    icms = outcome(() => calculateIcms(effect, { baseCents: item.operationCents }));
    // Sem alíquota, a regra fica "incompleta"; a mensagem útil é a da UF, não a genérica.
    if (icms.status === 'falta-configurar' && rateProblem && effect.rate === undefined)
      icms = missing(rateProblem);
    // O aviso só vale quando a alíquota entrou mesmo na conta (no Simples sem destaque, não entra).
    if (icms.status === 'calculado' && icms.result.rate !== null && usedGeneralRate !== null) {
      assumptions.push(
        `ICMS pela alíquota geral de ${company.uf} (${usedGeneralRate}%). Produto com alíquota própria precisa de regra específica.`,
      );
    }
  }
  const icmsCents = icms.status === 'calculado' ? icms.result.amountCents : 0;

  // ---------------------------------------------------------------- PIS e COFINS
  const contribution = (tax: ContributionTax): TaxOutcome<ContributionResult> => {
    if (regime.pisCofins === 'das') {
      return {
        status: 'nao-se-aplica',
        reason: `${tax} recolhido no documento de arrecadação do Simples Nacional.`,
      };
    }
    const general = pisCofinsRate(tax, regime.pisCofins, date);
    if (!general)
      return { status: 'nao-se-aplica', reason: `${tax} extinto a partir de 2027 (EC 132/2023).` };
    if (!profile.cstPisCofins) return missing('O perfil fiscal não tem o CST do PIS e da COFINS.');
    const excludeIcms =
      regime.pisCofins === 'nao-cumulativo' ? true : (settings.excludeIcmsFromCumulative ?? false);
    return outcome(() =>
      calculateContribution(
        tax,
        { cst: profile.cstPisCofins!, rate: general.rate, excludeIcms },
        { baseCents: item.operationCents, icmsCents },
      ),
    );
  };
  const pis = contribution('PIS');
  const cofins = contribution('COFINS');
  if (regime.pisCofins === 'cumulativo' && settings.excludeIcmsFromCumulative === undefined) {
    assumptions.push(
      'PIS e COFINS cumulativos calculados com o ICMS na base (dúvida D-019, a confirmar com o contador).',
    );
  }

  // ---------------------------------------------------------------- IBS e CBS
  const amount = (o: TaxOutcome<ContributionResult>) =>
    o.status === 'calculado' ? o.result.amountCents : 0;
  // Simples e MEI só entram no IBS/CBS em 2027 (D-002): a regra vem da tabela, com a fonte.
  const notFilled = ibsCbsNotFilled(regime.id, date);
  const ibsCbs: TaxOutcome<IbsCbsResult> = notFilled
    ? { status: 'nao-se-aplica', reason: notFilled }
    : profile.cClassTrib
      ? outcome(() =>
          calculateIbsCbs({
            cClassTrib: profile.cClassTrib!,
            date,
            operationCents: item.operationCents,
            taxes: { ICMS: icmsCents, PIS: amount(pis), COFINS: amount(cofins) },
          }),
        )
      : missing('O perfil fiscal não tem a classificação tributária do IBS e da CBS (cClassTrib).');

  return finish({ icms, pis, cofins, ibsCbs }, cfop);
}

/**
 * Resumo dos impostos de um item, para viajar com a venda (evento do caixa) e ficar gravado.
 * Valores em centavos; `null` quer dizer "sem valor destacado": o tributo não se aplica àquele
 * regime, ou não pôde ser calculado, e nesse caso o motivo está em `pending`.
 */
export interface SaleItemTaxSummary {
  crt: number | null;
  cfop: string | null;
  icmsCents: number | null;
  icmsStCents: number | null;
  fcpCents: number | null;
  pisCents: number | null;
  cofinsCents: number | null;
  ibsCents: number | null;
  cbsCents: number | null;
  complete: boolean;
  pending: string[];
}

export function summarizeSaleItemTaxes(taxes: SaleItemTaxes): SaleItemTaxSummary {
  const icms = taxes.icms.status === 'calculado' ? taxes.icms.result : null;
  const ibsCbs = taxes.ibsCbs.status === 'calculado' ? taxes.ibsCbs.result : null;
  const amount = (outcome: TaxOutcome<ContributionResult>) =>
    outcome.status === 'calculado' ? outcome.result.amountCents : null;
  return {
    crt: taxes.crt,
    cfop: taxes.cfop,
    icmsCents: icms ? icms.amountCents : null,
    icmsStCents: icms?.st ? icms.st.amountCents : null,
    fcpCents: icms?.fcp ? icms.fcp.amountCents : null,
    pisCents: amount(taxes.pis),
    cofinsCents: amount(taxes.cofins),
    ibsCents: ibsCbs ? ibsCbs.ibsAmountCents : null,
    cbsCents: ibsCbs ? ibsCbs.cbsAmountCents : null,
    complete: taxes.complete,
    pending: taxes.pending,
  };
}

const SUMMARY_FIELDS = [
  'crt',
  'cfop',
  'icmsCents',
  'icmsStCents',
  'fcpCents',
  'pisCents',
  'cofinsCents',
  'ibsCents',
  'cbsCents',
] as const;

/** Dois resumos chegaram aos mesmos números? (As mensagens de pendência não entram na comparação.) */
export function sameTaxSummary(a: SaleItemTaxSummary, b: SaleItemTaxSummary): boolean {
  return SUMMARY_FIELDS.every((field) => a[field] === b[field]);
}

/**
 * Resumo dos impostos de todos os itens de uma venda. É a mesma função no caixa (ao fechar a
 * venda, sem internet) e no servidor (ao conferir), para as duas contas só divergirem se os
 * dados forem diferentes.
 *
 * Devolve null quando a empresa não informou nem a UF nem o regime: ela ainda não usa a parte
 * fiscal, e a venda segue sem resumo de impostos, em vez de carregar avisos em todo item.
 */
export function saleTaxSummaries(input: {
  company: { uf: string | null; taxRegime: string | null };
  items: readonly {
    operationCents: number;
    profile: SaleFiscalProfile | null;
    ncm?: string | null;
  }[];
  /** Data do fato gerador (AAAA-MM-DD). */
  date: string;
  /** Regras de ICMS próprias da empresa (F3-06.e), por NCM. */
  rules?: readonly CompanyIcmsRule[];
}): SaleItemTaxSummary[] | null {
  const { company, items, date, rules = [] } = input;
  if (!company.uf && !company.taxRegime) return null;
  const regime = company.taxRegime ? (findCompanyRegime(company.taxRegime)?.id ?? null) : null;
  return items.map((item) =>
    summarizeSaleItemTaxes(
      calculateSaleItemTaxes({
        company: { uf: company.uf, regime },
        profile: item.profile,
        item: { operationCents: item.operationCents },
        date,
        settings: companyIcmsSettings(rules, item.ncm, date),
      }),
    ),
  );
}
