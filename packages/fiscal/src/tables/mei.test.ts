import { describe, expect, it } from 'vitest';
import { meiItemProblem, MEI_RULES } from './mei';
import { TABLE_SOURCES } from './sources';

/** F3-30: regras da nota do MEI (CRT 4), da NT 2024.001 v1.20. */

describe('regras do MEI na nota', () => {
  it('a tabela aponta para a NT guardada nas fontes oficiais', () => {
    expect(MEI_RULES.source).toContain('NT 2024.001 v1.20');
    expect(TABLE_SOURCES[MEI_RULES.sourceKey as keyof typeof TABLE_SOURCES].file).toBe(
      'NT_2024.001_v1.20_CRT4_MEI.pdf',
    );
  });

  it('NFC-e: só CSOSN 102 ou 300 e só o CFOP 5102 (regras N12a-81 e N12a-91)', () => {
    expect(meiItemProblem({ model: '65', csosn: '102', cfop: '5102' })).toBeNull();
    expect(meiItemProblem({ model: '65', csosn: '300', cfop: '5102' })).toBeNull();
    expect(meiItemProblem({ model: '65', csosn: '500', cfop: '5102' })).toContain('102, 300');
    expect(meiItemProblem({ model: '65', csosn: '102', cfop: '5405' })).toContain(
      'só usa o CFOP 5102',
    );
  });

  it('NF-e: CSOSN 102 só com 5102 ou 6102; 900 com a lista da regra N12a-90', () => {
    expect(meiItemProblem({ model: '55', csosn: '102', cfop: '6102' })).toBeNull();
    expect(meiItemProblem({ model: '55', csosn: '102', cfop: '5405' })).toContain('5102, 6102');
    expect(meiItemProblem({ model: '55', csosn: '900', cfop: '5904' })).toBeNull();
    expect(meiItemProblem({ model: '55', csosn: '900', cfop: '5102' })).toContain('CSOSN 900');
    // CSOSN 300 e 400 não têm lista de CFOP própria na NT.
    expect(meiItemProblem({ model: '55', csosn: '400', cfop: '5102' })).toBeNull();
    expect(meiItemProblem({ model: '55', csosn: '101', cfop: '5102' })).toContain(
      '102, 300, 400, 900',
    );
  });

  it('devolução e exterior', () => {
    expect(meiItemProblem({ model: '55', csosn: '900', cfop: '5202', isReturn: true })).toBeNull();
    expect(meiItemProblem({ model: '55', csosn: '900', cfop: '5904', isReturn: true })).toContain(
      'Na devolução',
    );
    expect(meiItemProblem({ model: '55', csosn: '101', cfop: '7102', exterior: true })).toBeNull();
  });
});
