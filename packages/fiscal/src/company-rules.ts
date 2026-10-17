import { AmbiguousRuleError, checkRules, selectRule, type Rule } from './rules';
import type { SaleTaxSettings } from './sale';
import { assertValidity, type Validity } from './validity';

/**
 * Regras de ICMS próprias da empresa (F3-06.e): o que a alíquota geral da UF não cobre, como a
 * alíquota de um produto (cesta básica, bebidas), uma redução de base, o FCP ou a margem da
 * substituição tributária. Cada regra vale para um ou mais prefixos de NCM, por vigência, e é
 * cadastrada pela empresa (normalmente com o contador). Vale a mais específica para o NCM.
 */
export interface CompanyIcmsEffect {
  /** Alíquota interna do produto, em percentual ("12"). */
  rate?: string;
  /** Redução da base de cálculo, em percentual. */
  baseReduction?: string;
  /** Alíquota do FCP somada para este produto. */
  fcpRate?: string;
  /** Substituição tributária: MVA e alíquota interna do destino. */
  st?: { mva: string; rate: string; baseReduction?: string };
  /** Código de benefício fiscal da UF (cBenef, F3-27), que vai no item da nota. */
  benefitCode?: string;
}

export interface CompanyIcmsRule {
  id: string;
  name: string;
  /** Prefixos de NCM, só dígitos ("2203" vale para todas as cervejas de malte). */
  ncm: string[];
  validity: Validity;
  effect: CompanyIcmsEffect;
  /** Fonte (lei, decreto, orientação do contador). */
  source: string;
}

const toRule = (rule: CompanyIcmsRule): Rule<CompanyIcmsEffect> => ({
  id: rule.id,
  tax: 'ICMS',
  validity: rule.validity,
  scope: { ncm: rule.ncm },
  effect: rule.effect,
  source: rule.source,
});

/** Problemas da tabela de regras da empresa, em português (para recusar o cadastro). */
export function checkCompanyIcmsRules(rules: readonly CompanyIcmsRule[]): string[] {
  const problems: string[] = [];
  const names = new Map(rules.map((rule) => [rule.id, rule.name]));
  for (const rule of rules) {
    if (rule.ncm.length === 0)
      problems.push(`A regra "${rule.name}" precisa de pelo menos um NCM.`);
    for (const prefix of rule.ncm) {
      if (!/^\d{2,8}$/.test(prefix))
        problems.push(`NCM "${prefix}" inválido na regra "${rule.name}".`);
    }
    if (Object.keys(rule.effect).length === 0)
      problems.push(`A regra "${rule.name}" não diz o que muda no ICMS.`);
    try {
      assertValidity(rule.validity);
    } catch (error) {
      problems.push(`Regra "${rule.name}": ${(error as Error).message}`);
    }
  }
  for (const problem of checkRules(rules.map(toRule))) {
    if (problem.ruleIds.length === 2) {
      const [a, b] = problem.ruleIds.map((id) => names.get(id) ?? id);
      problems.push(`As regras "${a}" e "${b}" valem para os mesmos NCM no mesmo período.`);
    }
  }
  return problems;
}

/**
 * O ajuste de ICMS que vale para um NCM na data. Sem regra, devolve nada (fica a alíquota geral
 * da UF). Duas regras igualmente específicas são erro de cadastro: o ICMS fica bloqueado com a
 * explicação, em vez de o sistema escolher uma delas.
 */
export function companyIcmsSettings(
  rules: readonly CompanyIcmsRule[],
  ncm: string | null | undefined,
  date: string,
): Pick<SaleTaxSettings, 'icms' | 'icmsBlocked'> & { ruleId?: string; benefitCode?: string } {
  if (rules.length === 0 || !ncm) return {};
  try {
    const rule = selectRule(rules.map(toRule), 'ICMS', {
      date,
      crt: 3,
      ufOrigem: '',
      ufDestino: '',
      ncm,
    });
    if (!rule) return {};
    // O cBenef não mexe no cálculo: vai para o item da nota.
    const { benefitCode, ...icms } = rule.effect;
    return { icms, ruleId: rule.id, ...(benefitCode && { benefitCode }) };
  } catch (error) {
    if (!(error instanceof AmbiguousRuleError)) throw error;
    const names = error.ruleIds.map((id) => rules.find((rule) => rule.id === id)?.name ?? id);
    return {
      icmsBlocked: `Mais de uma regra de ICMS da empresa vale para o NCM ${ncm}: ${names.join(', ')}. Corrija em Regras de ICMS.`,
    };
  }
}
