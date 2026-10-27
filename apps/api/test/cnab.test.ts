import { describe, expect, it } from 'vitest';
import {
  buildCnab240Remessa,
  parseCnab240Retorno,
  type CnabRemessaInput,
} from '../src/modules/payments/cnab/cnab240';
import { buildCnab400Remessa, parseCnab400Retorno } from '../src/modules/payments/cnab/cnab400';
import { calcBoletoFees, nextBusinessDay } from '../src/modules/payments/cnab/fees';
import {
  alpha,
  cnabText,
  dateField,
  money,
  num,
  parseDate,
  record,
} from '../src/modules/payments/cnab/fields';

const payer = {
  taxId: '12345678909',
  name: 'João da Conceição',
  address: 'Rua das Flores, 10',
  district: 'Centro',
  zip: '01001000',
  city: 'São Paulo',
  state: 'SP',
};

const remessa: CnabRemessaInput = {
  cedente: {
    bankCode: '341',
    bankName: 'Banco Exemplo',
    taxId: '11222333000181',
    name: 'Mercadinho Bipaê',
    agency: '1234',
    agencyDigit: '5',
    account: '56789',
    accountDigit: '0',
    agreement: 'CONV123',
  },
  sequence: 7,
  generatedOn: '2026-10-27',
  generatedAt: '093000',
  titles: [
    {
      ourNumber: '00000001',
      documentNumber: 'NF1234',
      amountCents: 15_050,
      dueDate: '2026-11-10',
      issueDate: '2026-10-27',
      payer,
      interest: { kind: 'monthly_bps', value: 100, fromDate: '2026-11-11' },
      fine: { kind: 'percent_bps', value: 200, fromDate: '2026-11-11' },
      message: 'Obrigado pela preferência',
    },
    {
      ourNumber: '00000002',
      documentNumber: 'NF1235',
      amountCents: 9_900,
      dueDate: '2026-11-12',
      issueDate: '2026-10-27',
      payer,
    },
  ],
};

describe('campos CNAB', () => {
  it('tira acento, completa e corta', () => {
    expect(cnabText('Ação ñ')).toBe('ACAO N');
    expect(cnabText('a€b')).toBe('A B');
    expect(alpha('Bipaê', 8)).toBe('BIPAE   ');
    expect(alpha(undefined, 3)).toBe('   ');
    expect(alpha('ABCDEFG', 3)).toBe('ABC');
    expect(num(42, 5)).toBe('00042');
    expect(num(undefined, 2)).toBe('00');
    expect(num('', 2)).toBe('00');
  });
  it('recusa número que não cabe e valor inválido, em vez de cortar dinheiro', () => {
    expect(() => num(123456, 5)).toThrow(/não cabe/);
    expect(() => money(-1, 5)).toThrow();
    expect(() => money(1.5, 5)).toThrow();
    expect(money(1999, 7)).toBe('0001999');
  });
  it('datas', () => {
    expect(dateField('2026-11-10')).toBe('10112026');
    expect(dateField('2026-11-10', true)).toBe('101126');
    expect(dateField(null)).toBe('00000000');
    expect(dateField(undefined, true)).toBe('000000');
    expect(() => dateField('10/11/2026')).toThrow();
    expect(parseDate('10112026')).toBe('2026-11-10');
    expect(parseDate('101126')).toBe('2026-11-10');
    expect(parseDate('00000000')).toBeNull();
    expect(parseDate('abc')).toBeNull();
    expect(parseDate('1011')).toBeNull();
  });
  it('registro com tamanho errado falha', () => {
    expect(() => record(3, ['ab'])).toThrow(/pede 3/);
  });
});

