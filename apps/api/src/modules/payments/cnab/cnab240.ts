import { alpha, blank, dateField, money, num, parseDate, pick, record } from './fields';

/**
 * CNAB 240 de cobrança: remessa (segmentos P, Q e R) e retorno (segmentos T e U), no layout
 * geral da FEBRABAN. ATENÇÃO: cada banco tem variações (convênio, carteira, campos de uso do
 * banco). As posições abaixo são as do layout geral como o projeto as conhece, NÃO conferidas
 * com o manual de um banco específico (falta a conta real, E9): antes de usar em produção,
 * confira com o manual do banco e ajuste. Pendência registrada em docs/canais-e-boletos.md.
 */
export interface CnabCedente {
  bankCode: string; // 3 dígitos
  bankName: string;
  taxId: string; // CPF ou CNPJ, só dígitos
  name: string;
  agency: string;
  agencyDigit: string;
  account: string;
  accountDigit: string;
  /** Convênio / código do cedente no banco. */
  agreement: string;
}

export interface CnabTitle {
  /** Nosso número (identifica o boleto no banco). */
  ourNumber: string;
  /** Seu número (documento da empresa). */
  documentNumber: string;
  amountCents: number;
  /** AAAA-MM-DD */
  dueDate: string;
  /** AAAA-MM-DD */
  issueDate: string;
  payer: {
    taxId: string;
    name: string;
    address: string;
    district: string;
    zip: string;
    city: string;
    state: string;
  };
  /** Juros ao dia em centavos (código 1) ou taxa mensal em bps (código 2); null isenta. */
  interest?: { kind: 'daily_cents' | 'monthly_bps'; value: number; fromDate: string } | null;
  /** Multa: valor fixo em centavos ou percentual em bps; null isenta. */
  fine?: { kind: 'fixed_cents' | 'percent_bps'; value: number; fromDate: string } | null;
  message?: string;
}

export interface CnabRemessaInput {
  cedente: CnabCedente;
  /** Número sequencial do arquivo (NSA). */
  sequence: number;
  /** AAAA-MM-DD e HHMMSS. */
  generatedOn: string;
  generatedAt: string;
  titles: CnabTitle[];
}

const SIZE = 240;
const kindOfTaxId = (id: string) => (id.replace(/\D/g, '').length > 11 ? '2' : '1');

function header(input: CnabRemessaInput): string {
  const c = input.cedente;
  return record(SIZE, [
    num(c.bankCode, 3),
    '0000',
    '0',
    blank(9),
    kindOfTaxId(c.taxId),
    num(c.taxId, 14),
    alpha(c.agreement, 20),
    num(c.agency, 5),
    alpha(c.agencyDigit, 1),
    num(c.account, 12),
    alpha(c.accountDigit, 1),
    ' ',
    alpha(c.name, 30),
    alpha(c.bankName, 30),
    blank(10),
    '1',
    dateField(input.generatedOn),
    num(input.generatedAt, 6),
    num(input.sequence, 6),
    '087',
    '01600',
    blank(20),
    blank(20),
    blank(29),
  ]);
}

function lotHeader(input: CnabRemessaInput): string {
  const c = input.cedente;
  return record(SIZE, [
    num(c.bankCode, 3),
    '0001',
    '1',
    'R',
    '01',
    blank(2),
    '045',
    ' ',
    kindOfTaxId(c.taxId),
    num(c.taxId, 15),
    alpha(c.agreement, 20),
    num(c.agency, 5),
    alpha(c.agencyDigit, 1),
    num(c.account, 12),
    alpha(c.accountDigit, 1),
    ' ',
    alpha(c.name, 30),
    blank(40),
    blank(40),
    num(input.sequence, 8),
    dateField(input.generatedOn),
    '0'.repeat(8),
    blank(33),
  ]);
}

function segmentP(c: CnabCedente, t: CnabTitle, seq: number): string {
  const interest = t.interest;
  return record(SIZE, [
    num(c.bankCode, 3),
    '0001',
    '3',
    num(seq, 5),
    'P',
    ' ',
    '01',
    num(c.agency, 5),
    alpha(c.agencyDigit, 1),
    num(c.account, 12),
    alpha(c.accountDigit, 1),
    ' ',
    alpha(t.ourNumber, 20),
    '1',
    '1',
    '1',
    '2',
    '2',
    alpha(t.documentNumber, 15),
    dateField(t.dueDate),
    money(t.amountCents, 15),
    '00000',
    ' ',
    '02',
    'N',
    dateField(t.issueDate),
    interest ? (interest.kind === 'daily_cents' ? '1' : '2') : '3',
    interest ? dateField(interest.fromDate) : '0'.repeat(8),
    interest ? money(interest.value, 15) : '0'.repeat(15),
    '0',
    '0'.repeat(8),
    '0'.repeat(15),
    '0'.repeat(15),
    '0'.repeat(15),
    blank(25),
    '3',
    '00',
    '0',
    '000',
    '09',
    '0'.repeat(10),
    ' ',
  ]);
}

function segmentQ(c: CnabCedente, t: CnabTitle, seq: number): string {
  const p = t.payer;
  return record(SIZE, [
    num(c.bankCode, 3),
    '0001',
    '3',
    num(seq, 5),
    'Q',
    ' ',
    '01',
    kindOfTaxId(p.taxId),
    num(p.taxId, 15),
    alpha(p.name, 40),
    alpha(p.address, 40),
    alpha(p.district, 15),
    num(p.zip, 8),
    alpha(p.city, 15),
    alpha(p.state, 2),
    '0',
    '0'.repeat(15),
    blank(40),
    '000',
    blank(20),
    blank(8),
  ]);
}

