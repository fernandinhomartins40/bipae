import { describe, expect, it } from 'vitest';
import { validatePackageXml, validateServiceXml } from '../../test/schema';
import { signFiscalXml, type WebCryptoKey } from '../nfce/sign';
import {
  buildCancelEvent,
  buildInutilization,
  eventRequest,
  inutilizationRequest,
  parseEventResponse,
  parseInutilizationResponse,
} from './events';

/** F3-17.a: cancelamento, cancelamento por substituição e inutilização, nos schemas oficiais. */

const CHAVE = '35261011222333000181650030000000421123456780';
const CHAVE_CONTINGENCIA = '35261011222333000181650030000000429123456781';
const NS = 'http://www.portalfiscal.inf.br/nfe';

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

const lote = (id: string, evento: string) =>
  `<envEvento xmlns="${NS}" versao="1.00"><idLote>${id}</idLote>${evento}</envEvento>`;

const envelope = (body: string) =>
  `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeResultMsg>${body}</nfeResultMsg></soap:Body></soap:Envelope>`;

describe('eventos e inutilização (F3-17.a)', () => {
  it('cancelamento (110111) assinado e válido no schema oficial, dentro do lote', async () => {
    const evento = await signFiscalXml(
      buildCancelEvent({
        accessKey: CHAVE,
        cnpj: '11222333000181',
        protocol: '135260000999999',
        reason: 'Venda cancelada a pedido do cliente',
        at: '2026-10-15T16:00:00-03:00',
      }),
      'evento',
      'infEvento',
      await chave(),
    );
    expect(evento).toContain(`<infEvento Id="ID110111${CHAVE}01">`);
    expect(evento).toContain('<descEvento>Cancelamento</descEvento>');
    expect(
      await validatePackageXml(
        lote('1', evento),
        'Evento_Canc_PL_v1.01_NT_2018_004.zip',
        'envEventoCancNFe_v1.00.xsd',
      ),
    ).toEqual([]);
    const req = eventRequest({ model: '65', uf: 'SP', batchId: '1', signedEvents: [evento] });
    expect(req.contentType).toContain(
      'action="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento"',
    );
    expect(req.url).toContain('homologacao');
  });

  it('cancelamento por substituição (110112) só da NFC-e, com a nota de contingência', async () => {
    const evento = await signFiscalXml(
      buildCancelEvent({
        accessKey: CHAVE,
        cnpj: '11222333000181',
        protocol: '135260000999999',
        reason: 'Venda acobertada pela NFC-e emitida em contingência',
        at: '2026-10-15T16:00:00-03:00',
        substitutedBy: { accessKey: CHAVE_CONTINGENCIA, appVersion: 'Bipae 1.0' },
      }),
      'evento',
      'infEvento',
      await chave(),
    );
    expect(evento).toContain(`<chNFeRef>${CHAVE_CONTINGENCIA}</chNFeRef>`);
    expect(
      await validatePackageXml(
        lote('2', evento),
        'Evento_CancSubst_v1.01_NT_2018_004.zip',
        'envEventoCancSubst_v1.00.xsd',
      ),
    ).toEqual([]);
    expect(() =>
      buildCancelEvent({
        accessKey: `${CHAVE.slice(0, 20)}55${CHAVE.slice(22)}`,
        cnpj: '11222333000181',
        protocol: '135260000999999',
        reason: 'Venda acobertada pela NFC-e de contingência',
        at: '2026-10-15T16:00:00-03:00',
        substitutedBy: { accessKey: CHAVE_CONTINGENCIA, appVersion: 'Bipae' },
      }),
    ).toThrow('O cancelamento por substituição é só da NFC-e.');
  });

  it('inutilização da faixa, assinada e válida no schema do PL_009q', async () => {
    const pedido = await signFiscalXml(
      buildInutilization({
        uf: 'SP',
        year: '26',
        cnpj: '11222333000181',
        model: '65',
        series: 3,
        from: 7,
        to: 9,
        reason: 'Números usados em devoluções, sem NFC-e',
      }),
      'inutNFe',
      'infInut',
      await chave(),
    );
    expect(pedido).toContain('<infInut Id="ID35261122233300018165003000000007000000009">');
    expect(await validateServiceXml(pedido, 'inutNFe_v4.00.xsd')).toEqual([]);
    expect(
      inutilizationRequest({ model: '65', uf: 'SP', signedXml: pedido }).contentType,
    ).toContain('NFeInutilizacao4/nfeInutilizacaoNF');
  });

  it('recusa justificativa curta, protocolo e faixa inválidos e envio sem assinatura', () => {
    const base = {
      accessKey: CHAVE,
      cnpj: '11222333000181',
      protocol: '135260000999999',
      at: '2026-10-15T16:00:00-03:00',
    };
    expect(() => buildCancelEvent({ ...base, reason: 'curta' })).toThrow(
      'A justificativa precisa ter de 15 a 255 caracteres.',
    );
    expect(() => buildCancelEvent({ ...base, protocol: '1', reason: 'x'.repeat(20) })).toThrow(
      'Protocolo inválido.',
    );
    expect(() => buildCancelEvent({ ...base, accessKey: '123', reason: 'x'.repeat(20) })).toThrow(
      'Chave de acesso inválida.',
    );
    expect(() =>
      buildInutilization({
        uf: 'SP',
        year: '26',
        cnpj: '11222333000181',
        model: '65',
        series: 3,
        from: 9,
        to: 7,
        reason: 'x'.repeat(20),
      }),
    ).toThrow('Faixa de números inválida.');
    expect(() =>
      buildInutilization({
        uf: 'SP',
        year: '2026',
        cnpj: '11222333000181',
        model: '65',
        series: 3,
        from: 1,
        to: 2,
        reason: 'x'.repeat(20),
      }),
    ).toThrow('Ano inválido (2 dígitos).');
    expect(() =>
      buildInutilization({
        uf: 'SP',
        year: '26',
        cnpj: '11222333000181',
        model: '65',
        series: 1000,
        from: 1,
        to: 2,
        reason: 'x'.repeat(20),
      }),
    ).toThrow('Série inválida.');
    expect(() =>
      eventRequest({ model: '65', uf: 'SP', batchId: '1', signedEvents: ['<evento/>'] }),
    ).toThrow('Evento sem assinatura.');
    expect(() => eventRequest({ model: '65', uf: 'SP', batchId: 'abc', signedEvents: [] })).toThrow(
      'Número do lote inválido.',
    );
    expect(() => inutilizationRequest({ model: '65', uf: 'SP', signedXml: '<inutNFe/>' })).toThrow(
      'Pedido de inutilização sem assinatura.',
    );
  });

  it('lê o retorno do evento e da inutilização', () => {
    const ok = parseEventResponse(
      envelope(
        '<retEnvEvento versao="1.00"><idLote>1</idLote><tpAmb>2</tpAmb><verAplic>SP</verAplic><cOrgao>35</cOrgao><cStat>128</cStat><xMotivo>Lote de evento processado</xMotivo>' +
          '<retEvento versao="1.00"><infEvento><tpAmb>2</tpAmb><verAplic>SP</verAplic><cOrgao>35</cOrgao><cStat>135</cStat><xMotivo>Evento registrado e vinculado a NF-e</xMotivo>' +
          `<chNFe>${CHAVE}</chNFe><tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento><dhRegEvento>2026-10-15T16:00:01-03:00</dhRegEvento><nProt>135260000888888</nProt></infEvento></retEvento></retEnvEvento>`,
      ),
    );
    expect(ok).toMatchObject({ cStat: '135', registered: true, protocol: '135260000888888' });
    expect(ok.xml).toContain('<retEvento');
    const fora = parseEventResponse(
      envelope(
        '<retEnvEvento><cStat>128</cStat><xMotivo>Lote</xMotivo><retEvento><infEvento><cStat>501</cStat><xMotivo>Rejeição: Prazo de cancelamento superior ao previsto na Legislação</xMotivo></infEvento></retEvento></retEnvEvento>',
      ),
    );
    expect(fora).toMatchObject({ cStat: '501', registered: false });
    expect(
      parseEventResponse(
        envelope('<retEnvEvento><cStat>215</cStat><xMotivo>Falha</xMotivo></retEnvEvento>'),
      ),
    ).toMatchObject({ cStat: '215', registered: false });
    expect(
      parseInutilizationResponse(
        envelope(
          '<retInutNFe><infInut><tpAmb>2</tpAmb><cStat>102</cStat><xMotivo>Inutilização de número homologado</xMotivo><dhRecbto>2026-10-15T16:00:00-03:00</dhRecbto><nProt>135260000777777</nProt></infInut></retInutNFe>',
        ),
      ),
    ).toMatchObject({ cStat: '102', registered: true, protocol: '135260000777777' });
    expect(() => parseEventResponse('não é xml')).toThrow();
    expect(() => parseInutilizationResponse(envelope('<outra/>'))).toThrow();
    expect(() =>
      parseEventResponse(
        '<soap:Envelope xmlns:soap="x"><soap:Body><soap:Fault><soap:Reason><soap:Text>Erro</soap:Text></soap:Reason></soap:Fault></soap:Body></soap:Envelope>',
      ),
    ).toThrow('SOAP Fault');
  });
});
