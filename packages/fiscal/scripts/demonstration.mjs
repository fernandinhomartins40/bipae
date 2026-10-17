// Extrai, do texto oficial do Ajuste SINIEF 02/18 (página do CONFAZ), as notas da venda
// condicional ("demonstração"): natureza da operação, CFOP, textos obrigatórios das Informações
// Adicionais e se a nota referencia a chave da remessa (F5-12.c). Nada é digitado à mão.

const QUOTED = /["“]([^"”]+)["”]/g;

/** Texto corrido da página, sem as marcas do HTML. */
export function actText(html) {
  return html
    .replace(/<br[^>]*>|<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

/** As cláusulas do ato, pelo nome ("quinta", "sexta"...), cada uma até a seguinte. */
export function actClauses(html) {
  const text = actText(html);
  const clauses = new Map();
  const heads = [...text.matchAll(/Cláusula ([a-zéêç]+(?: [a-zéêç]+)?)\s/g)];
  heads.forEach((h, i) => {
    const end = i + 1 < heads.length ? heads[i + 1].index : text.length;
    const name = h[1].trim();
    if (!clauses.has(name)) clauses.set(name, text.slice(h.index, end).trim());
  });
  return clauses;
}

const cfopPair = (text) => {
  const m = /(?:código|CFOP)\s+(\d)\.(\d{3}) ou (\d)\.(\d{3})/.exec(text);
  return m ? { interna: `${m[1]}${m[2]}`, interestadual: `${m[3]}${m[4]}` } : null;
};

const nature = (text) => {
  const m = /natureza da operação:\s*["“]?([^;"”\n]+?)["”]?\s*;/.exec(text);
  return m ? m[1].trim() : null;
};

/** As expressões entre aspas do trecho das Informações Adicionais. */
const texts = (text) => {
  const at = text.indexOf('Informações Adicionais');
  if (at < 0) return [];
  const line = text.slice(at).split('\n')[0];
  return [...line.matchAll(QUOTED)].map((m) => m[1].trim());
};

/**
 * As quatro notas da demonstração para consumidor (não contribuinte): remessa (cláusula quinta),
 * retorno (sexta, I), entrada simbólica e venda do que o cliente ficou (oitava, I e II).
 */
export function parseDemonstration(html) {
  const c = actClauses(html);
  const quinta = c.get('quinta');
  const quarta = c.get('quarta');
  const sexta = c.get('sexta');
  const oitava = c.get('oitava');
  if (!quinta || !quarta || !sexta || !oitava) {
    throw new Error('O texto do Ajuste SINIEF 02/18 mudou: faltam as cláusulas quarta a oitava');
  }
  const days = /em até (\d+) \(sessenta dias\)/.exec(quarta)?.[1];
  // A remessa vai até o § 1º (o que vem depois é a nota do prazo vencido).
  const remessa = quinta.split('§ 1º')[0];
  // O retorno dentro do prazo é o inciso I da cláusula sexta.
  const retorno = sexta.split('\n II - ')[0];
  const [simbolica, venda] = oitava.split('\n II - ');
  const notes = {
    remessa: {
      clause: 'quinta',
      direction: 'saida',
      nature: nature(remessa),
      cfop: cfopPair(remessa),
      texts: texts(remessa),
      references: false,
      taxed: false,
    },
    retorno: {
      clause: 'sexta, I',
      direction: 'entrada',
      nature: nature(retorno),
      cfop: cfopPair(retorno),
      texts: texts(retorno),
      references: /referência da chave de acesso/.test(retorno),
      taxed: false,
    },
    entradaSimbolica: {
      clause: 'oitava, I',
      direction: 'entrada',
      nature: nature(simbolica),
      cfop: cfopPair(simbolica),
      texts: texts(simbolica),
      references: /referência das? chaves? de acesso/.test(simbolica),
      taxed: false,
    },
    venda: {
      clause: 'oitava, II',
      direction: 'saida',
      nature: null,
      cfop: null,
      texts: texts(venda ?? ''),
      references: /referência da chave de acesso/.test(venda ?? ''),
      taxed: true,
    },
  };
  for (const [name, note] of Object.entries(notes)) {
    const problem = (name !== 'venda' && (!note.nature || !note.cfop)) || note.texts.length === 0;
    if (problem) throw new Error(`O texto do Ajuste SINIEF 02/18 mudou na nota "${name}"`);
  }
  if (!days) throw new Error('O texto do Ajuste SINIEF 02/18 mudou: não achei o prazo');
  return { maxDays: Number(days), notes };
}
