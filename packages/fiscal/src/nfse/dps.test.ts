import { describe, expect, it } from 'vitest';
import { validateNfseXml } from '../../test/schema';
import { signFiscalXml, type WebCryptoKey } from '../nfce/sign';
import { buildDps, dpsId, type DpsInput } from './dps';

/** F5-13.b: DPS da NFS-e Nacional, assinada e válida nos esquemas oficiais v1.01. */

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

const dps = (over: Partial<DpsInput> = {}): DpsInput => ({
  issuer: {
    taxId: '11.222.333/0001-81',
    municipalRegistration: '12345',
    phone: '(11) 3333-4444',
    email: 'contato@oficina.com.br',
    cityCode: '3550308',
    regime: 'simples',
  },
  series: 1,
  number: 42,
  issuedAt: '2026-11-03T14:00:00.000Z',
  competence: '2026-11-03',
  taker: {
    taxId: '123.456.789-09',
    name: 'Joana Prado',
    email: 'joana@exemplo.com.br',
    address: {
      cityCode: '3550308',
      cep: '01002-000',
      street: 'Rua das Acácias',
      number: '45',
      district: 'Centro',
    },
  },
  service: {
    code: '14.01.01',
    description: 'Revisão e troca de óleo do motor & filtro',
    placeCityCode: '3550308',
  },
  valueCents: 25_000,
  iss: { municipalAgreementActive: true },
  approximateTaxes: { simplesPercent: '6' },
  appVersion: 'Bipaê 1.0',
  ...over,
});

const ok = (input: DpsInput) => {
  const r = buildDps(input);
  if (!r.ok) throw new Error(r.pending.join('\n'));
  return r;
};

