// Publica o componente no site (P-06): copia dist/bipae-pdv.js para
//   <destino>/<versão>/bipae-pdv.js   (ex.: 1.0.0, nunca muda: cache de um ano)
//   <destino>/<maior>/bipae-pdv.js    (ex.: 1, recebe as correções da versão 1: cache curto)
// e grava <destino>/versions.json com o hash de integridade (SRI) de cada arquivo.
//
//   node kits/pdv-embed/scripts/publish.mjs apps/site/dist/pdv
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const kit = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Publica e devolve o que foi gravado (usado também pelo teste). */
export function publish(target) {
  const { version } = JSON.parse(readFileSync(join(kit, 'package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw new Error(`Versão inválida no package.json: ${version}`);
  const major = version.split('.')[0];
  const source = join(kit, 'dist', 'bipae-pdv.js');
  const bytes = readFileSync(source);
  const integrity = `sha384-${createHash('sha384').update(bytes).digest('base64')}`;
  for (const folder of [version, major]) {
    mkdirSync(join(target, folder), { recursive: true });
    copyFileSync(source, join(target, folder, 'bipae-pdv.js'));
  }
  const manifest = {
    latest: version,
    contract: major,
    files: {
      [`${version}/bipae-pdv.js`]: integrity,
      [`${major}/bipae-pdv.js`]: integrity,
    },
  };
  writeFileSync(join(target, 'versions.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const target = process.argv[2];
  if (!target) {
    console.error('Uso: node scripts/publish.mjs <pasta de destino>');
    process.exit(2);
  }
  const manifest = publish(target);
  console.log(
    `bipae-pdv.js ${manifest.latest} publicado em ${target} (${manifest.files[`${manifest.latest}/bipae-pdv.js`]})`,
  );
}