describe('multa e juros', () => {
  const base = { amountCents: 100_000, fineBps: 200, interestMonthlyBps: 100 };
  it('no prazo não cobra nada', () => {
    const f = calcBoletoFees({ ...base, dueDate: '2026-11-10', payDate: '2026-11-10' });
    expect(f).toMatchObject({ daysLate: 0, fineCents: 0, interestCents: 0, totalCents: 100_000 });
    expect(calcBoletoFees({ ...base, dueDate: '2026-11-10', payDate: '2026-11-01' }).daysLate).toBe(
      0,
    );
  });
  it('multa de 2% mais juros de 1% ao mês pro rata', () => {
    const f = calcBoletoFees({ ...base, dueDate: '2026-11-10', payDate: '2026-11-25' });
    expect(f.daysLate).toBe(15);
    expect(f.fineCents).toBe(2000);
    expect(f.interestCents).toBe(500); // 1000 x 15/30
    expect(f.totalCents).toBe(102_500);
  });
  it('arredonda meio para cima, uma vez só', () => {
    const f = calcBoletoFees({
      amountCents: 1050,
      fineBps: 200,
      interestMonthlyBps: 100,
      dueDate: '2026-11-10',
      payDate: '2026-11-11',
    });
    expect(f.fineCents).toBe(21); // exato
    expect(f.interestCents).toBe(0); // 0,35 arredonda para 0
  });
  it('vencimento no fim de semana ou feriado vale no dia útil seguinte', () => {
    expect(nextBusinessDay('2026-11-14')).toBe('2026-11-16'); // sábado
    expect(nextBusinessDay('2026-11-15')).toBe('2026-11-16'); // domingo
    expect(nextBusinessDay('2026-11-19', ['2026-11-20'])).toBe('2026-11-19');
    expect(nextBusinessDay('2026-11-20', new Set(['2026-11-20']))).toBe('2026-11-23');
    const f = calcBoletoFees({ ...base, dueDate: '2026-11-14', payDate: '2026-11-16' });
    expect(f).toMatchObject({ effectiveDueDate: '2026-11-16', daysLate: 0, fineCents: 0 });
  });
  it('carência adia a cobrança', () => {
    const f = calcBoletoFees({
      ...base,
      graceDays: 3,
      dueDate: '2026-11-10',
      payDate: '2026-11-13',
    });
    expect(f.fineCents).toBe(0);
    expect(
      calcBoletoFees({ ...base, graceDays: 3, dueDate: '2026-11-10', payDate: '2026-11-14' })
        .fineCents,
    ).toBe(2000);
  });
  it('recusa valores e datas inválidos', () => {
    expect(() =>
      calcBoletoFees({ ...base, amountCents: 10.5, dueDate: '2026-11-10', payDate: '2026-11-11' }),
    ).toThrow();
    expect(() =>
      calcBoletoFees({ ...base, fineBps: -1, dueDate: '2026-11-10', payDate: '2026-11-11' }),
    ).toThrow();
    expect(() => calcBoletoFees({ ...base, dueDate: '2026-02-30', payDate: '2026-03-01' })).toThrow(
      /Data inválida/,
    );
    expect(() => calcBoletoFees({ ...base, dueDate: 'x', payDate: '2026-03-01' })).toThrow(
      /Data inválida/,
    );
  });
});

describe('CNAB 240', () => {
  it('remessa: todo registro tem 240 posições e os totais batem', () => {
    const text = buildCnab240Remessa(remessa);
    const lines = text.split('\r\n');
    expect(lines.pop()).toBe('');
    expect(lines).toHaveLength(2 + 3 * 2 + 2);
    expect(lines.every((l) => l.length === 240)).toBe(true);
    expect(lines[0]!.slice(0, 8)).toBe('34100000');
    expect(lines[0]!.slice(143, 151)).toBe('27102026');
    const p = lines[2]!;
    expect(p[13]).toBe('P');
    expect(p.slice(77, 85)).toBe('10112026');
    expect(p.slice(85, 100)).toBe('000000000015050');
    expect(p[117]).toBe('2'); // juros: taxa mensal
    expect(lines[3]![13]).toBe('Q');
    expect(lines[3]!.slice(33, 73).trim()).toBe('JOAO DA CONCEICAO');
    const r = lines[4]!;
    expect(r[13]).toBe('R');
    expect(r[65]).toBe('2'); // multa percentual
    expect(r.slice(74, 89)).toBe('000000000000200');
    expect(lines[5]![13]).toBe('P');
    expect(lines[5]![117]).toBe('3'); // sem juros
    expect(lines[7]![65]).toBe('0');
    const lotTrailer = lines[lines.length - 2]!;
    expect(lotTrailer[7]).toBe('5');
    expect(lotTrailer.slice(17, 23)).toBe('000008');
    expect(lotTrailer.slice(23, 29)).toBe('000002');
    expect(lotTrailer.slice(29, 46)).toBe('00000000000024950');
    expect(lines[lines.length - 1]!.slice(0, 8)).toBe('34199999');
    expect(lines[lines.length - 1]!.slice(23, 29)).toBe('000010');
  });
  it('remessa vazia é recusada', () => {
    expect(() => buildCnab240Remessa({ ...remessa, titles: [] })).toThrow(/pelo menos um/);
  });

  function overlay(size: number, fields: [number, string][]): string {
    const chars = Array(size).fill(' ');
    for (const [from, text] of fields) text.split('').forEach((c, i) => (chars[from - 1 + i] = c));
    return chars.join('');
  }
  it('retorno: junta T e U, lê valores e rejeições', () => {
    const header = '3410000' + '0' + ' '.repeat(232);
    const t = overlay(240, [
      [1, '34100013'],
      [14, 'T'],
      [16, '06'],
      [38, '00000001'],
      [59, 'NF1234'],
      [74, '10112026'],
      [82, '000000000015050'],
      [214, '0302'],
    ]);
    const u = overlay(240, [
      [1, '34100013'],
      [14, 'U'],
      [18, '000000000002500'],
      [78, '000000000017550'],
      [93, '000000000017400'],
      [138, '25112026'],
      [146, '26112026'],
    ]);
    const tNoU = overlay(240, [
      [1, '34100013'],
      [14, 'T'],
      [38, '00000002'],
    ]);
    const orphanU = overlay(240, [
      [1, '34100013'],
      [14, 'U'],
    ]);
    const out = parseCnab240Retorno(
      [header, u, t, u, tNoU, 'curta', orphanU].join('\r\n') + '\r\n',
    );
    expect(out.entries).toHaveLength(2);
    expect(out.entries[0]).toMatchObject({
      ourNumber: '00000001',
      documentNumber: 'NF1234',
      occurrence: '06',
      dueDate: '2026-11-10',
      amountCents: 15_050,
      paidCents: 17_550,
      feesCents: 2500,
      creditedCents: 17_400,
      occurredOn: '2026-11-25',
      creditedOn: '2026-11-26',
      rejections: ['03', '02'],
    });
    expect(out.entries[1]).toMatchObject({ ourNumber: '00000002', paidCents: 0 });
    expect(out.problems).toHaveLength(2);
    expect(out.problems.some((p) => p.includes('sem o T'))).toBe(true);
  });
});

