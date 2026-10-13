import { describe, expect, it } from 'vitest';
import { nfceSupplement } from './qrcode';

const CHAVE = '35260611222333000181650010000000421123456780';

describe('QR Code da NFC-e, versão 3 (NT 2025.001)', () => {
  it('emissão normal: URL da UF?p=chave|3|2, sem CSC', () => {
    expect(nfceSupplement({ uf: 'SP', accessKey: CHAVE, environment: 'homologacao' })).toEqual({
      qrCode: `https://www.homologacao.nfce.fazenda.sp.gov.br/qrcode?p=${CHAVE}|3|2`,
      urlChave: 'https://www.homologacao.nfce.fazenda.sp.gov.br/consulta',
    });
  });

  it('acrescenta o protocolo quando a tabela oficial traz o endereço sem ele (D-014)', () => {
    expect(nfceSupplement({ uf: 'AM', accessKey: CHAVE, environment: 'homologacao' }).qrCode).toBe(
      `https://homnfce.sefaz.am.gov.br/nfceweb/consultarNFCe.jsp?p=${CHAVE}|3|2`,
    );
  });

  it('recusa chave inválida e UF sem endereço', () => {
    expect(() => nfceSupplement({ uf: 'SP', accessKey: '123', environment: 'homologacao' })).toThrow('Chave de acesso');
    expect(() => nfceSupplement({ uf: 'XX', accessKey: CHAVE, environment: 'homologacao' })).toThrow('UF XX');
  });
});
