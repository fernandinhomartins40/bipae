import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { uuidv7, type CertificateStatus, type certificateUploadInput } from '@bipae/domain';
import type { WebCryptoKey } from '@bipae/fiscal';
import { eq } from 'drizzle-orm';
import forge from 'node-forge';
import type { z } from 'zod';
import type { Config } from '../../config';
import type { RequestContext } from '../../common/auth';
import { CONFIG, DB } from '../../common/di';
import { AppError, notFound } from '../../common/errors';
import { SecretBox } from '../../common/secrets';
import { withTenant, type Db, type Tx } from '../../db/client';
import { companies, companyCertificates } from '../../db/schema';
import { AuditService } from '../audit/audit.service';

/** Avisa o vencimento com esta antecedência. */
const WARN_DAYS = 30;
const DAY_MS = 86_400_000;
// OID do CNPJ do titular no certificado ICP-Brasil (subjectAltName, otherName).
const ICP_CNPJ_OID = '2.16.76.1.3.3';

interface ParsedCertificate {
  privateKeyPkcs8: Uint8Array;
  certificateDer: string;
  subject: string;
  cnpj: string | null;
  serial: string;
  fingerprint: string;
  notBefore: Date;
  notAfter: Date;
}

const invalid = (message: string) => new AppError(400, 'validation', message, [{ path: 'pfx', message }]);
const brDate = (date: Date) => date.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

/** Lê o .pfx (PKCS#12) e devolve chave, certificado e dados do titular. */
export function parsePfx(pfx: Buffer, password: string): ParsedCertificate {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(forge.util.createBuffer(pfx.toString('binary'))), password);
  } catch (error) {
    const message = (error as Error).message ?? '';
    if (/password|MAC|Invalid/i.test(message)) throw invalid('Senha do certificado incorreta.');
    throw invalid('O arquivo não é um certificado A1 (.pfx ou .p12).');
  }
  const oids = forge.pki.oids as Record<string, string>;
  const bags = (type: string) => p12.getBags({ bagType: type })[type] ?? [];
  const keyBag = bags(oids.pkcs8ShroudedKeyBag!)[0] ?? bags(oids.keyBag!)[0];
  const key = keyBag?.key as forge.pki.rsa.PrivateKey | undefined;
  if (!key) throw invalid('O arquivo não traz a chave privada do certificado.');
  // O certificado do titular é o que tem a mesma chave pública da chave privada.
  const certificate = bags(oids.certBag!)
    .map((bag: forge.pkcs12.Bag) => bag.cert)
    .find((cert: forge.pki.Certificate | undefined): cert is forge.pki.Certificate => {
      const pub = cert?.publicKey as forge.pki.rsa.PublicKey | undefined;
      return !!pub && pub.n.equals(key.n);
    });
  if (!certificate) throw invalid('O arquivo não traz o certificado do titular.');

  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(certificate)).getBytes();
  const pkcs8 = forge.asn1.toDer(forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(key))).getBytes();
  const cn = String(certificate.subject.getField('CN')?.value ?? '');
  return {
    privateKeyPkcs8: Uint8Array.from(Buffer.from(pkcs8, 'binary')),
    certificateDer: Buffer.from(der, 'binary').toString('base64'),
    subject: cn,
    cnpj: cnpjOf(certificate, der),
    serial: certificate.serialNumber,
    fingerprint: createHash('sha256').update(Buffer.from(der, 'binary')).digest('hex'),
    notBefore: certificate.validity.notBefore,
    notAfter: certificate.validity.notAfter,
  };
}

/** CNPJ do titular: no otherName ICP-Brasil do subjectAltName, ou no fim do CN ("EMPRESA:CNPJ"). */
function cnpjOf(certificate: forge.pki.Certificate, der: string): string | null {
  const oid = forge.asn1.oidToDer(ICP_CNPJ_OID).getBytes();
  const at = der.indexOf(oid);
  if (at >= 0) {
    const digits = /\d{14}/.exec(der.slice(at + oid.length, at + oid.length + 40));
    if (digits) return digits[0];
  }
  const cn = String(certificate.subject.getField('CN')?.value ?? '');
  return /:(\d{14})$/.exec(cn)?.[1] ?? null;
}

/**
 * Certificado digital A1 da empresa (F3-10). O .pfx e a senha ficam cifrados com a chave do
 * servidor; a API nunca devolve nenhum dos dois. Enviar e remover certificado é ação sensível e
 * fica na trilha de auditoria.
 */
