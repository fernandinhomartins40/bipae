// Extrai, do PDF oficial do Decreto 90.309/2023 de Alagoas (regimes de substituição tributária,
// com as MVAs, versão atualizada que a SEFAZ-AL publica), as mercadorias em ST por anexo, com CEST,
// NCM e a MVA-ST original (F3-26.d.AL). Itens com a nota "revogado pelo Decreto ... Efeitos a partir
// de ..." viram "saiu da ST" com a data. Nada é digitado à mão.

const ROMAN = /^ANEXO ([IVXL]+)$/;
const NCM_TOKEN = /^\d{4}(?:\.\d{1,2}){0,2}$|^\d{2}\.\d{2}$|^\d{8}$/;

const isoFromBr = (text) => {
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(text);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

const orderOf = (item) => item.split('.').map(Number);
const between = (item, from, to) => {
  const cmp = (a, b) => a[0] - b[0] || (a[1] ?? 0) - (b[1] ?? 0);
  return cmp(orderOf(item), orderOf(from)) >= 0 && cmp(orderOf(item), orderOf(to)) <= 0;
};

/**
 * @param lines linhas do PDF (pdf-text.mjs)
 * @param knownCest CEST do Convênio ICMS 142/18 (sem pontos)
 */
export function parseAlDecreto90309(lines, knownCest) {
  // Anexos: "ANEXO II" e, na linha seguinte, "DA SUBSTITUIÇÃO TRIBUTÁRIA NAS OPERAÇÕES COM ...".
  const annexes = [];
  let current = null;
  for (let i = 0; i < lines.length; i++) {
    const head = ROMAN.exec(lines[i].trim());
    if (head && /^DAS?\s/.test(lines[i + 1] ?? '')) {
      // O título pode ocupar duas linhas antes do "Art. 1º" ou do "CAPÍTULO".
      const second = /^(Art\.|CAPÍTULO|TABELA)/.test(lines[i + 2] ?? '')
        ? ''
        : ` ${lines[i + 2] ?? ''}`;
      const name = `${lines[i + 1] ?? ''}${second}`
        .replace(/^DA SUBSTITUIÇÃO TRIBUTÁRIA NAS (OPERAÇÕES COM|VENDAS DE)\s*/, '')
        .replace(/^DAS OPERAÇÕES COM\s*/, '')
        .replace(/\s+Art\..*$/, '')
        .trim();
      current = { annex: head[1], name, text: [] };
      annexes.push(current);
      continue;
    }
    if (current) current.text.push(lines[i]);
  }

  const problems = [];
  for (const a of annexes) {
    // Palavra a palavra: depois do número do item, os pedaços do CEST (que o PDF quebra de vários
    // jeitos: "04.00" + "1.00", "17.031.0" + "0") são juntados até formar o código inteiro.
    const tokens = a.text.join(' ').split(/\s+/).filter(Boolean);
    const text = tokens.join(' ');
    const ITEM = /^\d{1,3}\.\d{1,2}$/;
    const CEST_FULL = /^\d{2}\.\d{3}\.\d{2}$/;
    const PIECE = /^[\d.]+$/;
    const starts = [];
    for (let k = 0; k < tokens.length; k++) {
      if (!ITEM.test(tokens[k])) continue;
      let joined = '';
      let m = k + 1;
      while (m < tokens.length && PIECE.test(tokens[m]) && joined.length < 9) {
        joined += tokens[m];
        m++;
        if (CEST_FULL.test(joined)) break;
      }
      if (CEST_FULL.test(joined)) {
        starts.push({ k, item: tokens[k], cest: joined.replace(/\./g, ''), next: m });
        k = m - 1;
      }
    }
    a.items = starts.map((st, n) => {
      const end = n + 1 < starts.length ? starts[n + 1].k : tokens.length;
      const rest = tokens.slice(st.next, end);
      const ncms = [];
      let at = 0;
      while (at < rest.length) {
        let tok = rest[at].replace(/[,;]$/, '');
        // NCM quebrado: "2403." + "1".
        if (/\.$/.test(tok) && /^\d+$/.test(rest[at + 1] ?? '')) {
          tok += rest[at + 1];
          at++;
        }
        if (!NCM_TOKEN.test(tok)) break;
        ncms.push(tok.replace(/\./g, ''));
        at++;
      }
      const block = rest.join(' ');
      const mva = /(\d{1,3}(?:,\d{1,2})?)\s*%/.exec(block);
      const description = rest
        .slice(at)
        .join(' ')
        .split(/\s(?:Prot\.|Conv\.|Protocolos?\b|Convênios?\b|\d{1,3}(?:,\d{1,2})?\s*%|\*)/)[0]
        .trim();
      if (!knownCest.has(st.cest)) problems.push(st.cest);
      return {
        item: st.item,
        cest: st.cest,
        ncms: [...new Set(ncms)],
        ncmText: ncms.join(' '),
        description,
        mva: mva ? mva[1].replace(',', '.') : null,
      };
    });
    // Notas de revogação: "*Item 31.1 revogado ..." e "*Itens 49.2 a 53.2 revogados ...".
    const notes = [
      ...text.matchAll(
        /\*\s*Ite(?:m|ns|ms)\s+(\d{1,3}\.\d{1,2})(?:\s+a\s+(\d{1,3}\.\d{1,2}))?\s+revogad[oa]s?\s+pel[oa]\s+Decreto\s+n\.?\s*[ºo°]?\s*([\d.]+\/\d{4})\.?\s*Efeitos a partir de\s*(\d{2}\/\d{2}\/\d{4})/gi,
      ),
    ];
    a.revoked = [];
    for (const [, from, to, act, date] of notes) {
      for (const it of a.items) {
        if (to ? between(it.item, from, to) : it.item === from) {
          it.excludedFrom = isoFromBr(date);
          it.excludedBy = `Decreto ${act}`;
        }
      }
    }
    delete a.text;
  }
  const items = annexes.flatMap((a) => a.items);
  if (items.length < 300)
    throw new Error(`Esperava o Decreto 90.309/2023 inteiro; achei ${items.length} itens`);
  if (problems.length > items.length / 10) {
    throw new Error(
      `Decreto 90.309/2023: muitos CEST fora do Convênio ICMS 142/18 (${problems.slice(0, 5).join(', ')})`,
    );
  }
  return annexes.filter((a) => a.items.length > 0);
}

const sentence = (upper) => upper.charAt(0) + upper.slice(1).toLocaleLowerCase('pt-BR');

/** Decreto 90.309/2023 no formato de st-references.json. */
export function alStReferences(annexes, { url }) {
  return {
    segment: {
      uf: 'AL',
      act: 'Decreto 90.309/2023 (AL), versão atualizada da SEFAZ-AL',
      source: 'stAlDecreto90309',
      url,
      annexes: annexes.map((a) => ({
        annex: a.annex,
        name: sentence(a.name),
        cests: [
          ...new Map(
            a.items.map((i) => [
              i.cest,
              {
                cest: i.cest,
                ...(i.ncms.length > 0 && { ncms: i.ncms }),
                ...(i.excludedFrom && { excludedFrom: i.excludedFrom, excludedBy: i.excludedBy }),
              },
            ]),
          ).values(),
        ],
      })),
    },
    references: annexes
      .map((a) => ({
        uf: 'AL',
        segment: a.annex,
        segmentName: sentence(a.name),
        act: `Decreto 90.309/2023 (AL), Anexo ${a.annex}`,
        source: 'stAlDecreto90309',
        url,
        validFrom: '2023-06-01',
        validTo: null,
        note: 'MVA-ST original. A tabela também traz as MVAs ajustadas para as entradas com 12%, 7% e 4% (que, segundo a própria SEFAZ-AL, não constam da publicação no DOE). Vale a redação atual.',
        items: a.items
          .filter((i) => i.mva && i.ncms.length > 0 && !i.excludedFrom)
          .map(({ excludedFrom: _f, excludedBy: _b, ...i }) => i),
      }))
      .filter((r) => r.items.length > 0),
  };
}
