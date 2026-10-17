import { describe, expect, it } from 'vitest';
import { validateNfeXml as validate } from '../../test/schema';
import { buildDraftNfe, type NfeDraftInput } from './draft';

/** F5-12.c: as notas da venda condicional (Ajuste SINIEF 02/18) montadas pelo motor. */

const CHAVE_REMESSA = '35261011222333000181550010000000151000000017';

const EMPRESA: NfeDraftInput['company'] = {
  cnpj: '11.222.333/0001-81',
  legalName: 'Ateliê Bipaê LTDA',
  ie: '110.042.490.114',
  uf: 'SP',
  regime: 'simples',
  address: {
    street: 'Rua das Flores',
    number: '100',
    district: 'Centro',
    cityCode: '3550308',
    cityName: 'São Paulo',
    cep: '01001-000',
  },
};

const CONSUMIDOR: NfeDraftInput['recipient'] = {
  taxId: '123.456.789-09',
  name: 'Joana Prado',
  ieIndicator: 9,
  address: {
    street: 'Rua das Acácias',
    number: '45',
    district: 'Centro',
    cityCode: '3550308',
    cityName: 'São Paulo',
    uf: 'SP',
    cep: '01002-000',
  },
};

/** Perfil da demonstração escolhido pela empresa: no Simples, o CSOSN que o contador indicou. */
const PERFIL_SIMPLES = {
  cfopInterna: '5912',
  cfopInterestadual: '6912',
  csosn: '400',
  cstPisCofins: '49',
  cClassTrib: '000001',
};

const condicional = (
  note: 'remessa' | 'retorno' | 'entradaSimbolica' | 'venda',
  over: Partial<NfeDraftInput> = {},
): NfeDraftInput => ({
  draftId: '0192a000-0000-7000-8000-00000000c0de',
  company: EMPRESA,
  series: 1,
  number: 16,
  issuedAt: '2026-10-15T18:30:00.000Z',
  nature: 'Venda de mercadoria',
  purpose: 'normal',
  presence: 'presencial',
  recipient: CONSUMIDOR,
  items: [
    {
      code: 'VEST-M',
      barcodes: [],
      description: 'Vestido Floral M',
      ncm: '62044200',
      unit: 'UN',
      quantityMilli: 1000,
      unitPriceCents: 18_990,
      grossCents: 18_990,
      discountCents: 0,
      profile: {
        cfopInterna: '5102',
        cfopInterestadual: '6102',
        csosn: '102',
        cClassTrib: '000001',
        origem: 0,
      },
    },
  ],
  transport: { freight: 'semFrete' },
  payments: [{ code: '01', amountCents: 18_990 }],
  appVersion: 'Bipaê 1.0',
  demonstration: { note, profile: PERFIL_SIMPLES },
  ...(note !== 'remessa' && { references: [CHAVE_REMESSA] }),
  ...over,
});

