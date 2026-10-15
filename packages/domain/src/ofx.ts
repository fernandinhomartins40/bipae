/**
 * Leitor de extrato OFX (F4-07), versões 1.x (SGML, sem fechar as tags, comum nos bancos
 * brasileiros) e 2.x (XML). Só o que a conciliação usa: banco, conta e lançamentos. O valor é
 * lido como texto e vira centavos sem passar por conta de ponto flutuante.
 */
export interface OfxTransaction {
  /** Identificador do lançamento no banco: importar o mesmo arquivo de novo não duplica. */
  fitId: string;
  type: string;
  /** AAAA-MM-DD */
  postedOn: string;
  /** Centavos com sinal: negativo é saída, positivo é entrada. */
  amountCents: number;
  memo: string;
}

export interface OfxStatement {
  bankId: string | null;
  accountId: string;
  currency: string | null;
  transactions: OfxTransaction[];
}

export class OfxError extends Error {}

/** Valor do campo (OFX 1.x pode não fechar a tag; termina na próxima tag). */
function field(block: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>\s*([^<\r\n]*)`, 'i').exec(block);
  const value = match?.[1]?.trim();
  return value ? value : null;
}

/** "-1.234,56", "1234.56", "-12" → centavos. */
export function ofxAmountToCents(text: string): number {
  let t = text.trim().replace(/\s/g, '');
  // Alguns bancos usam vírgula decimal (e ponto de milhar).
  if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  const match = /^([+-])?(\d+)(?:\.(\d{1,}))?$/.exec(t);
  if (!match) throw new OfxError(`Valor inválido no extrato: "${text}"`);
  const decimals = (match[3] ?? '').padEnd(2, '0');
  if (decimals.length > 2 && /[1-9]/.test(decimals.slice(2))) {
    throw new OfxError(`Valor com mais de duas casas no extrato: "${text}"`);
  }
  const cents = Number(match[2]) * 100 + Number(decimals.slice(0, 2));
  return match[1] === '-' ? -cents : cents;
}

/** "20261014120000[-3:BRT]" → "2026-10-14" */
function ofxDate(text: string | null): string {
  const match = text ? /^(\d{4})(\d{2})(\d{2})/.exec(text) : null;
  if (!match) throw new OfxError(`Data inválida no extrato: "${text ?? ''}"`);
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function parseOfx(content: string): OfxStatement {
  if (!/<OFX>/i.test(content)) throw new OfxError('Este arquivo não é um extrato OFX.');
  const accountBlock =
    /<(?:BANKACCTFROM|CCACCTFROM)>([\s\S]*?)<\/(?:BANKACCTFROM|CCACCTFROM)>/i.exec(content)?.[1] ??
    content;
  const accountId = field(accountBlock, 'ACCTID');
  if (!accountId) throw new OfxError('O extrato não informa a conta (ACCTID).');
  const transactions: OfxTransaction[] = [];
  const blocks = content.split(/<STMTTRN>/i).slice(1);
  for (const raw of blocks) {
    const block = raw.split(/<\/STMTTRN>/i)[0]!;
    const amount = field(block, 'TRNAMT');
    if (!amount) throw new OfxError('Lançamento sem valor (TRNAMT) no extrato.');
    const postedOn = ofxDate(field(block, 'DTPOSTED'));
    const amountCents = ofxAmountToCents(amount);
    const memo = [field(block, 'NAME'), field(block, 'MEMO')].filter(Boolean).join(' · ');
    transactions.push({
      // Sem FITID (raro), o lançamento é identificado pela data, valor e histórico.
      fitId: field(block, 'FITID') ?? `${postedOn}|${amountCents}|${memo}`,
      type: field(block, 'TRNTYPE') ?? 'OTHER',
      postedOn,
      amountCents,
      memo,
    });
  }
  return {
    bankId: field(accountBlock, 'BANKID'),
    accountId,
    currency: field(content, 'CURDEF'),
    transactions,
  };
}
