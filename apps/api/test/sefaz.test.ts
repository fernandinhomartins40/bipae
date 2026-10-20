import { createServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import type { TLSSocket } from 'node:tls';
import { buildNfce, calculateIcms, signNfe, statusRequest } from '@bipae/fiscal';
import forge from 'node-forge';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/db/client';
import { CertificatesService } from '../src/modules/fiscal/certificates.service';
import { SefazService } from '../src/modules/fiscal/sefaz.service';
import { HttpsSefazTransport, SefazUnavailableError } from '../src/modules/fiscal/sefaz.transport';
import { api, createTestApp, signup, type TestApp } from './helpers';
import { cadastroResponse } from './support/sefaz-simulator';

/**
 * F3-11.a: conversa com a SEFAZ. Os testes usam uma SEFAZ simulada (HTTPS que exige o
 * certificado do cliente, como a de verdade). Certificados gerados na hora, nunca versionados.
 */
const DIA = 86_400_000;
const SENHA = 'senha-de-teste-forte';

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

// AC de teste e o certificado do servidor simulado.
const ac = certificate('AC SEFAZ SIMULADA', null, null);
const servidor = certificate('127.0.0.1', ac.cert, ac.keys.privateKey);
const acPem = forge.pki.certificateToPem(ac.cert);

// Certificado A1 da empresa.
const empresaKeys = forge.pki.rsa.generateKeyPair(2048);
const empresaCert = (() => {
  const cert = forge.pki.createCertificate();
  cert.publicKey = empresaKeys.publicKey;
  cert.serialNumber = '02';
  cert.validity.notBefore = new Date(Date.now() - DIA);
  cert.validity.notAfter = new Date(Date.now() + 365 * DIA);
  cert.setSubject([{ name: 'commonName', value: 'MERCADINHO TESTE:11222333000181' }]);
  cert.setIssuer([{ name: 'commonName', value: 'MERCADINHO TESTE:11222333000181' }]);
  cert.sign(empresaKeys.privateKey, forge.md.sha256.create());
  return cert;
})();
const pfxBase64 = Buffer.from(
  forge.asn1
    .toDer(
      forge.pkcs12.toPkcs12Asn1(empresaKeys.privateKey, [empresaCert], SENHA, {
        algorithm: '3des',
      }),
    )
    .getBytes(),
  'binary',
).toString('base64');
const empresaFingerprint = forge.md.sha1
  .create()
  .update(forge.asn1.toDer(forge.pki.certificateToAsn1(empresaCert)).getBytes())
  .digest()
  .toHex()
  .toUpperCase()
  .replace(/(..)(?!$)/g, '$1:');

// ---------------------------------------------------------------- SEFAZ simulada

interface Chamada {
  path: string;
  contentType: string;
  body: string;
  clientFingerprint: string | undefined;
}
const chamadas: Chamada[] = [];
let modo: 'normal' | 'falha-soap' | 'html' = 'normal';

const envelope = (ns: string, body: string) =>
  `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>` +
  `<nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/${ns}">${body}</nfeResultMsg></soap:Body></soap:Envelope>`;
const protNFe = (key: string) =>
  `<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><verAplic>SIMULADA</verAplic><chNFe>${key}</chNFe><dhRecbto>2026-10-13T10:00:01-03:00</dhRecbto>` +
  `<nProt>135260000999999</nProt><digVal>AAAA</digVal><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe>`;

function responder(body: string, contentType: string): { status: number; text: string } {
  if (modo === 'html') return { status: 503, text: '<html>Serviço indisponível</html>' };
  if (modo === 'falha-soap') {
    return {
      status: 500,
      text:
        '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><soap:Fault><soap:Code><soap:Value>soap:Sender</soap:Value></soap:Code>' +
        '<soap:Reason><soap:Text xml:lang="pt">Certificado digital não habilitado para a NF-e</soap:Text></soap:Reason></soap:Fault></soap:Body></soap:Envelope>',
    };
  }
  const key = /Id="NFe(\d{44})"|<chNFe>(\d{44})<\/chNFe>/.exec(body);
  const chave = key?.[1] ?? key?.[2] ?? '';
  if (contentType.includes('nfeStatusServicoNF')) {
    return {
      status: 200,
      text: envelope(
        'NFeStatusServico4',
        '<retConsStatServ versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>2</tpAmb><verAplic>SIMULADA</verAplic><cStat>107</cStat>' +
          '<xMotivo>Serviço em Operação</xMotivo><cUF>35</cUF><dhRecbto>2026-10-13T10:00:00-03:00</dhRecbto><tMed>1</tMed></retConsStatServ>',
      ),
    };
  }
  if (contentType.includes('nfeAutorizacaoLote')) {
    return {
      status: 200,
      text: envelope(
        'NFeAutorizacao4',
        `<retEnviNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>2</tpAmb><verAplic>SIMULADA</verAplic><cStat>104</cStat><xMotivo>Lote processado</xMotivo><cUF>35</cUF>${protNFe(chave)}</retEnviNFe>`,
      ),
    };
  }
  if (contentType.includes('nfeConsultaNF')) {
    return {
      status: 200,
      text: envelope(
        'NFeConsultaProtocolo4',
        `<retConsSitNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>2</tpAmb><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo><chNFe>${chave}</chNFe>${protNFe(chave)}</retConsSitNFe>`,
      ),
    };
  }
  if (contentType.includes('CadConsultaCadastro4')) {
    return { status: 200, text: cadastroResponse(body) };
  }
  return { status: 404, text: 'serviço desconhecido' };
}

let sefaz: Server;
let porta = 0;
let t: TestApp;
let service: SefazService;

beforeAll(async () => {
  sefaz = createServer(
    {
      key: forge.pki.privateKeyToPem(servidor.keys.privateKey),
      cert: forge.pki.certificateToPem(servidor.cert),
      requestCert: true,
      rejectUnauthorized: false,
    },
    (req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        const contentType = String(req.headers['content-type'] ?? '');
        const peer = (req.socket as TLSSocket).getPeerCertificate();
        chamadas.push({
          path: req.url ?? '',
          contentType,
          body,
          clientFingerprint: peer?.fingerprint,
        });
        const { status, text } = responder(body, contentType);
        res.writeHead(status, { 'Content-Type': 'application/soap+xml; charset=utf-8' }).end(text);
      });
    },
  );
  await new Promise<void>((ok) => sefaz.listen(0, '127.0.0.1', () => ok()));
  porta = (sefaz.address() as AddressInfo).port;
  t = await createTestApp();
  service = t.app.get(SefazService);
  // A SEFAZ simulada no lugar da real: mesmo caminho, outro endereço, e a AC de teste.
  Object.assign(service, {
    transport: new HttpsSefazTransport({
      ca: [acPem],
      timeoutMs: 5000,
      rewriteUrl: (url) => `https://127.0.0.1:${porta}${new URL(url).pathname}`,
    }),
  });
});
afterAll(async () => {
  await t.close();
  await new Promise((ok) => sefaz.close(ok));
});

