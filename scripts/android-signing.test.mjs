// Testes da assinatura do AAB: node --test scripts/
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keystoreProperties, patchGradle } from './android-signing.mjs';

const GRADLE = `plugins {
}
android {
    compileSdk = 36
    buildTypes {
        getByName("release") {
            isMinifyEnabled = true
        }
    }
}
`;

test('liga a assinatura de release lendo o keystore.properties', () => {
  const out = patchGradle(GRADLE);
  assert.match(out, /signingConfigs \{/);
  assert.match(out, /signingConfig = signingConfigs\.getByName\("release"\)/);
  assert.match(out, /rootProject\.file\("keystore\.properties"\)/);
  assert.ok(out.indexOf('keystoreProperties') < out.indexOf('android {'));
});

test('rodar duas vezes não duplica', () => {
  const once = patchGradle(GRADLE);
  assert.equal(patchGradle(once), once);
});

test('falha alto quando o arquivo gerado mudou de forma', () => {
  assert.throws(() => patchGradle('plugins {}'), /android \{/);
  assert.throws(() => patchGradle('android {\n}\n'), /release/);
});

test('o keystore.properties pede todos os secrets e lista o que falta', () => {
  const env = { ANDROID_KEYSTORE_PASSWORD: 'a', ANDROID_KEY_ALIAS: 'b', ANDROID_KEY_PASSWORD: 'c' };
  assert.equal(
    keystoreProperties(env, '/k.jks'),
    'storeFile=/k.jks\nstorePassword=a\nkeyAlias=b\nkeyPassword=c\n',
  );
  assert.throws(
    () => keystoreProperties({ ANDROID_KEY_ALIAS: 'b' }, '/k.jks'),
    /ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_PASSWORD/,
  );
});
