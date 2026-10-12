import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Encryption at rest for small secrets stored in the database (2FA seeds; later the A1
 * certificate envelope keys, ADR-0010). AES-256-GCM with a key from SECRETS_KEY, or derived
 * from JWT_SECRET when SECRETS_KEY is not set. Format: v1.<iv>.<tag>.<ciphertext> (base64url).
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = createHash('sha256').update(`bipae-secrets:${secret}`).digest();
  }

  seal(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', iv, cipher.getAuthTag(), data].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join('.');
  }

  open(sealed: string): string {
    const [version, iv, tag, data] = sealed.split('.');
    if (version !== 'v1' || !iv || !tag || !data) throw new Error('Segredo em formato inválido');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  }
}
