import { companyIcmsSettings, type CompanyIcmsRule } from '../company-rules';
import {
  brasiliaDateTime,
  HOMOLOGATION_RECIPIENT_NAME,
  prorateFreight,
  saleNumericCode,
  type SaleNfceCompany,
  type SaleNfceItem,
} from '../nfce/sale';
import { findCompanyRegime } from '../regimes';
import { calculateSaleItemTaxes, type SaleFiscalProfile, type TaxOutcome } from '../sale';
import { DEMONSTRATION, type DemonstrationNote } from '../tables/demonstration';
import { findCfop } from '../tables/cfop';
import { isImportedOrigin } from '../tables/icms-uf';
import { meiItemProblem } from '../tables/mei';
import { findPaymentMeans } from '../tables/payment-means';
import { findFcp } from '../tables/rates';
import { calculateDifal, type DifalBaseMode } from '../taxes/difal';
import {
  buildNfe,
  type NfeDocument,
  type NfeInput,
  NFE_FREIGHT,
  NFE_PRESENCE,
  type NfeRecipient,
} from './build';
import type { NfeItem, NfePayment } from './groups';

/**
 * Da NF-e preenchida na retaguarda ao XML (F3-33.a): a mesma conta de impostos da NFC-e do caixa,
 * com a UF do destinatário (alíquota interestadual, partilha do ICMS) e o CFOP de venda a não
 * contribuinte quando a tabela oficial tem um. O que impede a emissão volta em `pending`, com a
 * mensagem para quem vai resolver; nada é suposto.
 */

export interface NfeDraftRecipient {
  /** CPF (11 dígitos) ou CNPJ (14), com ou sem máscara. */
  taxId: string | null;
  name: string | null;
  /** 1 contribuinte do ICMS, 2 contribuinte isento de inscrição, 9 não contribuinte. */
  ieIndicator: 1 | 2 | 9 | null;
  ie?: string | null;
  email?: string | null;
  address: {
    street: string | null;
    number: string | null;
    complement?: string | null;
    district: string | null;
    cityCode: string | null;
    cityName: string | null;
    uf: string | null;
    cep: string | null;
    phone?: string | null;
  };
}

export interface NfeDraftItem extends SaleNfceItem {
  /** CFOP escolhido na nota; sem ele, vale o do perfil fiscal do produto. */
  cfop?: string | null;
}

export interface NfeDraftInput {
  /** Id do rascunho: dele sai o cNF, para a nota ter sempre a mesma chave nas novas tentativas. */
  draftId: string;
  company: SaleNfceCompany;
  series: number;
  number: number;
  /** Momento da emissão (ISO). */
  issuedAt: string;
  /** Natureza da operação, como "Venda de mercadoria". */
  nature: string;
  purpose: 'normal' | 'devolucao';
  presence: keyof typeof NFE_PRESENCE;
  /** Consumidor final? Sem a escolha, é quem não é contribuinte do ICMS (indicador 9). */
  finalConsumer?: boolean;
  /** Chaves das notas referenciadas (obrigatória na devolução). */
  references?: string[];
  recipient: NfeDraftRecipient;
  items: NfeDraftItem[];
  transport: {
    freight: keyof typeof NFE_FREIGHT;
    /** Valor do frete cobrado na nota, rateado nos itens pelo valor de cada um. */
    freightCents?: number;
    carrier?: NfeInput['transport']['carrier'];
    volumes?: NfeInput['transport']['volumes'];
  };
  /** Parcelas da venda a prazo (duplicatas). */
  installments?: { dueDate: string; amountCents: number }[];
  /** Pagamentos pelo código tPag da tabela oficial (90 = sem pagamento). */
  payments: { code: string; amountCents: number; description?: string | null }[];
  rules?: readonly CompanyIcmsRule[];
  /** Forma da base do DIFAL que a empresa escolheu com o contador (dúvida D-025). */
  difalBaseMode?: DifalBaseMode;
  additionalInfo?: string | null;
  appVersion: string;
  /**
   * Nota da venda condicional (Ajuste SINIEF 02/18, F5-12.c): a natureza, o CFOP e os textos vêm
   * do ato. Na remessa, no retorno e na entrada simbólica o imposto fica suspenso, e os itens usam
   * o perfil fiscal que a empresa escolheu para a demonstração (com o contador).
   */
  demonstration?: {
    note: DemonstrationNote;
    profile: (SaleFiscalProfile & { origem?: number }) | null;
  };
}