describe('DPS da NFS-e Nacional (F5-13.b)', () => {
  it('ME/EPP do Simples sem retenção: sem alíquota, com o percentual do Simples; assinada e válida', async () => {
    const r = ok(dps());
    expect(r.id).toBe('DPS3550308' + '2' + '11222333000181' + '00001' + '000000000000042');
    expect(r.id).toBe(
      dpsId({ cityCode: '3550308', taxId: '11222333000181', series: 1, number: 42 }),
    );
    expect(r.xml).toContain(
      '<opSimpNac>3</opSimpNac><regApTribSN>1</regApTribSN><regEspTrib>0</regEspTrib>',
    );
    expect(r.xml).not.toContain('<pAliq>');
    expect(r.xml).toContain('<pTotTribSN>6.00</pTotTribSN>');
    expect(r.xml).toContain('<cTribNac>140101</cTribNac>');
    expect(r.xml).toContain('Revisão e troca de óleo do motor &amp; filtro');
    // O prestador que emite não informa o próprio nome (E0121).
    expect(r.xml).not.toMatch(/<prest>[\s\S]*<xNome>[\s\S]*<\/prest>/);
    const assinada = await signFiscalXml(r.xml, 'DPS', 'infDPS', await chave());
    expect(assinada).toContain(`<Reference URI="#${r.id}">`);
    expect(await validateNfseXml(assinada)).toEqual([]);
  });

  it('leiaute da NT 009: finNFSe 0 logo depois do tpEmit (exigido pela produção restrita)', () => {
    expect(ok(dps()).xml).toContain(
      '<tpEmit>1</tpEmit><finNFSe>0</finNFSe><cLocEmi>3550308</cLocEmi>',
    );
  });

  it('município que não emite pelo cadastro da Receita exige a inscrição municipal (E0084)', () => {
    const semIm = (over: Partial<DpsInput['issuer']> = {}) =>
      buildDps(
        dps({
          issuer: { ...dps().issuer, municipalRegistration: null, ...over },
          iss: { municipalAgreementActive: true, municipalRfbDefault: false },
        }),
      );
    const r = semIm();
    expect(!r.ok && r.pending).toContain(
      'Este município exige a inscrição municipal na NFS-e: a empresa precisa estar no cadastro de contribuintes da prefeitura (regra E0084). Informe-a em Empresas e lojas.',
    );
    // O MEI fica fora da regra; com a inscrição, a DPS sai com o IM do prestador.
    expect(semIm({ regime: 'mei' }).ok).toBe(true);
    const comIm = semIm({ municipalRegistration: '0012345' });
    expect(comIm.ok && comIm.xml).toContain('<IM>0012345</IM>');
    // Município que emite pelo cadastro da Receita não pede a inscrição.
    expect(
      buildDps(
        dps({
          issuer: { ...dps().issuer, municipalRegistration: null },
          iss: { municipalAgreementActive: true, municipalRfbDefault: true },
        }),
      ).ok,
    ).toBe(true);
  });

  it('ME/EPP com retenção pelo tomador: a alíquota vai na DPS (E0622)', async () => {
    const r = ok(dps({ iss: { municipalAgreementActive: true, retention: 'tomador', rate: '2' } }));
    expect(r.xml).toContain('<tpRetISSQN>2</tpRetISSQN><pAliq>2.00</pAliq>');
    expect(
      await validateNfseXml(await signFiscalXml(r.xml, 'DPS', 'infDPS', await chave())),
    ).toEqual([]);
  });

  it('MEI: sem alíquota, sem retenção e sem valor de tributos (indTotTrib 0)', async () => {
    const r = ok(dps({ issuer: { ...dps().issuer, regime: 'mei' }, approximateTaxes: {} }));
    expect(r.xml).toContain('<opSimpNac>2</opSimpNac><regEspTrib>0</regEspTrib>');
    expect(r.xml).toContain('<indTotTrib>0</indTotTrib>');
    expect(
      await validateNfseXml(await signFiscalXml(r.xml, 'DPS', 'infDPS', await chave())),
    ).toEqual([]);
    const retido = buildDps(
      dps({
        issuer: { ...dps().issuer, regime: 'mei' },
        iss: { municipalAgreementActive: true, retention: 'tomador' },
      }),
    );
    expect(retido.ok || retido.pending.join(' ')).toContain('O MEI não tem retenção');
  });

  it('não optante: alíquota só com o convênio do município inativo; percentuais aproximados', async () => {
    const base = {
      issuer: { ...dps().issuer, regime: 'presumido' },
      approximateTaxes: { federal: '13.45', state: '0', municipal: '5' },
    };
    const ativo = ok(dps({ ...base, iss: { municipalAgreementActive: true, rate: '5' } }));
    expect(ativo.xml).not.toContain('<pAliq>');
    expect(ativo.xml).toContain(
      '<pTotTrib><pTotTribFed>13.45</pTotTribFed><pTotTribEst>0.00</pTotTribEst><pTotTribMun>5.00</pTotTribMun></pTotTrib>',
    );
    const inativo = ok(dps({ ...base, iss: { municipalAgreementActive: false, rate: '5' } }));
    expect(inativo.xml).toContain('<pAliq>5.00</pAliq>');
    expect(
      await validateNfseXml(await signFiscalXml(inativo.xml, 'DPS', 'infDPS', await chave())),
    ).toEqual([]);
    const semSaber = buildDps(dps({ ...base, iss: { municipalAgreementActive: null } }));
    expect(semSaber.ok || semSaber.pending.join(' ')).toContain('convênio ativo');
  });

  it('acima do sublimite (regApTribSN 2) e o que falta vira lista', () => {
    const excesso = ok(
      dps({
        issuer: { ...dps().issuer, regime: 'simples-excesso' },
        iss: { municipalAgreementActive: false, rate: '3' },
      }),
    );
    expect(excesso.xml).toContain('<regApTribSN>2</regApTribSN>');
    expect(excesso.xml).toContain('<pAliq>3.00</pAliq>');
    const r = buildDps(
      dps({
        issuer: { ...dps().issuer, taxId: null, regime: null, cityCode: null },
        competence: '2026-12-01',
        service: { code: '999999', description: ' ', placeCityCode: null },
        valueCents: 0,
        approximateTaxes: {},
        iss: { municipalAgreementActive: true, retention: 'tomador', rate: '9' },
        taker: { taxId: '123', name: '' },
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.pending).toEqual(
      expect.arrayContaining([
        'Falta o regime tributário da empresa (Empresas e lojas).',
        'Falta o CNPJ da empresa.',
        'Falta o município da empresa.',
        'A data da prestação do serviço não pode ser depois da emissão da nota.',
        'Escolha o serviço na lista nacional de serviços (código de tributação nacional).',
        'Descreva o serviço prestado.',
        'Falta o município onde o serviço foi prestado.',
        'O valor do serviço precisa ser maior que zero.',
        'O CPF ou o CNPJ do tomador está incompleto.',
        'Falta o nome do tomador.',
        'A retenção do ISSQN pede o endereço do tomador.',
      ]),
    );
  });

  it('serviços que exigem obra ou evento, ou o ISS do município do tomador, avisam antes', () => {
    const obra = buildDps(dps({ service: { ...dps().service, code: '070201' } }));
    expect(obra.ok || obra.pending.join(' ')).toContain('construção civil');
    const tomador = buildDps(
      dps({
        service: { ...dps().service, code: '170501' },
        taker: { taxId: '12345678909', name: 'Joana' },
      }),
    );
    expect(tomador.ok || tomador.pending.join(' ')).toContain('município do tomador');
    const alto = buildDps(
      dps({ iss: { municipalAgreementActive: true, retention: 'tomador', rate: '6' } }),
    );
    expect(alto.ok || alto.pending.join(' ')).toContain('não pode passar de 5%');
    const semTomador = ok(dps({ taker: null }));
    expect(semTomador.notes).toEqual(['NFS-e sem tomador identificado.']);
  });
});
