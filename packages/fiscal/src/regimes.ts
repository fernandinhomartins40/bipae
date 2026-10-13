import type { Crt, TaxRegime } from './rules';

/**
 * Regimes tributários que o Bipaê atende, do MEI ao Lucro Real. Isto não é a natureza jurídica
 * (MEI, EI, LTDA, S.A.): uma LTDA pode estar em qualquer um destes. É o regime que decide o CRT da
 * nota, se o ICMS usa CSOSN ou CST e de onde vêm o PIS e a COFINS.
 */
export type CompanyRegime = 'mei' | 'simples' | 'simples-excesso' | 'presumido' | 'real';

export interface CompanyRegimeInfo {
  id: CompanyRegime;
  label: string;
  /** Explicação curta, para a tela de cadastro. */
  hint: string;
  /** Código de Regime Tributário que vai na nota. */
  crt: Crt;
  /** Regime de apuração usado na escolha das regras do motor. */
  taxRegime: TaxRegime;
  /** O ICMS da nota usa CSOSN (Simples) ou CST (regime normal). */
  icmsCode: 'csosn' | 'cst';
  /** De onde vêm o PIS e a COFINS: do documento do Simples ou da alíquota do regime. */
  pisCofins: 'das' | 'cumulativo' | 'nao-cumulativo';
  source: string;
}

export const COMPANY_REGIMES: readonly CompanyRegimeInfo[] = [
  {
    id: 'mei',
    label: 'MEI',
    hint: 'Microempreendedor individual, com receita de até R$ 81 mil por ano.',
    crt: 4,
    taxRegime: 'simples',
    icmsCode: 'csosn',
    pisCofins: 'das',
    source: 'LC 123/2006, art. 18-A; NT 2024.001 (CRT 4)',
  },
  {
    id: 'simples',
    label: 'Simples Nacional',
    hint: 'Microempresa ou empresa de pequeno porte, com receita de até R$ 4,8 milhões por ano.',
    crt: 1,
    taxRegime: 'simples',
    icmsCode: 'csosn',
    pisCofins: 'das',
    source: 'LC 123/2006, arts. 3º e 13',
  },
  {
    id: 'simples-excesso',
    label: 'Simples Nacional acima do sublimite',
    hint: 'Receita acima de R$ 3,6 milhões: o ICMS sai do Simples e é calculado como no regime normal.',
    crt: 2,
    taxRegime: 'simples',
    icmsCode: 'cst',
    pisCofins: 'das',
    source: 'LC 123/2006, art. 13-A',
  },
  {
    id: 'presumido',
    label: 'Lucro Presumido',
    hint: 'Regime normal, com PIS e COFINS cumulativos.',
    crt: 3,
    taxRegime: 'presumido',
    icmsCode: 'cst',
    pisCofins: 'cumulativo',
    source: 'Leis 9.715/1998 e 9.718/1998',
  },
  {
    id: 'real',
    label: 'Lucro Real',
    hint: 'Regime normal, com PIS e COFINS não cumulativos.',
    crt: 3,
    taxRegime: 'real',
    icmsCode: 'cst',
    pisCofins: 'nao-cumulativo',
    source: 'Leis 10.637/2002 e 10.833/2003',
  },
];

export function findCompanyRegime(id: string): CompanyRegimeInfo | null {
  return COMPANY_REGIMES.find((regime) => regime.id === id) ?? null;
}
