// Bundles the API (and workspace packages) into dist/main.js. node_modules stay external.
import { cpSync, readFileSync, rmSync } from 'node:fs';
import { build } from 'esbuild';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const external = Object.keys(pkg.dependencies).filter((d) => !d.startsWith('@bipae/'));

rmSync('dist', { recursive: true, force: true });
for (const entry of ['main', 'seed-cli', 'admin-cli']) {
  await build({
    entryPoints: [`src/${entry}.ts`],
    outfile: `dist/${entry}.js`,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    sourcemap: true,
    external,
    tsconfig: 'tsconfig.json',
  });
}
// migrate.ts reads ./migrations relative to the bundle.
cpSync('src/db/migrations', 'dist/migrations', { recursive: true });
console.log('API build ok');
