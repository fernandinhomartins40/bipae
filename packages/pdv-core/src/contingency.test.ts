import { uuidv7, type FiscalSnapshot } from '@bipae/domain';
import type { NfeSigner } from '@bipae/fiscal';
import { createStorage, migrateLocal } from '@bipae/local-db';
import { nodeSqliteDriver } from '@bipae/local-db/node';
import { beforeEach, describe, expect, it } from 'vitest';
import { addItem, EMPTY_CART } from './cart';
import { PdvService } from './service';

/** F3-15.b2: o caixa sem internet emite a NFC-e em contingência com o certificado do aparelho. */

const PERFIL = uuidv7();
const arroz = {
  id: uuidv7(),
  name: 'Arroz tipo 1 5kg',
  sku: 'ARROZ5',
  unit: 'UN',
  priceCents: 2890,
  isWeighable: false,
  active: true,
  ncm: '10063021',
  cest: null,
  fiscalProfileId: PERFIL,
  parentId: null,
  barcodes: ['7891000315507'],
  updatedAt: new Date().toISOString(),
};

const fiscal = (issuer = true): FiscalSnapshot => ({
  version: 'v1',
  company: { uf: 'SP', taxRegime: 'simples' },
  profiles: [
    {
      id: PERFIL,
      cfopInterna: '5102',
      cfopInterestadual: '6102',
      csosn: '102',
      cstIcms: null,
      cstPisCofins: null,
      cClassTrib: null,
      origem: 0,
    },
  ],
  ...(issuer && {
    issuer: {
      cnpj: '11222333000181',
      legalName: 'Mercadinho Bipaê LTDA',
      tradeName: null,
      ie: '111222333444',
      address: {
        street: 'Rua das Flores',
        number: '100',
        complement: null,
        district: 'Centro',
        cityCode: '3550308',
        cityName: 'São Paulo',
        cep: '01001000',
        phone: null,
      },
      paymentCodes: {},
      nfceSeries: 7,
    },
  }),
});

async function assinador(): Promise<NfeSigner> {
  const par = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-1',
    },
    false,
    ['sign', 'verify'],
  )) as { privateKey: Parameters<typeof crypto.subtle.sign>[1] };
  return {
    certificate: 'AAAA',
    sign: async (data) =>
      btoa(
        String.fromCharCode(
          ...new Uint8Array(
            await crypto.subtle.sign(
              'RSASSA-PKCS1-v1_5',
              par.privateKey,
              data as Uint8Array<ArrayBuffer>,
            ),
          ),
        ),
      ),
  };
}

let pdv: PdvService;
beforeEach(async () => {
  const storage = createStorage(nodeSqliteDriver());
  await migrateLocal(storage);
  pdv = new PdvService(storage, {
    terminalId: uuidv7(),
    operatorId: uuidv7(),
    now: () => new Date('2026-10-15T18:30:00.000Z'),
  });
  await pdv.applyCatalog([arroz]);
  await pdv.openSession(0);
});

const vender = (signer?: NfeSigner) =>
  pdv.completeSale(
    { ...addItem(EMPTY_CART, arroz, 2000), customerTaxId: '12345678909' },
    [{ method: 'cash', receivedCents: 6000 }],
    { discountLimitPercent: 10, ...(signer && { contingencySigner: signer }) },
  );

describe('NFC-e em contingência no caixa (F3-15.b2)', () => {
  it('sem internet e com o A1 no aparelho, a venda leva a NFC-e de contingência assinada', async () => {
    await pdv.applyFiscal(fiscal());
    const venda = await vender(await assinador());
    expect(venda.nfce).toBeDefined();
    const { accessKey, xml } = venda.nfce!;
    // Chave: série 007, número igual ao da venda, tipo de emissão 9.
    expect(accessKey.slice(22, 25)).toBe('007');
    expect(Number(accessKey.slice(25, 34))).toBe(venda.terminalSeq);
    expect(accessKey[34]).toBe('9');
    expect(xml).toContain('<tpEmis>9</tpEmis>');
    expect(xml).toContain('<xJust>Caixa sem conexão com a internet no momento da venda</xJust>');
    expect(xml).toContain('<Signature');
    // O evento leva a mesma nota, para o servidor transmitir como está.
    const evento = (await pdv.pendingEvents()).find((e) => e.type === 'sale.completed')!;
    expect(evento.payload).toMatchObject({ nfce: { accessKey, xml } });
    // E a venda guardada no caixa também (para a reimpressão).
    expect((await pdv.getSale(venda.id))?.nfce?.accessKey).toBe(accessKey);
  });

  it('sem os dados do emitente ou com falha na assinatura, a venda segue sem a nota', async () => {
    await pdv.applyFiscal(fiscal(false));
    expect((await vender(await assinador())).nfce).toBeUndefined();
    await pdv.applyFiscal(fiscal());
    const quebrado: NfeSigner = {
      certificate: 'AAAA',
      sign: () => Promise.reject(new Error('token removido')),
    };
    const venda = await vender(quebrado);
    expect(venda.nfce).toBeUndefined();
    expect(venda.totalCents).toBe(5780);
    // Sem assinador (com internet), o caixa não monta nota: o servidor emite.
    expect((await vender()).nfce).toBeUndefined();
  });
});