describe('CNAB 400', () => {
  const input = {
    cedente: {
      bankCode: '341',
      bankName: 'Banco Exemplo',
      taxId: '11222333000181',
      name: 'Mercadinho Bipaê',
      agency: '1234',
      account: '56789',
      accountDigit: '0',
      companyCode: 'EMP1',
      wallet: '109',
    },
    generatedOn: '2026-10-27',
    titles: [
      {
        ourNumber: '1',
        documentNumber: 'NF1234',
        amountCents: 15_050,
        dueDate: '2026-11-10',
        issueDate: '2026-10-27',
        payer,
        dailyInterestCents: 50,
        fine: { kind: 'percent_bps' as const, value: 200, fromDate: '2026-11-11' },
      },
      {
        ourNumber: '2',
        documentNumber: 'NF1235',
        amountCents: 9_900,
        dueDate: '2026-11-12',
        issueDate: '2026-10-27',
        payer: { ...payer, taxId: '11222333000181' },
        fine: { kind: 'fixed_cents' as const, value: 300, fromDate: '2026-11-13' },
      },
      {
        ourNumber: '3',
        documentNumber: 'NF1236',
        amountCents: 500,
        dueDate: '2026-11-12',
        issueDate: '2026-10-27',
        payer,
      },
    ],
  };
  it('remessa: 400 posições por linha, sequência e valores nos lugares', () => {
    const lines = buildCnab400Remessa(input).split('\r\n');
    lines.pop();
    expect(lines).toHaveLength(1 + 3 + 2 + 1);
    expect(lines.every((l) => l.length === 400)).toBe(true);
    expect(lines[0]!.slice(0, 26)).toBe('01REMESSA01COBRANCA       ');
    expect(lines[0]!.slice(94, 100)).toBe('271026');
    const d = lines[1]!;
    expect(d[0]).toBe('1');
    expect(d.slice(62, 70)).toBe('00000001');
    expect(d.slice(126, 139)).toBe('0000000015050');
    expect(d.slice(120, 126)).toBe('101126');
    expect(d.slice(160, 173)).toBe('0000000000050');
    expect(d.slice(394, 400)).toBe('000002');
    expect(lines[2]![0]).toBe('2');
    expect(lines[2]!.slice(1, 10)).toBe('211112026');
    expect(lines[2]!.slice(10, 23)).toBe('0000000000200');
    expect(lines[lines.length - 1]![0]).toBe('9');
    expect(lines[lines.length - 1]!.slice(394)).toBe('000007');
  });
  it('remessa vazia é recusada', () => {
    expect(() => buildCnab400Remessa({ ...input, titles: [] })).toThrow();
  });
  it('retorno: lê detalhes e acusa linha torta', () => {
    const chars = Array(400).fill(' ');
    const put = (from: number, text: string) =>
      text.split('').forEach((c, i) => (chars[from - 1 + i] = c));
    put(1, '1');
    put(63, '00000001');
    put(109, '06');
    put(111, '251126');
    put(117, 'NF1234');
    put(147, '101126');
    put(153, '0000000015050');
    put(254, '0000000017550');
    put(267, '0000000002500');
    put(296, '261126');
    const header = '02RETORNO'.padEnd(400, ' ');
    const out = parseCnab400Retorno([header, chars.join(''), 'curta'].join('\n'));
    expect(out.entries).toEqual([
      {
        ourNumber: '00000001',
        occurrence: '06',
        occurredOn: '2026-11-25',
        documentNumber: 'NF1234',
        dueDate: '2026-11-10',
        amountCents: 15_050,
        paidCents: 17_550,
        feesCents: 2500,
        creditedOn: '2026-11-26',
      },
    ]);
    expect(out.problems).toHaveLength(1);
  });
});
