import { assertDate, assertValidity, isValidOn, overlaps, type Validity } from './validity';

/**
 * Regras fiscais como dados (ADR-0006). Uma regra diz: para este tributo, neste período e
 * neste escopo, o efeito é este, e a fonte é esta norma. O código só escolhe e aplica; nenhuma
 * alíquota, CST ou data mora num `if`.
 */

/** Código de Regime Tributário do emitente: 1 e 2 Simples Nacional, 3 regime normal, 4 MEI. */
export type Crt = 1 | 2 | 3 | 4;

/**
 * Regime de apuração do emitente. O CRT não basta: Lucro Presumido e Lucro Real são os dois
 * CRT 3, mas o PIS e a COFINS de cada um são diferentes.
 */
export type TaxRegime = 'simples' | 'presumido' | 'real';

/** Tipo da operação, quando a regra depende dele. */
export type OperationKind = 'venda' | 'devolucao' | 'transferencia' | 'bonificacao';

/**
 * Escopo de uma regra. Campo ausente = vale para qualquer valor. Dentro de um campo, a lista é
 * "um destes". `ncm` aceita prefixos ("2203" casa todos os NCM de cerveja de malte).
 */
export interface RuleScope {
  crt?: Crt[];
  taxRegime?: TaxRegime[];
  ufOrigem?: string[];
  ufDestino?: string[];
  municipio?: string[];
  ncm?: string[];
  cest?: string[];
  cClassTrib?: string[];
  cfop?: string[];
  operation?: OperationKind[];
}

export interface Rule<Effect = unknown> {
  id: string;
  /** Tributo ou assunto: "ICMS", "PIS", "COFINS", "IBS", "CBS", "IS"... */
  tax: string;
  validity: Validity;
  scope: RuleScope;
  effect: Effect;
  /** Norma ou nota técnica (com versão) que justifica a regra, para auditoria e para o contador. */
  source: string;
}

/** Os fatos da operação que escolhem a regra. `date` é a data do fato gerador (AAAA-MM-DD). */
export interface RuleContext {
  date: string;
  crt: Crt;
  taxRegime?: TaxRegime;
  ufOrigem: string;
  ufDestino: string;
  municipio?: string;
  ncm?: string;
  cest?: string;
  cClassTrib?: string;
  cfop?: string;
  operation?: OperationKind;
}

export class AmbiguousRuleError extends Error {
  constructor(
    readonly tax: string,
    readonly ruleIds: string[],
  ) {
    super(
      `Regras de ${tax} empatadas para a mesma operação: ${ruleIds.join(', ')}. ` +
        'Corrija a tabela de regras: uma delas precisa ser mais específica ou ter outra vigência.',
    );
  }
}

// Peso de cada critério: o que identifica melhor a mercadoria vale mais que o que identifica
// o lugar ou o regime. O NCM soma o tamanho do prefixo que casou (8 dígitos vence 4).
const WEIGHT = {
  cClassTrib: 4096,
  cest: 2048,
  ncm: 1024,
  cfop: 256,
  operation: 128,
  municipio: 64,
  ufDestino: 32,
  ufOrigem: 16,
  crt: 8,
  taxRegime: 4,
} as const;

const includes = <T>(list: T[] | undefined, value: T | undefined): boolean =>
  list === undefined || (value !== undefined && list.includes(value));

function matchedNcmPrefix(scope: RuleScope, ncm: string | undefined): number {
  if (scope.ncm === undefined) return 0;
  if (ncm === undefined) return -1;
  let best = -1;
  for (const prefix of scope.ncm) {
    if (ncm.startsWith(prefix) && prefix.length > best) best = prefix.length;
  }
  return best;
}

