import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runConformance } from '../conformance/run.mjs';
import {
  createDemoDatabase,
  demoAuth,
  demoAuthorizeManager,
  DEMO_MANAGER,
  DEMO_SECRET,
} from '../demo/demo-db.mjs';
import { createPdvHandler } from '../server/node/bipae-pdv.mjs';

describe('Node reference implementation', () => {
  let server: Server;
  let url: string;
  let demo: Awaited<ReturnType<typeof createDemoDatabase>>;

  beforeAll(async () => {
    demo = await createDemoDatabase();
    const pdv = createPdvHandler({
      db: demo.db,
      auth: demoAuth,
      authorizeManager: demoAuthorizeManager,
      secret: DEMO_SECRET,
      onStockChange: demo.onStockChange,
      basePath: '/api/pdv',
    });
    server = createServer((req, res) => {
      void pdv(req, res).then((handled: boolean) => {
        if (!handled) {
          res.statusCode = 404;
          res.end('not found');
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/pdv`;
  });
  afterAll(async () => {
    server.close();
    await demo.pg.close();
  });

  it('passes the conformance test', async () => {
    const lines: string[] = [];
    const result = await runConformance({
      url,
      headers: { authorization: 'Bearer token-ana' },
      q: 'arroz',
      manager: DEMO_MANAGER,
      log: (l: string) => lines.push(l),
    });
    expect(result.failed, lines.join('\n')).toEqual([]);
    expect(result.passed).toBeGreaterThan(20);
  });

  it('updates the host stock: sale takes it out, cancel puts it back', async () => {
    const call = (method: string, path: string, body?: unknown) =>
      fetch(url + path, {
        method,
        headers: { authorization: 'Bearer token-ana', 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }).then(async (r) => ({ status: r.status, body: await r.json() }));
    const stock = async () =>
      Number(
        (await demo.pg.query<{ stock: string }>("select stock from demo_products where id = 'p5'"))
          .rows[0]!.stock,
      );

    await call('POST', '/cash-session/open', { openingCents: 0 });
    const before = await stock();
    // 1,255 kg of bananas at R$ 6,99/kg = R$ 8,77 (half up).
    const sale = await call('POST', '/sales', {
      id: crypto.randomUUID(),
      items: [{ productId: 'p5', quantityMilli: 1255, unitPriceCents: 699, discountCents: 0 }],
      subtotalCents: 877,
      discountCents: 0,
      totalCents: 877,
      payments: [{ method: 'pix', amountCents: 877, changeCents: 0 }],
    });
    expect(sale.status).toBe(201);
    expect(await stock()).toBeCloseTo(before - 1.255, 3);
    await call('POST', `/sales/${sale.body.sale.id}/cancel`, { reason: 'Teste de estoque' });
    expect(await stock()).toBeCloseTo(before, 3);
    await call('POST', '/cash-session/close', { countedCents: {} });
  });

  it('unknown paths are left for the host server and errors are friendly', async () => {
    expect((await fetch(url.replace('/api/pdv', '/outra-rota'))).status).toBe(404);
    const unauth = await fetch(`${url}/me`);
    expect(unauth.status).toBe(401);
    expect((await unauth.json()).error.message).toContain('Entre de novo');
  });
});
