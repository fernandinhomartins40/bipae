import { describe, expect, it } from 'vitest';
import { validateServiceXml } from '../../test/schema';
import { buildNfce, type NfceInput } from '../nfce/build';
import { signNfe, type WebCryptoKey } from '../nfce/sign';
import { calculateIcms } from '../taxes/icms';
import {
  authorizationRequest,
  buildNfeProc,
  consultRequest,
  parseBatchResponse,
  parseConsultResponse,
  parseStatusResponse,
  receiptRequest,
  sefazOutcome,
  sefazUrl,
  SefazMessageError,
  SefazResponseError,
  statusRequest,
  ufCode,
} from './index';

/** F3-11.a: mensagens dos webservices da SEFAZ e leitura dos retornos (homologação). */

const venda: NfceInput = {
  issuer: {
    cnpj: '11222333000181',
    name: 'Mercadinho Bipaê LTDA',
    ie: '110042490114',
    crt: 1,
    address: {
      street: 'Rua das Flores',
      number: '100',
      district: 'Centro',
      cityCode: '3550308',
      cityName: 'São Paulo',
      uf: 'SP',
      cep: '01001000',
    },
  },
  cUF: '35',
  series: 1,
  number: 42,
  issuedAt: '2026-06-15T10:30:00-03:00',
  numericCode: '12345678',
  items: [
    {
      code: 'ARZ5',
      gtin: null,
      description: 'Arroz Tipo 1 5kg',
      ncm: '10063021',
      cfop: '5102',
      unit: 'UN',
      quantityMilli: 1000,
      unitPriceCents: 2500,
      grossCents: 2500,
      discountCents: 0,
      origin: '0',
      icms: calculateIcms({ csosn: '102' }, { baseCents: 2500 }),
    },
  ],
  payments: [{ code: '01', amountCents: 2500 }],
  appVersion: 'Bipae 0.3.0',
};

async function notaAssinada() {
  const doc = buildNfce(venda);
  const par = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-1',
    },
    false,
    ['sign'],
  )) as { privateKey: WebCryptoKey };
  const xml = await signNfe(doc.xml, { privateKey: par.privateKey, certificate: btoa('teste') });
  return { xml, accessKey: doc.accessKey };
}

/** O XML dentro do envelope SOAP (a mensagem que o schema descreve). */
const payloadOf = (envelope: string) =>
  /<nfeDadosMsg[^>]*>([\s\S]*)<\/nfeDadosMsg>/.exec(envelope)![1]!;

const soap = (ns: string, body: string) =>
  '<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">' +
  `<soap:Body><nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/${ns}">${body}</nfeResultMsg></soap:Body></soap:Envelope>`;

const protNFe = (key: string, cStat: string, xMotivo: string, nProt = '135260000123456') =>
  `<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><verAplic>SP_NFCE_PL009_V400</verAplic><chNFe>${key}</chNFe>` +
  `<dhRecbto>2026-06-15T10:30:02-03:00</dhRecbto>${cStat === '100' ? `<nProt>${nProt}</nProt><digVal>AAAA</digVal>` : ''}` +
  `<cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo></infProt></protNFe>`;

