import { describe, expect, it } from 'vitest';
import { ofxAmountToCents, OfxError, parseOfx } from './ofx';

/** F4-07: leitor de OFX (SGML 1.x e XML 2.x). */

const SGML = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
CHARSET:1252

<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<CURDEF>BRL
<BANKACCTFROM>
<BANKID>0341
<ACCTID>12345-6
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261010120000[-3:BRT]
<TRNAMT>-1500.00
<FITID>A1
<MEMO>PAG BOLETO ALUGUEL
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20261011
<TRNAMT>2350.5
<FITID>A2
<NAME>PIX RECEBIDO
<MEMO>CLIENTE ATACADO
</STMTTRN>
</BANKTRANLIST>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;

const XML = `<?xml version="1.0"?><?OFX OFXHEADER="200" VERSION="220"?>
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL</CURDEF>
<BANKACCTFROM><BANKID>260</BANKID><ACCTID>998877</ACCTID></BANKACCTFROM>
<BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20261012</DTPOSTED><TRNAMT>-89.90</TRNAMT><FITID>X9</FITID><MEMO>Energia</MEMO></STMTTRN></BANKTRANLIST>
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

describe('extrato OFX', () => {
  it('lê o formato antigo (SGML) dos bancos brasileiros', () => {
    expect(parseOfx(SGML)).toEqual({
      bankId: '0341',
      accountId: '12345-6',
      currency: 'BRL',
      transactions: [
        {
          fitId: 'A1',
          type: 'DEBIT',
          postedOn: '2026-10-10',
          amountCents: -150_000,
          memo: 'PAG BOLETO ALUGUEL',
        },
        {
          fitId: 'A2',
          type: 'CREDIT',
          postedOn: '2026-10-11',
          amountCents: 235_050,
          memo: 'PIX RECEBIDO · CLIENTE ATACADO',
        },
      ],
    });
  });

  it('lê o formato XML', () => {
    const r = parseOfx(XML);
    expect(r).toMatchObject({ bankId: '260', accountId: '998877' });
    expect(r.transactions[0]).toMatchObject({
      fitId: 'X9',
      amountCents: -8990,
      postedOn: '2026-10-12',
    });
  });

  it('não come a primeira letra do histórico (ex.: SALARIO)', () => {
    const r = parseOfx(
      '<OFX><ACCTID>1<STMTTRN><DTPOSTED>20261010<TRNAMT>1<FITID>S1<MEMO>SALARIO</STMTTRN></OFX>',
    );
    expect(r.transactions[0]).toMatchObject({ fitId: 'S1', memo: 'SALARIO' });
  });

  it('valores sem ponto flutuante, com vírgula decimal e erros claros', () => {
    expect(ofxAmountToCents('0.1')).toBe(10);
    expect(ofxAmountToCents('-1.234,56')).toBe(-123_456);
    expect(ofxAmountToCents('12.300')).toBe(1230);
    expect(() => ofxAmountToCents('12.345')).toThrow('mais de duas casas');
    expect(() => parseOfx('não é ofx')).toThrow(OfxError);
    expect(() => parseOfx('<OFX><STMTTRN><TRNAMT>1</STMTTRN></OFX>')).toThrow('conta (ACCTID)');
  });
});
