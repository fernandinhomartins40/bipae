import { DOMParser } from '@xmldom/xmldom';
import { buildNfce, calculateIcms, signNfe } from '@bipae/fiscal';
import { sql } from 'drizzle-orm';
import forge from 'node-forge';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignedXml } from 'xml-crypto';
import { withTenant } from '../src/db/client';
import { rowsOf } from '../src/db/migrate';
import { CertificatesService } from '../src/modules/fiscal/certificates.service';
import { api, createTestApp, signup, type TestApp } from './helpers';

/**
 * F3-10: certificado A1. O certificado de teste é gerado na hora: nunca há certificado nem senha
 * versionados no repositório (regra 10 do CLAUDE.md).
 */
let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

const keys = forge.pki.rsa.generateKeyPair(2048);
const DIA = 86_400_000;

function makePfx(options: { cnpj: string; password: string; from?: Date; to?: Date; icp?: boolean }) {
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = options.from ?? new Date(Date.now() - DIA);
  cert.validity.notAfter = options.to ?? new Date(Date.now() + 365 * DIA);
  // Com icp, o CNPJ vai no otherName ICP-Brasil; sem, só no fim do CN ("EMPRESA:CNPJ").
  const cn = options.icp ? 'MERCADINHO TESTE' : `MERCADINHO TESTE:${options.cnpj}`;
  cert.setSubject([{ name: 'commonName', value: cn }]);
  cert.setIssuer([{ name: 'commonName', value: cn }]);
  if (options.icp) {
    const { asn1 } = forge;
    const otherName = asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OID, false, asn1.oidToDer('2.16.76.1.3.3').getBytes()),
      asn1.create(asn1.Class.CONTEXT_SPECIFIC, 0, true, [
        asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, options.cnpj),
      ]),
    ]);
    const altNames = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [otherName]);
    cert.setExtensions([{ name: 'subjectAltName', value: asn1.toDer(altNames).getBytes() }]);
  }
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], options.password, { algorithm: '3des' });
  return Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary').toString('base64');
}

const SENHA = 'senha-de-teste-forte';

