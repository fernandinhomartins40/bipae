import { describe, expect, it } from 'vitest';
import {
  danfseRequest,
  dpsQueryRequest,
  gunzipBase64,
  gzipBase64,
  municipalAgreementRequest,
  NFSE_ENDPOINTS,
  nfseEmitRequest,
  NfseMessageError,
  nfseQueryRequest,
  parseDpsQueryResponse,
  parseMunicipalAgreementResponse,
  parseNfseEmitResponse,
} from './sefin';

/** F5-13.b: mensagens para a Sefin Nacional e leitura das respostas. */

const DPS_ASSINADA = '<DPS><infDPS><tpAmb>2</tpAmb></infDPS><Signature></Signature></DPS>';
const CHAVE = '3'.repeat(50);

describe('Sefin Nacional (F5-13.b)', () => {
  it('endereços da página oficial: produção restrita para emitir', async () => {
    expect(NFSE_ENDPOINTS.sefinNacional.producaoRestrita).toBe(
      'https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional',
    );
    const req = await nfseEmitRequest(DPS_ASSINADA);
    expect(req).toMatchObject({
      method: 'POST',
      url: 'https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional/nfse',
    });
    const body = JSON.parse(req.body!) as { dpsXmlGZipB64: string };
    // Com a declaração de codificação, sem a qual a Sefin recusa (E1229).
    expect(await gunzipBase64(body.dpsXmlGZipB64)).toBe(
      `<?xml version="1.0" encoding="UTF-8"?>${DPS_ASSINADA}`,
    );
    await expect(nfseEmitRequest('<DPS/>')).rejects.toThrow('sem assinatura');
    await expect(
      nfseEmitRequest(DPS_ASSINADA.replace('<tpAmb>2</tpAmb>', '<tpAmb>1</tpAmb>')),
    ).rejects.toThrow('produção restrita');
    expect(dpsQueryRequest(`DPS${'1'.repeat(42)}`).url).toMatch(/\/dps\/DPS1{42}$/);
    expect(() => dpsQueryRequest('DPS1')).toThrow(NfseMessageError);
    expect(nfseQueryRequest(CHAVE).url).toMatch(/\/nfse\/3{50}$/);
    expect(() => nfseQueryRequest('1')).toThrow('Chave');
    expect(municipalAgreementRequest('3550308').url).toBe(
      'https://adn.producaorestrita.nfse.gov.br/parametrizacao/3550308/convenio',
    );
    expect(() => municipalAgreementRequest('35')).toThrow('município');
    expect(danfseRequest(CHAVE).url).toBe(
      `https://adn.producaorestrita.nfse.gov.br/danfse/${CHAVE}`,
    );
    expect(() => danfseRequest('1')).toThrow('Chave');
  });

  it('lê a NFS-e gerada e a lista de erros', async () => {
    const nfse = '<NFSe><infNFSe/></NFSe>';
    const ok = await parseNfseEmitResponse(
      201,
      JSON.stringify({
        chaveAcesso: CHAVE,
        nfseXmlGZipB64: await gzipBase64(nfse),
        alertas: [{ codigo: 'A001', descricao: 'Aviso' }],
      }),
    );
    expect(ok).toEqual({
      outcome: 'authorized',
      accessKey: CHAVE,
      nfseXml: nfse,
      alerts: ['A001 Aviso'],
    });
    const erro = await parseNfseEmitResponse(
      400,
      JSON.stringify({
        erros: [
          { Codigo: 'E0015', Descricao: 'Competência depois da emissão', Complemento: 'dCompet' },
        ],
      }),
    );
    expect(erro).toEqual({
      outcome: 'rejected',
      errors: [{ code: 'E0015', message: 'Competência depois da emissão — dCompet' }],
    });
    await expect(parseNfseEmitResponse(502, '<html>')).rejects.toThrow('sem uma mensagem JSON');
    await expect(parseNfseEmitResponse(500, '{}')).rejects.toThrow('sem a NFS-e');
  });

  it('consulta pela DPS e convênio do município', () => {
    expect(parseDpsQueryResponse(200, JSON.stringify({ chaveAcesso: CHAVE }))).toBe(CHAVE);
    expect(parseDpsQueryResponse(404, '')).toBeNull();
    expect(parseDpsQueryResponse(200, 'x')).toBeNull();
    expect(
      parseMunicipalAgreementResponse(200, JSON.stringify({ situacaoConvenio: 'Ativo' })),
    ).toBe(true);
    expect(
      parseMunicipalAgreementResponse(
        200,
        JSON.stringify({ parametrosConvenio: { situacao: 'Inativo' } }),
      ),
    ).toBe(false);
    expect(
      parseMunicipalAgreementResponse(200, JSON.stringify({ aderenteEmissorNacional: 1 })),
    ).toBe(true);
    expect(parseMunicipalAgreementResponse(200, JSON.stringify({ outro: 'x' }))).toBeNull();
    // A resposta real do ADN para Guarapuava (PR), em 20/10/2026.
    const guarapuava = {
      parametrosConvenio: {
        aderenteAmbienteNacional: 1,
        aderenteEmissorNacional: 1,
        situacaoEmissaoPadraoContribuintesRFB: 0,
        aderenteMAN: 0,
        permiteAproveitametoDeCreditos: true,
      },
      mensagem: 'Parâmetros do convênio recuperados com sucesso.',
    };
    expect(parseMunicipalAgreementResponse(200, JSON.stringify(guarapuava))).toBe(true);
    const fora = { parametrosConvenio: { aderenteAmbienteNacional: 0, aderenteMAN: 1 } };
    expect(parseMunicipalAgreementResponse(200, JSON.stringify(fora))).toBe(false);
    const semInfo = { parametrosConvenio: { aderenteAmbienteNacional: -1 } };
    expect(parseMunicipalAgreementResponse(200, JSON.stringify(semInfo))).toBeNull();
    expect(parseMunicipalAgreementResponse(404, '')).toBeNull();
    expect(parseMunicipalAgreementResponse(200, 'x')).toBeNull();
  });
});
