import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runConformance } from '../conformance/run.mjs';

/**
 * Runs the PHP reference (server/php) under PHP's built-in server with SQLite and checks it
 * against the same conformance test as the Node one. Needs `php` with pdo_sqlite and mbstring
 * (PHP_BIN / PHP_INI override); skipped when PHP is not installed. CI runs it.
 */
const PHP = process.env.PHP_BIN ?? 'php';
const ini = process.env.PHP_INI ? ['-c', process.env.PHP_INI] : [];
const hasPhp =
  spawnSync(PHP, [
    ...ini,
    '-r',
    'echo extension_loaded("pdo_sqlite") ? "ok" : "no";',
  ]).stdout?.toString() === 'ok';
if (!hasPhp && process.env.BIPAE_REQUIRE_PHP)
  throw new Error('PHP com pdo_sqlite é obrigatório neste job');

describe.skipIf(!hasPhp)('PHP reference implementation', () => {
  const port = 4620 + Math.floor(Math.random() * 300);
  const dir = mkdtempSync(join(tmpdir(), 'bipae-pdv-php-'));
  let server: ChildProcess;

  beforeAll(async () => {
    server = spawn(PHP, [...ini, '-S', `127.0.0.1:${port}`, 'server/php/demo/router.php'], {
      cwd: join(import.meta.dirname, '..'),
      env: { ...process.env, PDV_DB: join(dir, 'pdv.sqlite') },
      stdio: 'ignore',
    });
    for (let i = 0; i < 50; i++) {
      try {
        await fetch(`http://127.0.0.1:${port}/api/pdv/me`);
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    throw new Error('O servidor PHP não subiu');
  });
  afterAll(() => {
    server?.kill();
    rmSync(dir, { recursive: true, force: true });
  });

  it('passes the conformance test', async () => {
    const lines: string[] = [];
    const result = await runConformance({
      url: `http://127.0.0.1:${port}/api/pdv`,
      headers: { authorization: 'Bearer token-ana' },
      q: 'arroz',
      manager: { login: 'gerente@demo', password: 'senha-gerente' },
      log: (l: string) => lines.push(l),
    });
    expect(result.failed, lines.join('\n')).toEqual([]);
    expect(result.passed).toBeGreaterThan(20);
  });
});