@Injectable()
export class CertificatesService {
  private readonly box: SecretBox;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) config: Config,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {
    this.box = new SecretBox(config.SECRETS_KEY ?? config.JWT_SECRET);
  }

  list(ctx: RequestContext, now = new Date()): Promise<CertificateStatus[]> {
    return withTenant(this.db, ctx, async (tx) => {
      const rows = await tx.select().from(companyCertificates);
      return rows.map((row) => {
        const daysLeft = Math.floor((row.notAfter.getTime() - now.getTime()) / DAY_MS);
        return {
          companyId: row.companyId,
          subject: row.subject,
          cnpj: row.cnpj,
          notAfter: row.notAfter.toISOString(),
          daysLeft,
          status: daysLeft < 0 ? 'vencido' : daysLeft <= WARN_DAYS ? 'vencendo' : 'valido',
        };
      });
    });
  }

  upload(ctx: RequestContext, companyId: string, input: z.output<typeof certificateUploadInput>, now = new Date()) {
    const parsed = parsePfx(Buffer.from(input.pfxBase64, 'base64'), input.password);
    if (parsed.notAfter <= now) throw invalid(`Este certificado venceu em ${brDate(parsed.notAfter)}. Envie um certificado válido.`);
    if (parsed.notBefore > now) throw invalid(`Este certificado só vale a partir de ${brDate(parsed.notBefore)}.`);
    return withTenant(this.db, ctx, async (tx) => {
      const [company] = await tx.select({ taxId: companies.taxId }).from(companies).where(eq(companies.id, companyId));
      if (!company) throw notFound('Empresa');
      if (!company.taxId) throw invalid('Informe o CNPJ da empresa antes de enviar o certificado.');
      if (!parsed.cnpj) throw invalid('Não foi possível ler o CNPJ deste certificado. Ele precisa ser um e-CNPJ A1.');
      // Matriz e filial têm a mesma raiz de CNPJ e podem usar o mesmo certificado.
      if (parsed.cnpj.slice(0, 8) !== company.taxId.slice(0, 8)) {
        throw invalid(`O certificado é do CNPJ ${parsed.cnpj}, que não é desta empresa (${company.taxId}).`);
      }
      const values = {
        sealedPfx: this.box.seal(input.pfxBase64),
        sealedPassword: this.box.seal(input.password),
        subject: parsed.subject,
        cnpj: parsed.cnpj,
        serial: parsed.serial,
        fingerprint: parsed.fingerprint,
        notBefore: parsed.notBefore,
        notAfter: parsed.notAfter,
        createdBy: ctx.userId,
      };
      await tx.delete(companyCertificates).where(eq(companyCertificates.companyId, companyId));
      await tx.insert(companyCertificates).values({ id: uuidv7(), tenantId: ctx.tenantId, companyId, ...values });
      await this.audit.record(tx, ctx, {
        action: 'certificate.uploaded',
        entity: 'company',
        entityId: companyId,
        // Nada de segredo na trilha: só quem é o titular e até quando vale.
        data: { subject: parsed.subject, cnpj: parsed.cnpj, notAfter: parsed.notAfter.toISOString(), fingerprint: parsed.fingerprint },
      });
      return { subject: parsed.subject, cnpj: parsed.cnpj, notAfter: parsed.notAfter.toISOString() };
    });
  }

  remove(ctx: RequestContext, companyId: string) {
    return withTenant(this.db, ctx, async (tx) => {
      const deleted = await tx
        .delete(companyCertificates)
        .where(eq(companyCertificates.companyId, companyId))
        .returning({ subject: companyCertificates.subject });
      if (deleted.length === 0) throw notFound('Certificado');
      await this.audit.record(tx, ctx, {
        action: 'certificate.removed',
        entity: 'company',
        entityId: companyId,
        data: { subject: deleted[0]!.subject },
      });
      return { ok: true };
    });
  }

  /** Chave e certificado para assinar as notas da empresa (F3-11). Só uso interno do servidor. */
  async signingKey(tx: Tx, companyId: string): Promise<{ privateKey: WebCryptoKey; certificate: string; notAfter: Date }> {
    const [row] = await tx.select().from(companyCertificates).where(eq(companyCertificates.companyId, companyId));
    if (!row) throw new AppError(400, 'no_certificate', 'A empresa ainda não tem certificado digital A1 cadastrado.');
    if (row.notAfter <= new Date()) throw new AppError(400, 'certificate_expired', 'O certificado digital da empresa venceu.');
    const parsed = parsePfx(Buffer.from(this.box.open(row.sealedPfx), 'base64'), this.box.open(row.sealedPassword));
    const privateKey = await crypto.subtle.importKey(
      'pkcs8',
      parsed.privateKeyPkcs8,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-1' },
      false,
      ['sign'],
    );
    return { privateKey, certificate: parsed.certificateDer, notAfter: row.notAfter };
  }

  /**
   * Chave e certificado em PEM para a conexão com a SEFAZ (autenticação mútua). Convertidos aqui,
   * e não com o .pfx direto, porque muitos A1 usam cifras antigas que o OpenSSL 3 recusa.
   */
  async tlsCredentials(tx: Tx, companyId: string): Promise<{ key: string; cert: string }> {
    const [row] = await tx.select().from(companyCertificates).where(eq(companyCertificates.companyId, companyId));
    if (!row) throw new AppError(400, 'no_certificate', 'A empresa ainda não tem certificado digital A1 cadastrado.');
    if (row.notAfter <= new Date()) throw new AppError(400, 'certificate_expired', 'O certificado digital da empresa venceu.');
    const parsed = parsePfx(Buffer.from(this.box.open(row.sealedPfx), 'base64'), this.box.open(row.sealedPassword));
    const pem = (label: string, der: Buffer) =>
      `-----BEGIN ${label}-----\n${der.toString('base64').replace(/.{64}/g, '$&\n').replace(/\n$/, '')}\n-----END ${label}-----\n`;
    return {
      key: pem('PRIVATE KEY', Buffer.from(parsed.privateKeyPkcs8)),
      cert: pem('CERTIFICATE', Buffer.from(parsed.certificateDer, 'base64')),
    };
  }
}
