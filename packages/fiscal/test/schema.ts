import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateXML } from 'xmllint-wasm';

/**
 * Apoio dos testes: valida o XML da NF-e e da NFC-e contra os schemas oficiais (pacote PL_010f
 * do Portal Nacional, guardado em sources/, o mesmo que gera as tabelas).
 */
const schemas = await (async () => {
  const { unzip } = await import('../scripts/xlsx.mjs');
  const zip = readFileSync(fileURLToPath(new URL('../sources/PL_010f_v1.04.zip', import.meta.url)));
  return [...unzip(zip)]
    .filter(([name]) => name.endsWith('.xsd'))
    .map(([name, body]) => ({ fileName: name.split('/').pop()!, contents: body.toString('utf8') }));
})();
export const nfeSchema = schemas.find((s) => s.fileName === 'nfe_v4.00.xsd')!;
export const preload = schemas.filter((s) => s !== nfeSchema);

/**
 * Para validar a estrutura sem certificado, entra um bloco de assinatura no formato do schema,
 * com valores fictícios: ele nunca vai para a SEFAZ.
 */
const FAKE_SIGNATURE =
  '<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo>' +
  '<CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>' +
  '<SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/>' +
  '<Reference URI="#NFe0"><Transforms>' +
  '<Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/>' +
  '<Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/></Transforms>' +
  '<DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"/><DigestValue>AAAA</DigestValue>' +
  '</Reference></SignedInfo><SignatureValue>AAAA</SignatureValue>' +
  '<KeyInfo><X509Data><X509Certificate>AAAA</X509Certificate></X509Data></KeyInfo></Signature>';

/** Erros do schema (lista vazia = válido). O XML assinado de verdade passa por `validateSigned`. */
export async function validateNfeXml(xml: string): Promise<string[]> {
  return validateSigned(xml.replace('</NFe>', `${FAKE_SIGNATURE}</NFe>`));
}

export async function validateSigned(xml: string): Promise<string[]> {
  const result = await validateXML({
    xml: [{ fileName: 'nfe.xml', contents: xml }],
    schema: [nfeSchema],
    preload,
  });
  return result.errors.map((e) => e.message);
}

/**
 * Schemas dos webservices (pacote 9q): as mensagens de serviço (enviNFe, consStatServ...) com o
 * leiaute da nota do PL_010f, que é o vigente.
 */
const serviceSchemas = await (async () => {
  const { unzip } = await import('../scripts/xlsx.mjs');
  const zip = readFileSync(
    fileURLToPath(new URL('../sources/PL_009q_servicos_2025-05-19.zip', import.meta.url)),
  );
  const fromNfePackage = new Set(schemas.map((s) => s.fileName));
  return [
    ...schemas,
    ...[...unzip(zip)]
      .filter(([name]) => name.endsWith('.xsd'))
      .map(([name, body]) => ({
        fileName: name.split('/').pop()!,
        contents: body.toString('utf8'),
      }))
      .filter((s) => !fromNfePackage.has(s.fileName)),
  ];
})();

/** Valida uma mensagem de serviço contra o schema indicado (ex.: "enviNFe_v4.00.xsd"). */
export async function validateServiceXml(xml: string, schemaFile: string): Promise<string[]> {
  const schema = serviceSchemas.find((s) => s.fileName === schemaFile);
  if (!schema) throw new Error(`Schema não encontrado: ${schemaFile}`);
  const result = await validateXML({
    xml: [{ fileName: 'mensagem.xml', contents: xml }],
    schema: [schema],
    preload: serviceSchemas.filter((s) => s !== schema),
  });
  return result.errors.map((e) => e.message);
}

/**
 * Valida contra o schema de um pacote de eventos guardado em sources (ex.: Evento_Canc), com os
 * outros schemas do mesmo pacote (F3-17).
 */
export async function validatePackageXml(
  xml: string,
  zipFile: string,
  schemaFile: string,
): Promise<string[]> {
  const { unzip } = await import('../scripts/xlsx.mjs');
  const zip = readFileSync(fileURLToPath(new URL(`../sources/${zipFile}`, import.meta.url)));
  const all = [...unzip(zip)]
    .filter(([name]) => name.endsWith('.xsd'))
    .map(([name, body]) => ({ fileName: name.split('/').pop()!, contents: body.toString('utf8') }));
  const schema = all.find((s) => s.fileName === schemaFile);
  if (!schema) throw new Error(`Schema não encontrado: ${schemaFile}`);
  const result = await validateXML({
    xml: [{ fileName: 'evento.xml', contents: xml }],
    schema: [schema],
    preload: all.filter((s) => s !== schema),
  });
  return result.errors.map((e) => e.message);
}
