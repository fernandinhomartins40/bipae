import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { NFE_ENDPOINTS, NFE_NATIONAL_ENDPOINTS, nfeEndpoints } from './nfe-endpoints';
import { TABLE_SOURCES } from './sources';

const pagina = (key: keyof typeof TABLE_SOURCES) =>
  gunzipSync(
    readFileSync(
      fileURLToPath(new URL(`../../sources/${TABLE_SOURCES[key].file}`, import.meta.url)),
    ),
  ).toString('utf8');
const fontes = {
  producao: pagina('nfeWebservicesProducao'),
  homologacao: pagina('nfeWebservicesHomologacao'),
};
const AMBIENTES = ['producao', 'homologacao'] as const;
const ESSENCIAIS = [
  'NFeAutorizacao',
  'NFeConsultaProtocolo',
  'NFeInutilizacao',
  'NFeRetAutorizacao',
  'NFeStatusServico',
  'RecepcaoEvento',
];

describe('endereços da NF-e por UF (F3-08.b)', () => {
  it('as 27 UFs têm autorizador, contingência e os serviços de emissão nos dois ambientes', () => {
    expect(NFE_ENDPOINTS.map((i) => i.uf)).toHaveLength(27);
    for (const item of NFE_ENDPOINTS) {
      for (const ambiente of AMBIENTES) {
        for (const servico of ESSENCIAIS) {
          expect(item.webservices[ambiente], `${item.uf} ${ambiente} ${servico}`).toHaveProperty(
            servico,
          );
          // Em contingência não se inutiliza numeração: isso espera o autorizador normal voltar.
          if (servico === 'NFeInutilizacao') continue;
          expect(
            item.contingencyWebservices[ambiente],
            `${item.uf} ${ambiente} ${servico}`,
          ).toHaveProperty(servico);
        }
      }
    }
  });

  it('nenhum endereço foi inventado: cada um aparece na página oficial do ambiente', () => {
    for (const item of NFE_ENDPOINTS) {
      for (const ambiente of AMBIENTES) {
        const urls = [
          ...Object.values(item.webservices[ambiente]),
          ...Object.values(item.contingencyWebservices[ambiente]),
        ];
        for (const url of urls) {
          expect(url, `${item.uf} ${ambiente}`).toMatch(/^https:\/\//);
          expect(fontes[ambiente].includes(url), `${item.uf} ${ambiente}: ${url}`).toBe(true);
        }
      }
    }
    for (const ambiente of AMBIENTES) {
      for (const url of Object.values(NFE_NATIONAL_ENDPOINTS[ambiente])) {
        expect(fontes[ambiente].includes(url), url).toBe(true);
      }
    }
  });

  it('homologação nunca aponta para o endereço de produção', () => {
    for (const item of NFE_ENDPOINTS) {
      const producao = new Set(Object.values(item.webservices.producao));
      for (const url of Object.values(item.webservices.homologacao)) {
        expect(producao.has(url), `${item.uf}: ${url}`).toBe(false);
      }
    }
  });

  it('quem autoriza e quem atende em contingência', () => {
    const proprios = NFE_ENDPOINTS.filter((i) => i.authorizer.producao === i.uf).map((i) => i.uf);
    expect(proprios).toEqual(['AM', 'BA', 'GO', 'MG', 'MS', 'MT', 'PE', 'PR', 'RS', 'SP']);
    expect(nfeEndpoints('MA')).toMatchObject({
      authorizer: { producao: 'SVAN' },
      contingency: { producao: 'SVC-RS' },
    });
    expect(nfeEndpoints('SC')).toMatchObject({
      authorizer: { homologacao: 'SVRS' },
      contingency: { homologacao: 'SVC-AN' },
    });
    expect(nfeEndpoints('SC')!.webservices.homologacao.NFeAutorizacao).toContain(
      'nfe-homologacao.svrs.rs.gov.br',
    );
    // O "?wsdl" da página é o endereço da descrição; o serviço é o endereço sem ele.
    expect(nfeEndpoints('GO')!.webservices.producao.NFeAutorizacao).toBe(
      'https://nfe.sefaz.go.gov.br/nfe/services/NFeAutorizacao4',
    );
    // A consulta cadastro da SVRS só atende algumas UFs.
    expect(nfeEndpoints('SC')!.webservices.producao.NFeConsultaCadastro).toBeTruthy();
    expect(nfeEndpoints('RJ')!.webservices.producao.NFeConsultaCadastro).toBeUndefined();
    expect(nfeEndpoints('XX')).toBeNull();
  });
});