describe('mensagens para a SEFAZ', () => {
  it('status do serviço: SOAP 1.2 com a ação, cUF da empresa e só homologação', async () => {
    const req = statusRequest('65', 'SP');
    expect(req.url).toBe(sefazUrl('65', 'SP', 'NFeStatusServico'));
    expect(req.url).toMatch(/^https:\/\/.*homologacao/);
    expect(req.contentType).toBe(
      'application/soap+xml; charset=utf-8; action="http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4/nfeStatusServicoNF"',
    );
    expect(req.envelope).toContain(
      '<soap12:Body><nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4">',
    );
    const payload = payloadOf(req.envelope);
    expect(payload).toBe(
      '<consStatServ xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><tpAmb>2</tpAmb><cUF>35</cUF><xServ>STATUS</xServ></consStatServ>',
    );
    expect(await validateServiceXml(payload, 'consStatServ_v4.00.xsd')).toEqual([]);
    expect(statusRequest('55', 'MA').url).toContain('sefazvirtual.fazenda.gov.br');
  });

  it('lote com uma nota assinada pede processamento síncrono e passa no schema', async () => {
    const { xml } = await notaAssinada();
    const req = authorizationRequest({
      model: '65',
      uf: 'SP',
      batchId: '1',
      signedXmls: [`<?xml version="1.0"?>${xml}`],
    });
    expect(req.contentType).toContain('NFeAutorizacao4/nfeAutorizacaoLote');
    const payload = payloadOf(req.envelope);
    expect(payload).toMatch(
      /^<enviNFe xmlns="http:\/\/www.portalfiscal.inf.br\/nfe" versao="4.00"><idLote>1<\/idLote><indSinc>1<\/indSinc><NFe /,
    );
    expect(payload).not.toContain('<?xml');
    expect(await validateServiceXml(payload, 'enviNFe_v4.00.xsd')).toEqual([]);
    const lote = authorizationRequest({
      model: '65',
      uf: 'SP',
      batchId: '2',
      signedXmls: [xml, xml],
    });
    expect(lote.envelope).toContain('<indSinc>0</indSinc>');
  });

  it('recibo e consulta pela chave passam no schema', async () => {
    const recibo = payloadOf(receiptRequest('55', 'PR', '412000000123456').envelope);
    expect(await validateServiceXml(recibo, 'consReciNFe_v4.00.xsd')).toEqual([]);
    const { accessKey } = await notaAssinada();
    const consulta = consultRequest('SP', accessKey);
    expect(consulta.url).toBe(sefazUrl('65', 'SP', 'NFeConsultaProtocolo'));
    expect(await validateServiceXml(payloadOf(consulta.envelope), 'consSitNFe_v4.00.xsd')).toEqual(
      [],
    );
  });

  it('recusa o que não pode ir para a SEFAZ', async () => {
    const { xml } = await notaAssinada();
    const lote = (over: Partial<Parameters<typeof authorizationRequest>[0]>) => () =>
      authorizationRequest({ model: '65', uf: 'SP', batchId: '1', signedXmls: [xml], ...over });
    expect(lote({ batchId: 'abc' })).toThrow('Número do lote');
    expect(lote({ signedXmls: [] })).toThrow('de 1 a 50');
    expect(lote({ signedXmls: Array(51).fill(xml) })).toThrow('de 1 a 50');
    expect(lote({ signedXmls: [xml.replace(/<Signature[\s\S]*<\/Signature>/, '')] })).toThrow(
      'sem assinatura',
    );
    expect(lote({ signedXmls: [xml.replace('<tpAmb>2</tpAmb>', '<tpAmb>1</tpAmb>')] })).toThrow(
      'homologação',
    );
    expect(lote({ model: '55' })).toThrow('modelo 55');
    expect(() => receiptRequest('55', 'SP', '123')).toThrow('recibo');
    expect(() => consultRequest('SP', '123')).toThrow('Chave de acesso');
    expect(() => consultRequest('SP', '3'.repeat(20) + '99' + '1'.repeat(22))).toThrow(
      'nem de NFC-e',
    );
    expect(() => ufCode('XX')).toThrow(SefazMessageError);
    expect(() => sefazUrl('65', 'XX', 'NFeStatusServico')).toThrow('Sem endereço');
  });
});

