import { dec } from '../decimal';
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
  EFD_LAYOUT_VERSIONS,
  EFD_REGISTERS,
  type EfdBlock,
  type EfdFieldName,
  type EfdRegister,
} from './layout';
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

export interface EfdInput {
  /** Mês da escrituração (AAAA-MM). */
  month: string;
  company: EfdCompany;
  /** Perfil definido pelo fisco estadual para o estabelecimento (0000, campo 14). */
  profile: 'A' | 'B' | 'C';
  accountant?: EfdAccountant;
  entries: EfdEntry[];
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

/** C190: soma os itens por CST, CFOP e alíquota, como o registro pede. */
function analytics(doc: EfdDocument): Analytic[] {
  const groups = new Map<string, Analytic>();
  for (const item of doc.items) {
    const rate = dec(item.icmsRate).toFixed(2);
    const key = `${item.cstIcms}|${item.cfop}|${rate}`;
    const g = groups.get(key) ?? {
      cst: item.cstIcms,
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
    const goods =
      item.productCents +
      item.freightCents +
      item.insuranceCents +
      item.otherCents -
      item.discountCents;
    g.operationCents += goods + item.stCents + item.ipiCents;
    g.baseCents += item.icmsBaseCents;
    g.icmsCents += item.icmsCents;
    g.stBaseCents += item.stBaseCents;
    g.stCents += item.stCents;
    g.ipiCents += item.ipiCents;
    // Só o CST de 3 dígitos (regime normal) tem redução de base: 20 e 70 na Tabela B.
    if (item.cstIcms.length === 3 && C190_REDUCED_BASE_CSTS.includes(item.cstIcms.slice(1))) {
      g.reducedCents += Math.max(0, goods - item.icmsBaseCents);
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

const sum = (list: Analytic[], field: keyof Analytic) =>
  list.reduce((total, g) => total + (g[field] as number), 0);

function situation(entry: EfdEntry): string {
  if (entry.status === 'cancelled') return EFD_DOCUMENT_SITUATION.cancelled;
  if (entry.document.purpose === '2') return EFD_DOCUMENT_SITUATION.complementary;
  return EFD_DOCUMENT_SITUATION.regular;
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
  for (const entry of entries) {
    const d = entry.document;
    const sit = situation(entry);
    const groups = entry.status === 'cancelled' ? [] : analytics(d);
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
      const side = E110_CFOP_SIDE[g.cfop] ?? (d.direction === 'out' ? 'debit' : 'credit');
      if (side === 'debit') debits += g.icmsCents;
      else credits += g.icmsCents;
    }
  }

  // Apuração (E110): sem ajustes nem deduções, que o Bipaê ainda não registra.
  const previousCredit = input.previousCreditCents ?? 0;
  const balance = debits - credits - previousCredit;
  const settlement: EfdSettlement = {
    debitsCents: debits,
    creditsCents: credits,
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
      VL_TOT_AJ_CREDITOS: 0,
      VL_ESTORNOS_DEB: 0,
      VL_SLD_CREDOR_ANT: previousCredit,
      VL_SLD_APURADO: settlement.balanceCents,
      VL_TOT_DED: 0,
      VL_ICMS_RECOLHER: settlement.dueCents,
      VL_SLD_CREDOR_TRANSPORTAR: settlement.creditCarriedCents,
      DEB_ESP: 0,
    }),
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
  warnings.push(
    'As notas de compra (entradas) ainda não vão para o arquivo: sem elas não há crédito de ICMS e o valor a recolher fica maior. Confira com o contador antes de transmitir.',
  );
  if (input.month.endsWith('-02')) {
    warnings.push('Fevereiro pede o inventário de 31/12 (bloco H), que o Bipaê ainda não gera.');
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
