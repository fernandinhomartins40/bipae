import { dec, round } from '../decimal';
import {
  C100_CANCELLED_FIELDS,
  C100_NFCE_BLANK_FIELDS,
  C100_PIS_COFINS_FIELDS,
  C190_REDUCED_BASE_CSTS,
  E110_CFOP_SIDE,
  E110_SITUATIONS,
  E116_ICMS_DUE_CODE,
  EFD_1010_ANSWERS,
  EFD_BLOCK_ORDER,
  EFD_BRAZIL_COUNTRY,
  EFD_DOCUMENT_SITUATION,
  EFD_EMPTY_BLOCKS,
  EFD_INVENTORY_MAX_MONTHS_AFTER,
  EFD_INVENTORY_OWNERSHIP_WITH_PARTY,
  EFD_INVENTORY_REASONS,
  EFD_ITEM_TYPE_RESALE,
  EFD_LAYOUT_VERSIONS,
  EFD_REGISTERS,
  EFD_YEAR_END_INVENTORY,
  type EfdBlock,
  type EfdFieldName,
  type EfdRegister,
} from './layout';
import {
  EFD_CIAP_ACCOUNT,
  EFD_CIAP_ADJUSTMENT_CODE,
  EFD_CIAP_COST_CENTERS,
  EFD_CIAP_DEFAULT_COST_CENTER,
  EFD_CIAP_RULES,
  planCiap,
  type CiapOutput,
  type CiapPlan,
  type EfdCiap,
} from './ciap';
import {
  EFD_ENTRY_RULES,
  purchaseLines,
  type EfdPurchasePurpose,
  type PurchaseLine,
} from './entry';
import { EfdError, type EfdDocument, type EfdParty } from './read';

/**
 * Gerador do arquivo da EFD ICMS/IPI do mês (F4-14.b), puro: recebe a empresa e as notas lidas
 * do XML autorizado e devolve o texto do arquivo, a apuração e os avisos do que falta. Segue o
 * Guia Prático versão 3.2.2 e o leiaute 020; as regras do leiaute estão em `layout.ts`.
 */

export interface EfdCompany {
  legalName: string;
  tradeName?: string;
  cnpj: string;
  ie: string;
  uf: string;
  /** Código IBGE do município (7 dígitos). */
  cityCode: string;
  municipalRegistration?: string;
  cep?: string;
  street?: string;
  number?: string;
  complement?: string;
  district?: string;
  phone?: string;
  email?: string;
}

/** Contabilista responsável (registro 0100). */
export interface EfdAccountant {
  name: string;
  cpf?: string;
  crc?: string;
  /** CNPJ do escritório, se houver. */
  cnpj?: string;
  cep?: string;
  street?: string;
  number?: string;
  complement?: string;
  district?: string;
  phone?: string;
  email?: string;
  cityCode?: string;
}

export interface EfdEntry {
  /** Como a SEFAZ deixou a nota: autorizada ou cancelada depois. */
  status: 'authorized' | 'cancelled';
  document: EfdDocument;
}

/** O produto da empresa ligado a um item da nota de compra (0200 e 0220). */
export interface EfdProduct {
  /** Código próprio do item, o mesmo usado nas notas de venda (0200, campo 02). */
  code: string;
  name: string;
  /** Unidade do estoque (0200, campo 06). */
  unit: string;
  /** Unidades de estoque por unidade da nota (0220, campo 03), como texto decimal. */
  factor: string;
  ncm?: string;
  cest?: string;
  barcode?: string;
}

/** Nota de compra (de terceiros) que entrou no mês (F4-14.b.2). */
export interface EfdPurchase {
  /** Data da entrada na empresa (AAAA-MM-DD), que decide o mês do arquivo (C100, DT_E_S). */
  enteredOn: string;
  purpose: EfdPurchasePurpose;
  document: EfdDocument;
  /** Produto da empresa em cada item da nota, pelo número do item. */
  products: Readonly<Record<number, EfdProduct>>;
}

/** O inventário de 31/12 do arquivo de fevereiro (data e motivo), para quem monta o pedido. */
export { EFD_YEAR_END_INVENTORY } from './layout';

/** Um item do inventário (H010) com o que o 0200 e o 0190 pedem para ele. */
export interface EfdInventoryItem {
  /** Código próprio do item (0200, COD_ITEM): o mesmo das notas e do cadastro. */
  code: string;
  description: string;
  /** Unidade de medida do estoque (0200, UNID_INV; H010, UNID). */
  unit: string;
  unitDescription?: string;
  barcode?: string;
  ncm?: string;
  cest?: string;
  /** Quantidade em texto decimal ("12.5"), com até 3 casas no arquivo. */
  quantity: string;
  /** Custo unitário em centavos; com ele o valor do item sai de quantidade × custo. */
  unitCostCents?: number;
  /** Valor do item em centavos; se vier, vale no lugar da conta. */
  valueCents?: number;
  /** IND_PROP: 0 próprio em poder do informante, 1 próprio com terceiros, 2 de terceiros. */
  ownership?: '0' | '1' | '2';
  /** Dono ou possuidor quando não é o informante (vai no 0150 e no COD_PART). */
  party?: EfdParty;
  note?: string;
  accountCode?: string;
  /** H020 (motivos 02 a 05): CST, base e ICMS unitários, em centavos. */
  icms?: { cst: string; baseCents: number; icmsCents: number };
}

/** Inventário do bloco H: uma data, o motivo (MOT_INV) e os itens contados. */
export interface EfdInventory {
  /** Data do inventário (AAAA-MM-DD). */
  date: string;
  /** MOT_INV; o padrão é "01", no final do período. */
  reason?: string;
  items: EfdInventoryItem[];
}