export type NfeDraftResult =
  | { ok: true; document: NfeDocument; input: NfeInput; notes: string[] }
  | { ok: false; pending: string[] };

const NON_CONTRIBUTOR = ', destinada a não contribuinte.';
/** Tamanho máximo da natureza da operação (natOp) no leiaute da NF-e. */
const NAT_OP_MAX = 60;
const onlyDigits = (text: string | null | undefined) => (text ?? '').replace(/\D/g, '');

/**
 * O CFOP "destinada a não contribuinte" da tabela oficial que corresponde ao CFOP de venda (6102 →
 * 6108, 6101 → 6107): mesmo grupo e o título do outro começa igual. Null quando não há.
 */
export function nonContributorCfop(cfop: string): string | null {
  const original = findCfop(cfop);
  if (!original || original.title.endsWith(NON_CONTRIBUTOR)) return null;
  let best: { code: string; base: string } | null = null;
  for (let n = 0; n < 100; n++) {
    const code = `${cfop.slice(0, 2)}${String(n).padStart(2, '0')}`;
    const candidate = code === cfop ? null : findCfop(code);
    if (!candidate?.title.endsWith(NON_CONTRIBUTOR)) continue;
    const base = candidate.title.slice(0, -NON_CONTRIBUTOR.length);
    const title = original.title.replace(/\.$/, '');
    if (
      (title === base || title.startsWith(`${base},`)) &&
      (!best || base.length > best.base.length)
    )
      best = { code, base };
  }
  return best?.code ?? null;
}

function result<R>(outcome: TaxOutcome<R>, name: string, pending: string[]): R | null {
  if (outcome.status === 'calculado') return outcome.result;
  if (outcome.status === 'nao-se-aplica') return null;
  pending.push(`${name}: ${outcome.reason}`);
  return null;
}

