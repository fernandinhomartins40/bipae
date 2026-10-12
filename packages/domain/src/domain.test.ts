import { describe, expect, it } from 'vitest';
import {
  addCents,
  allocateNfceSeries,
  cents,
  cnpjCheckDigits,
  compareVersions,
  completeGtin,
  cpfCheckDigits,
  customerInput,
  formatBRL,
  formatCnpj,
  formatCpf,
  formatTaxId,
  hasPermission,
  isInStoreCode,
  isPermission,
  isUuid,
  isValidCnpj,
  isValidCpf,
  isValidGtin,
  parseBRL,
  parseClientHeader,
  parseTaxId,
  parseVersion,
  productInput,
  requiresUpdate,
  signupInput,
  subtractCents,
  SYSTEM_ROLES,
  uuidv7,
} from './index';

describe('money', () => {
  it('rejects non-integer cents', () => {
    expect(() => cents(1.5)).toThrow(RangeError);
    expect(cents(150)).toBe(150);
  });

  it('adds and subtracts exactly', () => {
    expect(addCents(cents(10), cents(20), cents(1))).toBe(31);
    expect(subtractCents(cents(10), cents(30))).toBe(-20);
  });

  it('formats BRL', () => {
    expect(formatBRL(cents(123456))).toBe('R$ 1.234,56');
    expect(formatBRL(cents(5))).toBe('R$ 0,05');
  });

  it.each([
    ['1.234,56', 123456],
    ['R$ 10', 1000],
    ['10,5', 1050],
    ['10.5', 1050],
    ['0,07', 7],
    ['1.000', 100000],
    ['-3,00', -300],
  ])('parses %s', (input, expected) => {
    expect(parseBRL(input)).toBe(expected);
  });

  it.each(['', 'abc', '1,2,3', '1,234', '12.34.5', '1.23,00'])('rejects %s', (input) => {
    expect(parseBRL(input)).toBeNull();
  });
});

describe('CPF', () => {
  it('validates real check digits', () => {
    const base = '123456789';
    const cpf = base + cpfCheckDigits(base);
    expect(cpf).toBe('12345678909');
    expect(isValidCpf(cpf)).toBe(true);
    expect(isValidCpf('123.456.789-09')).toBe(true);
    expect(isValidCpf('12345678900')).toBe(false);
    expect(isValidCpf('11111111111')).toBe(false);
    expect(isValidCpf('123')).toBe(false);
  });

  it('masks progressively', () => {
    expect(formatCpf('12345678909')).toBe('123.456.789-09');
    expect(formatCpf('1234')).toBe('123.4');
  });

  it('rejects invalid base', () => {
    expect(() => cpfCheckDigits('12')).toThrow();
  });
});

describe('CNPJ', () => {
  it('validates numeric CNPJ', () => {
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
    expect(isValidCnpj('11222333000182')).toBe(false);
    expect(isValidCnpj('00000000000000')).toBe(false);
  });

  it('validates alphanumeric CNPJ (IN RFB 2.229/2024 example)', () => {
    // Example published by Receita Federal: 12.ABC.345/01DE-35
    expect(cnpjCheckDigits('12ABC34501DE')).toBe('35');
    expect(isValidCnpj('12.ABC.345/01DE-35')).toBe(true);
    expect(isValidCnpj('12abc34501de35')).toBe(true);
    expect(isValidCnpj('12ABC34501DE36')).toBe(false);
  });

  it('masks CNPJ', () => {
    expect(formatCnpj('11222333000181')).toBe('11.222.333/0001-81');
    expect(formatCnpj('12ABC34501DE35')).toBe('12.ABC.345/01DE-35');
  });

  it('rejects invalid base', () => {
    expect(() => cnpjCheckDigits('1')).toThrow();
  });
});

describe('tax id', () => {
  it('detects kind', () => {
    expect(parseTaxId('123.456.789-09')).toEqual({ kind: 'cpf', value: '12345678909' });
    expect(parseTaxId('11.222.333/0001-81')).toEqual({ kind: 'cnpj', value: '11222333000181' });
    expect(parseTaxId('123')).toBeNull();
  });

  it('formats either kind', () => {
    expect(formatTaxId('12345678909')).toBe('123.456.789-09');
    expect(formatTaxId('11222333000181')).toBe('11.222.333/0001-81');
  });
});

describe('GTIN', () => {
  it('validates and completes', () => {
    expect(isValidGtin('7891000315507')).toBe(true);
    expect(isValidGtin('7891000315508')).toBe(false);
    expect(isValidGtin('abc')).toBe(false);
    expect(completeGtin('789100031550')).toBe('7891000315507');
    expect(isValidGtin('96385074')).toBe(true);
  });

  it('identifies in-store codes', () => {
    expect(isInStoreCode('2000123012345')).toBe(true);
    expect(isInStoreCode('7891000315507')).toBe(false);
  });

  it('rejects non-digit body', () => {
    expect(() => completeGtin('12a')).toThrow();
  });
});

describe('uuidv7', () => {
  it('is a valid, time-ordered v7 uuid', () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(isUuid(a)).toBe(true);
    expect(a[14]).toBe('7');
    expect(a < b).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
  });
});

