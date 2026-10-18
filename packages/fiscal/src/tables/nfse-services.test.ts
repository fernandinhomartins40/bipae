import { describe, expect, it } from 'vitest';
import {
  findNfseService,
  NFSE_SERVICES,
  nfseServiceGroup,
  searchNfseServices,
} from './nfse-services';

/** F5-13.a: lista nacional de serviços da NFS-e, gerada do Anexo B oficial. */
describe('lista nacional de serviços da NFS-e', () => {
  it('códigos de 6 dígitos, com item e subitem coerentes', () => {
    expect(NFSE_SERVICES.length).toBeGreaterThan(300);
    for (const s of NFSE_SERVICES) {
      expect(s.code, s.code).toMatch(/^\d{6}$/);
      expect(s.code.slice(0, 4), s.code).toBe(s.item + s.subitem.slice(3));
    }
    expect(findNfseService('14.01.01')).toMatchObject({ code: '140101', subitem: '14.01' });
    expect(findNfseService('10101')?.description).toBe('Análise e desenvolvimento de sistemas.');
    expect(findNfseService('999999')).toBeNull();
    expect(nfseServiceGroup('14')).toMatch(/^Serviços relativos a bens de terceiros/);
  });

  it('busca por código (com ou sem o zero da frente) e por palavras', () => {
    expect(searchNfseServices('14.01').map((s) => s.code)).toContain('140101');
    expect(searchNfseServices('101').map((s) => s.code)).toContain('010101');
    expect(searchNfseServices('desenvolvimento sistemas').map((s) => s.code)).toContain('010101');
    expect(searchNfseServices('a')).toEqual([]);
  });
});