export function matches(scope: RuleScope, ctx: RuleContext): boolean {
  return (
    includes(scope.crt, ctx.crt) &&
    includes(scope.taxRegime, ctx.taxRegime) &&
    includes(scope.ufOrigem, ctx.ufOrigem) &&
    includes(scope.ufDestino, ctx.ufDestino) &&
    includes(scope.municipio, ctx.municipio) &&
    includes(scope.cest, ctx.cest) &&
    includes(scope.cClassTrib, ctx.cClassTrib) &&
    includes(scope.cfop, ctx.cfop) &&
    includes(scope.operation, ctx.operation) &&
    matchedNcmPrefix(scope, ctx.ncm) >= 0
  );
}

/** Quanto a regra é específica para esta operação (só faz sentido para regras que casam). */
export function specificity(scope: RuleScope, ctx: RuleContext): number {
  let score = 0;
  for (const key of ['cClassTrib', 'cest', 'cfop', 'operation', 'municipio', 'ufDestino', 'ufOrigem', 'crt', 'taxRegime'] as const) {
    if (scope[key] !== undefined) score += WEIGHT[key];
  }
  const prefix = matchedNcmPrefix(scope, ctx.ncm);
  if (scope.ncm !== undefined && prefix >= 0) score += WEIGHT.ncm + prefix;
  return score;
}

/**
 * Escolhe a regra de um tributo para a operação: filtra pela vigência na data do fato gerador
 * e pelo escopo, e fica com a mais específica. Empate é erro de dados (ADR-0006). Sem regra
 * aplicável devolve null, e quem chama decide se isso é aceitável.
 */
export function selectRule<E>(rules: readonly Rule<E>[], tax: string, ctx: RuleContext): Rule<E> | null {
  assertDate(ctx.date);
  let best: Rule<E>[] = [];
  let bestScore = -1;
  for (const rule of rules) {
    if (rule.tax !== tax || !isValidOn(rule.validity, ctx.date) || !matches(rule.scope, ctx)) continue;
    const score = specificity(rule.scope, ctx);
    if (score > bestScore) {
      best = [rule];
      bestScore = score;
    } else if (score === bestScore) {
      best.push(rule);
    }
  }
  if (best.length > 1) throw new AmbiguousRuleError(tax, best.map((r) => r.id));
  return best[0] ?? null;
}

export interface RuleProblem {
  ruleIds: string[];
  message: string;
}

const scopeKey = (scope: RuleScope) =>
  JSON.stringify(
    Object.entries(scope)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, [...(v as (string | number)[])].sort()])
      .sort(([a], [b]) => String(a).localeCompare(String(b))),
  );

/**
 * Confere uma tabela de regras antes de ela ser usada: ids repetidos, vigência inválida, regra
 * sem fonte e duas regras do mesmo tributo com o mesmo escopo e vigências que se cruzam. Roda
 * nos testes das tabelas, para o erro de dados nunca chegar à produção.
 */
export function checkRules(rules: readonly Rule[]): RuleProblem[] {
  const problems: RuleProblem[] = [];
  const seen = new Map<string, number>();
  for (const rule of rules) {
    seen.set(rule.id, (seen.get(rule.id) ?? 0) + 1);
    try {
      assertValidity(rule.validity);
    } catch (error) {
      problems.push({ ruleIds: [rule.id], message: (error as Error).message });
    }
    if (!rule.source.trim()) {
      problems.push({ ruleIds: [rule.id], message: 'Regra sem fonte (norma ou nota técnica).' });
    }
  }
  for (const [id, count] of seen) {
    if (count > 1) problems.push({ ruleIds: [id], message: `Id repetido ${count} vezes.` });
  }
  for (let i = 0; i < rules.length; i++) {
    for (let j = i + 1; j < rules.length; j++) {
      const a = rules[i]!;
      const b = rules[j]!;
      if (a.tax === b.tax && scopeKey(a.scope) === scopeKey(b.scope) && overlaps(a.validity, b.validity)) {
        problems.push({
          ruleIds: [a.id, b.id],
          message: `Mesmo tributo (${a.tax}), mesmo escopo e vigências que se cruzam.`,
        });
      }
    }
  }
  return problems;
}