describe('permissions', () => {
  it('owner has everything, cashier cannot cancel sales', () => {
    expect(hasPermission(SYSTEM_ROLES.owner.permissions, 'pos.sale.cancel')).toBe(true);
    expect(hasPermission(SYSTEM_ROLES.cashier.permissions, 'pos.sale.cancel')).toBe(false);
    expect(SYSTEM_ROLES.manager.permissions).not.toContain('admin.users');
    expect(isPermission('catalog.read')).toBe(true);
    expect(isPermission('nope')).toBe(false);
  });
});

describe('NFC-e series allocation', () => {
  it('takes the lowest free series and never reuses', () => {
    expect(allocateNfceSeries([])).toBe(1);
    expect(allocateNfceSeries([1, 2, 4])).toBe(3);
    expect(allocateNfceSeries([1], { min: 1, max: 2 })).toBe(2);
    expect(() => allocateNfceSeries([1, 2], { min: 1, max: 2 })).toThrow(/Não há séries/);
  });
});

describe('client version', () => {
  it('parses header', () => {
    expect(parseClientHeader('desktop/1.4.2')).toEqual({ kind: 'desktop', version: [1, 4, 2] });
    expect(parseClientHeader('web/2.0.0-beta.1')?.version).toEqual([2, 0, 0]);
    expect(parseClientHeader('toaster/1.0.0')).toBeNull();
    expect(parseClientHeader(undefined)).toBeNull();
  });

  it('compares versions', () => {
    expect(compareVersions([1, 2, 3], [1, 2, 3])).toBe(0);
    expect(compareVersions([1, 10, 0], [1, 9, 9])).toBe(1);
    expect(compareVersions(parseVersion('0.9.0'), [1, 0, 0])).toBe(-1);
    expect(() => parseVersion('x')).toThrow();
  });

  it('requires update below minimum, but never for sync uploads', () => {
    const old = parseClientHeader('desktop/1.0.0');
    const minimums = { desktop: '1.2.0' };
    expect(requiresUpdate(old, minimums, '/v1/products')).toBe(true);
    expect(requiresUpdate(old, minimums, '/v1/sync/events')).toBe(false);
    expect(requiresUpdate(parseClientHeader('desktop/1.2.0'), minimums, '/v1/products')).toBe(
      false,
    );
    expect(requiresUpdate(parseClientHeader('web/0.0.1'), minimums, '/v1/products')).toBe(false);
    expect(requiresUpdate(null, minimums, '/v1/products')).toBe(false);
  });
});

describe('contracts', () => {
  it('normalizes signup input', () => {
    const parsed = signupInput.parse({
      ownerName: ' Célia ',
      email: 'CELIA@Exemplo.com.br ',
      password: 'segredo123',
      businessName: 'Bazar da Célia',
      taxId: '123.456.789-09',
    });
    expect(parsed.email).toBe('celia@exemplo.com.br');
    expect(parsed.taxId).toBe('12345678909');
    expect(parsed.ownerName).toBe('Célia');
  });

  it('rejects invalid tax id with pt-BR message', () => {
    const result = signupInput.safeParse({
      ownerName: 'Célia',
      email: 'celia@exemplo.com.br',
      password: 'segredo123',
      businessName: 'Bazar',
      taxId: '111.111.111-11',
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('CPF ou CNPJ inválido');
  });

  it('validates product barcodes and defaults', () => {
    const product = productInput.parse({
      name: 'Arroz 5kg',
      priceCents: 2890,
      barcodes: ['7891000315507'],
    });
    expect(product.unit).toBe('UN');
    expect(product.active).toBe(true);
    expect(productInput.safeParse({ name: 'X', priceCents: 1, barcodes: ['7891000315508'] }).success)
      .toBe(false);
    expect(productInput.safeParse({ name: 'X', priceCents: 1.5 }).success).toBe(false);
    expect(productInput.parse({ name: 'X', priceCents: 1, ncm: '' }).ncm).toBeNull();
  });

  it('accepts missing optional fields and rejects bad optional tax id', () => {
    const parsed = signupInput.parse({
      ownerName: 'Rafael',
      email: 'rafael@mercadinho.com.br',
      password: 'segredo123',
      businessName: 'Mercadinho',
    });
    expect(parsed.taxId).toBeNull();
    const bad = customerInput.safeParse({ name: 'Ana', taxId: '123' });
    expect(bad.success).toBe(false);
    expect(customerInput.parse({ name: 'Ana', email: '', phone: '', notes: '' })).toMatchObject({
      email: null,
      phone: null,
      notes: null,
      taxId: null,
    });
    expect(productInput.parse({ name: 'Bala', priceCents: 10, cest: '', sku: '' })).toMatchObject({
      cest: null,
      sku: null,
    });
  });

  it('normalizes customer phone and address', () => {
    const customer = customerInput.parse({
      name: 'João',
      phone: '(11) 98765-4321',
      address: {
        cep: '01001-000',
        street: 'Praça da Sé',
        number: 's/n',
        district: 'Sé',
        city: 'São Paulo',
        uf: 'SP',
      },
    });
    expect(customer.phone).toBe('11987654321');
    expect(customer.address?.cep).toBe('01001000');
    expect(customer.marketingConsent).toBe(false);
  });
});
