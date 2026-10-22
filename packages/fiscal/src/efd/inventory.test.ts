import { describe, expect, it } from 'vitest';
import { buildEfdIcmsIpi, type EfdCompany, type EfdInput } from './build';

/** F4-14.b.5: inventário (bloco H) no arquivo, pelo Guia Prático 3.2.2 (H001, H005, H010, H020, H990). */

const company: EfdCompany = {
  legalName: 'Mercadinho Bipaê LTDA',
  cnpj: '11.222.333/0001-81',
  ie: '110.042.490.114',
  uf: 'SP',
  cityCode: '3550308',
};

const rows = (text: string) =>
  text
    .split('\r\n')
    .filter(Boolean)
    .map((l) => l.slice(1, -1).split('|'));
const byReg = (text: string, reg: string) => rows(text).filter((l) => l[0] === reg);

type Inventory = NonNullable<EfdInput['inventory']>;

const inventario = (over: Partial<Inventory> = {}): Inventory => ({
  date: '2025-12-31',
  items: [
    {
      code: 'ARZ5',
      description: 'Arroz Tipo 1 5kg',
      unit: 'UN',
      quantity: '12.5',
      unitCostCents: 1999,
      ncm: '10063021',
    },
    { code: 'FEIJ', description: 'Feijão 1kg', unit: 'KG', quantity: '3', unitCostCents: 801 },
  ],
  ...over,
});

const arquivo = (month: string, inventory?: Inventory) =>
  buildEfdIcmsIpi({
    month,
    company,
    profile: 'C',
    entries: [],
    ...(inventory && { inventory }),
  });
const fev = (inventory?: Inventory) => arquivo('2026-02', inventory);

