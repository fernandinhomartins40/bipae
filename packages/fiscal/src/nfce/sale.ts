import { companyIcmsSettings, type CompanyIcmsRule } from '../company-rules';
import type { NfeItem, NfePayment } from '../nfe/groups';
import { findCompanyRegime } from '../regimes';
import { calculateSaleItemTaxes, type SaleFiscalProfile, type TaxOutcome } from '../sale';
import { findFcp } from '../tables/rates';
import { PdvPaymentError, pdvPaymentRule } from '../tables/pdv-payments';
import { buildNfce, NfceBuildError, type NfceDocument, type NfceInput } from './build';
import { nfceNumbering } from './numbering';
import { contingencyQrPayload } from './qrcode';
import { signText, type NfeSigner, type SigningKey } from './sign';

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
  payments: {
    method: string;
    amountCents: number;
    changeCents?: number;
    /** Código de autorização da maquininha, quando o operador informou. */
    authorizationCode?: string | null;
  }[];
  customerTaxId?: string | null;
  rules?: readonly CompanyIcmsRule[];
  /** Escolhas da empresa para Pix e vale (dúvida D-029). */
  paymentCodes?: Partial<Record<string, string>>;
  appVersion: string;
  /** Contingência off-line (F3-15); use `buildSaleNfceContingency`, que assina o QR Code. */
  contingency?: { enteredAt: string; reason: string; qrSignature: string };
  /** Entrega a domicílio (F5-10): a taxa vira frete, rateado nos itens. */
  delivery?: {
    feeCents: number;
    address: {
      street: string;
      number: string;
      complement?: string | null;
      district: string;
      /** Município do IBGE, já resolvido por quem chama (o caixa não carrega a tabela). */
      cityCode: string | null;
      cityName: string | null;
      uf: string | null;
      cep?: string | null;
      phone?: string | null;
    };
  } | null;
}

/** Reparte o frete pelo valor de cada item, maior resto primeiro (a soma bate com a taxa). */
export function prorateFreight(feeCents: number, weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (feeCents <= 0 || total <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (feeCents * w) / total);
  const floors = raw.map(Math.floor);
  let rest = feeCents - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (rest <= 0) break;
    floors[i]! += 1;
    rest -= 1;
  }
  return floors;
}

export type SaleNfceResult =
  { ok: true; document: NfceDocument; input: NfceInput } | { ok: false; pending: string[] };

/**
 * Em homologação a SEFAZ exige este texto na descrição do primeiro item da NFC-e (rejeição 373).
 * O Bipaê só emite em homologação (regra 4 do projeto); confirmar na F3-11.b (dúvida D-030).
 */
export const HOMOLOGATION_FIRST_ITEM =
  'NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';

