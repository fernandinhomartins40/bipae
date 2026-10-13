import { describe, expect, it } from 'vitest';
import codes from './data/nfe-codes.json';
import labels from './data/tax-situation-labels.json';
import {
  MERCHANDISE_ORIGINS,
  NFE_SCHEMA_PACKAGE,
  TAX_SITUATIONS,
  TAX_SITUATION_SOURCES,
  findOrigin,
  findTaxSituation,
  type TaxSituationKind,
} from './tax-situations';

const TIPOS: TaxSituationKind[] = ['icms', 'csosn', 'pis', 'cofins', 'ipi'];

describe('códigos de situação tributária', () => {
  it('as descrições cobrem exatamente os códigos do schema oficial, nem mais nem menos', () => {
    const descritos: Record<TaxSituationKind, string[]> = {
      icms: Object.keys(labels.icms.labels),
      csosn: Object.keys(labels.csosn.labels),
      pis: Object.keys(labels.pisCofins.labels),
      cofins: Object.keys(labels.pisCofins.labels),
      ipi: Object.keys(labels.ipi.labels),
    };
    for (const tipo of TIPOS) {
      expect(descritos[tipo].sort(), tipo).toEqual(codes[tipo].map((c) => c.code).sort());
    }
    expect(Object.keys(labels.orig.labels).sort()).toEqual([...codes.orig].sort());
  });

  it('todo código tem descrição, grupo do XML e norma de origem', () => {
    expect(NFE_SCHEMA_PACKAGE).toMatch(/^PL_\d{3}/);
    for (const tipo of TIPOS) {
      expect(TAX_SITUATION_SOURCES[tipo]).not.toBe('');
      expect(new Set(TAX_SITUATIONS[tipo].map((s) => s.code)).size).toBe(TAX_SITUATIONS[tipo].length);
      for (const situacao of TAX_SITUATIONS[tipo]) {
        expect(situacao.description, `${tipo} ${situacao.code}`).not.toBe('');
        expect(situacao.groups.length, `${tipo} ${situacao.code}`).toBeGreaterThan(0);
      }
    }
  });

  it('diz em que grupo do XML o CST do ICMS entra', () => {
    expect(findTaxSituation('icms', '00')).toEqual({
      code: '00',
      description: 'Tributada integralmente',
      groups: ['ICMS00'],
    });
    // Isenta, não tributada e suspensão dividem o mesmo grupo.
    for (const cst of ['40', '41', '50']) {
      expect(findTaxSituation('icms', cst)!.groups).toContain('ICMS40');
    }
    expect(findTaxSituation('icms', '60')!.groups).toEqual(['ICMS60', 'ICMSST']);
    expect(findTaxSituation('icms', '99')).toBeNull();
  });

  it('diz em que grupo do XML o CSOSN do Simples Nacional entra', () => {
    expect(findTaxSituation('csosn', '102')).toMatchObject({
      description: 'Tributada pelo Simples Nacional sem permissão de crédito',
      groups: ['ICMSSN102'],
    });
    for (const csosn of ['103', '300', '400']) {
      expect(findTaxSituation('csosn', csosn)!.groups).toEqual(['ICMSSN102']);
    }
    expect(findTaxSituation('csosn', '500')!.groups).toEqual(['ICMSSN500']);
    expect(findTaxSituation('csosn', '00')).toBeNull();
  });

  it('PIS e COFINS têm os mesmos códigos, cada um no seu grupo', () => {
    expect(TAX_SITUATIONS.pis.map((s) => s.code)).toEqual(TAX_SITUATIONS.cofins.map((s) => s.code));
    expect(findTaxSituation('pis', '01')!.groups).toEqual(['PISAliq']);
    expect(findTaxSituation('cofins', '01')!.groups).toEqual(['COFINSAliq']);
    expect(findTaxSituation('pis', '06')).toMatchObject({
      description: 'Operação tributável a alíquota zero',
      groups: ['PISNT'],
    });
    expect(findTaxSituation('cofins', '99')!.groups).toEqual(['COFINSOutr']);
  });

  it('separa o IPI tributado do não tributado', () => {
    expect(findTaxSituation('ipi', '50')).toMatchObject({ description: 'Saída tributada', groups: ['IPITrib'] });
    expect(findTaxSituation('ipi', '53')!.groups).toEqual(['IPINT']);
  });
});

describe('origem da mercadoria', () => {
  it('traz os nove códigos do schema, todos descritos', () => {
    expect(MERCHANDISE_ORIGINS.map((o) => o.code)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8']);
    for (const origem of MERCHANDISE_ORIGINS) expect(origem.description, origem.code).not.toBe('');
    expect(TAX_SITUATION_SOURCES.orig).toContain('Tabela A');
  });

  it('acha a origem por texto ou por número', () => {
    expect(findOrigin(0)?.description).toMatch(/^Nacional/);
    expect(findOrigin('6')?.description).toContain('sem similar nacional');
    expect(findOrigin(9)).toBeNull();
  });
});
