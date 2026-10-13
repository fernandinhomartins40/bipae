import { describe, expect, it } from 'vitest';
import { dec, format, fromCents, percent, round, toCents } from './decimal';

describe('decimal', () => {
  it('soma sem o erro do ponto flutuante', () => {
    expect(dec('0.1').plus(dec('0.2')).toString()).toBe('0.3');
    expect(0.1 + 0.2).not.toBe(0.3);
  });

  it('recusa valor que não é um número finito', () => {
    expect(() => dec(Number.NaN)).toThrow('Valor numérico inválido');
    expect(() => dec('Infinity')).toThrow('Valor numérico inválido');
  });

  it('arredonda conforme o modo pedido', () => {
    expect(round(dec('2.345')).toString()).toBe('2.35');
    expect(round(dec('2.345'), 2, 'half-up').toString()).toBe('2.35');
    expect(round(dec('2.345'), 2, 'half-even').toString()).toBe('2.34');
    expect(round(dec('2.355'), 2, 'half-even').toString()).toBe('2.36');
    expect(round(dec('2.349'), 2, 'truncate').toString()).toBe('2.34');
    expect(round(dec('1.23456'), 4).toString()).toBe('1.2346');
  });

  it('converte centavos em reais e de volta', () => {
    expect(fromCents(1234).toString()).toBe('12.34');
    expect(toCents(dec('12.34'))).toBe(1234);
    expect(toCents(dec('12.345'))).toBe(1235);
    expect(toCents(dec('12.345'), 'truncate')).toBe(1234);
    expect(toCents(dec('12.345'), 'half-even')).toBe(1234);
  });

  it('recusa centavos quebrados e valores grandes demais', () => {
    expect(() => fromCents(12.5)).toThrow('Centavos precisam ser um número inteiro');
    expect(() => toCents(dec('1e20'))).toThrow('Valor grande demais');
  });

  it('transforma percentual da legislação em fração', () => {
    expect(percent('18').toString()).toBe('0.18');
    expect(percent('0.9').toString()).toBe('0.009');
  });

  it('formata com casas fixas, como o leiaute fiscal pede', () => {
    expect(format(dec('1234.5'))).toBe('1234.50');
    expect(format(dec('0.125'))).toBe('0.13');
    expect(format(dec('18'), 4)).toBe('18.0000');
  });
});