export interface EfdInput {
  /** Mês da escrituração (AAAA-MM). */
  month: string;
  company: EfdCompany;
  /** Perfil definido pelo fisco estadual para o estabelecimento (0000, campo 14). */
  profile: 'A' | 'B' | 'C';
  accountant?: EfdAccountant;
  entries: EfdEntry[];
  /** Notas de compra; sem elas o arquivo avisa que o crédito das compras não entrou. */
  purchases?: EfdPurchase[];
  /** A empresa é do Simples (as compras não dão crédito de ICMS, LC 123/2006, art. 23). */
  simples?: boolean;
  /** Inventário (bloco H); sem ele o bloco vai sem movimento. */
  inventory?: EfdInventory;
  /** Bens do ativo no CIAP (bloco G, F4-14.b.7); sem eles o bloco vai sem movimento. */
  ciap?: EfdCiap;
  /** Saldo credor do período anterior, em centavos (E110, campo 10). */
  previousCreditCents?: number;
  /** Vencimento do ICMS a recolher (AAAA-MM-DD) e código de receita da UF (E116). */
  icmsDueDate?: string;
  icmsRevenueCode?: string;
  /** Arquivo substituto (COD_FIN 1) em vez do original. */
  replacement?: boolean;
}

export interface EfdSettlement {
  debitsCents: number;
  creditsCents: number;
  /** Ajustes a crédito do E111 (hoje, o crédito do ativo pelo CIAP). */
  adjustmentCreditsCents: number;
  previousCreditCents: number;
  balanceCents: number;
  dueCents: number;
  creditCarriedCents: number;
}

export interface EfdResult {
  fileName: string;
  /** Texto do arquivo, linhas terminadas em CR LF; grave em ISO 8859-1 (`encodeEfdLatin1`). */
  text: string;
  lineCount: number;
  /** Quantas linhas de cada registro (o mesmo que vai nos 9900). */
  registerCounts: Record<string, number>;
  settlement: EfdSettlement;
  /** O CIAP do mês: o crédito apropriado e a parcela de cada bem (para o controle dos bens). */
  ciap?: {
    appropriationCents: number;
    installments: { code: string; installment: number }[];
  };
  /** O que o arquivo ainda não cobre ou falta configurar, em português para o usuário. */
  warnings: string[];
}

type Value = string | number | undefined | null;
type Line = { reg: EfdRegister; text: string };

/** Caracteres de controle e o "|" (separador do arquivo) viram espaço. */
const clean = (text: string) =>
  [...text]
    .map((ch) => (ch.charCodeAt(0) < 32 || ch === '\u007f' || ch === '|' ? ' ' : ch))
    .join('');

/** Formata um campo pelo tipo do leiaute (Guia, Capítulo II, Seção 3). */
function formatField(type: string, value: Value, name: string): string {
  if (value === undefined || value === null || value === '') return '';
  const text = String(value);
  switch (type) {
    case 'text':
      return clean(text).replace(/\s+/g, ' ').trim();
    case 'date': {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
      if (!m) throw new EfdError(`Data inválida no campo ${name}: ${text}`);
      return `${m[3]}${m[2]}${m[1]}`;
    }
    case 'monthYear': {
      const m = /^(\d{4})-(\d{2})$/.exec(text);
      if (!m) throw new EfdError(`Mês inválido no campo ${name}: ${text}`);
      return `${m[2]}${m[1]}`;
    }
    case 'money': {
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        throw new EfdError(`Valor inválido no campo ${name}: ${text}`);
      }
      return `${Math.trunc(value / 100)},${String(value % 100).padStart(2, '0')}`;
    }
    case 'rate':
      return dec(text).toFixed(2).replace('.', ',');
    case 'quantity':
      return dec(text).toFixed(5).replace('.', ',');
    case 'factor':
      return dec(text).toFixed(6).replace('.', ',');
    case 'quantity3':
      return dec(text).toFixed(3).replace('.', ',');
    case 'index':
      return dec(text).toFixed(8).replace('.', ',');
    default:
      return text;
  }
}

/** Uma linha do arquivo: |REG|campo|campo|...| com todos os campos do leiaute, na ordem. */
function record<R extends EfdRegister>(
  reg: R,
  values: Partial<Record<EfdFieldName<R>, Value>>,
): Line {
  const fields = EFD_REGISTERS[reg] as readonly (readonly [string, string])[];
  const given = values as Record<string, Value>;
  const cells = fields.map(([name, type]) => formatField(type, given[name], name));
  return { reg, text: `|${reg}|${cells.join('|')}|` };
}

const digits = (value: string | undefined) => (value ?? '').replace(/\D/g, '') || undefined;

function lastDay(month: string): string {
  const [year, m] = month.split('-').map(Number) as [number, number];
  const day = new Date(Date.UTC(year, m, 0)).getUTCDate();
  return `${month}-${String(day).padStart(2, '0')}`;
}

function layoutVersion(end: string): string {
  const version = EFD_LAYOUT_VERSIONS.find((v) => v.validFrom <= end && end <= v.validTo);
  if (!version) {
    throw new EfdError(
      `O leiaute da EFD para ${end.slice(0, 4)} ainda não está no Bipaê. Falta a Nota Técnica do ano.`,
    );
  }
  return version.code;
}

function checkCompany(company: EfdCompany) {
  const missing = [
    [company.legalName, 'a razão social'],
    [digits(company.cnpj), 'o CNPJ'],
    [company.ie, 'a inscrição estadual'],
    [company.uf, 'a UF'],
    [/^\d{7}$/.test(company.cityCode ?? '') ? company.cityCode : '', 'o município (código IBGE)'],
  ]
    .filter(([value]) => !value)
    .map(([, label]) => `Falta ${label} da empresa (Empresas e lojas).`);
  if (missing.length > 0) throw new EfdError(missing.join(' '));
}

const partyCode = (p: EfdParty) => p.cnpj ?? p.cpf ?? `EX${p.foreignId ?? ''}`;

interface Analytic {
  cst: string;
  cfop: string;
  rate: string;
  operationCents: number;
  baseCents: number;
  icmsCents: number;
  stBaseCents: number;
  stCents: number;
  reducedCents: number;
  ipiCents: number;
}

/** Uma linha para o C190: o item com o CST, o CFOP e o ICMS que valem no arquivo. */
interface AnalyticSource {
  cst: string;
  cfop: string;
  rate: string;
  goodsCents: number;
  baseCents: number;
  icmsCents: number;
  stBaseCents: number;
  stCents: number;
  ipiCents: number;
}

