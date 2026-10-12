/**
 * Bipaê Conector simulator: the real protocol (ConnectorCore from @bipae/platform) behind a
 * real local WebSocket, with simulated printer, drawer and scale. Lets you develop and test
 * the web register's peripherals without hardware or the desktop app.
 *
 *   pnpm --filter @bipae/web connector:sim
 *
 * Env: CONNECTOR_CODE (default 123456), CONNECTOR_PORT (47800), CONNECTOR_ORIGINS (extra, comma-separated).
 * Inspect state at http://127.0.0.1:<port+1>/state (prints, drawer openings, weight).
 */
import { createServer } from 'node:http';
import {
  CONNECTOR_DEV_ORIGINS,
  CONNECTOR_ORIGINS,
  CONNECTOR_PORT,
  ConnectorCore,
  type ConnectorRequest,
} from '@bipae/platform';
import { WebSocketServer } from 'ws';

const port = Number(process.env.CONNECTOR_PORT ?? CONNECTOR_PORT);
const code = process.env.CONNECTOR_CODE ?? '123456';
const origins = new Set([
  ...CONNECTOR_ORIGINS,
  ...CONNECTOR_DEV_ORIGINS,
  ...(process.env.CONNECTOR_ORIGINS?.split(',').filter(Boolean) ?? []),
]);

const state = { prints: 0, lastPrintBytes: 0, drawerOpenings: 0, grams: 1250 };

const core = new ConnectorCore(code, {
  print: async (bytes) => {
    state.prints++;
    state.lastPrintBytes = bytes.length;
  },
  openDrawer: async () => {
    state.drawerOpenings++;
  },
  readScale: async () => state.grams,
  listPorts: async () => ['COM3 (simulada)', 'COM4 (simulada)'],
});

const wss = new WebSocketServer({
  host: '127.0.0.1',
  port,
  // Same rule as the Rust server: refuse other origins at the handshake.
  verifyClient: ({ origin }: { origin?: string }) => origins.has(origin ?? ''),
});
wss.on('connection', (socket) => {
  const session = { authed: false };
  socket.on('message', async (data) => {
    const response = await core.handle(session, JSON.parse(String(data)) as ConnectorRequest);
    socket.send(JSON.stringify(response));
  });
});

createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  res.setHeader('access-control-allow-origin', '*');
  if (req.url === '/state') return res.end(JSON.stringify(state));
  res.statusCode = 404;
  res.end('{}');
}).listen(port + 1, '127.0.0.1');

console.log(`Simulador do Bipaê Conector em ws://127.0.0.1:${port} · código ${code}`);
