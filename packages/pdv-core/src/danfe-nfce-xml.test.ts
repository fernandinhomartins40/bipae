import { buildNfeProc, buildSaleNfce } from '@bipae/fiscal';
import { describe, expect, it } from 'vitest';
import { buildDanfeNfce } from './danfe-nfce';
import { danfeNfceFromXml, DanfeXmlError } from './danfe-nfce-xml';

/** F3-14.c: o cupom (DANFE da NFC-e) sai do XML autorizado. */

function notaAutorizada() {
  const r = buildSaleNfce({
    saleId: '0192a000-0000-7000-8000-00000000abcd',
    company: {
      cnpj: '11222333000181',
      legalName: 'Mercadinho Bipaê LTDA',
      ie: '111222333444',
      uf: 'SP',
      regime: 'simples',
      address: {
        street: 'Rua das Flores',
        number: '100',
        district: 'Centro',
        cityCode: '3550308',
        cityName: 'São Paulo',
        cep: '01001000',
      },
    },
    series: 3,
    terminalSeq: 42,
    occurredAt: '2026-10-15T18:30:00.000Z',
    items: [
      {
        code: 'ARROZ5',
        barcodes: ['7891000315507'],
        description: 'Arroz tipo 1 5kg',
        ncm: '10063021',
        unit: 'UN',
        quantityMilli: 2000,
        unitPriceCents: 2890,
        grossCents: 5780,
        discountCents: 80,
        profile: {
          cfopInterna: '5102',
          cfopInterestadual: '6102',
          csosn: '102',
          cClassTrib: '000001',
        },
      },
    ],
    payments: [
      { method: 'cash', amountCents: 5000, changeCents: 300 },
      { method: 'pix', amountCents: 700 },
    ],
    customerTaxId: '12345678909',
    appVersion: 'Bipaê',
  });
  if (!r.ok) throw new Error(r.pending.join('; '));
  const key = r.document.accessKey;
  return buildNfeProc(r.document.xml, {
    accessKey: key,
    cStat: '100',
    xMotivo: 'Autorizado o uso da NF-e',
    outcome: 'authorized',
    number: '135260000999999',
    receivedAt: '2026-10-15T15:30:05-03:00',
    xml:
      `<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><verAplic>SP</verAplic><chNFe>${key}</chNFe>` +
      `<dhRecbto>2026-10-15T15:30:05-03:00</dhRecbto><nProt>135260000999999</nProt><digVal>AAAA</digVal>` +
      `<cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe>`,
  });
}

describe('DANFE da NFC-e a partir do XML autorizado (F3-14.c)', () => {
  it('lê emitente, itens, totais, pagamentos com o nome oficial, troco, CPF e protocolo', () => {
    const data = danfeNfceFromXml(notaAutorizada());
    expect(data).toMatchObject({
      environment: 'homologacao',
      emitter: {
        cnpj: '11222333000181',
        legalName: 'Mercadinho Bipaê LTDA',
        address: 'Rua das Flores, 100, Centro, São Paulo - SP',
      },
      items: [
        {
          code: 'ARROZ5',
          quantityMilli: 2000,
          unit: 'UN',
          unitPriceCents: 2890,
          totalCents: 5780,
        },
      ],
      discountCents: 80,
      surchargeCents: 0,
      totalCents: 5700,
      payments: [
        { label: 'Dinheiro', amountCents: 5300 },
        { label: 'Pagamento Instantâneo (PIX) - Estático', amountCents: 700 },
      ],
      changeCents: 300,
      consumer: { kind: 'cpf', id: '12345678909' },
      number: 42,
      series: 3,
      protocol: { number: '135260000999999', receivedAt: '2026-10-15T15:30:05-03:00' },
      contingency: false,
    });
    expect(data.accessKey).toMatch(/^35\d{42}$/);
    expect(data.qrCode).not.toBe('');
    // E o cupom sai com a chave e o protocolo.
    const text = JSON.stringify(
      buildDanfeNfce(data, { columns: 48, timeZone: 'America/Sao_Paulo' }),
    );
    expect(text).toContain('135260000999999');
  });

  it('recusa o que não é NFC-e', () => {
    expect(() => danfeNfceFromXml('não é xml')).toThrow(DanfeXmlError);
    expect(() => danfeNfceFromXml('<NFe><infNFe><ide><mod>55</mod></ide></infNFe></NFe>')).toThrow(
      'O XML não é de uma NFC-e.',
    );
  });
});
