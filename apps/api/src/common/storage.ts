import { createHash, createHmac } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

/**
 * Porta de armazenamento de arquivos (F1-08). A API fala só com esta interface: o driver sai da
 * configuração (`STORAGE_DRIVER`). Sem driver, as fotos continuam no PostgreSQL, como antes.
 * A chave é sempre `tenant/…`, escolhida pelo servidor, nunca pelo cliente.
 */
export interface FileStorage {
  readonly driver: 'disk' | 's3' | 'memory';
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** Os bytes do arquivo, ou null se não existir. */
  get(key: string): Promise<Uint8Array | null>;
  /** Apagar o que não existe não é erro. */
  delete(key: string): Promise<void>;
}

export const FILE_STORAGE = Symbol('FILE_STORAGE');

const SAFE_KEY = /^[a-zA-Z0-9][a-zA-Z0-9._-]*(\/[a-zA-Z0-9][a-zA-Z0-9._-]*)*$/;

/** Rejeita chaves com `..`, barra no começo, caminho do Windows ou caractere estranho. */
export function assertSafeKey(key: string) {
  if (!SAFE_KEY.test(key) || key.split('/').some((part) => part === '..' || part.endsWith('.'))) {
    throw new Error('Chave de arquivo inválida.');
  }
}

/** Em memória: para teste. */
export class MemoryStorage implements FileStorage {
  readonly driver = 'memory' as const;
  readonly files = new Map<string, { bytes: Uint8Array; contentType: string }>();

  async put(key: string, bytes: Uint8Array, contentType: string) {
    assertSafeKey(key);
    this.files.set(key, { bytes: new Uint8Array(bytes), contentType });
  }
  async get(key: string) {
    assertSafeKey(key);
    return this.files.get(key)?.bytes ?? null;
  }
  async delete(key: string) {
    assertSafeKey(key);
    this.files.delete(key);
  }
}

/** Disco local: para desenvolvimento e para um volume montado na VPS (E12 aprova o volume). */
export class LocalDiskStorage implements FileStorage {
  readonly driver = 'disk' as const;
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private path(key: string) {
    assertSafeKey(key);
    const full = resolve(this.root, ...key.split('/'));
    // Segunda barreira: o caminho final precisa ficar dentro da raiz.
    if (!full.startsWith(this.root + sep)) throw new Error('Chave de arquivo inválida.');
    return full;
  }

  async put(key: string, bytes: Uint8Array) {
    const file = this.path(key);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, bytes);
  }
  async get(key: string) {
    try {
      return new Uint8Array(await readFile(this.path(key)));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }
  async delete(key: string) {
    await rm(this.path(key), { force: true });
  }
}

export interface S3Options {
  /** Ex.: https://s3.us-east-1.amazonaws.com ou o endereço do MinIO/R2/Backblaze. */
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Endereço /bucket/chave (MinIO e similares) em vez de bucket.host/chave. */
  pathStyle?: boolean;
}

const sha256Hex = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string) =>
  createHmac('sha256', key).update(data).digest();

/**
 * Compatível com S3 (AWS, MinIO, R2, Backblaze…): PUT, GET e DELETE de objeto com assinatura
 * AWS Signature V4, sem SDK. Os segredos vêm do ambiente e nunca vão para log ou erro.
 */
export class S3Storage implements FileStorage {
  readonly driver = 's3' as const;

  constructor(
    private readonly options: S3Options,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private url(key: string) {
    assertSafeKey(key);
    const base = new URL(this.options.endpoint);
    if (this.options.pathStyle ?? true) {
      base.pathname = `/${this.options.bucket}/${key}`;
    } else {
      base.hostname = `${this.options.bucket}.${base.hostname}`;
      base.pathname = `/${key}`;
    }
    return base;
  }

  /** Cabeçalhos assinados (SigV4) para o pedido. Exposto para teste. */
  sign(method: string, url: URL, body: Uint8Array | null, contentType?: string) {
    const at = this.now();
    const amzDate = at
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '');
    const day = amzDate.slice(0, 8);
    const payloadHash = sha256Hex(body ?? '');
    const headers: Record<string, string> = {
      host: url.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    };
    if (contentType) headers['content-type'] = contentType;
    const names = Object.keys(headers).sort();
    const canonicalHeaders = names.map((n) => `${n}:${headers[n]}\n`).join('');
    const signedHeaders = names.join(';');
    const canonical = [method, url.pathname, '', canonicalHeaders, signedHeaders, payloadHash].join(
      '\n',
    );
    const scope = `${day}/${this.options.region}/s3/aws4_request`;
    const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonical)].join('\n');
    const kDate = hmac(`AWS4${this.options.secretAccessKey}`, day);
    const kRegion = hmac(kDate, this.options.region);
    const kService = hmac(kRegion, 's3');
    const signature = createHmac('sha256', hmac(kService, 'aws4_request'))
      .update(toSign)
      .digest('hex');
    const { host: _host, ...send } = headers;
    return {
      ...send,
      authorization: `AWS4-HMAC-SHA256 Credential=${this.options.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    };
  }

  private async request(method: string, key: string, body: Uint8Array | null, type?: string) {
    const url = this.url(key);
    const init: RequestInit = {
      method,
      headers: this.sign(method, url, body, type),
      signal: AbortSignal.timeout(30_000),
    };
    if (body) init.body = body as never;
    return this.fetchFn(url, init);
  }

  async put(key: string, bytes: Uint8Array, contentType: string) {
    const r = await this.request('PUT', key, bytes, contentType);
    // O corpo do erro não vai para a mensagem: pode ecoar a chave de acesso.
    if (!r.ok) throw new Error(`O armazenamento de arquivos respondeu ${r.status}.`);
  }
  async get(key: string) {
    const r = await this.request('GET', key, null);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`O armazenamento de arquivos respondeu ${r.status}.`);
    return new Uint8Array(await r.arrayBuffer());
  }
  async delete(key: string) {
    const r = await this.request('DELETE', key, null);
    if (!r.ok && r.status !== 404) {
      throw new Error(`O armazenamento de arquivos respondeu ${r.status}.`);
    }
  }
}

/** Monta o driver da configuração; null quando as fotos ficam no banco (padrão). */
export function createStorage(config: {
  STORAGE_DRIVER: 'db' | 'disk' | 's3';
  STORAGE_DIR: string;
  S3_ENDPOINT?: string | undefined;
  S3_BUCKET?: string | undefined;
  S3_REGION: string;
  S3_ACCESS_KEY_ID?: string | undefined;
  S3_SECRET_ACCESS_KEY?: string | undefined;
  S3_PATH_STYLE: boolean;
}): FileStorage | null {
  if (config.STORAGE_DRIVER === 'disk') return new LocalDiskStorage(config.STORAGE_DIR);
  if (config.STORAGE_DRIVER === 's3') {
    const { S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = config;
    if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
      throw new Error(
        'Falta configurar o armazenamento S3: defina S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID e S3_SECRET_ACCESS_KEY.',
      );
    }
    return new S3Storage({
      endpoint: S3_ENDPOINT,
      bucket: S3_BUCKET,
      region: config.S3_REGION,
      accessKeyId: S3_ACCESS_KEY_ID,
      secretAccessKey: S3_SECRET_ACCESS_KEY,
      pathStyle: config.S3_PATH_STYLE,
    });
  }
  return null;
}
