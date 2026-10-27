// Assinatura do AAB do app Android (F8-07.b). O `tauri android init` gera o projeto em
// apps/desktop/src-tauri/gen/android; este script liga a chave de upload (secrets do E24) ao
// build de release, lendo tudo de `keystore.properties` (nunca de texto fixo, regra 10).
// Uso: node scripts/android-signing.mjs <pasta gen/android/app>
import { readFileSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';

const MARK = '// bipae-signing';

/** Bloco que lê o keystore.properties, colocado antes de `android {`. */
const PROPS = `${MARK}
val keystoreProperties = java.util.Properties().apply {
    val file = rootProject.file("keystore.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}
`;

const SIGNING = `    signingConfigs {
        create("release") {
            storeFile = file(keystoreProperties.getProperty("storeFile"))
            storePassword = keystoreProperties.getProperty("storePassword")
            keyAlias = keystoreProperties.getProperty("keyAlias")
            keyPassword = keystoreProperties.getProperty("keyPassword")
        }
    }
`;

/**
 * Devolve o build.gradle.kts com a assinatura de release ligada. Idempotente. Falha em voz alta
 * se o arquivo gerado pelo Tauri mudar de forma, em vez de seguir sem assinar.
 */
export function patchGradle(source) {
  if (source.includes(MARK)) return source;
  if (!/^android\s*\{/m.test(source))
    throw new Error('Não achei o bloco "android {" no build.gradle.kts.');
  if (!/getByName\("release"\)\s*\{/.test(source))
    throw new Error('Não achei o tipo de build "release" no build.gradle.kts.');
  let out = source.replace(/^android\s*\{\n/m, (m) => `${PROPS}\n${m}${SIGNING}`);
  out = out.replace(
    /getByName\("release"\)\s*\{\n/,
    (m) => `${m}            signingConfig = signingConfigs.getByName("release")\n`,
  );
  return out;
}

/** Conteúdo do keystore.properties a partir do ambiente; lista o que faltar. */
export function keystoreProperties(env, storeFile) {
  const need = {
    storePassword: 'ANDROID_KEYSTORE_PASSWORD',
    keyAlias: 'ANDROID_KEY_ALIAS',
    keyPassword: 'ANDROID_KEY_PASSWORD',
  };
  const missing = Object.values(need).filter((name) => !env[name]);
  if (missing.length) throw new Error(`Faltam os secrets: ${missing.join(', ')}.`);
  return (
    [
      `storeFile=${storeFile}`,
      ...Object.entries(need).map(([key, name]) => `${key}=${env[name]}`),
    ].join('\n') + '\n'
  );
}

if (process.argv[1]?.endsWith('android-signing.mjs')) {
  const appDir = process.argv[2];
  if (!appDir) throw new Error('Informe a pasta gen/android/app.');
  const gradle = join(appDir, 'build.gradle.kts');
  writeFileSync(gradle, patchGradle(readFileSync(gradle, 'utf8')));
  const keystore = join(appDir, 'upload-keystore.jks');
  writeFileSync(
    join(appDir, '..', 'keystore.properties'),
    keystoreProperties(process.env, keystore.split(sep).join('/')),
  );
}
