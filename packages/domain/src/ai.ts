/**
 * Assistente de IA (F6-07, ADR-0011): a sugestão fiscal só vira cadastro com a aprovação de uma
 * pessoa; as perguntas sobre o negócio são respondidas com os relatórios da própria conta.
 */
export interface AiStatus {
  /** O Bipaê tem o provedor de IA configurado (chave da API). */
  configured: boolean;
  /** A conta ligou o assistente. */
  enabled: boolean;
  model: string | null;
  usedToday: number;
  dailyLimit: number;
}

export type AiConfidence = 'alta' | 'media' | 'baixa';

export const AI_CONFIDENCE_LABELS: Record<AiConfidence, string> = {
  alta: 'Confiança alta',
  media: 'Confiança média',
  baixa: 'Confiança baixa',
};

/** Sugestão já conferida contra as tabelas oficiais: o que não existe ficou de fora, com aviso. */
export interface AiFiscalSuggestion {
  ncm: string | null;
  ncmDescription: string | null;
  cest: string | null;
  cClassTrib: string | null;
  /** Perfil fiscal da conta com esse cClassTrib, se houver. */
  fiscalProfileId: string | null;
  justification: string;
  confidence: AiConfidence;
  warnings: string[];
}

export interface AiSuggestionView {
  id: string;
  productId: string;
  status: 'pending' | 'approved' | 'rejected';
  suggestion: AiFiscalSuggestion;
  model: string;
  createdAt: string;
  decidedAt: string | null;
}

export interface AiAnswer {
  answer: string;
  /** Relatórios consultados para responder. */
  tools: string[];
  model: string;
}

export const AI_TOOL_LABELS: Record<string, string> = {
  vendas: 'Relatório de vendas',
  resultado_mensal: 'Resultado do mês (DRE)',
  contas: 'Contas a pagar e a receber',
  perdas: 'Perdas',
};
