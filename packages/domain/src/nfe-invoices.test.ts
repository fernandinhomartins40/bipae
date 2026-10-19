import { describe, expect, it } from 'vitest';
import { nfeInvoiceInput } from './contracts';

/** F3-33.b: o rascunho da NF-e da retaguarda. */

const ID = '0192a000-0000-7000-8000-000000000001';

const rascunho = (over: Record<string, unknown> = {}) => ({
  companyId: ID,
  storeId: ID,
  recipient: {
    taxId: '11.444.777/0001-61',
    name: 'Mercado do Bairro LTDA',
    ieIndicator: 1,
    ie: '111.222.333.444',
    email: 'Compras@Mercado.com.br',
    phone: '(11) 3333-4444',
    address: {
      cep: '01430-000',
      street: 'Avenida Brasil',
      number: '2000',
      district: 'Jardim América',
      city: 'São Paulo',
      uf: 'SP',
      ibgeCode: '3550308',
    },
  },
  items: [{ productId: ID, quantityMilli: 1000, unitPriceCents: 2500 }],
  payments: [{ code: '15', amountCents: 2500 }],
  ...over,
});

describe('rascunho da NF-e', () => {
  it('limpa máscaras e completa o que tem padrão', () => {
    const r = nfeInvoiceInput.parse(rascunho());
    expect(r.recipient).toMatchObject({
      taxId: '11444777000161',
      ie: '111222333444',
      email: 'compras@mercado.com.br',
      phone: '1133334444',
    });
    expect(r).toMatchObject({
      nature: 'Venda de mercadoria',
      purpose: 'normal',
      presence: 'presencial',
      references: [],
      installments: [],
      transport: { freight: 'semFrete', freightCents: 0 },
    });
    expect(r.items[0]!.discountCents).toBe(0);
  });

  it('campos em branco viram nulos', () => {
    const base = rascunho();
    const r = nfeInvoiceInput.parse(
      rascunho({ recipient: { ...base.recipient, ie: '', email: '', phone: '', ieIndicator: 9 } }),
    );
    expect(r.recipient).toMatchObject({ ie: null, email: null, phone: null, ieIndicator: 9 });
  });

  it('devolução: cada item diz de qual nota e de qual item volta (NT 2025.002, VC02-14)', () => {
    const r = nfeInvoiceInput.safeParse(rascunho({ purpose: 'devolucao' }));
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => i.message)).toContain(
      'Item 1: informe de qual nota e de qual item ele é devolvido',
    );
    const item = (reference: unknown) =>
      rascunho({
        purpose: 'devolucao',
        items: [{ productId: ID, quantityMilli: 1000, unitPriceCents: 100, reference }],
      });
    expect(nfeInvoiceInput.safeParse(item({ key: '3'.repeat(44), item: 2 })).success).toBe(true);
    const fora = nfeInvoiceInput.safeParse(item({ key: '3'.repeat(44), item: 991 }));
    expect(fora.error!.issues.map((i) => i.message)).toContain(
      'O item da nota devolvida vai de 1 a 990',
    );
    const curta = nfeInvoiceInput.safeParse(item({ key: '123', item: 1 }));
    expect(curta.error!.issues.map((i) => i.message)).toContain(
      'Chave de acesso com 44 caracteres',
    );
  });

  it('confere o contribuinte, a inscrição, o CFOP e os itens', () => {
    const base = rascunho();
    const r = nfeInvoiceInput.safeParse(
      rascunho({
        recipient: { ...base.recipient, ieIndicator: 3, ie: '1' },
        items: [{ productId: ID, quantityMilli: 1000, unitPriceCents: 100, cfop: '512' }],
        transport: { freight: 'porContaDoRemetente', volumes: { grossKg: '1,5' } },
      }),
    );
    expect(r.success).toBe(false);
    const messages = r.error!.issues.map((i) => i.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        'Diga se o destinatário é contribuinte do ICMS',
        'Inscrição estadual inválida',
        'CFOP com 4 dígitos',
        'Peso em kg, com ponto',
      ]),
    );
    expect(nfeInvoiceInput.safeParse(rascunho({ items: [] })).error!.issues[0]!.message).toBe(
      'Escolha pelo menos um produto',
    );
  });
});