const goodsOf = (item: EfdDocument['items'][number]) =>
  item.productCents +
  item.freightCents +
  item.insuranceCents +
  item.otherCents -
  item.discountCents;

/** C190: soma as linhas por CST, CFOP e alíquota, como o registro pede. */
function analytics(sources: AnalyticSource[]): Analytic[] {
  const groups = new Map<string, Analytic>();
  for (const item of sources) {
    const rate = dec(item.rate).toFixed(2);
    const key = `${item.cst}|${item.cfop}|${rate}`;
    const g = groups.get(key) ?? {
      cst: item.cst,
      cfop: item.cfop,
      rate,
      operationCents: 0,
      baseCents: 0,
      icmsCents: 0,
      stBaseCents: 0,
      stCents: 0,
      reducedCents: 0,
      ipiCents: 0,
    };
    g.operationCents += item.goodsCents + item.stCents + item.ipiCents;
    g.baseCents += item.baseCents;
    g.icmsCents += item.icmsCents;
    g.stBaseCents += item.stBaseCents;
    g.stCents += item.stCents;
    g.ipiCents += item.ipiCents;
    // Só o CST de 3 dígitos (regime normal) tem redução de base: 20 e 70 na Tabela B.
    if (item.cst.length === 3 && C190_REDUCED_BASE_CSTS.includes(item.cst.slice(1))) {
      g.reducedCents += Math.max(0, item.goodsCents - item.baseCents);
    }
    groups.set(key, g);
  }
  return [...groups.values()].sort(
    (a, b) =>
      a.cst.localeCompare(b.cst) ||
      a.cfop.localeCompare(b.cfop) ||
      dec(a.rate).comparedTo(dec(b.rate)),
  );
}

/** Itens da nota própria (venda ou entrada emitida pela empresa), como estão no XML. */
const ownSources = (doc: EfdDocument): AnalyticSource[] =>
  doc.items.map((item) => ({
    cst: item.cstIcms,
    cfop: item.cfop,
    rate: item.icmsRate,
    goodsCents: goodsOf(item),
    baseCents: item.icmsBaseCents,
    icmsCents: item.icmsCents,
    stBaseCents: item.stBaseCents,
    stCents: item.stCents,
    ipiCents: item.ipiCents,
  }));

/** Linhas da compra, sob o enfoque da empresa (entry.ts). */
const purchaseSources = (lines: PurchaseLine[]): AnalyticSource[] =>
  lines.map((l) => ({
    cst: l.cst,
    cfop: l.cfop,
    rate: l.icmsRate,
    goodsCents: goodsOf(l.item),
    baseCents: l.icmsBaseCents,
    icmsCents: l.icmsCents,
    stBaseCents: l.stBaseCents,
    stCents: l.stCents,
    ipiCents: l.item.ipiCents,
  }));

const sum = (list: Analytic[], field: keyof Analytic) =>
  list.reduce((total, g) => total + (g[field] as number), 0);

function situation(entry: EfdEntry): string {
  if (entry.status === 'cancelled') return EFD_DOCUMENT_SITUATION.cancelled;
  if (entry.document.purpose === '2') return EFD_DOCUMENT_SITUATION.complementary;
  return EFD_DOCUMENT_SITUATION.regular;
}

interface PreparedItem {
  item: EfdInventoryItem;
  valueCents: number;
  /** Valor unitário em reais, texto decimal. */
  unitValue: string;
}

interface PreparedInventory {
  date: string;
  reason: string;
  items: PreparedItem[];
  totalCents: number;
}

/**
 * Confere o inventário pelas validações do Guia (H005 e H010) e calcula o valor de cada item em
 * centavos inteiros (quantidade × custo, meio para cima). Itens sem quantidade ficam de fora; se
 * o total der zero, o H005 vai com valor 0 e sem H010 ("sem estoque").
 */
function prepareInventory(inventory: EfdInventory, month: string, end: string): PreparedInventory {
  const reason = inventory.reason ?? EFD_YEAR_END_INVENTORY.reason;
  const rule = EFD_INVENTORY_REASONS[reason];
  if (!rule) throw new EfdError(`Motivo de inventário inválido: ${reason}.`);
  if (!rule.supported) {
    throw new EfdError(
      `O inventário ${rule.label} (motivo ${reason}) ainda não é gerado pelo Bipaê.`,
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inventory.date)) {
    throw new EfdError(`Data do inventário inválida: ${inventory.date}.`);
  }
  if (inventory.date > end) {
    throw new EfdError('A data do inventário não pode ser depois do fim do mês do arquivo.');
  }
  if (reason === EFD_YEAR_END_INVENTORY.reason) {
    const index = (ym: string) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7));
    if (index(month) - index(inventory.date.slice(0, 7)) > EFD_INVENTORY_MAX_MONTHS_AFTER) {
      throw new EfdError(
        `O inventário de ${inventory.date.split('-').reverse().join('/')} só pode ir até o segundo mês seguinte à data.`,
      );
    }
  }
  const seen = new Set<string>();
  const items: PreparedItem[] = [];
  for (const item of inventory.items) {
    if (!item.code || item.code.length > 60) {
      throw new EfdError(`Código de item inválido no inventário: ${item.code}.`);
    }
    if (seen.has(item.code)) throw new EfdError(`Item repetido no inventário: ${item.code}.`);
    seen.add(item.code);
    if (!item.unit || item.unit.length > 6) {
      throw new EfdError(`Unidade inválida no item ${item.code} (até 6 caracteres).`);
    }
    if (!/^\d+(\.\d+)?$/.test(item.quantity)) {
      throw new EfdError(`Quantidade inválida no item ${item.code}: ${item.quantity}.`);
    }
    const quantity = dec(item.quantity);
    if (quantity.isZero()) continue;
    const ownership = item.ownership ?? '0';
    if (EFD_INVENTORY_OWNERSHIP_WITH_PARTY.includes(ownership) && !item.party) {
      throw new EfdError(
        `Informe o dono ou possuidor do item ${item.code} (propriedade ${ownership}).`,
      );
    }
    if (item.valueCents === undefined && item.unitCostCents === undefined) {
      throw new EfdError(`Falta o custo do item ${item.code} no inventário.`);
    }
    const valueCents =
      item.valueCents ?? round(quantity.mul(item.unitCostCents!), 0, 'half-up').toNumber();
    if (!Number.isSafeInteger(valueCents) || valueCents < 0) {
      throw new EfdError(`Valor inválido no item ${item.code} do inventário.`);
    }
    const unitValue =
      item.unitCostCents !== undefined && item.valueCents === undefined
        ? dec(item.unitCostCents).div(100)
        : dec(valueCents).div(100).div(quantity);
    if (rule.h020 && !item.icms) {
      throw new EfdError(
        `O inventário ${rule.label} pede o CST, a base e o ICMS do item ${item.code} (H020).`,
      );
    }
    items.push({ item, valueCents, unitValue: unitValue.toFixed(6) });
  }
  const totalCents = items.reduce((total, p) => total + p.valueCents, 0);
  return {
    date: inventory.date,
    reason,
    items: totalCents > 0 ? items.sort((a, b) => a.item.code.localeCompare(b.item.code)) : [],
    totalCents,
  };
}

