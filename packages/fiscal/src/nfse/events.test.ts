import { describe, expect, it } from 'vitest';
import { validateNfseXml } from '../../test/schema';
import { signFiscalXml, type WebCryptoKey } from '../nfce/sign';
import { buildNfseCancelRequest, nfseEventRequest, parseNfseEventResponse } from './events';
import { gunzipBase64, gzipBase64 } from './sefin';

/** F5-13.g: cancelamento da NFS-e Nacional (evento 101101) no schema oficial. */

const CHAVE = '35503082211222333000181000000000000126100000000017';

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

const pedido = (over: Partial<Parameters<typeof buildNfseCancelRequest>[0]> = {}) =>
  buildNfseCancelRequest({
    accessKey: CHAVE,
    cnpj: '11222333000181',
    code: '2',
    reason: 'O serviço não foi prestado: cliente desistiu.',
    at: '2026-10-19T10:00:00-03:00',
    ...over,
  });

describe('cancelamento da NFS-e Nacional (F5-13.g)', () => {
  it('pedido 101101 assinado e válido no pedRegEvento_v1.01; Id PRE + chave + código do evento', async () => {
    const xml = await signFiscalXml(pedido(), 'pedRegEvento', 'infPedReg', await chave());
    expect(xml).toContain(`<infPedReg Id="PRE${CHAVE}101101">`);
    expect(xml).toContain('<xDesc>Cancelamento de NFS-e</xDesc><cMotivo>2</cMotivo>');
    expect(await validateNfseXml(xml, 'pedRegEvento_v1.01.xsd')).toEqual([]);
    const req = await nfseEventRequest(CHAVE, xml);
    expect(req.url).toMatch(new RegExp(`/nfse/${CHAVE}/eventos$`));
    const body = JSON.parse(req.body!) as { pedidoRegistroEventoXmlGZipB64: string };
    expect(await gunzipBase64(body.pedidoRegistroEventoXmlGZipB64)).toBe(xml);
  });

  it('confere chave, motivo e texto antes de assinar; sem assinatura não envia', async () => {
    expect(() => pedido({ accessKey: '123' })).toThrow(/Chave/);
    expect(() => pedido({ code: '5' as never })).toThrow(/1, 2 ou 9/);
    expect(() => pedido({ reason: 'curto' })).toThrow(/15 a 255/);
    await expect(nfseEventRequest(CHAVE, pedido())).rejects.toThrow(/sem assinatura/);
  });

  it('lê o evento registrado e a recusa do município (prazo, E0822)', async () => {
    const evento = '<evento xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"/>';
    expect(
      await parseNfseEventResponse(
        201,
        JSON.stringify({ eventoXmlGZipB64: await gzipBase64(evento) }),
      ),
    ).toEqual({ outcome: 'registered', eventXml: evento });
    expect(
      await parseNfseEventResponse(
        400,
        JSON.stringify({
          erros: [
            {
              Codigo: 'E0822',
              Descricao:
                'O prazo para o cancelamento da NFS-e expirou, conforme parametrização do município emissor da NFS-e.',
            },
          ],
        }),
      ),
    ).toMatchObject({ outcome: 'rejected', errors: [{ code: 'E0822' }] });
    await expect(parseNfseEventResponse(500, 'oops')).rejects.toThrow(/sem uma mensagem JSON/);
    await expect(parseNfseEventResponse(500, '{}')).rejects.toThrow(/sem o evento/);
  });
});
