import data from './data/demonstration.json';

/**
 * Notas da venda condicional ("demonstração") para consumidor, geradas do texto oficial do Ajuste
 * SINIEF 02/18 (F5-12.c): natureza da operação, CFOP, textos obrigatórios e se a nota referencia
 * a chave da remessa. A saída e a volta vão sem destaque do imposto (suspenso, cláusula quarta).
 */
export type DemonstrationNote = 'remessa' | 'retorno' | 'entradaSimbolica' | 'venda';

export interface DemonstrationRule {
  clause: string;
  direction: 'entrada' | 'saida';
  /** Natureza da operação exigida; na venda, é a da venda de sempre. */
  nature: string | null;
  /** CFOP dentro do estado e para outro estado; na venda, o CFOP da venda. */
  cfop: { interna: string; interestadual: string } | null;
  /** Expressões obrigatórias nas Informações Adicionais. */
  texts: string[];
  /** A nota leva a chave da nota de remessa. */
  references: boolean;
  /** Com destaque do imposto (só a venda do que o cliente ficou). */
  taxed: boolean;
}

export const DEMONSTRATION = data as {
  act: string;
  source: string;
  url: string;
  /** Prazo da suspensão: a mercadoria volta em até estes dias (cláusula quarta). */
  maxDays: number;
  notes: Record<DemonstrationNote, DemonstrationRule>;
};
