import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { NFCE_ENDPOINTS, nfceEndpoints } from './nfce-endpoints';
import { TABLE_SOURCES } from './sources';

const pagina = (key: keyof typeof TABLE_SOURCES) =>
  gunzipSync(readFileSync(fileURLToPath(new URL(`../../sources/${TABLE_SOURCES[key].file}`, import.meta.url)))).toString('utf8');
const fontes = [pagina('nfceAuthorizers'), pagina('nfceWebservicesEncat'), pagina('nfceQrCode'), pagina('nfceUrlChave')].join('\n');

describe('endereços da NFC-e por UF (F3-28)', () => {
  it('as 27 UFs têm autorizador, os 6 serviços de homologação, QR Code e consulta pela chave', () => {
    expect(NFCE_ENDPOINTS).toHaveLength(27);
    for (const item of NFCE_ENDPOINTS) {
      expect(Object.keys(item.webservices.homologacao).sort(), item.uf).toEqual(
        ['NFeAutorizacao', 'NFeConsultaProtocolo', 'NFeInutilizacao', 'NFeRetAutorizacao', 'NFeStatusServico', 'RecepcaoEvento'],
      );
      for (const url of Object.values(item.webservices.homologacao)) expect(url, item.uf).toMatch(/^https:\/\//);
      for (const url of [item.qrCode.producao, item.qrCode.homologacao, item.urlChave.producao, item.urlChave.homologacao]) {
        expect(url, item.uf).toBeTruthy();
      }
    }
  });

  it('nenhum endereço foi inventado: cada um aparece na página oficial guardada', () => {
    for (const item of NFCE_ENDPOINTS) {
      const urls = [
        ...Object.values(item.webservices.homologacao),
        ...Object.values(item.webservices.producao ?? {}),
        item.qrCode.producao!,
        item.qrCode.homologacao!,
        item.urlChave.producao!,
        item.urlChave.homologacao!,
      ];
      for (const url of urls) {
        // Única correção: o erro de digitação "homolog acao" da página do QR Code do MA.
        const naFonte = url.replace('homologacao.sefaz.ma', 'homolog acao.sefaz.ma');
        expect(fontes.includes(naFonte), `${item.uf}: ${url}`).toBe(true);
      }
    }
  });

  it('quem autoriza a NFC-e de cada UF', () => {
    const proprios = NFCE_ENDPOINTS.filter((i) => i.authorizer !== 'SVRS').map((i) => i.uf);
    expect(proprios).toEqual(['AM', 'GO', 'MG', 'MS', 'MT', 'PR', 'RS', 'SP']);
    expect(nfceEndpoints('SC')).toMatchObject({ authorizer: 'SVRS' });
    expect(nfceEndpoints('SC')!.webservices.homologacao.NFeAutorizacao).toContain('nfce-homologacao.svrs.rs.gov.br');
    expect(nfceEndpoints('MG')!.note).toContain('D-022');
    expect(nfceEndpoints('XX')).toBeNull();
  });

  it('pega o endereço vigente quando a página lista o antigo e o novo', () => {
    expect(nfceEndpoints('GO')!.qrCode.producao).toBe('https://nfeweb.sefaz.go.gov.br/nfeweb/sites/nfce/danfeNFCe');
    expect(nfceEndpoints('RN')!.qrCode.producao).toBe('https://nfce.sefaz.rn.gov.br/consultarNFCe.aspx');
    expect(nfceEndpoints('PB')!.qrCode.producao).toBe('http://www.sefaz.pb.gov.br/nfce');
    expect(nfceEndpoints('SP')!.qrCode.homologacao).toBe('https://www.homologacao.nfce.fazenda.sp.gov.br/qrcode');
  });
});