function segmentR(c: CnabCedente, t: CnabTitle, seq: number): string {
  const fine = t.fine;
  return record(SIZE, [
    num(c.bankCode, 3),
    '0001',
    '3',
    num(seq, 5),
    'R',
    ' ',
    '01',
    '0',
    '0'.repeat(8),
    '0'.repeat(15),
    '0',
    '0'.repeat(8),
    '0'.repeat(15),
    fine ? (fine.kind === 'fixed_cents' ? '1' : '2') : '0',
    fine ? dateField(fine.fromDate) : '0'.repeat(8),
    fine ? money(fine.value, 15) : '0'.repeat(15),
    blank(10),
    alpha(t.message, 40),
    blank(40),
    blank(61),
  ]);
}

/** Gera o arquivo de remessa (linhas separadas por CRLF, com a quebra final). */
export function buildCnab240Remessa(input: CnabRemessaInput): string {
  if (input.titles.length === 0) throw new Error('A remessa precisa de pelo menos um boleto.');
  const c = input.cedente;
  const lines = [header(input), lotHeader(input)];
  let seq = 0;
  let total = 0;
  for (const t of input.titles) {
    seq += 1;
    lines.push(segmentP(c, t, seq));
    seq += 1;
    lines.push(segmentQ(c, t, seq));
    seq += 1;
    lines.push(segmentR(c, t, seq));
    total += t.amountCents;
  }
  const lotRecords = lines.length - 1 + 1; // header do lote + segmentos + trailer do lote
  lines.push(
    record(SIZE, [
      num(c.bankCode, 3),
      '0001',
      '5',
      blank(9),
      num(lotRecords, 6),
      num(input.titles.length, 6),
      money(total, 17),
      '0'.repeat(6),
      '0'.repeat(17),
      '0'.repeat(6),
      '0'.repeat(17),
      '0'.repeat(6),
      '0'.repeat(17),
      blank(8),
      blank(117),
    ]),
  );
  lines.push(
    record(SIZE, [
      num(c.bankCode, 3),
      '9999',
      '9',
      blank(9),
      '000001',
      num(lines.length + 1, 6),
      '000000',
      blank(205),
    ]),
  );
  return lines.join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------- retorno

export interface CnabReturnEntry {
  ourNumber: string;
  documentNumber: string;
  /** Código de ocorrência do banco (02 entrada confirmada, 06 liquidação... varia por banco). */
  occurrence: string;
  dueDate: string | null;
  amountCents: number;
  /** Valor pago (segmento U); 0 se ainda não pagou. */
  paidCents: number;
  /** Juros, multa e encargos cobrados a mais. */
  feesCents: number;
  creditedCents: number;
  occurredOn: string | null;
  creditedOn: string | null;
  /** Motivos de rejeição (pares de 2 dígitos), quando há. */
  rejections: string[];
}

export interface CnabReturn {
  entries: CnabReturnEntry[];
  /** Linhas que não foram entendidas (tamanho errado, tipo desconhecido): nunca descartadas calado. */
  problems: string[];
}

const cents = (text: string) => Number(text.replace(/\D/g, '') || '0');

/** Lê o arquivo de retorno: junta o segmento T (título) com o U (valores) que vem logo depois. */
export function parseCnab240Retorno(content: string): CnabReturn {
  const lines = content.split(/\r?\n/).filter((l) => l.length > 0);
  const entries: CnabReturnEntry[] = [];
  const problems: string[] = [];
  let current: CnabReturnEntry | null = null;
  lines.forEach((line, index) => {
    const n = index + 1;
    if (line.length !== SIZE) {
      problems.push(`Linha ${n}: tem ${line.length} posições, o CNAB 240 pede ${SIZE}.`);
      return;
    }
    const type = pick(line, 8, 8);
    if (type !== '3') return; // cabeçalhos e rodapés não trazem título
    const segment = pick(line, 14, 14);
    if (segment === 'T') {
      const rej = pick(line, 214, 223).trim();
      current = {
        ourNumber: pick(line, 38, 57).trim(),
        documentNumber: pick(line, 59, 73).trim(),
        occurrence: pick(line, 16, 17),
        dueDate: parseDate(pick(line, 74, 81)),
        amountCents: cents(pick(line, 82, 96)),
        paidCents: 0,
        feesCents: 0,
        creditedCents: 0,
        occurredOn: null,
        creditedOn: null,
        rejections: rej.match(/.{2}/g)?.filter((r) => r !== '00' && r.trim()) ?? [],
      };
      entries.push(current);
    } else if (segment === 'U') {
      if (!current) {
        problems.push(`Linha ${n}: segmento U sem o T antes.`);
        return;
      }
      current.feesCents = cents(pick(line, 18, 32));
      current.paidCents = cents(pick(line, 78, 92));
      current.creditedCents = cents(pick(line, 93, 107));
      current.occurredOn = parseDate(pick(line, 138, 145));
      current.creditedOn = parseDate(pick(line, 146, 153));
      current = null;
    }
  });
  return { entries, problems };
}
