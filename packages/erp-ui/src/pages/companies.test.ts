import { describe, expect, it } from 'vitest';
import { cleanPercent, formatCnae } from './companies';

describe('campo da CNAE principal (F3-26.d.CE.c)', () => {
  it('põe a máscara 0000-0/00 enquanto digita e corta no 7º dígito', () => {
    expect(formatCnae('4781400')).toBe('4781-4/00');
    expect(formatCnae('4781-4/00')).toBe('4781-4/00');
    expect(formatCnae('47814001')).toBe('4781-4/00');
    expect(formatCnae('4781')).toBe('4781');
    expect(formatCnae('47814')).toBe('4781-4');
    expect(formatCnae('478140')).toBe('4781-4/0');
    expect(formatCnae('')).toBe('');
  });
});

describe('campo de percentual da NFS-e', () => {
  it('aceita vírgula ou ponto e guarda só números, uma vírgula e até 2 casas', () => {
    expect(cleanPercent('6.5')).toBe('6,5');
    expect(cleanPercent('6,54')).toBe('6,54');
    expect(cleanPercent('6,549')).toBe('6,54');
    expect(cleanPercent('13,45%')).toBe('13,45');
    expect(cleanPercent('1.0')).toBe('1,0');
    expect(cleanPercent('100')).toBe('10');
  });

  it('texto do preenchimento automático do navegador não entra', () => {
    expect(cleanPercent('Brasil')).toBe('');
    expect(cleanPercent('R$ 5')).toBe('5');
  });
});
