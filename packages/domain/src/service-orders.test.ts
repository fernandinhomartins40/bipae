import { describe, expect, it } from 'vitest';
import { serviceInput, serviceOrderDeliverInput, serviceOrderInput } from './contracts';

/** F5-13.c: cadastro de serviço e ordem de serviço. */

const ID = '0192a000-0000-7000-8000-000000000001';

describe('serviço e ordem de serviço', () => {
  it('serviço: código da lista nacional com zeros, NBS e alíquota com vírgula', () => {
    expect(
      serviceInput.parse({
        name: 'Troca de óleo',
        code: '14.01.01',
        nbs: '1.2050.10.00',
        issRate: '2,5',
      }),
    ).toMatchObject({
      code: '140101',
      nbs: '120501000',
      issRate: '2.5',
      priceCents: 0,
      active: true,
    });
    expect(serviceInput.parse({ name: 'X', code: '10101', nbs: '', issRate: '' })).toMatchObject({
      code: '010101',
      nbs: null,
      issRate: null,
    });
    const ruim = serviceInput.safeParse({ name: 'X', code: '1', nbs: '12', issRate: 6 });
    expect(ruim.success).toBe(false);
    expect(ruim.error!.issues.map((i) => i.message)).toEqual(
      expect.arrayContaining(['NBS com 9 dígitos', 'Alíquota do ISSQN de 0 a 5%, com até 2 casas']),
    );
  });

  it('OS: itens com o serviço ou a peça escolhidos', () => {
    const ok = serviceOrderInput.parse({
      storeId: ID,
      customerId: ID,
      items: [
        { kind: 'service', serviceId: ID, quantityMilli: 1000, unitPriceCents: 100 },
        { kind: 'product', productId: ID, quantityMilli: 500, unitPriceCents: 200 },
      ],
    });
    expect(ok.items).toHaveLength(2);
    expect(serviceOrderInput.parse({ storeId: ID, customerId: ID }).items).toEqual([]);
    const ruim = serviceOrderInput.safeParse({
      storeId: ID,
      customerId: ID,
      items: [{ kind: 'product', serviceId: ID, quantityMilli: 1, unitPriceCents: 1 }],
    });
    expect(ruim.error!.issues[0]!.message).toBe('Escolha o serviço ou a peça');
    expect(serviceOrderDeliverInput.parse({})).toEqual({});
  });
});

describe('NFS-e na empresa (F5-13.d)', () => {
  it('percentuais aproximados com vírgula; em branco vira nulo; acima de 99,99 é recusado', async () => {
    const { companyInput } = await import('./contracts');
    const r = companyInput.parse({
      legalName: 'Oficina',
      nfseSimplesPercent: '6,5',
      nfseTaxFederal: 13.45,
      nfseTaxState: '',
      nfseSeries: 2,
    });
    expect(r).toMatchObject({
      nfseSimplesPercent: '6.5',
      nfseTaxFederal: '13.45',
      nfseTaxState: null,
      nfseSeries: 2,
    });
    expect(companyInput.safeParse({ legalName: 'X', nfseTaxMunicipal: '100' }).success).toBe(false);
    // O navegador chegou a preencher "Brasil" no campo: a mensagem diz qual campo corrigir.
    const brasil = companyInput.safeParse({ legalName: 'Oficina', nfseTaxMunicipal: 'Brasil' });
    expect(brasil.error!.issues[0]!.message).toBe(
      'Tributos municipais aproximados: use só números, de 0 a 99,99 (ex.: 6 ou 6,54)',
    );
    expect(companyInput.safeParse({ legalName: 'X', nfseSeries: 50000 }).success).toBe(false);
  });
});
