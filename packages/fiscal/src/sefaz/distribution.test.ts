import { describe, expect, it } from 'vitest';
import { validatePackageXml } from '../../test/schema';
import { signFiscalXml, type WebCryptoKey } from '../nfce/sign';
import {
  buildDistributionQuery,
  buildRecipientEvent,
  distributionRequest,
  parseDistributionResponse,
  recipientEventRequest,
} from './distribution';

/** F3-20.a: distribuição de DF-e e manifestação do destinatário, nos schemas oficiais. */

const DIST = 'PL_NFeDistDFe_104_2026-07-03.zip';
const MANIF = 'Evento_ManifestaDest_PL_v1.01.zip';
const NS = 'http://www.portalfiscal.inf.br/nfe';
const CHAVE = '35261011444777000161550010000012341000012345';

async function chave() {
  const par = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-1',
    },
    false,
    ['sign'],
  )) as unknown as { privateKey: WebCryptoKey };
  return { privateKey: par.privateKey, certificate: 'AAAA' };
}

/** docZip como o Ambiente Nacional manda: GZip em base64. */
async function zipado(xml: string) {
  const stream = new Blob([new TextEncoder().encode(xml)])
    .stream()
    .pipeThrough(new CompressionStream('gzip'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

const RESUMO =
  `<resNFe xmlns="${NS}" versao="1.01"><chNFe>${CHAVE}</chNFe><CNPJ>11444777000161</CNPJ>` +
  '<xNome>Distribuidora Fornecedora LTDA</xNome><IE>111222333444</IE>' +
  '<dhEmi>2026-10-15T10:00:00-03:00</dhEmi><tpNF>1</tpNF><vNF>1530.75</vNF>' +
  '<dhRecbto>2026-10-15T10:00:05-03:00</dhRecbto><nProt>135260000123456</nProt>' +
  '<cSitNFe>1</cSitNFe></resNFe>';

describe('distribuição de DF-e (F3-20.a)', () => {
  it('pedido pelo último NSU, por um NSU e pela chave, válidos no schema oficial', async () => {
    for (const query of [{ ultNSU: 0 }, { nsu: '123' }, { accessKey: CHAVE }]) {
      const xml = buildDistributionQuery({ taxId: '11.222.333/0001-81', uf: 'SP', query });
      expect(
        await validatePackageXml(xml, DIST, 'distDFeInt_v1.01.xsd'),
        JSON.stringify(query),
      ).toEqual([]);
    }
    const xml = buildDistributionQuery({
      taxId: '11222333000181',
      uf: 'SP',
      query: { ultNSU: 42 },
    });
    expect(xml).toContain('<cUFAutor>35</cUFAutor><CNPJ>11222333000181</CNPJ>');
    expect(xml).toContain('<ultNSU>000000000000042</ultNSU>');
    const req = distributionRequest(xml);
    expect(req.url).toBe(
      'https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',
    );
    expect(req.envelope).toContain(
      '<nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe"><nfeDadosMsg><distDFeInt',
    );
    expect(req.contentType).toContain(
      'action="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse"',
    );
  });

  it('o resumo de teste segue o schema oficial do resNFe', async () => {
    expect(await validatePackageXml(RESUMO, DIST, 'resNFe_v1.01.xsd', [MANIF])).toEqual([]);
  });

  it('lê o retorno: NSU, resumo e evento descompactados', async () => {
    const evento =
      `<resEvento xmlns="${NS}" versao="1.01"><cOrgao>91</cOrgao><CNPJ>11444777000161</CNPJ>` +
      `<chNFe>${CHAVE}</chNFe><dhEvento>2026-10-15T11:00:00-03:00</dhEvento><tpEvento>110111</tpEvento>` +
      '<nSeqEvento>1</nSeqEvento><xEvento>Cancelamento</xEvento><dhRecbto>2026-10-15T11:00:02-03:00</dhRecbto>' +
      '<nProt>135260000123457</nProt></resEvento>';
    const resposta =
      '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>' +
      '<nfeDistDFeInteresseResponse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe"><nfeDistDFeInteresseResult>' +
      `<retDistDFeInt xmlns="${NS}" versao="1.01"><tpAmb>2</tpAmb><verAplic>1.7.6</verAplic><cStat>138</cStat>` +
      '<xMotivo>Documento localizado</xMotivo><dhResp>2026-10-18T09:00:00-03:00</dhResp>' +
      '<ultNSU>000000000000002</ultNSU><maxNSU>000000000000002</maxNSU><loteDistDFeInt>' +
      `<docZip NSU="000000000000001" schema="resNFe_v1.01.xsd">${await zipado(RESUMO)}</docZip>` +
      `<docZip NSU="000000000000002" schema="resEvento_v1.01.xsd">${await zipado(evento)}</docZip>` +
      '</loteDistDFeInt></retDistDFeInt></nfeDistDFeInteresseResult></nfeDistDFeInteresseResponse></soap:Body></soap:Envelope>';
    const r = await parseDistributionResponse(resposta);
    expect(r).toMatchObject({ cStat: '138', ultNSU: '000000000000002', maxNSU: '000000000000002' });
    expect(r.documents[0]).toMatchObject({
      kind: 'resumo',
      nsu: '000000000000001',
      summary: {
        accessKey: CHAVE,
        issuerTaxId: '11444777000161',
        issuerName: 'Distribuidora Fornecedora LTDA',
        totalCents: 153_075,
        protocol: '135260000123456',
        situation: 'autorizada',
      },
    });
    expect(r.documents[1]).toMatchObject({ kind: 'evento', accessKey: CHAVE, eventType: '110111' });
  });

  it('nenhum documento novo (137) e resposta fora do formato', async () => {
    const vazia =
      `<retDistDFeInt xmlns="${NS}" versao="1.01"><tpAmb>2</tpAmb><verAplic>1</verAplic><cStat>137</cStat>` +
      '<xMotivo>Nenhum documento localizado</xMotivo><dhResp>2026-10-18T09:00:00-03:00</dhResp>' +
      '<ultNSU>000000000000002</ultNSU><maxNSU>000000000000002</maxNSU></retDistDFeInt>';
    expect(await parseDistributionResponse(vazia)).toMatchObject({ cStat: '137', documents: [] });
    await expect(parseDistributionResponse('não é xml')).rejects.toThrow('não é XML');
    expect(() => buildDistributionQuery({ taxId: '123', uf: 'SP', query: { ultNSU: 0 } })).toThrow(
      'CNPJ ou o CPF',
    );
  });
});

describe('manifestação do destinatário (F3-20.a)', () => {
  it('ciência, confirmação, desconhecimento e operação não realizada, válidos no schema', async () => {
    const key = await chave();
    for (const [type, code] of [
      ['ciencia', '210210'],
      ['confirmacao', '210200'],
      ['desconhecimento', '210220'],
      ['naoRealizada', '210240'],
    ] as const) {
      const evento = await signFiscalXml(
        buildRecipientEvent({
          accessKey: CHAVE,
          taxId: '11.222.333/0001-81',
          type,
          ...(type === 'naoRealizada' && { reason: 'A mercadoria não foi entregue na loja' }),
          at: '2026-10-18T09:00:00-03:00',
        }),
        'evento',
        'infEvento',
        key,
      );
      expect(evento).toContain(`<infEvento Id="ID${code}${CHAVE}01">`);
      expect(evento).toContain('<cOrgao>91</cOrgao>');
      const lote = `<envEvento xmlns="${NS}" versao="1.00"><idLote>1</idLote>${evento}</envEvento>`;
      expect(await validatePackageXml(lote, MANIF, 'envConfRecebto_v1.00.xsd'), type).toEqual([]);
      const req = recipientEventRequest({ batchId: '1', signedEvent: evento });
      expect(req.url).toBe(
        'https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
      );
    }
  });

  it('operação não realizada pede a justificativa; evento sem assinatura não vai', () => {
    expect(() =>
      buildRecipientEvent({
        accessKey: CHAVE,
        taxId: '11222333000181',
        type: 'naoRealizada',
        at: '2026-10-18T09:00:00-03:00',
      }),
    ).toThrow('não foi realizada');
    const xml = buildRecipientEvent({
      accessKey: CHAVE,
      taxId: '11222333000181',
      type: 'ciencia',
      at: '2026-10-18T09:00:00-03:00',
    });
    expect(() => recipientEventRequest({ batchId: '1', signedEvent: xml })).toThrow(
      'sem assinatura',
    );
  });
});

describe('distribuição: casos de borda (F3-20.a)', () => {
  const retorno = (lote: string) =>
    `<retDistDFeInt xmlns="${NS}" versao="1.01"><tpAmb>2</tpAmb><verAplic>1</verAplic><cStat>138</cStat>` +
    '<xMotivo>Documento localizado</xMotivo><dhResp>2026-10-18T09:00:00-03:00</dhResp>' +
    `<ultNSU>000000000000003</ultNSU><maxNSU>000000000000003</maxNSU><loteDistDFeInt>${lote}</loteDistDFeInt></retDistDFeInt>`;

  it('nota completa, documento de outro tipo e conteúdo que não é XML', async () => {
    const proc =
      `<nfeProc xmlns="${NS}" versao="4.00"><NFe><infNFe Id="NFe${CHAVE}" versao="4.00">` +
      '<ide><dhEmi>2026-10-15T10:00:00-03:00</dhEmi><tpNF>0</tpNF></ide>' +
      '<emit><CPF>12345678909</CPF><xNome>Produtor Rural</xNome></emit>' +
      '<total><ICMSTot><vNF>10</vNF></ICMSTot></total></infNFe></NFe>' +
      `<protNFe versao="4.00"><infProt><nProt>135260000123456</nProt><cStat>100</cStat></infProt></protNFe></nfeProc>`;
    const r = await parseDistributionResponse(
      retorno(
        `<docZip NSU="000000000000001" schema="procNFe_v4.00.xsd">${await zipado(proc)}</docZip>` +
          `<docZip NSU="000000000000002" schema="resCTe_v1.00.xsd">${await zipado('<resCTe/>')}</docZip>` +
          `<docZip NSU="000000000000003" schema="resNFe_v1.01.xsd">${await zipado('isto não é xml <')}</docZip>`,
      ),
    );
    expect(r.documents.map((d) => d.kind)).toEqual(['nota', 'outro', 'outro']);
    expect(r.documents[0]).toMatchObject({
      summary: {
        accessKey: CHAVE,
        issuerTaxId: '12345678909',
        direction: '0',
        totalCents: 1000,
        issuerIe: null,
        situation: 'autorizada',
      },
    });
  });

  it('resumo sem situação e evento que não é de cancelamento', async () => {
    const semSituacao = RESUMO.replace('<cSitNFe>1</cSitNFe>', '').replace(
      '<IE>111222333444</IE>',
      '',
    );
    const evento = `<procEventoNFe xmlns="${NS}"><evento><infEvento><chNFe>${CHAVE}</chNFe><tpEvento>110110</tpEvento></infEvento></evento></procEventoNFe>`;
    const r = await parseDistributionResponse(
      retorno(
        `<docZip NSU="000000000000001" schema="resNFe_v1.01.xsd">${await zipado(semSituacao)}</docZip>` +
          `<docZip NSU="000000000000002" schema="procEventoNFe_v1.00.xsd">${await zipado(evento)}</docZip>`,
      ),
    );
    expect(r.documents[0]).toMatchObject({ summary: { situation: null, issuerIe: null } });
    expect(r.documents[1]).toMatchObject({ kind: 'evento', eventType: '110110' });
  });

  it('SOAP Fault, resposta sem o retorno e pedidos inválidos', async () => {
    const fault =
      '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><soap:Fault>' +
      '<soap:Reason><soap:Text>Certificado não autorizado</soap:Text></soap:Reason></soap:Fault></soap:Body></soap:Envelope>';
    await expect(parseDistributionResponse(fault)).rejects.toThrow('Certificado não autorizado');
    await expect(parseDistributionResponse('<outra/>')).rejects.toThrow('retDistDFeInt');
    expect(
      buildDistributionQuery({ taxId: '123.456.789-09', uf: 'MG', query: { ultNSU: 0 } }),
    ).toContain('<cUFAutor>31</cUFAutor><CPF>12345678909</CPF>');
    expect(() =>
      buildDistributionQuery({ taxId: '11222333000181', uf: 'SP', query: { accessKey: '123' } }),
    ).toThrow('Chave de acesso inválida');
    expect(() =>
      buildDistributionQuery({ taxId: '11222333000181', uf: 'SP', query: { nsu: 'x' } }),
    ).toThrow('NSU inválido');
    const base = { accessKey: CHAVE, taxId: '11222333000181', at: '2026-10-18T09:00:00-03:00' };
    expect(() => buildRecipientEvent({ ...base, type: 'ciencia', sequence: 21 })).toThrow(
      'Sequência',
    );
    expect(() => buildRecipientEvent({ ...base, accessKey: '1', type: 'ciencia' })).toThrow(
      'Chave de acesso inválida',
    );
    expect(() => buildRecipientEvent({ ...base, taxId: '1', type: 'ciencia' })).toThrow(
      'CNPJ ou o CPF',
    );
    expect(
      buildRecipientEvent({ ...base, taxId: '123.456.789-09', type: 'ciencia', sequence: 2 }),
    ).toContain(`<CPF>12345678909</CPF>`);
    expect(() => recipientEventRequest({ batchId: 'x', signedEvent: '<Signature>' })).toThrow(
      'lote',
    );
  });
});
