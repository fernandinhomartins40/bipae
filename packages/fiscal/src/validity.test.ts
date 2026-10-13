import { describe, expect, it } from 'vitest';
import { assertDate, assertValidity, isValidOn, overlaps } from './validity';

describe('vigência', () => {
  it('aceita data no formato AAAA-MM-DD', () => {
    expect(assertDate('2026-01-01')).toBe('2026-01-01');
    expect(assertDate('2028-02-29')).toBe('2028-02-29');
  });

  it('recusa data fora do formato ou que não existe', () => {
    expect(() => assertDate('01/01/2026')).toThrow('use AAAA-MM-DD');
    expect(() => assertDate('2026-13-01')).toThrow('Data inválida');
    expect(() => assertDate('2026-02-30')).toThrow('Data inválida');
    expect(() => assertDate('2027-02-29')).toThrow('Data inválida');
  });

  it('exige que o fim venha depois do início', () => {
    expect(assertValidity({ start: '2026-01-01' })).toEqual({ start: '2026-01-01' });
    expect(() => assertValidity({ start: '2026-01-01', end: '2026-01-01' })).toThrow(
      'precisa ser depois do início',
    );
    expect(() => assertValidity({ start: '2027-01-01', end: '2026-01-01' })).toThrow(
      'Vigência inválida',
    );
    expect(() => assertValidity({ start: '2026-01-01', end: 'nunca' })).toThrow('Data inválida');
    expect(() => assertValidity({ start: 'ontem' })).toThrow('Data inválida');
  });

  it('vale do primeiro dia até a véspera do fim', () => {
    const ano2026 = { start: '2026-01-01', end: '2027-01-01' };
    expect(isValidOn(ano2026, '2025-12-31')).toBe(false);
    expect(isValidOn(ano2026, '2026-01-01')).toBe(true);
    expect(isValidOn(ano2026, '2026-12-31')).toBe(true);
    expect(isValidOn(ano2026, '2027-01-01')).toBe(false);
  });

  it('sem data de fim vale para sempre', () => {
    expect(isValidOn({ start: '2033-01-01' }, '2099-12-31')).toBe(true);
    expect(isValidOn({ start: '2033-01-01' }, '2032-12-31')).toBe(false);
  });

  it('vigências vizinhas não se cruzam; as que dividem um dia, sim', () => {
    const a = { start: '2026-01-01', end: '2027-01-01' };
    const b = { start: '2027-01-01', end: '2028-01-01' };
    expect(overlaps(a, b)).toBe(false);
    expect(overlaps(b, a)).toBe(false);
    expect(overlaps(a, { start: '2026-12-31', end: '2028-01-01' })).toBe(true);
    expect(overlaps(a, { start: '2026-06-01' })).toBe(true);
    expect(overlaps({ start: '2020-01-01' }, { start: '2030-01-01' })).toBe(true);
    expect(overlaps({ start: '2027-01-01' }, a)).toBe(false);
  });
});
