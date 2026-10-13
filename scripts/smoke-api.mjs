// Sobe o pacote compilado da API (apps/api/dist/main.js), do jeito que roda em produção, e
// confere que ela responde. Existe porque os testes rodam o código-fonte: um erro que só
// aparece no pacote compilado (como o driver do Redis que não carregava) passava batido.
//
// Uso: pnpm --filter @bipae/api build && node scripts/smoke-api.mjs
//   REDIS_URL          Redis da fila (na CI, um Redis de verdade).
//   SMOKE_REDIS_DOWN=1 o Redis está fora do ar de propósito: a API precisa subir mesmo assim.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.SMOKE_PORT ?? 3391);
const redisDown = process.env.SMOKE_REDIS_DOWN === '1';
const data = mkdtempSync(join(tmpdir(), 'bipae-smoke-'));

const api = spawn(process.execPath, ['dist/main.js'], {
  cwd: join(root, 'apps/api'),
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(port),
    HOST: '127.0.0.1',
    DATABASE_URL: `pglite://${data.replaceAll('\\', '/')}`,
    JWT_SECRET: 'segredo-so-do-teste-de-fumaca-0123456789abcdef0123',
  },
});

let output = '';
let exited = null;
for (const stream of [api.stdout, api.stderr]) {
  stream.on('data', (chunk) => {
    output += chunk;
  });
}
api.on('exit', (code) => {
  exited = code;
});

const finish = (ok, message) => {
  api.kill();
  // No Windows o arquivo do banco pode ficar preso por um instante; apagar é só limpeza.
  setTimeout(() => {
    try {
      rmSync(data, { recursive: true, force: true });
    } catch {
      /* fica na pasta temporária */
    }
    if (!ok) console.error(`--- saída da API ---\n${output}`);
    console.log(ok ? `ok: ${message}` : `ERRO: ${message}`);
    process.exit(ok ? 0 : 1);
  }, 500);
};

// Sinais de que a fila não funcionou. Com o Redis fora do ar de propósito, só o aviso de
// conexão é aceito; a API não pode cair nem trocar de fila calada.
const FATAL = [
  'could not load',
  'Fila em Redis indisponível',
  'Fila de manutenção não iniciou',
  'Não foi possível agendar',
];

const deadline = Date.now() + 90_000;
let healthy = false;
while (Date.now() < deadline && exited === null) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/health`);
    if (response.ok) {
      healthy = true;
      break;
    }
  } catch {
    /* ainda subindo */
  }
  await new Promise((r) => setTimeout(r, 500));
}

if (!healthy) {
  finish(false, exited === null ? 'a API não respondeu em 90 s' : `a API encerrou (código ${exited})`);
} else {
  // Um tempo para a fila conectar e agendar a manutenção antes de olhar o log.
  await new Promise((r) => setTimeout(r, 3000));
  const fatal = FATAL.find((text) => output.includes(text));
  const redisWarning = output.includes('[fila]');
  if (exited !== null) finish(false, `a API caiu depois de subir (código ${exited})`);
  else if (fatal) finish(false, `a fila não iniciou ("${fatal}")`);
  else if (redisWarning && !redisDown) finish(false, 'a fila avisou erro com o Redis no ar');
  else if (!redisWarning && redisDown) finish(false, 'esperava o aviso de Redis fora do ar');
  else finish(true, redisDown ? 'a API sobe mesmo com o Redis fora do ar' : 'a API sobe com a fila');
}
