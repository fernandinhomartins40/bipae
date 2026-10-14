import forge from 'node-forge';

/**
 * Leitura do certificado A1 (.pfx / .p12) no próprio aparelho, para assinar sem internet. Fica
 * num módulo separado, carregado só quando alguém instala um certificado (o node-forge é grande).
 */
export class CertificateInstallError extends Error {}

export interface ParsedPkcs12 {
  privateKeyPkcs8: Uint8Array;
  /** Certificado do titular em DER. */
  certificateDer: Uint8Array;
  subject: string;
  /** CNPJ (ou CPF) do titular, quando o certificado traz. */
  taxId: string | null;
  notBefore: Date;
  notAfter: Date;
}

// OIDs do titular nos certificados ICP-Brasil (otherName do subjectAltName).
const ICP_CNPJ_OID = '2.16.76.1.3.3';

const bytes = (binary: string) => Uint8Array.from(binary, (c) => c.charCodeAt(0));

function taxIdOf(certificate: forge.pki.Certificate, der: string): string | null {
  const oid = forge.asn1.oidToDer(ICP_CNPJ_OID).getBytes();
  const at = der.indexOf(oid);
  if (at >= 0) {
    const digits = /\d{14}/.exec(der.slice(at + oid.length, at + oid.length + 40));
    if (digits) return digits[0];
  }
  const cn = String(certificate.subject.getField('CN')?.value ?? '');
  return /:(\d{11}|\d{14})$/.exec(cn)?.[1] ?? null;
}

export function parsePkcs12(pfx: Uint8Array, password: string): ParsedPkcs12 {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const binary = Array.from(pfx, (b) => String.fromCharCode(b)).join('');
    p12 = forge.pkcs12.pkcs12FromAsn1(
      forge.asn1.fromDer(forge.util.createBuffer(binary)),
      password,
    );
  } catch (error) {
    const message = (error as Error).message ?? '';
    if (/password|MAC|Invalid/i.test(message))
      throw new CertificateInstallError('Senha do certificado incorreta.');
    throw new CertificateInstallError('O arquivo não é um certificado A1 (.pfx ou .p12).');
  }
  const oids = forge.pki.oids as Record<string, string>;
  const bags = (type: string) => p12.getBags({ bagType: type })[type] ?? [];
  const keyBag = bags(oids.pkcs8ShroudedKeyBag!)[0] ?? bags(oids.keyBag!)[0];
  const key = keyBag?.key as forge.pki.rsa.PrivateKey | undefined;
  if (!key) throw new CertificateInstallError('O arquivo não traz a chave privada do certificado.');
  // O certificado do titular é o que tem a mesma chave pública da chave privada.
  const certificate = bags(oids.certBag!)
    .map((bag: forge.pkcs12.Bag) => bag.cert)
    .find((cert: forge.pki.Certificate | undefined): cert is forge.pki.Certificate => {
      const pub = cert?.publicKey as forge.pki.rsa.PublicKey | undefined;
      return !!pub && pub.n.equals(key.n);
    });
  if (!certificate)
    throw new CertificateInstallError('O arquivo não traz o certificado do titular.');
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(certificate)).getBytes();
  const pkcs8 = forge.asn1
    .toDer(forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(key)))
    .getBytes();
  return {
    privateKeyPkcs8: bytes(pkcs8),
    certificateDer: bytes(der),
    subject: String(certificate.subject.getField('CN')?.value ?? ''),
    taxId: taxIdOf(certificate, der),
    notBefore: certificate.validity.notBefore,
    notAfter: certificate.validity.notAfter,
  };
}
