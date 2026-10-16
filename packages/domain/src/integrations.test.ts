import { describe, expect, it } from 'vitest';
import {
  apiKeyInput,
  conditionalCloseInput,
  conditionalInput,
  purchasePersonalUseInput,
  webhookInput,
} from './contracts';

/** Contratos da API pública (F6-01), do condicional (F5-12.b) e da compra de uso pessoal. */

const id = '0190a5c2-7c1e-7000-8000-000000000001';

describe('contratos novos', () => {
  it('chave de API: nome, escopos só de leitura e sem repetir', () => {
    expect(apiKeyInput.parse({ name: 'Loja', scopes: ['catalog.read', 'catalog.read'] })).toEqual({
      name: 'Loja',
      scopes: ['catalog.read'],
    });
    expect(apiKeyInput.safeParse({ name: 'L', scopes: ['catalog.read'] }).success).toBe(false);
    expect(apiKeyInput.safeParse({ name: 'Loja', scopes: [] }).success).toBe(false);
    expect(apiKeyInput.safeParse({ name: 'Loja', scopes: ['finance.write'] }).success).toBe(false);
  });

  it('webhook: endereço http(s), eventos conhecidos, sem repetir, ativo por padrão', () => {
    expect(
      webhookInput.parse({
        url: ' https://loja.com.br/avisos ',
        events: ['sale.completed', 'sale.completed'],
      }),
    ).toEqual({ url: 'https://loja.com.br/avisos', events: ['sale.completed'], active: true });
    expect(webhookInput.safeParse({ url: 'ftp://x.com', events: ['sale.completed'] }).success).toBe(
      false,
    );
    expect(webhookInput.safeParse({ url: 'loja.com.br', events: ['sale.completed'] }).success).toBe(
      false,
    );
    expect(webhookInput.safeParse({ url: 'https://x.com', events: ['ping'] }).success).toBe(false);
    expect(webhookInput.safeParse({ url: 'https://x.com', events: [] }).success).toBe(false);
  });

  it('condicional: cliente, peças e prazo opcional; na volta, quanto ficou', () => {
    const ok = conditionalInput.parse({
      storeId: id,
      customerId: id,
      items: [{ productId: id, quantityMilli: 1000 }],
    });
    expect(ok.dueOn).toBeUndefined();
    expect(
      conditionalInput.safeParse({ storeId: id, customerId: id, dueOn: '31/12/2026', items: [] })
        .success,
    ).toBe(false);
    expect(
      conditionalCloseInput.parse({ items: [{ productId: id, keptMilli: 0 }] }).items,
    ).toHaveLength(1);
    expect(
      conditionalCloseInput.safeParse({ items: [{ productId: id, keptMilli: -1 }] }).success,
    ).toBe(false);
  });

  it('compra de uso pessoal: sim ou não', () => {
    expect(purchasePersonalUseInput.parse({ personalUse: true })).toEqual({ personalUse: true });
    expect(purchasePersonalUseInput.safeParse({ personalUse: 'sim' }).success).toBe(false);
  });
});
