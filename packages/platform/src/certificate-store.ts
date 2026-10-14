import type { CertificateInfo, CertificatePort } from './ports';

/**
 * Certificado A1 instalado neste aparelho (F3-21), para assinar a nota mesmo sem internet
 * (contingência). A chave privada é importada na WebCrypto como **não exportável** e guardada
 * assim: nem o Bipaê consegue lê-la de volta, só usá-la para assinar. O arquivo .pfx e a senha
 * não ficam guardados.
 */
export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

type Subtle = typeof crypto.subtle;
type SignKey = Parameters<Subtle['sign']>[1];

interface StoredCertificate {
  info: CertificateInfo;
  /** Certificado do titular em DER, base64 (vai no KeyInfo da assinatura). */
  certificate: string;
  keys: { 'RSA-SHA1': SignKey; 'RSA-SHA256': SignKey };
}

const ENTRY = 'certificado-a1';

const toBase64 = (data: ArrayBuffer | Uint8Array) => {
  let binary = '';
  for (const byte of new Uint8Array(data)) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const brDate = (date: Date) => date.toLocaleDateString('pt-BR', { timeZone: 'UTC' });

export class LocalCertificateStore implements CertificatePort {
  constructor(
    private readonly store: KeyValueStore,
    private readonly subtle: Subtle = crypto.subtle,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Instala o .pfx neste aparelho. Substitui o que estava instalado. */
  async install(pfx: Uint8Array, password: string): Promise<CertificateInfo> {
    const { parsePkcs12, CertificateInstallError } = await import('./pkcs12');
    const parsed = parsePkcs12(pfx, password);
    if (parsed.notAfter <= this.now()) {
      throw new CertificateInstallError(`Este certificado venceu em ${brDate(parsed.notAfter)}.`);
    }
    const importKey = (hash: 'SHA-1' | 'SHA-256') =>
      this.subtle.importKey(
        'pkcs8',
        parsed.privateKeyPkcs8.slice().buffer,
        { name: 'RSASSA-PKCS1-v1_5', hash },
        false,
        ['sign'],
      );
    const info: CertificateInfo = {
      subject: parsed.subject,
      taxId: parsed.taxId ?? '',
      notAfter: parsed.notAfter.toISOString(),
      kind: 'A1',
    };
    const entry: StoredCertificate = {
      info,
      certificate: toBase64(parsed.certificateDer),
      keys: { 'RSA-SHA1': await importKey('SHA-1'), 'RSA-SHA256': await importKey('SHA-256') },
    };
    await this.store.set(ENTRY, entry);
    return info;
  }

  async info(): Promise<CertificateInfo | null> {
    return (await this.store.get<StoredCertificate>(ENTRY))?.info ?? null;
  }

  /** Certificado do titular em base64 (DER), ou null se nada está instalado. */
  async certificate(): Promise<string | null> {
    return (await this.store.get<StoredCertificate>(ENTRY))?.certificate ?? null;
  }

  async sign(data: Uint8Array, algorithm: 'RSA-SHA1' | 'RSA-SHA256'): Promise<string> {
    const entry = await this.store.get<StoredCertificate>(ENTRY);
    if (!entry) throw new Error('Nenhum certificado digital instalado neste aparelho.');
    if (new Date(entry.info.notAfter) <= this.now()) {
      throw new Error(
        `O certificado deste aparelho venceu em ${brDate(new Date(entry.info.notAfter))}.`,
      );
    }
    return toBase64(
      await this.subtle.sign('RSASSA-PKCS1-v1_5', entry.keys[algorithm], data.slice().buffer),
    );
  }

  async remove(): Promise<void> {
    await this.store.delete(ENTRY);
  }
}
