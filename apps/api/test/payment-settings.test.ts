import type { PaymentSettingsView, SyncPullResult } from '@bipae/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestApp, signup, type TestApp } from './helpers';

/** F8-08: meios de pagamento por loja, com o QR do Pix indo ao caixa. */

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

describe('meios de pagamento (F8-08)', () => {
  it('padrão honesto, QR do Pix validado, auditoria e envio ao caixa', async () => {
    const dono = await signup(t.app);
    const admin = api(t.app, dono.auth);
    const store = (await admin.get('/stores')).json()[0];
    const url = `/stores/${store.id}/payment-settings`;

    // Sem configuração: maquininha à parte e Pix manual (nada aprova sozinho).
    expect((await admin.get(url)).json()).toMatchObject({ card: 'manual', pix: 'manual' });

    const ruim = await admin.put(url, { pix: 'static_qr', pixKey: 'abc', pixCity: 'Curitiba' });
    expect(ruim.statusCode).toBe(400);
    const campos = ruim.json().issues.map((i: { path: string }) => i.path);
    expect(campos).toEqual(expect.arrayContaining(['pixKey', 'pixMerchantName']));

    const ok = await admin.put(url, {
      card: 'manual',
      pix: 'static_qr',
      pixKey: '(42) 99999-0000',
      pixMerchantName: 'Mercearia da Lia',
      pixCity: 'Guarapuava',
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json() as PaymentSettingsView).toMatchObject({ pixKey: '+5542999990000' });
    const audit = (await admin.get('/audit?limit=5')).json();
    expect((audit.items ?? audit)[0].action).toBe('payment_settings.updated');

    // O caixa da loja recebe a configuração no retrato (sem nada secreto).
    const terminal = (
      await admin.post('/terminals', { storeId: store.id, name: 'Balcão', platform: 'web' })
    ).json();
    const pull = (
      await api(t.app, { ...dono.auth, 'x-bipae-terminal': terminal.id }).get('/sync/pull?limit=1')
    ).json() as SyncPullResult;
    expect(pull.pricing?.payments).toEqual({
      card: 'manual',
      pix: 'static_qr',
      pixStatic: { key: '+5542999990000', merchantName: 'Mercearia da Lia', city: 'Guarapuava' },
    });

    // O catálogo mostra o que já funciona e o que chega.
    const catalog = (await admin.get('/payment-providers')).json() as {
      id: string;
      status: string;
    }[];
    expect(catalog.find((p) => p.id === 'pix-static')?.status).toBe('ready');
    expect(catalog.find((p) => p.id === 'tef')?.status).toBe('coming-soon');

    // Outra empresa não lê nem muda a loja desta.
    const vizinho = api(t.app, (await signup(t.app)).auth);
    expect((await vizinho.get(url)).statusCode).toBe(404);
    expect((await vizinho.put(url, { card: 'simulator' })).statusCode).toBe(404);
  });
});