/** Bloco H com movimento: H001, H005, um H010 por item (e o H020 dos motivos que pedem). */
function inventoryBlock(inventory: PreparedInventory): Line[] {
  const rule = EFD_INVENTORY_REASONS[inventory.reason]!;
  return [
    record('H001', { IND_MOV: '0' }),
    record('H005', {
      DT_INV: inventory.date,
      VL_INV: inventory.totalCents,
      MOT_INV: inventory.reason,
    }),
    ...inventory.items.flatMap(({ item, valueCents, unitValue }) => {
      const ownership = item.ownership ?? '0';
      return [
        record('H010', {
          COD_ITEM: item.code,
          UNID: item.unit,
          QTD: item.quantity,
          VL_UNIT: unitValue,
          VL_ITEM: valueCents,
          IND_PROP: ownership,
          COD_PART: item.party && partyCode(item.party),
          TXT_COMPL: item.note,
          COD_CTA: item.accountCode,
        }),
        ...(rule.h020 && item.icms
          ? [
              record('H020', {
                CST_ICMS: item.icms.cst,
                BC_ICMS: item.icms.baseCents,
                VL_ICMS: item.icms.icmsCents,
              }),
            ]
          : []),
      ];
    }),
  ];
}

interface CiapLines {
  plan: CiapPlan;
  /** 0300 e 0305 de cada bem, 0500 da conta e 0600 dos centros de custo (bloco 0). */
  registry: Line[];
  /** G001, G110, G125 e, no mês da entrada, G130 e G140. */
  block: Line[];
}

/**
 * Bloco G e cadastros do bloco 0 do CIAP (Guia 3.2.2). O G130 e o G140 vão no mês da entrada do
 * bem (IM), com a nota de compra do próprio arquivo; nos meses seguintes o bem vai como SI.
 */
function ciapLines(
  plan: CiapPlan,
  ciap: EfdCiap,
  purchasesByKey: Map<string, { purchase: EfdPurchase; lines: PurchaseLine[] }>,
  start: string,
  end: string,
): CiapLines {
  const account = ciap.account!;
  if (!account.code || account.code.length > 60 || !account.name) {
    throw new EfdError('Conta contábil do ativo inválida (código até 60 caracteres e nome).');
  }
  if (!Number.isInteger(account.level) || account.level < 1) {
    throw new EfdError('Informe o nível da conta contábil do ativo (1 ou mais).');
  }
  const assets = new Map(plan.movements.map((m) => [m.asset.code, m.asset]));
  const costCenters = new Set<string>();
  const registry: Line[] = [];
  for (const asset of assets.values()) {
    const center = asset.costCenter ?? EFD_CIAP_DEFAULT_COST_CENTER;
    if (!EFD_CIAP_COST_CENTERS[center]) {
      throw new EfdError(`Centro de custo inválido no bem ${asset.code}: ${center}.`);
    }
    costCenters.add(center);
    registry.push(
      record('0300', {
        COD_IND_BEM: asset.code,
        // 1 = bem: o Bipaê não controla componentes de bem em construção.
        IDENT_MERC: '1',
        DESCR_ITEM: asset.description,
        COD_CTA: account.code,
        NR_PARC: asset.installments ?? EFD_CIAP_RULES.installments,
      }),
      record('0305', {
        COD_CCUS: center,
        FUNC: asset.usage || 'Uso nas atividades do estabelecimento',
      }),
    );
  }
  // DT_ALT não pode passar do fim do período (Guia, 0500 e 0600).
  const since = account.since && account.since <= end ? account.since : start;
  registry.push(
    record('0500', {
      DT_ALT: since,
      COD_NAT_CC: EFD_CIAP_ACCOUNT.nature,
      IND_CTA: EFD_CIAP_ACCOUNT.kind,
      NIVEL: account.level,
      COD_CTA: account.code,
      NOME_CTA: account.name,
    }),
    ...[...costCenters]
      .sort()
      .map((center) =>
        record('0600', { DT_ALT: since, COD_CCUS: center, CCUS: EFD_CIAP_COST_CENTERS[center] }),
      ),
  );

  const block: Line[] = [
    record('G001', { IND_MOV: '0' }),
    record('G110', {
      DT_INI: start,
      DT_FIN: end,
      SALDO_IN_ICMS: plan.openingCents,
      SOM_PARC: plan.parcelsCents,
      VL_TRIB_EXP: plan.index.taxedCents,
      VL_TOTAL: plan.index.totalCents,
      IND_PER_SAI: plan.index.index,
      ICMS_APROP: plan.appropriationCents,
      SOM_ICMS_OC: 0,
    }),
  ];
  for (const m of plan.movements) {
    const icms = m.asset.icms;
    block.push(
      record('G125', {
        COD_IND_BEM: m.asset.code,
        DT_MOV: m.date,
        TIPO_MOV: m.type,
        VL_IMOB_ICMS_OP: m.withValues ? icms.ownCents : undefined,
        VL_IMOB_ICMS_ST: m.withValues ? icms.stCents : undefined,
        VL_IMOB_ICMS_FRT: m.withValues ? icms.freightCents : undefined,
        VL_IMOB_ICMS_DIF: m.withValues ? icms.difalCents : undefined,
        NUM_PARC: m.installment,
        VL_PARC_PASS: m.parcelCents,
      }),
    );
    if (m.type !== 'IM') continue;
    // IM: o G130 é obrigatório (Guia, G130), com a nota de compra que trouxe o bem.
    const source = m.asset.source;
    const found = source && purchasesByKey.get(source.accessKey);
    const line = found && found.lines.find((l) => l.item.line === source.line);
    if (!found || !line || !found.purchase.document.issuer) {
      throw new EfdError(
        `O bem ${m.asset.description} entrou no mês e a nota de compra dele não está no arquivo (G130).`,
      );
    }
    const d = found.purchase.document;
    const product = found.purchase.products[line.item.line]!;
    block.push(
      record('G130', {
        IND_EMIT: '1',
        COD_PART: partyCode(d.issuer!),
        COD_MOD: d.model,
        SERIE: String(d.series).padStart(3, '0'),
        NUM_DOC: d.number,
        CHV_NFE_CTE: d.accessKey,
        DT_DOC: d.issuedOn,
      }),
      record('G140', {
        NUM_ITEM: line.item.line,
        COD_ITEM: product.code,
        QTDE: line.item.quantity,
        UNID: line.item.unit,
        VL_ICMS_OP_APLICADO: icms.ownCents,
        VL_ICMS_ST_APLICADO: icms.stCents,
        VL_ICMS_FRT_APLICADO: icms.freightCents,
        VL_ICMS_DIF_APLICADO: icms.difalCents,
      }),
    );
  }
  return { plan, registry, block };
}

