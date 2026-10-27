/**
 * Conciliação automática do Pix recebido (F6-02). Regras puras, sem I/O: dado um lançamento de
 * entrada do extrato, decide se ele é a prova de um Pix que o Bipaê já conhece (cobrança paga, pelo
 * identificador fim a fim) ou o pagamento de uma conta a receber (valor igual, vencimento próximo e
 * o nome do pagador no histórico). Na dúvida, não concilia: o lançamento segue pendente com as
 * sugestões de sempre. Quem aplica a baixa é a API, na mesma transação e com trilha de auditoria.
 */

/** Identificador fim a fim do Pix (BCB): "E" + ISPB (8) + data/hora (12) + sequência (11). */
const E2E_PATTERN = /E\d{8}\d{12}[0-9A-Za-z]{11}/;

export function extractEndToEndId(memo: string): string | null {
  return E2E_PATTERN.exec(memo)?.[0] ?? null;
}

/** O histórico fala de Pix: a palavra "PIX" ou um identificador fim a fim. */
export function isPixMemo(memo: string): boolean {
  return /\bpix\b/i.test(memo) || extractEndToEndId(memo) !== null;
}

const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ');

/** Palavras do nome que identificam a pessoa (tira "DA", "DE", "LTDA"... e palavras curtas). */
const IGNORED_WORDS = new Set([
  'LTDA',
  'EIRELI',
  'MEI',
  'ME',
  'EPP',
  'SA',
  'COMERCIO',
  'DE',
  'DA',
  'DO',
  'DAS',
  'DOS',
  'E',
]);

function nameTokens(name: string): string[] {
  return normalize(name)
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !IGNORED_WORDS.has(t));
}

/**
 * O histórico cita o pagador: todas as palavras significativas do nome (até as 3 primeiras)
 * aparecem. Nome só com palavras curtas ou comuns nunca conta como evidência.
 */
export function memoMentionsName(memo: string, name: string | null): boolean {
  if (!name) return false;
  const tokens = nameTokens(name).slice(0, 3);
  if (tokens.length === 0) return false;
  const words = new Set(normalize(memo).split(/\s+/));
  return tokens.every((t) => words.has(t));
}

export interface PixStatementLine {
  amountCents: number;
  /** AAAA-MM-DD */
  postedOn: string;
  memo: string;
}

export interface PixKnownCharge {
  id: string;
  endToEndId: string | null;
  /** Conta a receber que a cobrança quitava, quando houver. */
  entryId: string | null;
}

export interface PixOpenReceivable {
  id: string;
  amountCents: number;
  /** AAAA-MM-DD */
  dueDate: string;
  partyName: string | null;
}

export type PixMatch =
  | { kind: 'charge'; chargeId: string; entryId: string | null; reason: 'end_to_end' }
  | { kind: 'entry'; entryId: string; reason: 'name' }
  | {
      kind: 'none';
      reason: 'not_credit' | 'not_pix' | 'no_candidate' | 'ambiguous' | 'no_name_evidence';
    };

export const PIX_MATCH_LABELS: Record<'end_to_end' | 'name', string> = {
  end_to_end: 'Pix identificado pelo código fim a fim',
  name: 'Valor, vencimento e nome do pagador batem',
};

const DAY_MS = 86_400_000;
const dayNumber = (iso: string) => Math.floor(new Date(`${iso}T12:00:00Z`).getTime() / DAY_MS);

/**
 * Decide a conciliação de um lançamento do extrato.
 * 1. Código fim a fim igual ao de uma cobrança Pix paga: conciliado (e a conta que ela quitava).
 * 2. Senão, entre as contas a receber em aberto de mesmo valor e vencimento dentro da janela, só
 *    concilia sozinho quando o nome do pagador aparece no histórico e aponta uma única conta.
 *    Valor igual sozinho não basta: dois clientes pagam R$ 100 no mesmo dia.
 */
export function decidePixMatch(
  line: PixStatementLine,
  charges: PixKnownCharge[],
  receivables: PixOpenReceivable[],
  windowDays: number,
): PixMatch {
  if (line.amountCents <= 0) return { kind: 'none', reason: 'not_credit' };
  if (!isPixMemo(line.memo)) return { kind: 'none', reason: 'not_pix' };

  const e2e = extractEndToEndId(line.memo);
  if (e2e) {
    const charge = charges.find((c) => c.endToEndId === e2e);
    if (charge) {
      return { kind: 'charge', chargeId: charge.id, entryId: charge.entryId, reason: 'end_to_end' };
    }
  }

  const candidates = receivables.filter(
    (r) =>
      r.amountCents === line.amountCents &&
      Math.abs(dayNumber(r.dueDate) - dayNumber(line.postedOn)) <= windowDays,
  );
  if (candidates.length === 0) return { kind: 'none', reason: 'no_candidate' };
  const named = candidates.filter((r) => memoMentionsName(line.memo, r.partyName));
  if (named.length === 1) return { kind: 'entry', entryId: named[0]!.id, reason: 'name' };
  if (named.length > 1) return { kind: 'none', reason: 'ambiguous' };
  return { kind: 'none', reason: 'no_name_evidence' };
}

/**
 * Extrato OFX de mentira com entradas de Pix, para treinar e testar a conciliação sem banco: cada
 * item vira um lançamento com o histórico no formato que os bancos usam ("PIX RECEBIDO NOME E2E").
 */
export function buildSimulatedPixStatement(
  items: {
    fitId: string;
    postedOn: string;
    amountCents: number;
    payer: string;
    endToEndId?: string;
  }[],
): string {
  const money = (cents: number) =>
    `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
  const lines = items.map(
    (i) =>
      `<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>${i.postedOn.replace(/-/g, '')}<TRNAMT>${money(i.amountCents)}<FITID>${i.fitId}<MEMO>PIX RECEBIDO ${i.payer}${i.endToEndId ? ` ${i.endToEndId}` : ''}</STMTTRN>`,
  );
  return [
    'OFXHEADER:100',
    'DATA:OFXSGML',
    '<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL',
    '<BANKACCTFROM><BANKID>999<ACCTID>00001-0</BANKACCTFROM>',
    '<BANKTRANLIST>',
    ...lines,
    '</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>',
  ].join('\n');
}
