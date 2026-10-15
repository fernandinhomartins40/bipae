import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import forge from 'node-forge';
import { HttpsSefazTransport } from '../../src/modules/fiscal/sefaz.transport';

/**
 * SEFAZ simulada para os testes fiscais: HTTPS que pede o certificado do cliente, com respostas
 * no formato do MOC. Certificados gerados na hora, nunca versionados (regra 10 do projeto).
 */
const DIA = 86_400_000;
export const SENHA_A1 = 'senha-de-teste-forte';

function certificate(
  subject: string,
  issuer: forge.pki.Certificate | null,
  issuerKey: forge.pki.rsa.PrivateKey | null,
) {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = String(Math.floor(Math.random() * 1e9));
  cert.validity.notBefore = new Date(Date.now() - DIA);
  cert.validity.notAfter = new Date(Date.now() + 365 * DIA);
  cert.setSubject([{ name: 'commonName', value: subject }]);
  cert.setIssuer(issuer ? issuer.subject.attributes : [{ name: 'commonName', value: subject }]);
  if (!issuer)
    cert.setExtensions([
      { name: 'basicConstraints', cA: true },
      { name: 'keyUsage', keyCertSign: true, digitalSignature: true },
    ]);
  else cert.setExtensions([{ name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }] }]);
  cert.sign(issuerKey ?? keys.privateKey, forge.md.sha256.create());
  return { cert, keys };
}

/** Certificado A1 de teste da empresa, em .pfx (base64), como o assistente recebe. */
export function testPfx(subject = 'MERCADINHO TESTE:11222333000181') {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '02';
  cert.validity.notBefore = new Date(Date.now() - DIA);
  cert.validity.notAfter = new Date(Date.now() + 365 * DIA);
  cert.setSubject([{ name: 'commonName', value: subject }]);
  cert.setIssuer([{ name: 'commonName', value: subject }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const der = forge.asn1
    .toDer(forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], SENHA_A1, { algorithm: '3des' }))
    .getBytes();
  return Buffer.from(der, 'binary').toString('base64');
}

/** perde: a SEFAZ autoriza, mas a resposta não chega (rede caiu no meio). */
export type SefazMode = 'normal' | 'rejeita' | 'fora' | 'perde';

export interface SefazCall {
  service: 'status' | 'autorizacao' | 'consulta' | 'outro';
  body: string;
}

const envelope = (ns: string, body: string) =>
  `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>` +
  `<nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/${ns}">${body}</nfeResultMsg></soap:Body></soap:Envelope>`;
const protNFe = (key: string, cStat = '100', xMotivo = 'Autorizado o uso da NF-e') =>
  `<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><verAplic>SIMULADA</verAplic><chNFe>${key}</chNFe><dhRecbto>2026-10-15T10:00:01-03:00</dhRecbto>` +
  (cStat === '100' ? `<nProt>135260000999999</nProt><digVal>AAAA</digVal>` : '') +
  `<cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo></infProt></protNFe>`;

export class SefazSimulator {
  mode: SefazMode = 'normal';
  /** Chaves que a SEFAZ já autorizou (a consulta responde por elas). */
  readonly authorized = new Set<string>();
  readonly calls: SefazCall[] = [];
  private server: Server | null = null;
  private readonly ac = certificate('AC SEFAZ SIMULADA', null, null);
  private readonly tls = certificate('127.0.0.1', this.ac.cert, this.ac.keys.privateKey);

  async start() {
    this.server = createServer(
      {
        key: forge.pki.privateKeyToPem(this.tls.keys.privateKey),
        cert: forge.pki.certificateToPem(this.tls.cert),
        requestCert: true,
        rejectUnauthorized: false,
      },
      (req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          const { status, text } = this.respond(body, String(req.headers['content-type'] ?? ''));
          res
            .writeHead(status, { 'Content-Type': 'application/soap+xml; charset=utf-8' })
            .end(text);
        });
      },
    );
    await new Promise<void>((ok) => this.server!.listen(0, '127.0.0.1', () => ok()));
  }

  /** Transporte que leva as chamadas da API para esta SEFAZ, mantendo o caminho oficial. */
  transport() {
    const port = (this.server!.address() as AddressInfo).port;
    return new HttpsSefazTransport({
      ca: [forge.pki.certificateToPem(this.ac.cert)],
      timeoutMs: 5000,
      rewriteUrl: (url) => `https://127.0.0.1:${port}${new URL(url).pathname}`,
    });
  }

  async stop() {
    await new Promise((ok) => this.server?.close(ok));
  }

  private respond(body: string, contentType: string): { status: number; text: string } {
    const key = /Id="NFe(\d{44})"|<chNFe>(\d{44})<\/chNFe>/.exec(body);
    const chave = key?.[1] ?? key?.[2] ?? '';
    const service = contentType.includes('nfeStatusServicoNF')
      ? 'status'
      : contentType.includes('nfeAutorizacaoLote')
        ? 'autorizacao'
        : contentType.includes('nfeConsultaNF')
          ? 'consulta'
          : 'outro';
    this.calls.push({ service, body });
    if (this.mode === 'perde' && service === 'autorizacao') this.authorized.add(chave);
    if (this.mode === 'fora' || this.mode === 'perde') {
      return { status: 503, text: '<html>Serviço indisponível</html>' };
    }
    if (service === 'status') {
      return {
        status: 200,
        text: envelope(
          'NFeStatusServico4',
          '<retConsStatServ versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>2</tpAmb><verAplic>SIMULADA</verAplic><cStat>107</cStat>' +
            '<xMotivo>Serviço em Operação</xMotivo><cUF>35</cUF><dhRecbto>2026-10-15T10:00:00-03:00</dhRecbto><tMed>1</tMed></retConsStatServ>',
        ),
      };
    }
    if (service === 'autorizacao') {
      const prot =
        this.mode === 'rejeita'
          ? protNFe(chave, '225', 'Rejeição: Falha no Schema XML da NFe')
          : protNFe(chave);
      if (this.mode === 'normal') this.authorized.add(chave);
      return {
        status: 200,
        text: envelope(
          'NFeAutorizacao4',
          `<retEnviNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>2</tpAmb><verAplic>SIMULADA</verAplic><cStat>104</cStat><xMotivo>Lote processado</xMotivo><cUF>35</cUF>${prot}</retEnviNFe>`,
        ),
      };
    }
    if (service === 'consulta') {
      const known = this.authorized.has(chave);
      return {
        status: 200,
        text: envelope(
          'NFeConsultaProtocolo4',
          known
            ? `<retConsSitNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>2</tpAmb><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo><chNFe>${chave}</chNFe>${protNFe(chave)}</retConsSitNFe>`
            : `<retConsSitNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>2</tpAmb><cStat>217</cStat><xMotivo>Rejeição: NF-e não consta na base de dados da SEFAZ</xMotivo><chNFe>${chave}</chNFe></retConsSitNFe>`,
        ),
      };
    }
    return { status: 404, text: 'serviço desconhecido' };
  }
}
