import { alpha, blank, dateField, money, num, parseDate, pick, record } from './fields';

/**
 * CNAB 400 de cobrança: remessa (header, detalhe tipo 1, multa tipo 2 e trailer) e retorno. O 400
 * é bem mais preso a cada banco do que o 240. As posições abaixo seguem o desenho de maior uso
 * entre os bancos como o projeto o conhece e NÃO foram conferidas com o manual de um banco
 * específico (falta a conta real, E9): confira antes de usar em produção. Pendência em
 * docs/canais-e-boletos.md.
 */
export interface Cnab400Cedente {
  bankCode: string;
  bankName: string;
  taxId: string;
  name: string;
  agency: string;
  account: string;
  accountDigit: string;
  /** Código da empresa no banco. */
  companyCode: string;
  /** Carteira de cobrança. */
  wallet: string;
}

export interface Cnab400Title {
  ourNumber: string;
  documentNumber: string;
  amountCents: number;
  dueDate: string;
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
  /** Juros de mora por dia, em centavos. */
  dailyInterestCents?: number;
  /** Multa: valor fixo (centavos) ou percentual (bps). */
  fine?: { kind: 'fixed_cents' | 'percent_bps'; value: number; fromDate: string } | null;
}

export interface Cnab400RemessaInput {
  cedente: Cnab400Cedente;
  generatedOn: string;
  titles: Cnab400Title[];
}

const SIZE = 400;
const kind = (id: string) => (id.replace(/\D/g, '').length > 11 ? '02' : '01');

export function buildCnab400Remessa(input: Cnab400RemessaInput): string {
  if (input.titles.length === 0) throw new Error('A remessa precisa de pelo menos um boleto.');
  const c = input.cedente;
  let seq = 1;
  const lines: string[] = [
    record(SIZE, [
      '0',
      '1',
      'REMESSA',
      '01',
      alpha('COBRANCA', 15),
      alpha(c.companyCode, 20),
      alpha(c.name, 30),
      num(c.bankCode, 3),
      alpha(c.bankName, 15),
      dateField(input.generatedOn, true),
      blank(294),
      num(seq, 6),
    ]),
  ];
  for (const t of input.titles) {
    seq += 1;
    const p = t.payer;
    lines.push(
      record(SIZE, [
        '1',
        kind(c.taxId),
        num(c.taxId, 14),
        num(c.agency, 4),
        '00',
        num(c.account, 5),
        alpha(c.accountDigit, 1),
        blank(4),
        '0000',
        alpha(t.documentNumber, 25),
        num(t.ourNumber, 8),
        '0'.repeat(13),
        num(c.wallet, 3),
        blank(21),
        'I',
        '01',
        alpha(t.documentNumber, 10),
        dateField(t.dueDate, true),
        money(t.amountCents, 13),
        num(c.bankCode, 3),
        '00000',
        '01',
        'N',
        dateField(t.issueDate, true),
        '00',
        '00',
        money(t.dailyInterestCents ?? 0, 13),
        '0'.repeat(6),
        '0'.repeat(13),
        '0'.repeat(13),
        '0'.repeat(13),
        kind(p.taxId),
        num(p.taxId, 14),
        alpha(p.name, 30),
        blank(10),
        alpha(p.address, 40),
        alpha(p.district, 12),
        num(p.zip, 8),
        alpha(p.city, 15),
        alpha(p.state, 2),
        blank(30),
        blank(4),
        '0'.repeat(6),
        '00',
        ' ',
        num(seq, 6),
      ]),
    );
    if (t.fine) {
      seq += 1;
      lines.push(
        record(SIZE, [
          '2',
          t.fine.kind === 'fixed_cents' ? '1' : '2',
          dateField(t.fine.fromDate),
          money(t.fine.value, 13),
          blank(371),
          num(seq, 6),
        ]),
      );
    }
  }
  seq += 1;
  lines.push(record(SIZE, ['9', blank(393), num(seq, 6)]));
  return lines.join('\r\n') + '\r\n';
}

export interface Cnab400ReturnEntry {
  ourNumber: string;
  documentNumber: string;
  occurrence: string;
  occurredOn: string | null;
  dueDate: string | null;
  amountCents: number;
  paidCents: number;
  feesCents: number;
  creditedOn: string | null;
}

export interface Cnab400Return {
  entries: Cnab400ReturnEntry[];
  problems: string[];
}

const cents = (text: string) => Number(text.replace(/\D/g, '') || '0');

/** Lê o retorno: só os detalhes tipo 1; o que não bate com o layout vai para `problems`. */
export function parseCnab400Retorno(content: string): Cnab400Return {
  const entries: Cnab400ReturnEntry[] = [];
  const problems: string[] = [];
  content
    .split(/\r?\n/)
    .filter((l) => l.length > 0)
    .forEach((line, index) => {
      if (line.length !== SIZE) {
        problems.push(`Linha ${index + 1}: tem ${line.length} posições, o CNAB 400 pede ${SIZE}.`);
        return;
      }
      if (line[0] !== '1') return;
      entries.push({
        ourNumber: pick(line, 63, 70).trim(),
        occurrence: pick(line, 109, 110),
        occurredOn: parseDate(pick(line, 111, 116)),
        documentNumber: pick(line, 117, 126).trim(),
        dueDate: parseDate(pick(line, 147, 152)),
        amountCents: cents(pick(line, 153, 165)),
        paidCents: cents(pick(line, 254, 266)),
        feesCents: cents(pick(line, 267, 279)),
        creditedOn: parseDate(pick(line, 296, 301)),
      });
    });
  return { entries, problems };
}
