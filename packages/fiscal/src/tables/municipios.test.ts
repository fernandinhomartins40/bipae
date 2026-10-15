import { describe, expect, it } from 'vitest';
import { findMunicipio, searchMunicipios } from './municipios';

describe('municípios do IBGE (F3-14.a)', () => {
  it('acha pelo código e busca pelo nome dentro da UF, sem acento', () => {
    expect(findMunicipio('3550308')).toEqual({ code: '3550308', name: 'São Paulo', uf: 'SP' });
    expect(findMunicipio('0000000')).toBeNull();
    expect(searchMunicipios('PR', 'sao jose dos pin')).toEqual([
      { code: '4125506', name: 'São José dos Pinhais', uf: 'PR' },
    ]);
    expect(searchMunicipios('AC', '', 3)).toHaveLength(3);
  });
});
