import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, createTestApp, signup, type TestApp } from './helpers';

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t.close();
});

/** "Foto" JPEG de mentira: a assinatura do formato e alguns bytes (o servidor só confere o tipo). */
function fakeJpeg(seed: number) {
  return Buffer.from([
    0xff,
    0xd8,
    0xff,
    0xe0,
    ...Array.from({ length: 300 }, (_, i) => (i * seed) % 256),
  ]);
}
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const payload = (bytes: Buffer, contentType = 'image/jpeg') => ({
  contentType,
  data: bytes.toString('base64'),
});

describe('foto do produto (F2-14)', () => {
  it('envia, lê com ETag e cache longo, troca e remove, com auditoria', async () => {
    const owner = await signup(t.app);
    const admin = api(t.app, owner.auth);
    const product = (
      await admin.post('/products', { name: 'Pão de Queijo', priceCents: 450 })
    ).json();
    expect(product.imageHash).toBeNull();
    expect((await admin.get(`/products/${product.id}/image`)).statusCode).toBe(404);

    const first = fakeJpeg(7);
    const saved = await admin.put(`/products/${product.id}/image`, payload(first));
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({ imageHash: sha(first) });
    expect((await admin.get(`/products/${product.id}`)).json().imageHash).toBe(sha(first));
    const listed = (await admin.get('/products?q=queijo')).json();
    expect(listed.items[0].imageHash).toBe(sha(first));

    const read = await admin.get(`/products/${product.id}/image?v=${sha(first)}`);
    expect(read.statusCode).toBe(200);
    expect(read.headers['content-type']).toBe('image/jpeg');
    expect(read.headers.etag).toBe(`"${sha(first)}"`);
    expect(read.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    expect(Buffer.from(read.rawPayload).equals(first)).toBe(true);

    // Quem já tem a foto não baixa de novo.
    const again = await t.app.inject({
      method: 'GET',
      url: `/v1/products/${product.id}/image`,
      headers: { ...owner.auth, 'if-none-match': `"${sha(first)}"` },
    });
    expect(again.statusCode).toBe(304);
    expect(again.rawPayload.length).toBe(0);

    // Troca a foto: hash novo, o ETag antigo não vale mais.
    const second = fakeJpeg(13);
    await admin.put(`/products/${product.id}/image`, payload(second));
    const stale = await t.app.inject({
      method: 'GET',
      url: `/v1/products/${product.id}/image`,
      headers: { ...owner.auth, 'if-none-match': `"${sha(first)}"` },
    });
    expect(stale.statusCode).toBe(200);
    expect(stale.headers.etag).toBe(`"${sha(second)}"`);

    expect((await admin.delete(`/products/${product.id}/image`)).statusCode).toBe(204);
    expect((await admin.get(`/products/${product.id}`)).json().imageHash).toBeNull();
    expect((await admin.get(`/products/${product.id}/image`)).statusCode).toBe(404);
    // Tirar de novo não dá erro nem registra nada.
    expect((await admin.delete(`/products/${product.id}/image`)).statusCode).toBe(204);

    const audit = (await admin.get('/audit?limit=50')).json();
    const actions = audit.items.map((e: { action: string }) => e.action);
    expect(actions.filter((a: string) => a === 'product.image_saved')).toHaveLength(2);
    expect(actions.filter((a: string) => a === 'product.image_removed')).toHaveLength(1);
  });

  it('recusa o que não é foto, foto grande demais e produto que não existe', async () => {
    const owner = await signup(t.app);
    const admin = api(t.app, owner.auth);
    const product = (await admin.post('/products', { name: 'Café', priceCents: 1200 })).json();

    const pdf = await admin.put(
      `/products/${product.id}/image`,
      payload(Buffer.from('%PDF-1.4 isto não é foto')),
    );
    expect(pdf.statusCode).toBe(422);
    expect(pdf.json().message).toBe('Esse arquivo não é uma foto. Envie WebP, JPEG ou PNG.');

    const gif = await admin.put(`/products/${product.id}/image`, {
      contentType: 'image/gif',
      data: fakeJpeg(3).toString('base64'),
    });
    expect(gif.statusCode).toBe(400);
    expect(gif.body).toContain('Envie a foto em WebP, JPEG ou PNG.');

    const big = Buffer.concat([fakeJpeg(5), Buffer.alloc(210 * 1024)]);
    const tooBig = await admin.put(`/products/${product.id}/image`, payload(big));
    expect(tooBig.statusCode).toBe(400);
    expect(tooBig.body).toContain('A foto passou de 200 KB');

    const ghost = await admin.put(
      '/products/0190b5a0-0000-7000-8000-000000000000/image',
      payload(fakeJpeg(9)),
    );
    expect(ghost.statusCode).toBe(404);
  });

  it('confere o tipo pelos bytes: PNG declarado como JPEG fica guardado como PNG', async () => {
    const owner = await signup(t.app);
    const admin = api(t.app, owner.auth);
    const product = (await admin.post('/products', { name: 'Bolo', priceCents: 900 })).json();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    await admin.put(`/products/${product.id}/image`, payload(png, 'image/jpeg'));
    const read = await admin.get(`/products/${product.id}/image`);
    expect(read.headers['content-type']).toBe('image/png');
  });

  it('outra empresa não lê, não troca e não tira a foto (RLS)', async () => {
    const owner = await signup(t.app);
    const admin = api(t.app, owner.auth);
    const product = (await admin.post('/products', { name: 'Suco', priceCents: 700 })).json();
    await admin.put(`/products/${product.id}/image`, payload(fakeJpeg(11)));

    const other = api(t.app, (await signup(t.app)).auth);
    expect((await other.get(`/products/${product.id}/image`)).statusCode).toBe(404);
    expect(
      (await other.put(`/products/${product.id}/image`, payload(fakeJpeg(17)))).statusCode,
    ).toBe(404);
    await other.delete(`/products/${product.id}/image`);
    expect((await admin.get(`/products/${product.id}/image`)).statusCode).toBe(200);
    expect((await admin.get(`/products/${product.id}`)).json().imageHash).toBe(sha(fakeJpeg(11)));
  });

  it('quem só vende no caixa lê a foto, mas não troca', async () => {
    const owner = await signup(t.app);
    const admin = api(t.app, owner.auth);
    const product = (await admin.post('/products', { name: 'Água', priceCents: 300 })).json();
    await admin.put(`/products/${product.id}/image`, payload(fakeJpeg(19)));
    const roles = (await admin.get('/roles')).json() as { id: string; systemKey: string | null }[];
    const email = `caixa-foto-${Date.now()}@exemplo.com.br`;
    await admin.post('/members', {
      name: 'Caixa',
      email,
      password: 'senha-forte-123',
      roleId: roles.find((r) => r.systemKey === 'cashier')!.id,
    });
    const login = await t.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email, password: 'senha-forte-123' },
    });
    const operador = api(t.app, { authorization: `Bearer ${login.json().accessToken}` });
    expect((await operador.get(`/products/${product.id}/image`)).statusCode).toBe(200);
    expect(
      (await operador.put(`/products/${product.id}/image`, payload(fakeJpeg(23)))).statusCode,
    ).toBe(403);
    expect((await operador.delete(`/products/${product.id}/image`)).statusCode).toBe(403);
  });
});
