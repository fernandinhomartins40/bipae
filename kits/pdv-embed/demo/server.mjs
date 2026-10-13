// Demonstração: um "painel admin" fictício com o <bipae-pdv> embutido, servido pela implementação
// de referência em Node com banco em memória. Rode: pnpm --filter @bipae/pdv-embed demo
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createPdvHandler } from '../server/node/bipae-pdv.mjs';
import { createDemoDatabase, demoAuth } from './demo-db.mjs';

const port = Number(process.env.PORT ?? 4600);
const demo = await createDemoDatabase();
const pdv = createPdvHandler({
  db: demo.db,
  auth: demoAuth,
  onStockChange: demo.onStockChange,
  basePath: '/api/pdv',
});

const FILES = {
  '/': ['demo/index.html', 'text/html; charset=utf-8'],
  '/bipae-pdv.js': ['dist/bipae-pdv.js', 'text/javascript; charset=utf-8'],
};

createServer(async (req, res) => {
  if (await pdv(req, res)) return;
  const path = new URL(req.url, 'http://local').pathname;
  if (path === '/api/estoque') {
    const { rows } = await demo.pg.query('select id, name, stock from demo_products order by id');
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify(rows));
  }
  const file = FILES[path];
  if (!file) {
    res.statusCode = 404;
    return res.end('Não encontrado');
  }
  try {
    const body = await readFile(new URL(`../${file[0]}`, import.meta.url));
    res.setHeader('content-type', file[1]);
    res.setHeader('cache-control', 'no-store');
    res.end(body);
  } catch {
    res.statusCode = 500;
    res.end('Rode "pnpm --filter @bipae/pdv-embed build" antes da demonstração.');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Bipaê PDV Embed — demonstração em http://127.0.0.1:${port}`);
});
