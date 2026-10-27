import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertSafeKey, createStorage, LocalDiskStorage, S3Storage } from '../src/common/storage';
import { api, createTestApp, signup, type TestApp } from './helpers';

/** F1-08: porta de armazenamento de arquivos (disco, S3 compatível) e fotos fora do banco. */

const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

describe('armazenamento de arquivos (F1-08)', () => {
  it('chaves perigosas são recusadas', () => {
    for (const key of ['../x', 'a/../b', '/abs', 'a//b', 'a\\b', '.oculto', 'a/b/', 'c:/x', '']) {
      expect(() => assertSafeKey(key), key).toThrow('Chave de arquivo inválida.');
    }
    expect(() => assertSafeKey('tenant/products/abc.def0')).not.toThrow();
  });

  it('disco local: grava, lê, apaga e não sai da pasta', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'bipae-storage-'));
    try {
      const storage = new LocalDiskStorage(dir);
      expect(await storage.get('t/p/a.1')).toBeNull();
      await storage.put('t/p/a.1', bytes);
      expect(await storage.get('t/p/a.1')).toEqual(bytes);
      await storage.delete('t/p/a.1');
      await storage.delete('t/p/a.1');
      expect(await storage.get('t/p/a.1')).toBeNull();
      await expect(storage.put('../fora', bytes)).rejects.toThrow('inválida');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('S3: assina com SigV4 e fala PUT, GET e DELETE no endereço do bucket', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const store = new Map<string, Uint8Array>();
    const fake = (async (input: URL | string, init: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (init.method === 'PUT') {
        store.set(url, init.body as Uint8Array);
        return new Response(null, { status: 200 });
      }
      if (init.method === 'DELETE') {
        store.delete(url);
        return new Response(null, { status: 204 });
      }
      const found = store.get(url);
      return found ? new Response(found as never) : new Response('x', { status: 404 });
    }) as unknown as typeof fetch;
    const s3 = new S3Storage(
      {
        endpoint: 'https://s3.exemplo.com',
        bucket: 'fotos',
        region: 'sa-east-1',
        accessKeyId: 'AKIDEXEMPLO',
        secretAccessKey: 'segredo-de-teste',
      },
      fake,
      () => new Date('2026-10-27T12:00:00Z'),
    );
    await s3.put('t/p/a.1', bytes, 'image/jpeg');
    expect(calls[0]!.url).toBe('https://s3.exemplo.com/fotos/t/p/a.1');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['x-amz-date']).toBe('20261027T120000Z');
    expect(headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXEMPLO\/20261027\/sa-east-1\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
    expect(JSON.stringify(headers)).not.toContain('segredo-de-teste');
    expect(await s3.get('t/p/a.1')).toEqual(bytes);
    await s3.delete('t/p/a.1');
    expect(await s3.get('t/p/a.1')).toBeNull();

    // Assinatura determinística: mesma entrada, mesma assinatura.
    const url = new URL('https://s3.exemplo.com/fotos/k');
    expect(s3.sign('GET', url, null).authorization).toBe(s3.sign('GET', url, null).authorization);

    // Erro do serviço não vaza o corpo.
    const broken = new S3Storage(
      {
        endpoint: 'https://s3.exemplo.com',
        bucket: 'b',
        region: 'r',
        accessKeyId: 'a',
        secretAccessKey: 's',
      },
      (async () => new Response('AKIDEXEMPLO echo', { status: 403 })) as unknown as typeof fetch,
    );
    const error = await broken.put('k', bytes, 'image/jpeg').catch((e: unknown) => e);
    expect((error as Error).message).toBe('O armazenamento de arquivos respondeu 403.');
  });

  it('a configuração monta o driver; S3 sem as variáveis diz o que falta configurar', () => {
    const base = {
      STORAGE_DIR: 'x',
      S3_REGION: 'r',
      S3_PATH_STYLE: true,
    };
    expect(createStorage({ ...base, STORAGE_DRIVER: 'db' })).toBeNull();
    expect(createStorage({ ...base, STORAGE_DRIVER: 'disk' })?.driver).toBe('disk');
    expect(() => createStorage({ ...base, STORAGE_DRIVER: 's3' })).toThrow('Falta configurar');
    expect(
      createStorage({
        ...base,
        STORAGE_DRIVER: 's3',
        S3_ENDPOINT: 'https://e',
        S3_BUCKET: 'b',
        S3_ACCESS_KEY_ID: 'a',
        S3_SECRET_ACCESS_KEY: 's',
      })?.driver,
    ).toBe('s3');
  });
});

describe('fotos de produto no disco (F1-08)', () => {
  let t: TestApp;
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bipae-fotos-'));
    t = await createTestApp({ STORAGE_DRIVER: 'disk', STORAGE_DIR: dir });
  });
  afterAll(async () => {
    await t.close();
    await rm(dir, { recursive: true, force: true });
  });

  const files = async () => {
    const out: string[] = [];
    const walk = async (d: string) => {
      for (const e of await readdir(d, { withFileTypes: true })) {
        if (e.isDirectory()) await walk(join(d, e.name));
        else out.push(e.name);
      }
    };
    await walk(dir);
    return out;
  };
  const photo = (seed: number) => {
    const raw = Buffer.from([
      0xff,
      0xd8,
      0xff,
      0xe0,
      ...Array.from({ length: 200 }, (_, i) => (i * seed) % 256),
    ]);
    return { raw, body: { contentType: 'image/jpeg', data: raw.toString('base64') } };
  };

  it('o arquivo vai para o disco, a linha guarda só a chave; troca e remoção limpam o disco', async () => {
    const owner = await signup(t.app);
    const admin = api(t.app, owner.auth);
    const product = (await admin.post('/products', { name: 'Biscoito', priceCents: 350 })).json();
    const one = photo(5);
    expect((await admin.put(`/products/${product.id}/image`, one.body)).statusCode).toBe(200);
    expect(await files()).toHaveLength(1);
    const read = await admin.get(`/products/${product.id}/image`);
    expect(Buffer.from(read.rawPayload).equals(one.raw)).toBe(true);

    // O banco não guarda os bytes.
    const rows = await t.database.db.execute(
      (await import('drizzle-orm'))
        .sql`select bytes is null as sem_bytes, storage_key from product_images`,
    );
    const row =
      (rows as unknown as { rows?: Record<string, unknown>[] }).rows?.[0] ??
      (rows as unknown as Record<string, unknown>[])[0];
    expect(row?.sem_bytes).toBe(true);
    expect(String(row?.storage_key)).toContain(`/products/${product.id}.`);

    const two = photo(9);
    await admin.put(`/products/${product.id}/image`, two.body);
    expect(await files()).toHaveLength(1);
    expect(
      Buffer.from((await admin.get(`/products/${product.id}/image`)).rawPayload).equals(two.raw),
    ).toBe(true);

    expect((await admin.delete(`/products/${product.id}/image`)).statusCode).toBe(204);
    expect(await files()).toHaveLength(0);
    expect((await admin.get(`/products/${product.id}/image`)).statusCode).toBe(404);
  });

  it('arquivo recusado (tipo errado) não deixa nada no disco', async () => {
    const owner = await signup(t.app);
    const admin = api(t.app, owner.auth);
    const product = (await admin.post('/products', { name: 'Suco', priceCents: 500 })).json();
    const before = (await files()).length;
    const r = await admin.put(`/products/${product.id}/image`, {
      contentType: 'image/jpeg',
      data: Buffer.from('isso nao e foto').toString('base64'),
    });
    expect(r.statusCode).toBe(422);
    expect(await files()).toHaveLength(before);
  });
});