/** Nome do destinatário exigido em homologação (regra 598, Anexo I do MOC 7.0, NT 2011/002). */
export const HOMOLOGATION_RECIPIENT_NAME =
  'NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';

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

  const freight = prorateFreight(
    input.delivery?.feeCents ?? 0,
    input.items.map((i) => i.grossCents - i.discountCents),
  );
  const items: NfeItem[] = input.items.map((item, index) => {
    const label = `Item ${index + 1} (${item.description})`;
    if (!item.ncm) pending.push(`${label}: o produto não tem NCM.`);
    const settings = companyIcmsSettings(input.rules ?? [], item.ncm, date);
    const taxes = calculateSaleItemTaxes({
      company: { uf: c.uf, regime: regime?.id ?? null },
      profile: item.profile,
      // O frete compõe o valor da operação do item (base do ICMS, quando há destaque).
      item: { operationCents: item.grossCents - item.discountCents + freight[index]! },
      date,
      settings,
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
      ...(settings.benefitCode && { benefitCode: settings.benefitCode }),
      cfop: taxes.cfop ?? '',
      unit: item.unit,
      quantityMilli: item.quantityMilli,
      unitPriceCents: item.unitPriceCents,
      grossCents: item.grossCents,
      discountCents: item.discountCents,
      ...(freight[index]! > 0 && { freightCents: freight[index]! }),
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
      const rule = pdvPaymentRule(p.method, date, input.paymentCodes);
      payments.push({
        code: rule.code,
        amountCents: p.amountCents + (p.changeCents ?? 0),
        // Cartão sem TEF integrado (E10): tpIntegra 2, como uma maquininha avulsa.
        ...(rule.card && {
          card: {
            integration: '2' as const,
            ...(p.authorizationCode && { authorizationCode: p.authorizationCode }),
          },
        }),
      });
    } catch (error) {
      if (error instanceof PdvPaymentError) pending.push(error.message);
      else throw error;
    }
  }
  const changeCents = input.payments.reduce((s, p) => s + (p.changeCents ?? 0), 0);

  const taxId = onlyDigits(input.customerTaxId);
  const d = input.delivery;
  const deliveryCity =
    d?.address.cityCode && d.address.cityName && d.address.uf
      ? { code: d.address.cityCode, name: d.address.cityName, uf: d.address.uf }
      : null;
  if (d) {
    if (!taxId) {
      pending.push(
        'A venda para entrega precisa do CPF ou CNPJ do cliente na nota (regra 787 da SEFAZ).',
      );
    }
    if (!d.address.street.trim() || !d.address.number.trim() || !d.address.district.trim()) {
      pending.push('Falta o endereço de entrega (rua, número e bairro).');
    }
    if (!deliveryCity) pending.push('Falta o município do endereço de entrega.');
  }
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
    // Em homologação, o nome do destinatário é o texto oficial (regra 598 do MOC 7.0).
    ...(taxId && {
      customer:
        taxId.length === 11
          ? { cpf: taxId, name: HOMOLOGATION_RECIPIENT_NAME }
          : { cnpj: taxId, name: HOMOLOGATION_RECIPIENT_NAME },
    }),
    items,
    payments,
    ...(changeCents > 0 && { changeCents }),
    appVersion: input.appVersion,
    ...(input.contingency && { contingency: input.contingency }),
    ...(d &&
      deliveryCity && {
        delivery: {
          address: {
            street: d.address.street.trim(),
            number: d.address.number.trim(),
            ...(d.address.complement?.trim() && { complement: d.address.complement.trim() }),
            district: d.address.district.trim(),
            cityCode: deliveryCity.code,
            cityName: deliveryCity.name,
            uf: deliveryCity.uf,
            ...(onlyDigits(d.address.cep).length === 8 && { cep: onlyDigits(d.address.cep) }),
            ...(onlyDigits(d.address.phone).length >= 10 && { phone: onlyDigits(d.address.phone) }),
          },
          // Entrega própria: a loja é a transportadora (dúvida D-032).
          carrier: { cnpj, name: c.legalName },
        },
      }),
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

/**
 * A NFC-e da venda em contingência off-line, com o QR Code assinado pelo certificado (F3-15).
 * `enteredAt` é o momento em que o caixa ficou sem conexão (dhCont); o XML ainda precisa de
 * `signNfe` antes de ser guardado e transmitido.
 */
export async function buildSaleNfceContingency(
  input: Omit<SaleNfceInput, 'contingency'>,
  contingency: { enteredAt: string; reason: string },
  key: SigningKey | NfeSigner,
): Promise<SaleNfceResult> {
  const draft = buildSaleNfce({ ...input, contingency: { ...contingency, qrSignature: '-' } });
  if (!draft.ok) return draft;
  const payload = contingencyQrPayload({
    accessKey: draft.document.accessKey,
    issuedAt: draft.input.issuedAt,
    totalCents: draft.document.totalCents,
    customer: draft.input.customer ?? null,
  });
  const qrSignature = await signText(payload, key);
  return buildSaleNfce({ ...input, contingency: { ...contingency, qrSignature } });
}
