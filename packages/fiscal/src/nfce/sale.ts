import { companyIcmsSettings, type CompanyIcmsRule } from '../company-rules';
import type { NfeItem, NfePayment } from '../nfe/groups';
import { findCompanyRegime } from '../regimes';
import { calculateSaleItemTaxes, type SaleFiscalProfile, type TaxOutcome } from '../sale';
import { findFcp } from '../tables/rates';
import { PdvPaymentError, pdvPaymentCode } from '../tables/pdv-payments';
import { buildNfce, NfceBuildError, type NfceDocument, type NfceInput } from './build';
import { nfceNumbering } from './numbering';

/**
 * Da venda do caixa à NFC-e (F3-14.a). Junta a empresa, a série do caixa, os itens com os
 * impostos completos do motor, os pagamentos com o tPag e o CPF/CNPJ do cliente. O que impede a
 * emissão volta em `pending`, com a mensagem para quem vai resolver; nada é suposto.
 */

export interface SaleNfceCompany {
  /** CNPJ só com dígitos (ou letras, no CNPJ alfanumérico). */
  cnpj: string | null;
  legalName: string;
  tradeName?: string | null;
  /** Inscrição estadual só com dígitos. */
  ie: string | null;
  uf: string | null;
  regime: string | null;
  address: {
    street: string | null;
    number: string | null;
    complement?: string | null;
    district: string | null;
    cityCode: string | null;
    cityName: string | null;
    cep: string | null;
    phone?: string | null;
  };
}

export interface SaleNfceItem {
  /** Código do produto (cProd): o código interno ou o id. */
  code: string;
  /** Códigos de barras do produto; o primeiro GTIN válido vai no cEAN. */
  barcodes: string[];
  description: string;
  ncm: string | null;
  cest?: string | null;
  unit: string;
  quantityMilli: number;
  unitPriceCents: number;
  grossCents: number;
  discountCents: number;
  /** Perfil fiscal do produto com a origem da mercadoria. */
  profile: (SaleFiscalProfile & { origem?: number }) | null;
}

export interface SaleNfceInput {
  /** Id da venda: dele sai o cNF, para a nota ter sempre a mesma chave nas novas tentativas. */
  saleId: string;
  company: SaleNfceCompany;
  series: number;
  terminalSeq: number;
  /** Momento da venda (ISO). */
  occurredAt: string;
  items: SaleNfceItem[];
  payments: { method: string; amountCents: number; changeCents?: number }[];
  customerTaxId?: string | null;
  rules?: readonly CompanyIcmsRule[];
  /** Escolhas da empresa para Pix e vale (dúvida D-029). */
  paymentCodes?: Partial<Record<string, string>>;
  appVersion: string;
}

export type SaleNfceResult =
  { ok: true; document: NfceDocument; input: NfceInput } | { ok: false; pending: string[] };

/**
 * Em homologação a SEFAZ exige este texto na descrição do primeiro item da NFC-e (rejeição 373).
 * O Bipaê só emite em homologação (regra 4 do projeto); confirmar na F3-11.b (dúvida D-030).
 */
export const HOMOLOGATION_FIRST_ITEM =
  'NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';

const onlyDigits = (text: string | null | undefined) => (text ?? '').replace(/\D/g, '');

