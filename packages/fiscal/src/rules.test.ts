import { describe, expect, it } from 'vitest';
import {
  AmbiguousRuleError,
  checkRules,
  matches,
  selectRule,
  specificity,
  type Rule,
  type RuleContext,
} from './rules';

// Regras de exemplo, só para exercitar o motor: os números NÃO são alíquotas oficiais.
// As tabelas de verdade entram na tarefa F3-03, cada uma com a sua fonte.
const regra = (id: string, parcial: Partial<Rule<string>> = {}): Rule<string> => ({
  id,
  tax: 'ICMS',
  validity: { start: '2026-01-01' },
  scope: {},
  effect: id,
  source: 'Norma de exemplo',
  ...parcial,
});

const operacao: RuleContext = {
  date: '2026-06-15',
  crt: 3,
  ufOrigem: 'SP',
  ufDestino: 'SP',
  ncm: '22030000',
  cfop: '5102',
  operation: 'venda',
};

describe('escopo da regra', () => {
  it('campo ausente vale para qualquer operação', () => {
    expect(matches({}, operacao)).toBe(true);
  });

  it('lista quer dizer "um destes"', () => {
    expect(matches({ ufOrigem: ['RJ', 'SP'] }, operacao)).toBe(true);
    expect(matches({ ufOrigem: ['RJ', 'MG'] }, operacao)).toBe(false);
    expect(matches({ crt: [1, 2] }, operacao)).toBe(false);
    expect(matches({ operation: ['devolucao'] }, operacao)).toBe(false);
    expect(matches({ cfop: ['5102'], ufDestino: ['SP'] }, operacao)).toBe(true);
  });

  it('NCM casa por prefixo', () => {
    expect(matches({ ncm: ['2203'] }, operacao)).toBe(true);
    expect(matches({ ncm: ['22030000'] }, operacao)).toBe(true);
    expect(matches({ ncm: ['2204', '2205'] }, operacao)).toBe(false);
  });

  it('regra que exige um dado não casa quando a operação não o informa', () => {
    const semNcm: RuleContext = { date: '2026-06-15', crt: 3, ufOrigem: 'SP', ufDestino: 'SP' };
    expect(matches({ ncm: ['2203'] }, semNcm)).toBe(false);
    expect(matches({ municipio: ['3550308'] }, semNcm)).toBe(false);
    expect(matches({ cest: ['0302100'] }, semNcm)).toBe(false);
    expect(matches({ cClassTrib: ['000001'] }, semNcm)).toBe(false);
  });

  it('quanto mais a regra identifica a mercadoria, mais específica ela é', () => {
    const geral = specificity({}, operacao);
    const porUf = specificity({ ufOrigem: ['SP'] }, operacao);
    const porNcm4 = specificity({ ncm: ['2203'] }, operacao);
    const porNcm8 = specificity({ ncm: ['2203', '22030000'] }, operacao);
    const porClass = specificity({ cClassTrib: ['000001'] }, operacao);
    expect(geral).toBe(0);
    expect(porUf).toBeGreaterThan(geral);
    expect(porNcm4).toBeGreaterThan(porUf);
    expect(porNcm8).toBeGreaterThan(porNcm4);
    expect(porClass).toBeGreaterThan(porNcm8);
  });
});

describe('escolha da regra', () => {
  it('usa a regra em vigor na data do fato gerador', () => {
    const regras = [
      regra('ate-2026', { validity: { start: '2026-01-01', end: '2027-01-01' } }),
      regra('de-2027', { validity: { start: '2027-01-01' } }),
    ];
    expect(selectRule(regras, 'ICMS', operacao)?.id).toBe('ate-2026');
    expect(selectRule(regras, 'ICMS', { ...operacao, date: '2027-01-01' })?.id).toBe('de-2027');
    expect(selectRule(regras, 'ICMS', { ...operacao, date: '2025-12-31' })).toBeNull();
  });

  it('fica com a mais específica, em qualquer ordem da tabela', () => {
    const regras = [
      regra('geral'),
      regra('cerveja', { scope: { ncm: ['2203'] } }),
      regra('sp', { scope: { ufOrigem: ['SP'] } }),
    ];
    expect(selectRule(regras, 'ICMS', operacao)?.id).toBe('cerveja');
    expect(selectRule([...regras].reverse(), 'ICMS', operacao)?.id).toBe('cerveja');
    expect(selectRule(regras, 'ICMS', { ...operacao, ncm: '10063021' })?.id).toBe('sp');
    expect(selectRule(regras, 'ICMS', { ...operacao, ncm: '10063021', ufOrigem: 'RJ' })?.id).toBe(
      'geral',
    );
  });

  it('ignora regras de outro tributo', () => {
    const regras = [regra('pis', { tax: 'PIS' })];
    expect(selectRule(regras, 'ICMS', operacao)).toBeNull();
    expect(selectRule(regras, 'PIS', operacao)?.id).toBe('pis');
  });

  it('empate é erro de dados, nunca escolha silenciosa', () => {
    const regras = [
      regra('a', { scope: { ufOrigem: ['SP'] } }),
      regra('b', { scope: { ufOrigem: ['SP', 'RJ'] } }),
    ];
    expect(() => selectRule(regras, 'ICMS', operacao)).toThrow(AmbiguousRuleError);
    try {
      selectRule(regras, 'ICMS', operacao);
    } catch (error) {
      expect((error as AmbiguousRuleError).ruleIds).toEqual(['a', 'b']);
      expect((error as AmbiguousRuleError).tax).toBe('ICMS');
      expect((error as Error).message).toContain('Corrija a tabela de regras');
    }
  });

  it('recusa data inválida na operação', () => {
    expect(() => selectRule([regra('x')], 'ICMS', { ...operacao, date: '15/06/2026' })).toThrow(
      'Data inválida',
    );
  });
});

describe('conferência da tabela de regras', () => {
  it('tabela correta não tem problema', () => {
    const regras = [
      regra('a', { validity: { start: '2026-01-01', end: '2027-01-01' } }),
      regra('b', { validity: { start: '2027-01-01' } }),
      regra('c', { scope: { ncm: ['2203'] } }),
      regra('d', { tax: 'PIS' }),
    ];
    expect(checkRules(regras)).toEqual([]);
  });

  it('aponta id repetido, vigência inválida e regra sem fonte', () => {
    const problemas = checkRules([
      regra('a', { scope: { ufOrigem: ['SP'] } }),
      regra('a', { scope: { ufOrigem: ['RJ'] } }),
      regra('b', { scope: { crt: [1] }, validity: { start: '2027-01-01', end: '2026-01-01' } }),
      regra('c', { scope: { crt: [3] }, source: '  ' }),
    ]);
    const mensagens = problemas.map((p) => p.message);
    expect(mensagens).toContain('Id repetido 2 vezes.');
    expect(mensagens.some((m) => m.startsWith('Vigência inválida'))).toBe(true);
    expect(mensagens).toContain('Regra sem fonte (norma ou nota técnica).');
  });

  it('aponta duas regras iguais com vigências que se cruzam', () => {
    const problemas = checkRules([
      regra('a', { scope: { ufOrigem: ['SP', 'RJ'], ncm: ['2203'] } }),
      // Mesmo escopo, escrito em outra ordem.
      regra('b', { scope: { ncm: ['2203'], ufOrigem: ['RJ', 'SP'], cest: undefined } }),
    ]);
    expect(problemas).toHaveLength(1);
    expect(problemas[0]!.ruleIds).toEqual(['a', 'b']);
    expect(problemas[0]!.message).toContain('vigências que se cruzam');
  });
});