describe('certificado digital A1 (F3-10)', () => {
  it('envia, guarda cifrado, mostra o vencimento e assina uma nota que confere', async () => {
    const dono = await signup(t.app);
    const admin = api(t.app, dono.auth);
    const [empresa] = (await admin.get('/companies')).json();
    const pfx = makePfx({ cnpj: '11222333000181', password: SENHA, icp: true });

    // Sem CNPJ na empresa, o certificado não tem com quem conferir.
    const semCnpj = await admin.post(`/fiscal/certificates/${empresa.id}`, { pfxBase64: pfx, password: SENHA });
    expect(semCnpj.json().message).toBe('Informe o CNPJ da empresa antes de enviar o certificado.');
    await admin.patch(`/companies/${empresa.id}`, { legalName: empresa.legalName, taxId: '11.222.333/0001-81' });

    const enviado = await admin.post(`/fiscal/certificates/${empresa.id}`, { pfxBase64: pfx, password: SENHA });
    expect(enviado.statusCode).toBe(201);
    expect(enviado.json()).toMatchObject({ cnpj: '11222333000181', subject: 'MERCADINHO TESTE' });

    const [situacao] = (await admin.get('/fiscal/certificates')).json();
    expect(situacao).toMatchObject({ companyId: empresa.id, status: 'valido' });
    expect(situacao.daysLeft).toBeGreaterThan(300);
    expect(JSON.stringify(situacao)).not.toMatch(/sealed|pfx|password/i);

    // No banco, nem o arquivo nem a senha aparecem em texto puro.
    // Lido como a própria empresa: a equipe Bipaê (papel da plataforma) nem tem acesso a esta tabela.
    const doCliente = { tenantId: dono.me.tenant.id, userId: dono.me.user.id } as never;
    const [linha] = await withTenant(t.database.db, doCliente, async (tx) =>
      rowsOf<{ sealed_pfx: string; sealed_password: string }>(
        await tx.execute(
          sql`select sealed_pfx, sealed_password from company_certificates where company_id = ${empresa.id}`,
        ),
      ),
    );
    expect(linha!.sealed_pfx.startsWith('v1.')).toBe(true);
    expect(linha!.sealed_pfx).not.toContain(pfx.slice(0, 40));
    expect(linha!.sealed_password).not.toContain(SENHA);

    // Auditoria sem segredo.
    const trilha = (await admin.get('/audit')).json().items as { action: string; data: unknown }[];
    const evento = trilha.find((e) => e.action === 'certificate.uploaded')!;
    expect(JSON.stringify(evento.data)).not.toContain(SENHA);

    // O servidor abre o certificado e assina; a assinatura confere com o certificado do KeyInfo.
    const service = t.app.get(CertificatesService);
    const contexto = { tenantId: dono.me.tenant.id, userId: dono.me.user.id } as never;
    const chave = await withTenant(t.database.db, contexto, (tx) => service.signingKey(tx, empresa.id));
    const nota = buildNfce({
      issuer: {
        cnpj: '11222333000181',
        name: 'Mercadinho',
        ie: '110042490114',
        crt: 1,
        address: { street: 'Rua A', number: '1', district: 'Centro', cityCode: '3550308', cityName: 'São Paulo', uf: 'SP', cep: '01001000' },
      },
      cUF: '35',
      series: 1,
      number: 1,
      issuedAt: '2026-06-15T10:00:00-03:00',
      numericCode: '13572468',
      items: [
        {
          code: '1',
          gtin: null,
          description: 'Pão',
          ncm: '19059090',
          cfop: '5102',
          unit: 'UN',
          quantityMilli: 1000,
          unitPriceCents: 500,
          grossCents: 500,
          discountCents: 0,
          origin: '0',
          icms: calculateIcms({ csosn: '102' }, { baseCents: 500 }),
        },
      ],
      payments: [{ code: '01', amountCents: 500 }],
      appVersion: 'Bipae teste',
    });
    const xml = await signNfe(nota.xml, chave);
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const verificador = new SignedXml({ getCertFromKeyInfo: SignedXml.getCertFromKeyInfo });
    verificador.loadSignature(
      doc.getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#', 'Signature')[0] as never,
    );
    expect(verificador.checkSignature(xml)).toBe(true);

    expect((await admin.delete(`/fiscal/certificates/${empresa.id}`)).statusCode).toBe(200);
    expect((await admin.get('/fiscal/certificates')).json()).toEqual([]);
  });

  it('explica cada problema com o arquivo', async () => {
    const dono = await signup(t.app);
    const admin = api(t.app, dono.auth);
    const [empresa] = (await admin.get('/companies')).json();
    await admin.patch(`/companies/${empresa.id}`, { legalName: empresa.legalName, taxId: '11.222.333/0001-81' });
    const enviar = (pfxBase64: string, password: string) =>
      admin.post(`/fiscal/certificates/${empresa.id}`, { pfxBase64, password });

    const valido = makePfx({ cnpj: '11222333000181', password: 'certa' });
    expect((await enviar(valido, 'errada')).json().message).toBe('Senha do certificado incorreta.');
    const lixo = Buffer.from('isto nao e um certificado '.repeat(20)).toString('base64');
    expect((await enviar(lixo, 'x')).json().message).toBe('O arquivo não é um certificado A1 (.pfx ou .p12).');
    const vencido = makePfx({ cnpj: '11222333000181', password: 'p', from: new Date('2020-01-01T12:00:00Z'), to: new Date('2021-01-01T12:00:00Z') });
    expect((await enviar(vencido, 'p')).json().message).toBe(
      'Este certificado venceu em 01/01/2021. Envie um certificado válido.',
    );
    const outro = makePfx({ cnpj: '99888777000166', password: 'p' });
    expect((await enviar(outro, 'p')).json().message).toBe(
      'O certificado é do CNPJ 99888777000166, que não é desta empresa (11222333000181).',
    );
    // Filial da mesma raiz de CNPJ pode usar o certificado da matriz.
    expect((await enviar(makePfx({ cnpj: '11222333000262', password: 'p' }), 'p')).statusCode).toBe(201);
    // Vencendo em menos de 30 dias aparece como tal (e o novo substitui o anterior).
    const curto = makePfx({ cnpj: '11222333000181', password: 'p', to: new Date(Date.now() + 10 * DIA) });
    expect((await enviar(curto, 'p')).statusCode).toBe(201);
    const lista = (await admin.get('/fiscal/certificates')).json();
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ status: 'vencendo' });
  });
});
