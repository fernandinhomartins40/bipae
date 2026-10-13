/**
 * Assinatura da NF-e/NFC-e (F3-09): XMLDSig envelopada sobre o elemento infNFe, como o Manual de
 * Orientação do Contribuinte exige: canonicalização C14N 1.0, transformação "enveloped-signature",
 * resumo SHA-1 e assinatura RSA-SHA1, com o certificado X.509 do emitente em KeyInfo.
 *
 * Usa só a WebCrypto padrão (servidor, navegador e desktop). O XML de entrada precisa ter saído
 * de `buildNfce`, que já gera a forma canônica; por isso a canonicalização aqui é só incluir a
 * declaração de namespace herdada, sem reinterpretar o documento.
 */
const NFE_NS = 'http://www.portalfiscal.inf.br/nfe';
const DSIG_NS = 'http://www.w3.org/2000/09/xmldsig#';
const C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';

/** Chave da WebCrypto (o tipo vem da própria API, para valer no Node e no navegador). */
export type WebCryptoKey = Parameters<typeof crypto.subtle.sign>[1];

export interface SigningKey {
  /** Chave privada RSA do certificado A1, importada para RSASSA-PKCS1-v1_5 com SHA-1. */
  privateKey: WebCryptoKey;
  /** Certificado X.509 do emitente em DER, codificado em base64 (sem cabeçalhos PEM). */
  certificate: string;
}

const encoder = new TextEncoder();

function toBase64(bytes: ArrayBuffer): string {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** O infNFe como a canonicalização o vê: com o namespace herdado do elemento NFe. */
export function canonicalInfNfe(xml: string): { canonical: string; id: string } {
  const match = /<infNFe Id="(NFe[0-9A-Z]{44})" versao="([^"]+)">[\s\S]*<\/infNFe>/.exec(xml);
  if (!match) throw new Error('XML sem o elemento infNFe no formato gerado pelo Bipaê');
  if (!xml.startsWith(`<NFe xmlns="${NFE_NS}">`))
    throw new Error('XML sem o elemento NFe com o namespace da NF-e');
  const canonical = match[0].replace('<infNFe ', `<infNFe xmlns="${NFE_NS}" `);
  return { canonical, id: match[1]! };
}

function signedInfo(id: string, digest: string, withNamespace: boolean): string {
  const ns = withNamespace ? ` xmlns="${DSIG_NS}"` : '';
  return (
    `<SignedInfo${ns}>` +
    `<CanonicalizationMethod Algorithm="${C14N}"></CanonicalizationMethod>` +
    `<SignatureMethod Algorithm="${DSIG_NS}rsa-sha1"></SignatureMethod>` +
    `<Reference URI="#${id}"><Transforms>` +
    `<Transform Algorithm="${DSIG_NS}enveloped-signature"></Transform>` +
    `<Transform Algorithm="${C14N}"></Transform>` +
    `</Transforms><DigestMethod Algorithm="${DSIG_NS}sha1"></DigestMethod>` +
    `<DigestValue>${digest}</DigestValue></Reference></SignedInfo>`
  );
}

export async function signNfe(xml: string, key: SigningKey): Promise<string> {
  if (xml.includes('<Signature')) throw new Error('Este XML já está assinado');
  if (!/^[A-Za-z0-9+/=]+$/.test(key.certificate))
    throw new Error('Certificado precisa estar em base64, sem cabeçalhos');
  const { canonical, id } = canonicalInfNfe(xml);
  const digest = toBase64(await crypto.subtle.digest('SHA-1', encoder.encode(canonical)));
  // A assinatura é sobre o SignedInfo canônico, que carrega o namespace herdado de Signature.
  const signature = toBase64(
    await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      key.privateKey,
      encoder.encode(signedInfo(id, digest, true)),
    ),
  );
  const block =
    `<Signature xmlns="${DSIG_NS}">${signedInfo(id, digest, false)}` +
    `<SignatureValue>${signature}</SignatureValue>` +
    `<KeyInfo><X509Data><X509Certificate>${key.certificate}</X509Certificate></X509Data></KeyInfo></Signature>`;
  return xml.replace(/<\/NFe>$/, `${block}</NFe>`);
}