describe('retornos da SEFAZ', () => {
  it('status: em operação ou paralisado', () => {
    const ok = parseStatusResponse(
      soap(
        'NFeStatusServico4',
        '<retConsStatServ versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>2</tpAmb><verAplic>SP</verAplic>' +
          '<cStat>107</cStat><xMotivo>Serviço em Operação</xMotivo><cUF>35</cUF><dhRecbto>2026-10-13T10:00:00-03:00</dhRecbto><tMed>1</tMed></retConsStatServ>',
      ),
    );
    expect(ok).toEqual({
      cStat: '107',
      xMotivo: 'Serviço em Operação',
      online: true,
      receivedAt: '2026-10-13T10:00:00-03:00',
      averageSeconds: 1,
    });
    const parado = parseStatusResponse(
      soap(
        'NFeStatusServico4',
        '<retConsStatServ><cStat>108</cStat><xMotivo>Paralisado</xMotivo><xObs>Manutenção</xObs></retConsStatServ>',
      ),
    );
    expect(parado).toMatchObject({ online: false, observation: 'Manutenção' });
  });

  it('lote síncrono autorizado vira o XML autorizado (nfeProc), válido no schema', async () => {
    const { xml, accessKey } = await notaAssinada();
    const resposta = soap(
      'NFeAutorizacao4',
      '<retEnviNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>2</tpAmb><verAplic>SP</verAplic>' +
        `<cStat>104</cStat><xMotivo>Lote processado</xMotivo><cUF>35</cUF><dhRecbto>2026-06-15T10:30:02-03:00</dhRecbto>${protNFe(accessKey, '100', 'Autorizado o uso da NF-e')}</retEnviNFe>`,
    );
    const lote = parseBatchResponse(resposta);
    expect(lote).toMatchObject({ cStat: '104', outcome: 'batch-processed' });
    const [prot] = lote.protocols;
    expect(prot).toMatchObject({
      accessKey,
      cStat: '100',
      outcome: 'authorized',
      number: '135260000123456',
    });
    const proc = buildNfeProc(xml, prot!);
    expect(proc).toMatch(
      /^<\?xml version="1.0" encoding="UTF-8"\?><nfeProc xmlns="http:\/\/www.portalfiscal.inf.br\/nfe" versao="4.00"><NFe /,
    );
    expect(
      await validateServiceXml(proc.replace(/^<\?xml[^>]*\?>/, ''), 'procNFe_v4.00.xsd'),
    ).toEqual([]);
  });

  it('lote assíncrono devolve recibo; a consulta do recibo traz a rejeição', async () => {
    const recebido = parseBatchResponse(
      soap(
        'NFeAutorizacao4',
        '<retEnviNFe><cStat>103</cStat><xMotivo>Lote recebido com sucesso</xMotivo><infRec><nRec>352000000123456</nRec><tMed>2</tMed></infRec></retEnviNFe>',
      ),
    );
    expect(recebido).toMatchObject({
      outcome: 'processing',
      receipt: '352000000123456',
      averageSeconds: 2,
      protocols: [],
    });
    const { accessKey, xml } = await notaAssinada();
    const rejeitado = parseBatchResponse(
      soap(
        'NFeRetAutorizacao4',
        `<retConsReciNFe><nRec>352000000123456</nRec><cStat>104</cStat><xMotivo>Lote processado</xMotivo>${protNFe(accessKey, '539', 'Rejeição: Duplicidade de NF-e com diferença na Chave de Acesso')}</retConsReciNFe>`,
      ),
    );
    expect(rejeitado.receipt).toBe('352000000123456');
    expect(rejeitado.protocols[0]).toMatchObject({ cStat: '539', outcome: 'rejected' });
    expect(rejeitado.protocols[0]!.number).toBeUndefined();
    expect(() => buildNfeProc(xml, rejeitado.protocols[0]!)).toThrow('não foi autorizada: 539');
  });

  it('consulta pela chave: autorizada, denegada ou inexistente', async () => {
    const { accessKey, xml } = await notaAssinada();
    const autorizada = parseConsultResponse(
      soap(
        'NFeConsultaProtocolo4',
        `<retConsSitNFe><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo><chNFe>${accessKey}</chNFe>${protNFe(accessKey, '100', 'Autorizado o uso da NF-e')}</retConsSitNFe>`,
      ),
    );
    expect(autorizada.protocol).toMatchObject({ outcome: 'authorized' });
    expect(buildNfeProc(xml, autorizada.protocol!)).toContain('<nProt>135260000123456</nProt>');
    const outra = { ...autorizada.protocol!, accessKey: '0'.repeat(44) };
    expect(() => buildNfeProc(xml, outra)).toThrow('não é desta nota');
    const inexistente = parseConsultResponse(
      soap(
        'NFeConsultaProtocolo4',
        '<retConsSitNFe><cStat>217</cStat><xMotivo>Rejeição: NF-e não consta na base de dados da SEFAZ</xMotivo></retConsSitNFe>',
      ),
    );
    expect(inexistente).toEqual({
      cStat: '217',
      xMotivo: 'Rejeição: NF-e não consta na base de dados da SEFAZ',
      outcome: 'rejected',
    });
    expect(sefazOutcome('302')).toBe('denied');
    expect(sefazOutcome('150')).toBe('authorized');
  });

  it('falha SOAP, resposta que não é XML e retorno incompleto viram erro claro', () => {
    const fault =
      '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><soap:Fault><soap:Code><soap:Value>soap:Receiver</soap:Value></soap:Code>' +
      '<soap:Reason><soap:Text xml:lang="pt">Certificado não autorizado</soap:Text></soap:Reason></soap:Fault></soap:Body></soap:Envelope>';
    expect(() => parseStatusResponse(fault)).toThrow('SOAP Fault): Certificado não autorizado');
    expect(() => parseStatusResponse('<html>erro 503')).toThrow('não é XML');
    expect(() => parseStatusResponse(soap('X', '<outra/>'))).toThrow('não traz retConsStatServ');
    expect(() =>
      parseStatusResponse(soap('X', '<retConsStatServ><cStat>107</cStat></retConsStatServ>')),
    ).toThrow('não traz xMotivo');
    expect(() =>
      parseBatchResponse(
        soap('X', '<retEnviNFe><cStat>104</cStat><xMotivo>ok</xMotivo><protNFe/></retEnviNFe>'),
      ),
    ).toThrow(SefazResponseError);
  });
});