export function buildDraftNfe(input: NfeDraftInput): NfeDraftResult {
  const pending: string[] = [];
  const notes: string[] = [];
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

  // ---------------------------------------------------------------- destinatário
  const r = input.recipient;
  const ra = r.address;
  const want = (value: string | null | undefined, label: string) => {
    if (!value || !value.trim()) pending.push(`Falta ${label} do destinatário.`);
    return value?.trim() ?? '';
  };
  const taxId = onlyDigits(r.taxId);
  if (taxId.length !== 11 && taxId.length !== 14)
    pending.push('Falta o CPF ou o CNPJ do destinatário.');
  want(r.name, 'o nome');
  if (r.ieIndicator === null) {
    pending.push('Diga se o destinatário é contribuinte do ICMS (com inscrição estadual) ou não.');
  }
  const recipientIe = onlyDigits(r.ie);
  if (r.ieIndicator === 1 && !recipientIe)
    pending.push('Destinatário contribuinte do ICMS precisa da inscrição estadual.');
  const recipientAddress = {
    street: want(ra.street, 'a rua do endereço'),
    number: want(ra.number, 'o número do endereço'),
    district: want(ra.district, 'o bairro'),
    cityCode: want(ra.cityCode, 'o município'),
    cityName: want(ra.cityName, 'o município'),
    uf: want(ra.uf, 'a UF'),
    cep: onlyDigits(want(ra.cep, 'o CEP')),
  };
  const ieIndicator = r.ieIndicator ?? 9;
  const finalConsumer = input.finalConsumer ?? ieIndicator === 9;
  const ufDestino = recipientAddress.uf || uf;
  const interstate = Boolean(uf) && ufDestino !== uf;
  // EC 87/2015: só a venda interestadual para consumidor final não contribuinte leva a partilha.
  // ---------------------------------------------------------------- venda condicional
  const demo = input.demonstration ? DEMONSTRATION.notes[input.demonstration.note] : null;
  const suspended = Boolean(demo && !demo.taxed);
  const act = `${DEMONSTRATION.act}, cláusula ${demo?.clause ?? ''}`;
  if (demo?.references && !(input.references?.length ?? 0)) {
    pending.push(`Falta a chave da NF-e de remessa para demonstração (${act}).`);
  }
  if (suspended && interstate) {
    pending.push(
      'A nota da venda condicional para cliente de outro estado ainda não é emitida pelo Bipaê.',
    );
  }
  const demoProfile = input.demonstration?.profile ?? null;
  if (suspended && !demoProfile) {
    pending.push(
      'Escolha em Empresas e lojas o perfil fiscal da venda condicional (demonstração), com o contador.',
    );
  }
  if (suspended && demoProfile && regime?.icmsCode === 'cst' && demoProfile.cstIcms !== '50') {
    pending.push(
      `Na demonstração o ICMS fica suspenso (${DEMONSTRATION.act}, cláusula quarta): o perfil fiscal da venda condicional precisa do CST 50 (suspensão).`,
    );
  }
  const direction = demo?.direction ?? 'saida';
  // O leiaute aceita até 60 caracteres na natureza da operação; o texto do Ajuste para a entrada
  // simbólica tem mais. Sem abreviação oficial (dúvida D-035), vale a que a empresa escrever na
  // nota, e o texto completo vai nas informações complementares.
  const officialNature = demo?.nature ?? null;
  const tooLong = officialNature !== null && officialNature.length > NAT_OP_MAX;
  const typedNature = input.nature.trim();
  if (
    tooLong &&
    (!typedNature || typedNature === 'Venda de mercadoria' || typedNature.length > NAT_OP_MAX)
  ) {
    pending.push(
      `A natureza do Ajuste ("${officialNature}") passa dos ${NAT_OP_MAX} caracteres do leiaute. Escreva na nota a forma abreviada combinada com o contador; o texto completo vai nas informações complementares.`,
    );
  }
  const nature =
    officialNature && !tooLong
      ? officialNature
      : tooLong
        ? typedNature
        : typedNature || 'Venda de mercadoria';
  // EC 87/2015: só a venda interestadual para consumidor final não contribuinte leva a partilha;
  // na demonstração ela fica suspensa junto (cláusula quarta, § 1º).
  const needsDifal =
    !suspended && regime?.crt !== 4 && interstate && finalConsumer && ieIndicator === 9;

  // ---------------------------------------------------------------- itens
  const date = brasiliaDateTime(input.issuedAt).slice(0, 10);
  if (input.items.length === 0) pending.push('A nota precisa de pelo menos um item.');
  const freight = prorateFreight(
    input.transport.freightCents ?? 0,
    input.items.map((i) => i.grossCents - i.discountCents),
  );
  const items = input.items.map((item, index): NfeItem | null => {
    const label = `Item ${index + 1} (${item.description})`;
    if (!item.ncm) pending.push(`${label}: o produto não tem NCM.`);
    // Remessa, retorno e entrada simbólica: o perfil da demonstração, com a origem do produto.
    const profile =
      suspended && demoProfile
        ? { ...demoProfile, origem: item.profile?.origem ?? 0 }
        : suspended
          ? null
          : item.profile;
    const settings = suspended ? {} : companyIcmsSettings(input.rules ?? [], item.ncm, date);
    const imported = isImportedOrigin(item.profile?.origem);
    const operationCents = item.grossCents - item.discountCents + freight[index]!;
    const taxes = calculateSaleItemTaxes({
      company: { uf: c.uf, regime: regime?.id ?? null },
      profile,
      item: { operationCents, ufDestino, imported },
      date,
      settings,
      model: '55',
    });
    let cfop =
      suspended && demo?.cfop
        ? interstate
          ? demo.cfop.interestadual
          : demo.cfop.interna
        : item.cfop?.trim() || taxes.cfop || '';
    // Venda a não contribuinte: a tabela oficial de CFOP tem o código próprio (6.108, 6.107).
    if (!suspended && !item.cfop && interstate && ieIndicator === 9 && cfop) {
      const other = nonContributorCfop(cfop);
      const csosn = item.profile?.csosn ?? null;
      const allowed =
        regime?.id !== 'mei' || (other && !meiItemProblem({ model: '55', csosn, cfop: other }));
      if (other && allowed) {
        notes.push(`${label}: CFOP ${other} (venda a não contribuinte), no lugar do ${cfop}.`);
        cfop = other;
      }
    }
    if (!cfop) pending.push(`${label}: falta o CFOP no perfil fiscal do produto.`);
    if (suspended && !profile) return null;
    const icms = result(taxes.icms, `${label}, ICMS`, pending);
    const pis = result(taxes.pis, `${label}, PIS`, pending);
    const cofins = result(taxes.cofins, `${label}, COFINS`, pending);
    const ibsCbs = result(taxes.ibsCbs, `${label}, IBS/CBS`, pending);
    for (const note of taxes.assumptions) notes.push(`${label}: ${note}`);
    let difal = null;
    if (needsDifal) {
      try {
        difal = calculateDifal({
          ufOrigem: uf,
          ufDestino,
          baseCents: operationCents,
          imported,
          ...(input.difalBaseMode && { baseMode: input.difalBaseMode }),
        });
        if (difal.assumption) notes.push(`${label}: ${difal.assumption}`);
      } catch (error) {
        pending.push(`${label}, partilha do ICMS: ${(error as Error).message}`);
      }
    }
    return {
      code: item.code,
      gtin: item.barcodes.find((b) => /^\d{8}$|^\d{12,14}$/.test(b) && !b.startsWith('2')) ?? null,
      description: item.description,
      ncm: item.ncm ?? '',
      ...(item.cest && { cest: item.cest }),
      ...(settings.benefitCode && { benefitCode: settings.benefitCode }),
      cfop,
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
      ...(difal && { difal }),
    };
  });

  // ---------------------------------------------------------------- pagamento e cobrança
  const payments: NfePayment[] = [];
  // Remessa, retorno e entrada simbólica não têm pagamento (tPag 90).
  const paid = suspended ? [{ code: '90', amountCents: 0, description: null }] : input.payments;
  for (const p of paid) {
    const means = findPaymentMeans(p.code, date);
    if (!means) {
      pending.push(`Meio de pagamento ${p.code} não existe na tabela oficial em ${date}.`);
      continue;
    }
    payments.push({
      code: p.code,
      amountCents: p.amountCents,
      ...(p.description?.trim() && { description: p.description.trim() }),
      // Cartão sem TEF integrado (E10): tpIntegra 2, como uma maquininha avulsa.
      ...(['03', '04'].includes(p.code) && { card: { integration: '2' as const } }),
    });
  }
  if (payments.length === 0 && paid.length === 0)
    pending.push('Informe o pagamento (ou "sem pagamento", na devolução e na remessa).');
  const installments = suspended ? [] : (input.installments ?? []);

  if (pending.length > 0) return { ok: false, pending: [...new Set(pending)] };

  const recipient: NfeRecipient = {
    ...(taxId.length === 11 ? { cpf: taxId } : { cnpj: taxId }),
    // Em homologação, o nome do destinatário é o texto oficial (regra 598 do MOC 7.0).
    name: HOMOLOGATION_RECIPIENT_NAME,
    ieIndicator,
    ...(ieIndicator === 1 && { ie: recipientIe }),
    ...(r.email?.trim() && { email: r.email.trim() }),
    address: {
      ...recipientAddress,
      ...(ra.complement?.trim() && { complement: ra.complement.trim() }),
      ...(onlyDigits(ra.phone).length >= 10 && { phone: onlyDigits(ra.phone) }),
    },
  };
  // Os textos obrigatórios do Ajuste vêm antes do que a pessoa escreveu.
  const additionalInfo = [
    ...(tooLong ? [`Natureza da operação: ${officialNature}`] : []),
    ...(demo?.texts ?? []),
    input.additionalInfo?.trim(),
  ]
    .filter(Boolean)
    .join('. ');
  const nfe: NfeInput = {
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
    // cUF da tabela oficial de UFs (a mesma do FCP).
    cUF: findFcp(uf)?.cUF ?? '',
    series: input.series,
    number: input.number,
    issuedAt: brasiliaDateTime(input.issuedAt),
    numericCode: saleNumericCode(input.draftId, input.number),
    nature,
    direction,
    purpose: input.purpose,
    presence: input.presence,
    finalConsumer,
    ...(input.references?.length && { references: input.references }),
    recipient,
    items: items.filter((i): i is NfeItem => i !== null),
    transport: {
      freight: input.transport.freight,
      ...(input.transport.carrier && { carrier: input.transport.carrier }),
      ...(input.transport.volumes?.length && { volumes: input.transport.volumes }),
    },
    payments,
    ...(additionalInfo && { additionalInfo }),
    appVersion: input.appVersion,
  };
  try {
    const document = buildNfe(nfe);
    if (installments.length === 0) return { ok: true, document, input: nfe, notes };
    // Fatura e duplicatas: o número da fatura é o da nota; as parcelas somam o total.
    const withBilling: NfeInput = {
      ...nfe,
      billing: {
        invoice: {
          number: String(input.number),
          originalCents: document.totalCents,
          discountCents: 0,
        },
        installments: installments.map((d, i) => ({
          number: String(i + 1).padStart(3, '0'),
          dueDate: d.dueDate,
          amountCents: d.amountCents,
        })),
      },
    };
    return { ok: true, document: buildNfe(withBilling), input: withBilling, notes };
  } catch (error) {
    // Erro de montagem (CFOP, destinatário, parcelas): volta como pendência, com a mensagem.
    if (error instanceof Error) return { ok: false, pending: [error.message] };
    throw error;
  }
}
