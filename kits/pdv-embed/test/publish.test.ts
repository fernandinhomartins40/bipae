import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { publish } from '../scripts/publish.mjs';

/** P-06: o componente vai para endereços fixos e versionados, com o hash de integridade. */
describe('publicação do bipae-pdv.js', () => {
  it('copia para a versão exata e para a versão principal, com o SRI', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bipae-pdv-pub-'));
    try {
      const manifest = publish(dir);
      const { version } = JSON.parse(
        readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'),
      );
      const original = readFileSync(join(import.meta.dirname, '..', 'dist', 'bipae-pdv.js'));
      const sri = `sha384-${createHash('sha384').update(original).digest('base64')}`;
      expect(manifest).toEqual({
        latest: version,
        contract: version.split('.')[0],
        files: { [`${version}/bipae-pdv.js`]: sri, [`${version.split('.')[0]}/bipae-pdv.js`]: sri },
      });
      expect(readFileSync(join(dir, version, 'bipae-pdv.js'))).toEqual(original);
      expect(readFileSync(join(dir, '1', 'bipae-pdv.js'))).toEqual(original);
      expect(JSON.parse(readFileSync(join(dir, 'versions.json'), 'utf8'))).toEqual(manifest);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