/** Monta o arquivo da EFD ICMS/IPI do mês. */
export function buildEfdIcmsIpi(input: EfdInput): EfdResult {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month)) throw new EfdError('Mês inválido (AAAA-MM).');
  checkCompany(input.company);
  const start = `${input.month}-01`;
  const end = lastDay(input.month);
  const version = layoutVersion(end);
  const company = input.company;
  const warnings: string[] = [];

  const entries = [...input.entries].sort(
    (a, b) =>
      a.document.model.localeCompare(b.document.model) ||
      a.document.series - b.document.series ||
      a.document.number - b.document.number,
  );
  for (const { document: d } of entries) {
    if (d.issuedOn < start || d.issuedOn > end) {
      throw new EfdError(`A nota ${d.number} (série ${d.series}) não é do mês ${input.month}.`);
    }
  }

  // Bloco C e, ao mesmo tempo, a apuração do E110 a partir dos próprios C190.
  const blockC: Line[] = [];
  const participants = new Map<string, EfdParty>();
  let debits = 0;
  let credits = 0;
  const outputs: CiapOutput[] = [];
  for (const entry of entries) {
    const d = entry.document;
    const sit = situation(entry);
    const groups = entry.status === 'cancelled' ? [] : analytics(ownSources(d));
    const recipient = d.model === '55' && entry.status !== 'cancelled' ? d.recipient : undefined;
    if (recipient) participants.set(partyCode(recipient), recipient);
    const movedOn =
      d.direction === 'in' && d.movedOn && d.movedOn >= d.issuedOn && d.movedOn <= end
        ? d.movedOn
        : d.issuedOn;
    const values: Partial<Record<EfdFieldName<'C100'>, Value>> = {
      IND_OPER: d.direction === 'out' ? '1' : '0',
      IND_EMIT: '0',
      COD_PART: recipient && partyCode(recipient),
      COD_MOD: d.model,
      COD_SIT: sit,
      SER: String(d.series).padStart(3, '0'),
      NUM_DOC: d.number,
      CHV_NFE: d.accessKey,
      DT_DOC: d.issuedOn,
      // Nas saídas a data é opcional e a apuração usa a emissão; nas entradas é obrigatória.
      DT_E_S: d.direction === 'in' ? movedOn : undefined,
      VL_DOC: d.totalCents,
      IND_PGTO: d.paymentIndicator,
      VL_DESC: d.discountCents,
      VL_ABAT_NT: 0,
      VL_MERC: d.productsCents,
      IND_FRT: d.freightMode,
      VL_FRT: d.freightCents,
      VL_SEG: d.insuranceCents,
      VL_OUT_DA: d.otherCents,
      VL_BC_ICMS: sum(groups, 'baseCents'),
      VL_ICMS: sum(groups, 'icmsCents'),
      VL_BC_ICMS_ST: sum(groups, 'stBaseCents'),
      VL_ICMS_ST: sum(groups, 'stCents'),
      VL_IPI: sum(groups, 'ipiCents'),
    };
    const blank = new Set<string>(C100_PIS_COFINS_FIELDS);
    if (d.model === '65') for (const f of C100_NFCE_BLANK_FIELDS) blank.add(f);
    for (const key of Object.keys(values) as EfdFieldName<'C100'>[]) {
      const keep = entry.status === 'cancelled' ? C100_CANCELLED_FIELDS.includes(key) : true;
      if (!keep || blank.has(key)) delete values[key];
    }
    blockC.push(record('C100', values));
    for (const g of groups) {
      blockC.push(
        record('C190', {
          CST_ICMS: g.cst,
          CFOP: g.cfop,
          ALIQ_ICMS: g.rate,
          VL_OPR: g.operationCents,
          VL_BC_ICMS: g.baseCents,
          VL_ICMS: g.icmsCents,
          VL_BC_ICMS_ST: g.stBaseCents,
          VL_ICMS_ST: g.stCents,
          VL_RED_BC: g.reducedCents,
          VL_IPI: g.ipiCents,
        }),
      );
      if (!E110_SITUATIONS.includes(sit)) continue;
      // Índice do CIAP: as saídas do mês, pelos próprios C190 (G110, campos 06 e 07).
      if (d.direction === 'out') {
        outputs.push({
          cst: g.cst,
          cfop: g.cfop,
          operationCents: g.operationCents,
          icmsCents: g.icmsCents,
        });
      }
      const side = E110_CFOP_SIDE[g.cfop] ?? (d.direction === 'out' ? 'debit' : 'credit');
      if (side === 'debit') debits += g.icmsCents;
      else credits += g.icmsCents;
    }
  }

  // Notas de compra (F4-14.b.2): C100 de terceiros com C170 e C190 sob o enfoque da empresa.
  const items = new Map<string, { product: EfdProduct; itemType: string }>();
  const units = new Set<string>();
  const conversions = new Map<string, Map<string, string>>();
  const purchases = [...(input.purchases ?? [])].sort(
    (a, b) =>
      a.enteredOn.localeCompare(b.enteredOn) ||
      a.document.series - b.document.series ||
      a.document.number - b.document.number,
  );
  const purchasesByKey = new Map<string, { purchase: EfdPurchase; lines: PurchaseLine[] }>();
  for (const purchase of purchases) {
    const d = purchase.document;
    if (purchase.enteredOn < start || purchase.enteredOn > end) {
      throw new EfdError(
        `A compra ${d.number} (série ${d.series}) não entrou no mês ${input.month}.`,
      );
    }
    if (!d.issuer) throw new EfdError(`A compra ${d.number} não traz o fornecedor no XML.`);
    participants.set(partyCode(d.issuer), d.issuer);
    const lines = purchaseLines(d.items, {
      purpose: purchase.purpose,
      enteredOn: purchase.enteredOn,
      declarantSimples: input.simples ?? false,
    });
    const groups = analytics(purchaseSources(lines));
    blockC.push(
      record('C100', {
        IND_OPER: '0',
        IND_EMIT: '1',
        COD_PART: partyCode(d.issuer),
        COD_MOD: d.model,
        COD_SIT: EFD_DOCUMENT_SITUATION.regular,
        SER: String(d.series).padStart(3, '0'),
        NUM_DOC: d.number,
        CHV_NFE: d.accessKey,
        DT_DOC: d.issuedOn,
        DT_E_S: purchase.enteredOn,
        VL_DOC: d.totalCents,
        IND_PGTO: d.paymentIndicator,
        VL_DESC: d.discountCents,
        VL_ABAT_NT: 0,
        VL_MERC: d.productsCents,
        IND_FRT: d.freightMode,
        VL_FRT: d.freightCents,
        VL_SEG: d.insuranceCents,
        VL_OUT_DA: d.otherCents,
        VL_BC_ICMS: sum(groups, 'baseCents'),
        VL_ICMS: sum(groups, 'icmsCents'),
        VL_BC_ICMS_ST: sum(groups, 'stBaseCents'),
        VL_ICMS_ST: sum(groups, 'stCents'),
        VL_IPI: sum(groups, 'ipiCents'),
      }),
    );
    for (const line of lines) {
      const product = purchase.products[line.item.line];
      if (!product) {
        throw new EfdError(
          `O item ${line.item.line} da compra ${d.number} não está ligado a um produto. Confira a nota em Compras.`,
        );
      }
      if (!items.has(product.code)) items.set(product.code, { product, itemType: line.itemType });
      units.add(line.item.unit).add(product.unit);
      if (line.item.unit !== product.unit) {
        const byUnit = conversions.get(product.code) ?? new Map<string, string>();
        byUnit.set(line.item.unit, product.factor);
        conversions.set(product.code, byUnit);
      }
      blockC.push(
        record('C170', {
          NUM_ITEM: line.item.line,
          COD_ITEM: product.code,
          DESCR_COMPL: line.item.description,
          QTD: line.item.quantity,
          UNID: line.item.unit,
          VL_ITEM: line.item.productCents,
          VL_DESC: line.item.discountCents,
          IND_MOV: '0',
          CST_ICMS: line.cst,
          CFOP: line.cfop,
          VL_BC_ICMS: line.icmsBaseCents,
          ALIQ_ICMS: line.icmsRate,
          VL_ICMS: line.icmsCents,
          VL_BC_ICMS_ST: line.stBaseCents,
          ALIQ_ST: line.stRate,
          VL_ICMS_ST: line.stCents,
          VL_IPI: line.item.ipiCents,
          VL_ABAT_NT: 0,
        }),
      );
    }
    for (const g of groups) {
      blockC.push(
        record('C190', {
          CST_ICMS: g.cst,
          CFOP: g.cfop,
          ALIQ_ICMS: g.rate,
          VL_OPR: g.operationCents,
          VL_BC_ICMS: g.baseCents,
          VL_ICMS: g.icmsCents,
          VL_BC_ICMS_ST: g.stBaseCents,
          VL_ICMS_ST: g.stCents,
          VL_RED_BC: g.reducedCents,
          VL_IPI: g.ipiCents,
        }),
      );
      credits += g.icmsCents;
    }
    purchasesByKey.set(d.accessKey, { purchase, lines });
    if (purchase.purpose === 'fixed_asset' && !input.ciap) {
      warnings.push(
        `A compra ${d.number} é para o ativo imobilizado e o controle dos bens (CIAP) não foi informado: o crédito em 48 parcelas não entrou no arquivo (${EFD_ENTRY_RULES.fixed_asset.source}).`,
      );
    }
  }

  // Inventário (bloco H): os itens entram no 0200 e no 0190 junto com os das compras.
  const inventory = input.inventory
    ? prepareInventory(input.inventory, input.month, end)
    : undefined;
  for (const { item } of inventory?.items ?? []) {
    const known = items.get(item.code);
    if (known && known.product.unit !== item.unit) {
      throw new EfdError(
        `O item ${item.code} tem unidade ${item.unit} no inventário e ${known.product.unit} nas compras.`,
      );
    }
    if (!known) {
      items.set(item.code, {
        product: {
          code: item.code,
          name: item.description,
          unit: item.unit,
          factor: '1',
          ...(item.ncm && { ncm: item.ncm }),
          ...(item.cest && { cest: item.cest }),
          ...(item.barcode && { barcode: item.barcode }),
        },
        itemType: EFD_ITEM_TYPE_RESALE,
      });
    }
    units.add(item.unit);
    if (item.party) participants.set(partyCode(item.party), item.party);
  }

  // CIAP (bloco G, F4-14.b.7): a empresa do Simples não se credita do ICMS do ativo.
  let ciap: CiapLines | undefined;
  if (input.ciap && input.ciap.assets.length > 0 && !input.simples) {
    const plan = planCiap(input.ciap, input.month, start, end, outputs);
    warnings.push(...plan.skipped);
    if (plan.movements.length > 0) {
      if (!input.ciap.account) {
        warnings.push(
          'Há bens do ativo no CIAP, mas falta a conta contábil do ativo imobilizado (registros 0300 e 0500). Cadastre em Arquivos para o contador: sem ela o bloco G e o crédito do ativo não entram no arquivo.',
        );
      } else {
        ciap = ciapLines(plan, input.ciap, purchasesByKey, start, end);
        if (plan.appropriationCents > 0 && !input.ciap.adjustmentCode) {
          warnings.push(
            'Falta o código de ajuste do crédito do ativo (E111, tabela 5.1.1 da sua UF). O bloco G foi gerado, mas o crédito do CIAP não entrou na apuração do ICMS. Cadastre em Arquivos para o contador.',
          );
        }
        if (plan.index.stUndecided) {
          warnings.push(
            'Houve saídas com ICMS cobrado antes por substituição tributária (CST 60). Elas não contaram como tributadas no índice do CIAP; se a legislação da sua UF manda contar, ajuste em Arquivos para o contador.',
          );
        }
      }
    }
  }
  const adjustmentCode = input.ciap?.adjustmentCode;
  if (adjustmentCode) {
    const match = EFD_CIAP_ADJUSTMENT_CODE.exec(adjustmentCode);
    if (!match || match[1] !== company.uf) {
      throw new EfdError(
        `Código de ajuste do CIAP inválido: ${adjustmentCode}. Use o da tabela 5.1.1 da UF ${company.uf}, com 8 caracteres (UF, "0", "2" e o número).`,
      );
    }
  }
  const adjustmentCredits = ciap && adjustmentCode ? ciap.plan.appropriationCents : 0;

  // Apuração (E110): o único ajuste é o crédito do ativo (E111); deduções o Bipaê não registra.
  const previousCredit = input.previousCreditCents ?? 0;
  const balance = debits - credits - adjustmentCredits - previousCredit;
  const settlement: EfdSettlement = {
    debitsCents: debits,
    creditsCents: credits,
    adjustmentCreditsCents: adjustmentCredits,
    previousCreditCents: previousCredit,
    balanceCents: Math.max(balance, 0),
    dueCents: Math.max(balance, 0),
    creditCarriedCents: balance < 0 ? -balance : 0,
  };

  const blocks = new Map<EfdBlock, Line[]>();
  blocks.set('0', [
    record('0000', {
      COD_VER: version,
      COD_FIN: input.replacement ? '1' : '0',
      DT_INI: start,
      DT_FIN: end,
      NOME: company.legalName,
      CNPJ: digits(company.cnpj),
      UF: company.uf,
      IE: digits(company.ie),
      COD_MUN: company.cityCode,
      IM: company.municipalRegistration,
      IND_PERFIL: input.profile,
      // 1 - Outros: o Bipaê atende comércio; indústria pede o bloco do IPI (E500), que não gera.
      IND_ATIV: '1',
    }),
    record('0001', { IND_MOV: '0' }),
    record('0005', {
      FANTASIA: company.tradeName || company.legalName,
      CEP: digits(company.cep),
      END: company.street,
      NUM: company.number,
      COMPL: company.complement,
      BAIRRO: company.district,
      FONE: digits(company.phone),
      EMAIL: company.email,
    }),
    ...(input.accountant
      ? [
          record('0100', {
            NOME: input.accountant.name,
            CPF: digits(input.accountant.cpf),
            CRC: input.accountant.crc,
            CNPJ: digits(input.accountant.cnpj),
            CEP: digits(input.accountant.cep),
            END: input.accountant.street,
            NUM: input.accountant.number,
            COMPL: input.accountant.complement,
            BAIRRO: input.accountant.district,
            FONE: digits(input.accountant.phone),
            EMAIL: input.accountant.email,
            COD_MUN: input.accountant.cityCode,
          }),
        ]
      : []),
    ...[...participants.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, p]) => {
        const brazil = p.countryCode.replace(/^0/, '') === EFD_BRAZIL_COUNTRY;
        return record('0150', {
          COD_PART: code,
          NOME: p.name,
          COD_PAIS: p.countryCode,
          CNPJ: brazil ? p.cnpj : undefined,
          CPF: brazil ? p.cpf : undefined,
          IE: p.ie,
          COD_MUN: brazil ? p.cityCode : '9999999',
          END: p.street,
          NUM: p.number,
          COMPL: p.complement,
          BAIRRO: p.district,
        });
      }),
    ...[...units].sort().map((unit) => record('0190', { UNID: unit, DESCR: unit })),
    ...[...items.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .flatMap(([code, { product, itemType }]) => [
        record('0200', {
          COD_ITEM: code,
          DESCR_ITEM: product.name,
          COD_BARRA: product.barcode,
          UNID_INV: product.unit,
          TIPO_ITEM: itemType,
          COD_NCM: product.ncm,
          CEST: product.cest,
        }),
        // Unidade da nota diferente da do estoque: o fator que converte (0220).
        ...[...(conversions.get(code) ?? new Map<string, string>())]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([unit, factor]) => record('0220', { UNID_CONV: unit, FAT_CONV: factor })),
      ]),
    ...(ciap?.registry ?? []),
  ]);
  blocks.set('C', [record('C001', { IND_MOV: blockC.length > 0 ? '0' : '1' }), ...blockC]);
  blocks.set('E', [
    record('E001', { IND_MOV: '0' }),
    record('E100', { DT_INI: start, DT_FIN: end }),
    record('E110', {
      VL_TOT_DEBITOS: debits,
      VL_AJ_DEBITOS: 0,
      VL_TOT_AJ_DEBITOS: 0,
      VL_ESTORNOS_CRED: 0,
      VL_TOT_CREDITOS: credits,
      VL_AJ_CREDITOS: 0,
      VL_TOT_AJ_CREDITOS: adjustmentCredits,
      VL_ESTORNOS_DEB: 0,
      VL_SLD_CREDOR_ANT: previousCredit,
      VL_SLD_APURADO: settlement.balanceCents,
      VL_TOT_DED: 0,
      VL_ICMS_RECOLHER: settlement.dueCents,
      VL_SLD_CREDOR_TRANSPORTAR: settlement.creditCarriedCents,
      DEB_ESP: 0,
    }),
    // E111: o crédito do ativo (G110, ICMS_APROP) entra como ajuste da apuração (Guia, G110).
    ...(adjustmentCredits > 0
      ? [
          record('E111', {
            COD_AJ_APUR: adjustmentCode,
            DESCR_COMPL_AJ: 'Crédito do ICMS do ativo permanente (CIAP, bloco G)',
            VL_AJ_APUR: adjustmentCredits,
          }),
        ]
      : []),
    ...(settlement.dueCents > 0
      ? [
          record('E116', {
            COD_OR: E116_ICMS_DUE_CODE,
            VL_OR: settlement.dueCents,
            DT_VCTO: input.icmsDueDate,
            COD_REC: input.icmsRevenueCode,
            MES_REF: input.month,
          }),
        ]
      : []),
  ]);
  blocks.set('G', ciap ? ciap.block : [record('G001', { IND_MOV: '1' })]);
  blocks.set('H', inventory ? inventoryBlock(inventory) : [record('H001', { IND_MOV: '1' })]);
  for (const block of EFD_EMPTY_BLOCKS) {
    const open = `${block}001` as EfdRegister;
    const [field] = EFD_REGISTERS[open][0] as readonly [string, string];
    blocks.set(block, [record(open, { [field]: '1' } as never)]);
  }
  blocks.set('1', [record('1001', { IND_MOV: '0' }), record('1010', EFD_1010_ANSWERS)]);

  // Encerramento de cada bloco com a contagem de linhas (abertura e encerramento incluídos).
  const lines: Line[] = [];
  for (const block of EFD_BLOCK_ORDER) {
    if (block === '9') continue;
    const body = blocks.get(block)!;
    const close = `${block}990` as EfdRegister;
    const [field] = EFD_REGISTERS[close][0] as readonly [string, string];
    lines.push(...body, record(close, { [field]: body.length + 1 } as never));
  }

  // Bloco 9: um 9900 por registro presente, inclusive os do próprio bloco 9 e o 9999.
  const counts = new Map<string, number>();
  for (const l of lines) counts.set(l.reg, (counts.get(l.reg) ?? 0) + 1);
  const closingRegs = ['9001', '9900', '9990', '9999'];
  const types9900 = counts.size + closingRegs.length;
  counts.set('9001', 1);
  counts.set('9900', types9900);
  counts.set('9990', 1);
  counts.set('9999', 1);
  const block9: Line[] = [record('9001', { IND_MOV: '0' })];
  for (const [reg, qty] of counts) block9.push(record('9900', { REG_BLC: reg, QTD_REG_BLC: qty }));
  block9.push(record('9990', { QTD_LIN_9: block9.length + 2 }));
  lines.push(...block9);
  lines.push(record('9999', { QTD_LIN: lines.length + 1 }));

  if (!input.accountant && input.profile !== 'C') {
    warnings.push(
      'Falta o contador responsável (registro 0100), obrigatório nos perfis A e B. Cadastre em Arquivos para o contador.',
    );
  }
  if (!input.purchases) {
    warnings.push(
      'As notas de compra (entradas) não foram informadas: sem elas não há crédito de ICMS e o valor a recolher fica maior. Confira com o contador antes de transmitir.',
    );
  }
  if (input.month.slice(5) === EFD_YEAR_END_INVENTORY.month) {
    const yearEnd = `${Number(input.month.slice(0, 4)) - 1}-${EFD_YEAR_END_INVENTORY.day}`;
    if (!inventory) {
      warnings.push(
        'Fevereiro pede o inventário de 31/12 (bloco H) e o arquivo está sem ele. Se a empresa tinha estoque nessa data, confira com o contador antes de transmitir.',
      );
    } else if (inventory.date !== yearEnd || inventory.reason !== EFD_YEAR_END_INVENTORY.reason) {
      warnings.push(
        'Fevereiro pede o inventário de 31/12 do ano anterior com o motivo 01 (final do período); o do arquivo é outro, e o PVA vai avisar.',
      );
    }
  }
  if (company.uf === 'DF') {
    warnings.push('No Distrito Federal o bloco B (ISS) é obrigatório e o Bipaê ainda não o gera.');
  }
  if (settlement.dueCents > 0 && !input.icmsDueDate) {
    warnings.push('Falta configurar o vencimento do ICMS (registro E116).');
  }
  warnings.push(
    'Se a sua UF exige o registro 1601 (vendas com cartão e Pix por instituição de pagamento), ele ainda não é gerado.',
  );

  return {
    fileName: `EFD-ICMS-IPI-${digits(company.cnpj)}-${input.month}.txt`,
    text: lines.map((l) => `${l.text}\r\n`).join(''),
    lineCount: lines.length,
    registerCounts: Object.fromEntries(counts),
    settlement,
    ...(ciap && {
      ciap: {
        appropriationCents: ciap.plan.appropriationCents,
        installments: ciap.plan.installments,
      },
    }),
    warnings,
  };
}

/** O arquivo vai em ISO 8859-1 (NT 2025.001, item 2.1.1); o que não cabe vira "?". */
export function encodeEfdLatin1(text: string): Uint8Array {
  const normalized = text.normalize('NFC');
  const bytes = new Uint8Array(normalized.length);
  for (let i = 0; i < normalized.length; i++) {
    const code = normalized.charCodeAt(i);
    bytes[i] = code <= 0xff ? code : 0x3f;
  }
  return bytes;
}