describe('notas da venda condicional (Ajuste SINIEF 02/18)', () => {
  it('remessa: CFOP 5912, natureza e textos do Ajuste, sem pagamento; válida no schema', async () => {
    const r = buildDraftNfe(condicional('remessa'));
    expect(r.ok, r.ok ? '' : r.pending.join('\n')).toBe(true);
    if (!r.ok) return;
    expect(await validate(r.document.xml)).toEqual([]);
    expect(r.document.xml).toContain('<natOp>Remessa para Demonstração</natOp>');
    expect(r.document.xml).toContain('<tpNF>1</tpNF>');
    expect(r.document.xml).toContain('<CFOP>5912</CFOP>');
    expect(r.document.xml).toContain('<CSOSN>400</CSOSN>');
    expect(r.document.xml).toContain('<tPag>90</tPag>');
    expect(r.document.xml).toContain(
      'Mercadoria remetida para demonstração. Imposto suspenso nos termos do Ajuste SINIEF 02/18',
    );
  });

  it('retorno e entrada simbólica: notas de entrada com a chave da remessa', async () => {
    const casos = [
      ['retorno', '1913', 'Retorno de mercadoria remetida para Demonstração'],
      // O texto do Ajuste passa dos 60 caracteres do leiaute: vai a forma abreviada da empresa.
      ['entradaSimbolica', '1949', 'Entrada simbólica em retorno de demonstração'],
    ] as const;
    for (const [note, cfop, natOp] of casos) {
      const r = buildDraftNfe(condicional(note, { nature: natOp }));
      expect(r.ok, r.ok ? '' : r.pending.join('\n')).toBe(true);
      if (!r.ok) continue;
      expect(await validate(r.document.xml), note).toEqual([]);
      expect(r.document.xml).toContain(`<natOp>${natOp}</natOp>`);
      expect(r.document.xml).toContain('<tpNF>0</tpNF>');
      expect(r.document.xml).toContain(`<CFOP>${cfop}</CFOP>`);
      expect(r.document.xml).toContain(`<refNFe>${CHAVE_REMESSA}</refNFe>`);
      expect(r.document.xml).toContain(
        'Imposto suspenso nos termos da cláusula quarta do Ajuste SINIEF 02/18',
      );
    }
  });

  it('entrada simbólica: sem a natureza abreviada a nota pede; com ela, leva o texto completo', () => {
    const sem = buildDraftNfe(condicional('entradaSimbolica'));
    expect(sem.ok || sem.pending.join(' ')).toContain('passa dos 60 caracteres do leiaute');
    const com = buildDraftNfe(
      condicional('entradaSimbolica', { nature: 'Entrada simbólica em retorno de demonstração' }),
    );
    expect(com.ok && com.document.xml).toContain(
      'Natureza da operação: Entrada Simbólica em Retorno de Mercadoria remetida para Demonstração',
    );
  });

  it('venda do que o cliente ficou: imposto da venda, chave da remessa e texto do Ajuste', async () => {
    const r = buildDraftNfe(condicional('venda'));
    expect(r.ok, r.ok ? '' : r.pending.join('\n')).toBe(true);
    if (!r.ok) return;
    expect(await validate(r.document.xml)).toEqual([]);
    expect(r.document.xml).toContain('<CFOP>5102</CFOP>');
    expect(r.document.xml).toContain('<CSOSN>102</CSOSN>');
    expect(r.document.xml).toContain(`<refNFe>${CHAVE_REMESSA}</refNFe>`);
    expect(r.document.xml).toContain(
      'Transmissão da Propriedade de mercadoria remetida para Demonstração',
    );
    expect(r.document.xml).toContain('<tPag>01</tPag>');
  });

  it('no regime normal, a remessa com CST 50 sai sem destaque do ICMS', async () => {
    const r = buildDraftNfe(
      condicional('remessa', {
        company: { ...EMPRESA, regime: 'presumido' },
        demonstration: {
          note: 'remessa',
          profile: { ...PERFIL_SIMPLES, csosn: null, cstIcms: '50', cstPisCofins: '08' },
        },
      }),
    );
    expect(r.ok, r.ok ? '' : r.pending.join('\n')).toBe(true);
    if (!r.ok) return;
    expect(await validate(r.document.xml)).toEqual([]);
    expect(r.document.xml).toContain('<CST>50</CST>');
    expect(r.document.xml).not.toContain('<vICMS>1');
  });

  it('o que falta: perfil da demonstração, CST 50, chave da remessa e cliente de outro estado', () => {
    const pendencias = (input: NfeDraftInput) => {
      const r = buildDraftNfe(input);
      return r.ok ? [] : r.pending;
    };
    expect(
      pendencias(condicional('remessa', { demonstration: { note: 'remessa', profile: null } })),
    ).toEqual([
      'Escolha em Empresas e lojas o perfil fiscal da venda condicional (demonstração), com o contador.',
    ]);
    expect(
      pendencias(
        condicional('remessa', {
          company: { ...EMPRESA, regime: 'presumido' },
          demonstration: {
            note: 'remessa',
            profile: { ...PERFIL_SIMPLES, csosn: null, cstIcms: '41' },
          },
        }),
      ).join(' '),
    ).toContain('precisa do CST 50 (suspensão)');
    expect(pendencias(condicional('retorno', { references: [] }))).toContain(
      'Falta a chave da NF-e de remessa para demonstração (Ajuste SINIEF 02/18, cláusula sexta, I).',
    );
    expect(
      pendencias(
        condicional('remessa', {
          recipient: {
            ...CONSUMIDOR,
            address: {
              ...CONSUMIDOR.address,
              uf: 'RJ',
              cityCode: '3304557',
              cityName: 'Rio de Janeiro',
            },
          },
        }),
      ).join(' '),
    ).toContain('para cliente de outro estado');
  });
});
