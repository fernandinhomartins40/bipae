import { describe, expect, it } from 'vitest';
import {
  nfseDistributionRequest,
  nfseSummary,
  parseNfseDistributionResponse,
} from './distribution';
import { gzipBase64 } from './sefin';

/** F5-13.l: NFS-e em que a empresa aparece, pelo ADN Contribuinte. */

const CHAVE = '41094012242761086000115000000000000126104123456789';
const NFSE = `<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infNFSe Id="NFS${CHAVE}"><xLocEmi>Guarapuava</xLocEmi><nNFSe>12</nNFSe><dhProc>2026-10-20T10:00:00-03:00</dhProc><emit><CNPJ>11222333000181</CNPJ><xNome>Gráfica Exemplo LTDA</xNome></emit><valores><vLiq>950.00</vLiq></valores><DPS versao="1.01"><infDPS Id="DPS1"><dhEmi>2026-10-20T09:59:00-03:00</dhEmi><toma><CNPJ>42761086000115</CNPJ><xNome>FUSE AGENCIA LTDA</xNome></toma><serv><cServ><cTribNac>130501</cTribNac></cServ></serv><valores><vServPrest><vServ>1000.00</vServ></vServPrest></valores></infDPS></DPS></infNFSe></NFSe>`;

describe('NFS-e recebidas pelo ADN Contribuinte', () => {
  it('pede o lote a partir do NSU no endereço oficial da produção restrita', () => {
    expect(nfseDistributionRequest(0).url).toBe(
      'https://adn.producaorestrita.nfse.gov.br/contribuintes/DFe/0?lote=true',
    );
    expect(() => nfseDistributionRequest(-1)).toThrow('NSU inválido');
  });

  it('sem documento: a resposta real da produção restrita (E2220)', async () => {
    const real = {
      StatusProcessamento: 'NENHUM_DOCUMENTO_LOCALIZADO',
      LoteDFe: [],
      Alertas: [],
      Erros: [
        {
          Mensagem: {},
          Codigo: 'E2220',
          Descricao:
            'Nenhum documento localizado - não existem documentos fiscais para o Contribuinte a partir do NSU informado.',
        },
      ],
      TipoAmbiente: 'HOMOLOGACAO',
      VersaoAplicativo: '1.0.0.0',
      DataHoraProcessamento: '2026-10-20T13:14:07.9663134-03:00',
    };
    const r = await parseNfseDistributionResponse(404, JSON.stringify(real));
    expect(r).toMatchObject({ outcome: 'none', documents: [], lastNsu: null });
    expect(r.errors[0]!.code).toBe('E2220');
  });

  it('lote com NFS-e e evento: XML descompactado e o maior NSU', async () => {
    const lote = {
      StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS',
      LoteDFe: [
        {
          NSU: 7,
          ChaveAcesso: CHAVE,
          TipoDocumento: 'NFSE',
          ArquivoXml: await gzipBase64(NFSE),
          DataHoraGeracao: '2026-10-20T10:00:01',
        },
        {
          NSU: 9,
          ChaveAcesso: CHAVE,
          TipoDocumento: 'EVENTO',
          TipoEvento: 'CANCELAMENTO',
          ArquivoXml: await gzipBase64('<evento/>'),
        },
      ],
      Erros: [],
    };
    const r = await parseNfseDistributionResponse(200, JSON.stringify(lote));
    expect(r.outcome).toBe('documents');
    expect(r.lastNsu).toBe(9);
    expect(r.documents[0]).toMatchObject({ nsu: 7, kind: 'nfse', accessKey: CHAVE, xml: NFSE });
    expect(r.documents[1]).toMatchObject({ kind: 'evento', eventType: 'CANCELAMENTO' });
    const recusa = await parseNfseDistributionResponse(
      400,
      JSON.stringify({
        StatusProcessamento: 'REJEICAO',
        Erros: [{ Codigo: 'E2001', Descricao: 'x' }],
      }),
    );
    expect(recusa.outcome).toBe('rejected');
    await expect(parseNfseDistributionResponse(500, 'x')).rejects.toThrow('sem JSON');
  });

  it('XML em texto, em base64 puro ou ilegível; tipo desconhecido e NSU vazio', async () => {
    const base64 = btoa(String.fromCharCode(...new TextEncoder().encode('<evento/>')));
    const r = await parseNfseDistributionResponse(
      200,
      JSON.stringify({
        StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS',
        LoteDFe: [
          { NSU: 3, TipoDocumento: 'NFSE', ArquivoXml: NFSE },
          { NSU: 4, TipoDocumento: 'EVENTO', ArquivoXml: base64 },
          { NSU: 5, TipoDocumento: 'CNC', ArquivoXml: 'não é base64 nem gzip' },
          { TipoDocumento: 'DPS', ArquivoXml: 42 },
        ],
      }),
    );
    expect(r.documents.map((d) => [d.kind, d.xml?.slice(0, 9) ?? null])).toEqual([
      ['nfse', '<NFSe xml'],
      ['evento', '<evento/>'],
      ['outro', null],
      ['outro', null],
    ]);
    expect(r.documents[3]).toMatchObject({ nsu: 0, accessKey: null, eventType: null });
    expect(r.lastNsu).toBe(5);
    // Lote sem NSU válido não move o ponteiro.
    const semNsu = await parseNfseDistributionResponse(
      200,
      JSON.stringify({ StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS' }),
    );
    expect(semNsu).toMatchObject({ outcome: 'documents', documents: [], lastNsu: null });
    expect(
      (await parseNfseDistributionResponse(404, JSON.stringify({ Erros: [{ Codigo: 'E2220' }] })))
        .outcome,
    ).toBe('none');
  });

  it('resumo de NFS-e com CPF e sem valores', () => {
    const cpf = NFSE.replace('<CNPJ>11222333000181</CNPJ>', '<CPF>12345678909</CPF>')
      .replace('<CNPJ>42761086000115</CNPJ>', '<CPF>98765432100</CPF>')
      .replace('<vLiq>950.00</vLiq>', '<vLiq>950,0</vLiq>')
      .replace('<vServ>1000.00</vServ>', '')
      .replace('<nNFSe>12</nNFSe>', '')
      .replace('<dhProc>2026-10-20T10:00:00-03:00</dhProc>', '');
    expect(nfseSummary(cpf)).toMatchObject({
      issuerTaxId: '12345678909',
      takerTaxId: '98765432100',
      number: null,
      issuedAt: '2026-10-20T09:59:00-03:00',
      valueCents: 0,
      netCents: 0,
    });
    expect(nfseSummary(NFSE.replace(`Id="NFS${CHAVE}"`, 'Id="NFS123"'))).toBeNull();
    const semPartes = `<NFSe><infNFSe Id="NFS${CHAVE}"></infNFSe></NFSe>`;
    expect(nfseSummary(semPartes)).toMatchObject({
      issuerTaxId: '',
      issuerName: '',
      takerTaxId: null,
      takerName: null,
      issuedAt: null,
      serviceCode: null,
    });
  });

  it('o resumo da NFS-e: prestador, tomador, valores e o código do serviço', () => {
    expect(nfseSummary(NFSE)).toEqual({
      accessKey: CHAVE,
      number: '12',
      issuerTaxId: '11222333000181',
      issuerName: 'Gráfica Exemplo LTDA',
      takerTaxId: '42761086000115',
      takerName: 'FUSE AGENCIA LTDA',
      issuedAt: '2026-10-20T10:00:00-03:00',
      valueCents: 100_000,
      netCents: 95_000,
      serviceCode: '130501',
    });
    expect(nfseSummary('<x/>')).toBeNull();
  });
});
