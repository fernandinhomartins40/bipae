import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { createZip } from './zip';

/** Lê de volta os arquivos de um ZIP pelos cabeçalhos locais (o suficiente para o teste). */
function readZip(zip: Buffer) {
  const files: Record<string, string> = {};
  let at = 0;
  while (zip.readUInt32LE(at) === 0x04034b50) {
    const size = zip.readUInt32LE(at + 18);
    const nameLength = zip.readUInt16LE(at + 26);
    const name = zip.subarray(at + 30, at + 30 + nameLength).toString('utf8');
    const start = at + 30 + nameLength;
    files[name] = inflateRawSync(zip.subarray(start, start + size)).toString('utf8');
    at = start + size;
  }
  expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
  expect(zip.readUInt16LE(zip.length - 12)).toBe(Object.keys(files).length);
  return files;
}

describe('ZIP da exportação (P-03)', () => {
  it('guarda os arquivos com nomes em UTF-8 e conteúdo comprimido', () => {
    const big = 'Bipou? Bipaê! '.repeat(1000);
    const zip = createZip([
      { name: 'leia-me.txt', data: 'Dados exportados do Bipaê' },
      { name: 'vendas/produtos.json', data: big },
      { name: 'ação.json', data: Buffer.from('[]') },
    ]);
    expect(zip.length).toBeLessThan(big.length);
    expect(readZip(zip)).toEqual({
      'leia-me.txt': 'Dados exportados do Bipaê',
      'vendas/produtos.json': big,
      'ação.json': '[]',
    });
  });
});