describe('inventário no bloco H (F4-14.b.5)', () => {
  it('gera H005 com a soma dos H010, os 0190 e 0200 dos itens e o H990 certo', () => {
    const r = fev(inventario());
    const text = r.text;
    expect(byReg(text, 'H001')[0]).toEqual(['H001', '0']);
    // 12,5 × R$ 19,99 = R$ 249,875 → 249,88 (meio para cima); 3 × R$ 8,01 = R$ 24,03.
    const h010 = byReg(text, 'H010');
    expect(h010.map((l) => l.slice(1, 7))).toEqual([
      ['ARZ5', 'UN', '12,500', '19,990000', '249,88', '0'],
      ['FEIJ', 'KG', '3,000', '8,010000', '24,03', '0'],
    ]);
    expect(byReg(text, 'H005')[0]).toEqual(['H005', '31122025', '273,91', '01']);
    const soma = h010.reduce((t, l) => t + Number(l[5]!.replace(',', '')), 0);
    expect(Number(byReg(text, 'H005')[0]![2]!.replace(',', ''))).toBe(soma);
    expect(byReg(text, '0190').map((l) => l[1])).toEqual(['KG', 'UN']);
    const o200 = byReg(text, '0200');
    expect(o200.map((l) => l[1])).toEqual(['ARZ5', 'FEIJ']);
    expect(o200[0]!.slice(5, 7)).toEqual(['UN', '00']);
    expect(o200[0]![7]).toBe('10063021');
    // H990 conta H001, H005, 2 H010 e ele mesmo; o bloco 9 confere com as linhas.
    expect(byReg(text, 'H990')[0]).toEqual(['H990', '5']);
    const counted = Object.fromEntries(byReg(text, '9900').map((l) => [l[1], Number(l[2])]));
    const real: Record<string, number> = {};
    for (const l of rows(text)) real[l[0]!] = (real[l[0]!] ?? 0) + 1;
    expect(counted).toEqual(real);
    expect(counted.H010).toBe(2);
    expect(counted['0200']).toBe(2);
    expect(Number(byReg(text, '9999')[0]![1])).toBe(rows(text).length);
    // Inventário do motivo 01 em 31/12 no arquivo de fevereiro: sem aviso.
    expect(r.warnings.join(' ')).not.toMatch(/inventário/);
  });

  it('sem inventário o bloco H fica sem movimento e fevereiro avisa', () => {
    const r = fev();
    expect(byReg(r.text, 'H001')[0]).toEqual(['H001', '1']);
    expect(byReg(r.text, 'H005')).toHaveLength(0);
    expect(byReg(r.text, 'H990')[0]).toEqual(['H990', '2']);
    expect(r.warnings.join(' ')).toMatch(/Fevereiro pede o inventário/);
    // Em outro mês, sem inventário, não há aviso.
    expect(arquivo('2026-10').warnings.join(' ')).not.toMatch(/inventário/);
  });

  it('avisa quando o inventário de fevereiro não é o de 31/12 com o motivo 01', () => {
    expect(fev(inventario({ date: '2026-01-31' })).warnings.join(' ')).toMatch(/motivo 01/);
  });

  it('valor total zero: H005 com 0 e sem H010; item sem quantidade fica de fora', () => {
    const r = fev(
      inventario({
        items: [
          { code: 'ARZ5', description: 'Arroz', unit: 'UN', quantity: '0', unitCostCents: 5 },
        ],
      }),
    );
    expect(byReg(r.text, 'H005')[0]).toEqual(['H005', '31122025', '0,00', '01']);
    expect(byReg(r.text, 'H010')).toHaveLength(0);
    expect(byReg(r.text, '0200')).toHaveLength(0);
  });

  it('valueCents vale no lugar da conta e o valor unitário sai dele', () => {
    const r = fev(
      inventario({
        items: [{ code: 'A', description: 'A', unit: 'UN', quantity: '3', valueCents: 1000 }],
      }),
    );
    expect(byReg(r.text, 'H010')[0]!.slice(3, 6)).toEqual(['3,000', '3,333333', '10,00']);
  });

  it('motivos 02 a 05 pedem o H020; o 06 ainda não é gerado', () => {
    const comIcms = inventario().items.map((i) => ({
      ...i,
      icms: { cst: '000', baseCents: 1999, icmsCents: 360 },
    }));
    expect(() => fev(inventario({ reason: '02' }))).toThrow(/H020/);
    const r = fev(inventario({ reason: '02', items: comIcms }));
    expect(byReg(r.text, 'H020')[0]).toEqual(['H020', '000', '19,99', '3,60']);
    expect(byReg(r.text, 'H005')[0]![3]).toBe('02');
    expect(() => fev(inventario({ reason: '06' }))).toThrow(/ainda não é gerado/);
  });

  it('propriedade de terceiros exige o participante e entra no 0150', () => {
    const primeiro = inventario().items[0]!;
    expect(() => fev(inventario({ items: [{ ...primeiro, ownership: '2' }] }))).toThrow(
      /dono ou possuidor/,
    );
    const r = fev(
      inventario({
        items: [
          {
            ...primeiro,
            ownership: '2',
            party: {
              cnpj: '11444777000161',
              name: 'Depositante SA',
              countryCode: '1058',
              cityCode: '3550308',
            },
          },
        ],
      }),
    );
    expect(byReg(r.text, 'H010')[0]![6]).toBe('2');
    expect(byReg(r.text, 'H010')[0]![7]).toBe('11444777000161');
    expect(byReg(r.text, '0150').map((l) => l[1])).toContain('11444777000161');
  });

  it('recusa data depois do mês, prazo vencido, item repetido e quantidade inválida', () => {
    const a = inventario().items[0]!;
    expect(() => fev(inventario({ date: '2026-03-01' }))).toThrow(/depois do fim do mês/);
    expect(() => fev(inventario({ date: '2025-11-30' }))).toThrow(/segundo mês seguinte/);
    expect(() => fev(inventario({ items: [a, a] }))).toThrow(/repetido/);
    expect(() => fev(inventario({ items: [{ ...a, quantity: '-1' }] }))).toThrow(/Quantidade/);
    expect(() => fev(inventario({ items: [{ ...a, unit: 'UNIDADE' }] }))).toThrow(/Unidade/);
  });
});
