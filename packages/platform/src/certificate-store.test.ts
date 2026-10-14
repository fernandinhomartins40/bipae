import forge from 'node-forge';
import { describe, expect, it } from 'vitest';
import { LocalCertificateStore, type KeyValueStore } from './certificate-store';
import { parsePkcs12 } from './pkcs12';

/** F3-21.a: certificado A1 instalado no aparelho, com a chave não exportável. */

const DIA = 86_400_000;
const keys = forge.pki.rsa.generateKeyPair(2048);

function pfx(options: { password: string; to?: Date; icp?: boolean }): Uint8Array {
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '03';
  cert.validity.notBefore = new Date(Date.now() - DIA);
  cert.validity.notAfter = options.to ?? new Date(Date.now() + 365 * DIA);
  const cn = options.icp ? 'LOJA DO TESTE' : 'LOJA DO TESTE:11222333000181';
  cert.setSubject([{ name: 'commonName', value: cn }]);
  cert.setIssuer([{ name: 'commonName', value: cn }]);
  if (options.icp) {
    const { asn1 } = forge;
    const otherName = asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [
      asn1.create(
        asn1.Class.UNIVERSAL,
        asn1.Type.OID,
        false,
        asn1.oidToDer('2.16.76.1.3.3').getBytes(),
      ),
      asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, '11222333000181'),
      ]),
    ]);
    cert.setExtensions([
      {
        name: 'subjectAltName',
        value: asn1
          .toDer(asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [otherName]))
          .getBytes(),
      },
    ]);
  }
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const der = forge.asn1
    .toDer(
      forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], options.password, { algorithm: '3des' }),
    )
    .getBytes();
  return Uint8Array.from(der, (c) => c.charCodeAt(0));
}

function memoryStore(): KeyValueStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get: async <T>(key: string) => data.get(key) as T | undefined,
    set: async (key, value) => void data.set(key, value),
    delete: async (key) => void data.delete(key),
  };
}

const publicKey = await crypto.subtle.importKey(
  'spki',
  Uint8Array.from(forge.asn1.toDer(forge.pki.publicKeyToAsn1(keys.publicKey)).getBytes(), (c) =>
    c.charCodeAt(0),
  ),
  { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-1' },
  false,
  ['verify'],
);

describe('certificado A1 neste aparelho', () => {
  it('instala, mostra os dados, assina e a assinatura confere com a chave pública', async () => {
    const store = memoryStore();
    const local = new LocalCertificateStore(store);
    expect(await local.info()).toBeNull();
    const info = await local.install(pfx({ password: 'segredo', icp: true }), 'segredo');
    expect(info).toMatchObject({ subject: 'LOJA DO TESTE', taxId: '11222333000181', kind: 'A1' });
    expect(await local.info()).toEqual(info);
    expect(await local.certificate()).toMatch(/^[A-Za-z0-9+/=]+$/);

    const dados = new TextEncoder().encode('<SignedInfo>teste</SignedInfo>');
    const assinatura = await local.sign(dados, 'RSA-SHA1');
    const bytes = Uint8Array.from(atob(assinatura), (c) => c.charCodeAt(0));
    expect(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, bytes, dados)).toBe(true);
    expect(await local.sign(dados, 'RSA-SHA256')).toMatch(/^[A-Za-z0-9+/=]+$/);

    // A chave guardada não pode ser exportada: nem o próprio Bipaê lê a chave de volta.
    const guardado = store.data.get('certificado-a1') as { keys: Record<string, CryptoKey> };
    expect(guardado.keys['RSA-SHA1']!.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('pkcs8', guardado.keys['RSA-SHA1']!)).rejects.toThrow();
    expect(JSON.stringify(store.data.get('certificado-a1'))).not.toContain('segredo');

    await local.remove();
    expect(await local.info()).toBeNull();
    expect(await local.certificate()).toBeNull();
    await expect(local.sign(dados, 'RSA-SHA1')).rejects.toThrow(
      'Nenhum certificado digital instalado',
    );
  });

  it('recusa senha errada, arquivo que não é certificado e certificado vencido', async () => {
    const local = new LocalCertificateStore(memoryStore());
    await expect(local.install(pfx({ password: 'certa' }), 'errada')).rejects.toThrow(
      'Senha do certificado incorreta.',
    );
    await expect(local.install(new Uint8Array([1, 2, 3]), 'x')).rejects.toThrow(
      'não é um certificado A1',
    );
    await expect(
      local.install(pfx({ password: 'a', to: new Date(Date.now() - DIA) }), 'a'),
    ).rejects.toThrow(/Este certificado venceu em/);
  });

  it('para de assinar quando o certificado instalado vence', async () => {
    let agora = new Date();
    const local = new LocalCertificateStore(memoryStore(), crypto.subtle, () => agora);
    await local.install(pfx({ password: 'a', to: new Date(Date.now() + 2 * DIA) }), 'a');
    agora = new Date(Date.now() + 3 * DIA);
    await expect(local.sign(new Uint8Array([1]), 'RSA-SHA1')).rejects.toThrow(/venceu em/);
  });

  it('lê o CNPJ do fim do nome quando não há o campo da ICP-Brasil', () => {
    expect(parsePkcs12(pfx({ password: 'p' }), 'p')).toMatchObject({
      taxId: '11222333000181',
      subject: 'LOJA DO TESTE:11222333000181',
    });
  });
});