/** Data e hora no horário de Brasília, como o leiaute pede (AAAA-MM-DDThh:mm:ss-03:00). */
export function brasiliaDateTime(iso: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}-03:00`;
}

/** cNF de 8 dígitos tirado do id da venda: a mesma venda sempre gera a mesma chave. */
export function saleNumericCode(saleId: string, number: number): string {
  const value = BigInt(`0x${saleId.replace(/-/g, '')}`) % 100_000_000n;
  let code = Number(value);
  if (code === number) code = (code + 1) % 100_000_000;
  return String(code).padStart(8, '0');
}

function result<R>(outcome: TaxOutcome<R>, name: string, pending: string[]): R | null {
  if (outcome.status === 'calculado') return outcome.result;
  if (outcome.status === 'nao-se-aplica') return null;
  pending.push(`${name}: ${outcome.reason}`);
  return null;
}

export function buildSaleNfce(input: SaleNfceInput): SaleNfceResult {
  const pending: string[] = [];
  const c = input.company;
  const regime = c.regime ? findCompanyRegime(c.regime) : null;
  const need = (value: string | null | undefined, label: string) => {
    if (!value || !value.trim()) pending.push(`Falta ${label} da empresa (Empresas e lojas).`);
    return value?.trim() ?? '';
  };
  const cnpj = need(c.cnpj, 'o CNPJ')
    .replace(/[^0-9A-Z]/gi, '')
    .toUpperCase();
  const ie = onlyDigits(need(c.ie, 'a inscrição estadual'));
  const uf = need(c.uf, 'a UF');
  if (!regime) pending.push('Falta o regime tributário da empresa (Empresas e lojas).');
  const street = need(c.address.street, 'a rua do endereço');
  const number = need(c.address.number, 'o número do endereço');
  const district = need(c.address.district, 'o bairro');
  const cityCode = need(c.address.cityCode, 'o município');
  const cityName = need(c.address.cityName, 'o município');
  const cep = onlyDigits(need(c.address.cep, 'o CEP'));

  const date = brasiliaDateTime(input.occurredAt).slice(0, 10);
  let numbering = { series: input.series, number: 1 };
  try {
    numbering = nfceNumbering({ series: input.series, terminalSeq: input.terminalSeq });
  } catch (error) {
    pending.push((error as Error).message);
  }

  const items: NfeItem[] = input.items.map((item, index) => {
    const label = `Item ${index + 1} (${item.description})`;
    if (!item.ncm) pending.push(`${label}: o produto não tem NCM.`);
    const taxes = calculateSaleItemTaxes({
      company: { uf: c.uf, regime: regime?.id ?? null },
      profile: item.profile,
      item: { operationCents: item.grossCents - item.discountCents },
      date,
      settings: companyIcmsSettings(input.rules ?? [], item.ncm, date),
    });
    const icms = result(taxes.icms, `${label}, ICMS`, pending);
    const pis = result(taxes.pis, `${label}, PIS`, pending);
    const cofins = result(taxes.cofins, `${label}, COFINS`, pending);
    const ibsCbs = result(taxes.ibsCbs, `${label}, IBS/CBS`, pending);
    return {
      code: item.code,
      gtin: item.barcodes.find((b) => /^\d{8}$|^\d{12,14}$/.test(b) && !b.startsWith('2')) ?? null,
      description: index === 0 ? HOMOLOGATION_FIRST_ITEM : item.description,
      ncm: item.ncm ?? '',
      ...(item.cest && { cest: item.cest }),
      cfop: taxes.cfop ?? '',
      unit: item.unit,
      quantityMilli: item.quantityMilli,
      unitPriceCents: item.unitPriceCents,
      grossCents: item.grossCents,
      discountCents: item.discountCents,
      origin: String(item.profile?.origem ?? 0),
      icms: icms!,
      pis,
      cofins,
      ibsCbs,
    };
  });

  const payments: NfePayment[] = [];
  for (const p of input.payments) {
    try {
      payments.push({
        code: pdvPaymentCode(p.method, date, input.paymentCodes),
        amountCents: p.amountCents + (p.changeCents ?? 0),
      });
    } catch (error) {
      if (error instanceof PdvPaymentError) pending.push(error.message);
      else throw error;
    }
  }
  const changeCents = input.payments.reduce((s, p) => s + (p.changeCents ?? 0), 0);

  const taxId = onlyDigits(input.customerTaxId);
  if (pending.length > 0) return { ok: false, pending: [...new Set(pending)] };

  const nfce: NfceInput = {
    issuer: {
      cnpj,
      name: c.legalName,
      ...(c.tradeName && { tradeName: c.tradeName }),
      ie,
      crt: regime!.crt,
      address: {
        street,
        number,
        ...(c.address.complement && { complement: c.address.complement }),
        district,
        cityCode,
        cityName,
        uf,
        cep,
        ...(c.address.phone && { phone: onlyDigits(c.address.phone) }),
      },
    },
    cUF: '',
    series: numbering.series,
    number: numbering.number,
    issuedAt: brasiliaDateTime(input.occurredAt),
    numericCode: saleNumericCode(input.saleId, numbering.number),
    ...(taxId && {
      customer: taxId.length === 11 ? { cpf: taxId } : { cnpj: taxId },
    }),
    items,
    payments,
    ...(changeCents > 0 && { changeCents }),
    appVersion: input.appVersion,
  };
  try {
    // cUF da tabela oficial de UFs (a mesma do FCP).
    const withUf = { ...nfce, cUF: findFcp(uf)?.cUF ?? '' };
    return { ok: true, document: buildNfce(withUf), input: withUf };
  } catch (error) {
    // Erro de montagem (chave, campos): volta como pendência, com a mensagem do motor.
    if (error instanceof NfceBuildError || error instanceof Error) {
      return { ok: false, pending: [error.message] };
    }
    throw error;
  }
}
