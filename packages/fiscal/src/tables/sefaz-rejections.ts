import data from './data/sefaz-rejections.json';

/**
 * Rejeições da SEFAZ explicadas (F3-18): para os códigos mais comuns no varejo, a causa e o que
 * fazer no Bipaê, em linguagem simples. O texto oficial de cada código vem do Anexo I do MOC 7.0;
 * para os outros, vale o motivo que a própria SEFAZ devolve.
 */
export type RejectionArea =
  'empresa' | 'certificado' | 'produto' | 'pagamento' | 'cliente' | 'prazo' | 'sistema';

export interface RejectionHelp {
  code: string;
  official: string;
  area: RejectionArea;
  /** corrigir: depende de alguém ajustar; automatico: o Bipaê tenta de novo; suporte: falar com o suporte. */
  next: 'corrigir' | 'automatico' | 'suporte';
  cause: string;
  fix: string;
}

export const SEFAZ_REJECTIONS = data.items as RejectionHelp[];
export const SEFAZ_REJECTIONS_SOURCE = data.source;

/** A explicação do código; quando não há, a mensagem da SEFAZ com a orientação geral. */
export function explainRejection(cStat: string, xMotivo = ''): RejectionHelp {
  const known = SEFAZ_REJECTIONS.find((r) => r.code === cStat);
  if (known) return known;
  return {
    code: cStat,
    official: xMotivo,
    area: 'sistema',
    next: 'suporte',
    cause: xMotivo || 'A SEFAZ recusou a nota.',
    fix: 'Confira os dados citados no motivo. Se não souber o que ajustar, fale com o suporte do Bipaê.',
  };
}