async function empresaPronta(options: { uf?: string | null; certificado?: boolean } = {}) {
  const dono = await signup(t.app);
  const admin = api(t.app, dono.auth);
  const [empresa] = (await admin.get('/companies')).json();
  await admin.patch(`/companies/${empresa.id}`, {
    legalName: empresa.legalName,
    taxId: '11.222.333/0001-81',
    uf: options.uf === undefined ? 'SP' : options.uf,
  });
  if (options.certificado !== false) {
    const enviado = await admin.post(`/fiscal/certificates/${empresa.id}`, {
      pfxBase64,
      password: SENHA,
    });
    expect(enviado.statusCode).toBe(201);
  }
  const ctx = { tenantId: dono.me.tenant.id, userId: dono.me.user.id } as never;
  return { admin, empresa, ctx };
}

describe('SEFAZ em homologação (F3-11.a)', () => {
  it('testa a conexão com o certificado da empresa e mostra a resposta', async () => {
    modo = 'normal';
    const { admin, empresa } = await empresaPronta();
    const res = await admin.post(`/fiscal/sefaz/status/${empresa.id}`, { model: '65' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      model: '65',
      uf: 'SP',
      environment: 'homologacao',
      cStat: '107',
      xMotivo: 'Serviço em Operação',
      online: true,
      averageSeconds: 1,
    });
    const chamada = chamadas.at(-1)!;
    // Mesmo caminho do endereço oficial de homologação de SP, com o certificado da empresa.
    expect(chamada.path).toBe(new URL(statusRequest('65', 'SP').url).pathname);
    expect(chamada.contentType).toContain(
      'action="http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4/nfeStatusServicoNF"',
    );
    expect(chamada.body).toContain('<tpAmb>2</tpAmb><cUF>35</cUF>');
    expect(chamada.clientFingerprint).toBe(empresaFingerprint);

    // A contingência da UF (SP usa a SVC-AN) também pode ser testada, só na NF-e.
    const svc = await admin.post(`/fiscal/sefaz/status/${empresa.id}`, { model: '55', svc: true });
    expect(svc.json()).toMatchObject({ model: '55', uf: 'SP', svc: true, cStat: '107' });
    expect(chamadas.at(-1)!.path).toContain(new URL(statusRequest('55', 'SP', true).url).pathname);
    const nfce = await admin.post(`/fiscal/sefaz/status/${empresa.id}`, { model: '65', svc: true });
    expect(nfce.statusCode).toBe(400);
    expect(nfce.json().message).toBe('A NFC-e não é autorizada pela SVC (rejeição 783).');
  });

  it('consulta o cadastro do destinatário na SEFAZ da UF dele, com o certificado da empresa', async () => {
    modo = 'normal';
    const { admin } = await empresaPronta();
    const achou = (await admin.get('/fiscal/sefaz/cadastro?uf=PR&taxId=76.484.013/0001-45')).json();
    expect(achou).toMatchObject({ uf: 'PR', cStat: '111', found: true });
    expect(achou.entries[0]).toMatchObject({ ie: '1018008064', active: true });
    expect(chamadas.at(-1)!.path).toContain('/CadConsultaCadastro4');
    expect(chamadas.at(-1)!.body).toContain(
      '<xServ>CONS-CAD</xServ><UF>PR</UF><CNPJ>76484013000145</CNPJ>',
    );
    const nao = (await admin.get('/fiscal/sefaz/cadastro?uf=PR&taxId=42761086000115')).json();
    expect(nao).toMatchObject({ cStat: '259', found: false, entries: [] });
    const semWs = await admin.get('/fiscal/sefaz/cadastro?uf=PA&taxId=76484013000145');
    expect(semWs.statusCode).toBe(400);
    expect(semWs.json().message).toContain('A SEFAZ de PA não oferece a consulta de cadastro');
    expect((await admin.get('/fiscal/sefaz/cadastro?uf=PR')).statusCode).toBe(422);
  });

  it('envia uma NFC-e assinada, recebe o protocolo e monta o XML autorizado; consulta pela chave', async () => {
    modo = 'normal';
    const { empresa, ctx } = await empresaPronta();
    const certificates = t.app.get(CertificatesService);
    const chave = await withTenant(t.database.db, ctx, (tx) =>
      certificates.signingKey(tx, empresa.id),
    );
    const nota = buildNfce({
      issuer: {
        cnpj: '11222333000181',
        name: 'Mercadinho Bipaê LTDA',
        ie: '110042490114',
        crt: 1,
        address: {
          street: 'Rua A',
          number: '1',
          district: 'Centro',
          cityCode: '3550308',
          cityName: 'São Paulo',
          uf: 'SP',
          cep: '01001000',
        },
      },
      cUF: '35',
      series: 1,
      number: 7,
      issuedAt: '2026-10-13T10:00:00-03:00',
      numericCode: '12345678',
      items: [
        {
          code: 'A1',
          gtin: null,
          description: 'Arroz',
          ncm: '10063021',
          cfop: '5102',
          unit: 'UN',
          quantityMilli: 1000,
          unitPriceCents: 1000,
          grossCents: 1000,
          discountCents: 0,
          origin: '0',
          icms: calculateIcms({ csosn: '102' }, { baseCents: 1000 }),
        },
      ],
      payments: [{ code: '01', amountCents: 1000 }],
      appVersion: 'Bipae teste',
    });
    const assinada = await signNfe(nota.xml, chave);
    const resultado = await service.authorize(ctx, {
      companyId: empresa.id,
      model: '65',
      batchId: '1',
      signedXml: assinada,
    });
    expect(resultado.protocols[0]).toMatchObject({
      accessKey: nota.accessKey,
      outcome: 'authorized',
      number: '135260000999999',
    });
    expect(resultado.nfeProc).toContain(
      '<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe ',
    );
    expect(resultado.nfeProc).toContain('<nProt>135260000999999</nProt>');
    expect(chamadas.at(-1)!.body).toContain('<indSinc>1</indSinc>');

    const consulta = await service.consult(ctx, empresa.id, nota.accessKey);
    expect(consulta).toMatchObject({ cStat: '100', outcome: 'authorized' });
  });

  it('explica o que falta antes de chamar a SEFAZ', async () => {
    modo = 'normal';
    const semCertificado = await empresaPronta({ certificado: false });
    const r1 = await semCertificado.admin.post(
      `/fiscal/sefaz/status/${semCertificado.empresa.id}`,
      {},
    );
    expect(r1.statusCode).toBe(400);
    expect(r1.json().message).toBe('A empresa ainda não tem certificado digital A1 cadastrado.');
    const semUf = await empresaPronta({ uf: null });
    const r2 = await semUf.admin.post(`/fiscal/sefaz/status/${semUf.empresa.id}`, {});
    expect(r2.json().message).toBe('Falta configurar a UF da empresa.');
    const r3 = await semUf.admin.post(`/fiscal/sefaz/status/${semUf.empresa.id}`, { model: '99' });
    expect(r3.json().message).toBe('Escolha NF-e (55) ou NFC-e (65)');
  });

  it('SEFAZ fora do ar, falha SOAP e resposta estranha viram mensagem clara', async () => {
    const { admin, empresa } = await empresaPronta();
    modo = 'falha-soap';
    const fault = await admin.post(`/fiscal/sefaz/status/${empresa.id}`, {});
    expect(fault.statusCode).toBe(502);
    expect(fault.json().message).toBe(
      'A SEFAZ recusou a mensagem (SOAP Fault): Certificado digital não habilitado para a NF-e',
    );
    modo = 'html';
    const html = await admin.post(`/fiscal/sefaz/status/${empresa.id}`, {});
    expect(html.json().message).toMatch(/status 503 e sem mensagem SOAP\. Tente de novo/);
    modo = 'normal';
    Object.assign(service, {
      transport: new HttpsSefazTransport({
        ca: [acPem],
        timeoutMs: 2000,
        rewriteUrl: () => 'https://127.0.0.1:1/',
      }),
    });
    const fora = await admin.post(`/fiscal/sefaz/status/${empresa.id}`, {});
    expect(fora.statusCode).toBe(502);
    expect(fora.json().message).toMatch(/^Não foi possível falar com a SEFAZ/);
    Object.assign(service, {
      transport: new HttpsSefazTransport({
        ca: [acPem],
        timeoutMs: 5000,
        rewriteUrl: (url) => `https://127.0.0.1:${porta}${new URL(url).pathname}`,
      }),
    });
  });

  it('sem a AC de teste, o certificado do servidor simulado é recusado (a conexão confere a SEFAZ)', async () => {
    const padrao = new HttpsSefazTransport({
      rewriteUrl: (url) => `https://127.0.0.1:${porta}${new URL(url).pathname}`,
    });
    const credenciais = {
      key: forge.pki.privateKeyInfoToPem(
        forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(empresaKeys.privateKey)),
      ),
      cert: forge.pki.certificateToPem(empresaCert),
    };
    await expect(padrao.send(statusRequest('65', 'SP'), credenciais)).rejects.toThrow(
      SefazUnavailableError,
    );
  });
});
