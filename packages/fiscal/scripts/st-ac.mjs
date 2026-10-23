// Extrai, do PDF oficial da Instrução Normativa DIAT 1/2023 da SEFAZ-AC ("Tabela de
// Multiplicadores", texto consolidado com a IN DIAT 2/2023), o Anexo I: as mercadorias em
// substituição tributária ou antecipação com encerramento da Tabela I do Anexo I do RICMS/AC
// (Decreto 008/1998), com CEST, NCM e a MVA original (F3-26.d.AC). Cada item traz a MVA original
// seguida dos três multiplicadores (entradas com 12%, 7% e 4%); a MVA é o percentual que vem antes
// dessa trinca. As redações anteriores ("Redação original: efeitos até ...") ficam de fora, e o
// item revogado vira "saiu da ST" com a data. Nada é digitado à mão.

const SEGMENT = /^(\d{1,2}) - ([^a-z]+)$/;
const ITEM = /^(\d{1,3}\.\d{1,2}) (\d{2})\.(\d{2,3})\.(\d{2})(?: (.*))?$/;
const NCM = /^\d{4}(?:\.\d{1,2}){0,2}$/;
// MVA original seguida dos multiplicadores originais (12%, 7% e 4%).
const MVA_RUN =
  /(?:^|\s)(\d{1,3}(?:,\d{1,2})?)%\s+\d{1,3},\d{2}%\s+\d{1,3},\d{2}%\s+\d{1,3},\d{2}%/;
const LEGAL = /^(Antecipação|Protocolos?\b|Convênios?\b|Conv\.|Prot\.|Substituição|Decreto)/;
const PAGE_HEADER =
  /^(ESTADO DO ACRE|SECRETARIA DE ESTADO DA FAZENDA|DIRETORIA DE ADMINISTRAÇÃO TRIBUTÁRIA|Página \d+ de \d+)$/;
const NEW_TEXT = /^Nova Redação dada a[oa]s? (?:itens?|item) (.+?), pela Instrução Normativa/i;
const REVOKED =
  /^Item (\d{1,3}\.\d{1,2}) [–-] REVOGADO: \(Instrução Normativa nº (\d+), de .*?Efeitos à partir de (\d{1,2})º?-(\d{2})-(\d{4})/i;
const ORIGINAL = /^Redação original: efeitos até/i;

const percent = (text) =>
  text
    .replace(',', '.')
    .replace(/\.0+$/, '')
    .replace(/(\.\d)0$/, '$1');

/** "1.0, 2.0 e 3.0" → ["1.0", "2.0", "3.0"]. */
const itemNumbers = (text) => [...text.matchAll(/\d{1,3}\.\d{1,2}/g)].map((m) => m[0]);

/**
 * @param lines linhas do PDF (pdf-text.mjs)
 * @param knownCest CEST do Convênio ICMS 142/18 (sem pontos)
 */
export function parseAcIn12023(lines, knownCest) {
  const start = lines.findIndex((l) => l.trim() === 'ANEXO I');
  const end = lines.findIndex((l, i) => i > start && l.trim() === 'ANEXO II');
  if (start < 0 || end < 0) throw new Error('IN DIAT 1/2023 (AC): não achei o Anexo I');

  const segments = [];
  let segment = null;
  let current = null;
  // Redação anterior: itens já lidos na redação nova (ou revogados) que o PDF repete abaixo.
  let pending = null;
  let skipping = false;
  const revocations = new Map();
  for (let i = start + 1; i < end; i++) {
    const line = lines[i].trim();
    if (PAGE_HEADER.test(line)) continue;
    const seg = SEGMENT.exec(line);
    if (seg) {
      segment = { code: seg[1].padStart(2, '0'), name: seg[2].trim(), head: [], items: [] };
      segments.push(segment);
      current = null;
      skipping = false;
      continue;
    }
    const changed = NEW_TEXT.exec(line);
    if (changed) {
      pending = new Set(itemNumbers(changed[1]));
      current = null;
      continue;
    }
    const revoked = REVOKED.exec(line);
    if (revoked) {
      pending = new Set([revoked[1]]);
      revocations.set(`${segment.code} ${revoked[1]}`, {
        from: `${revoked[5]}-${revoked[4]}-${revoked[3].padStart(2, '0')}`,
        by: `Instrução Normativa DIAT ${revoked[2]}/2023`,
      });
      current = null;
      continue;
    }
    if (ORIGINAL.test(line)) {
      skipping = true;
      current = null;
      continue;
    }
    const item = ITEM.exec(line);
    if (item && segment) {
      const cest = `${item[2]}${item[3].padStart(3, '0')}${item[4]}`;
      if (skipping) {
        // Na redação anterior só aparecem itens já lidos (mesmo número e CEST) ou o revogado.
        // O aviso às vezes cita o número errado ("item 15.0" antes do 18.0), por isso a
        // comparação é com o que já foi lido, e não com a lista do aviso.
        const seen = segment.items.some((x) => x.item === item[1] && x.cest === cest);
        const gone = revocations.get(`${segment.code} ${item[1]}`);
        if (seen || (gone && pending?.has(item[1]))) {
          if (!seen) {
            segment.revoked ??= [];
            segment.revoked.push({
              item: item[1],
              cest,
              excludedFrom: gone.from,
              excludedBy: gone.by,
            });
          }
          current = null;
          continue;
        }
      }
      skipping = false;
      // Segmento sem título no PDF (o 5, cimentos, vem logo depois do 4): vale o do CEST.
      if (item[2] !== segment.code) {
        segment = { code: item[2], name: '', head: [], items: [] };
        segments.push(segment);
      }
      current = { item: item[1], cest, lines: item[5] ? [item[5]] : [] };
      segment.items.push(current);
      continue;
    }
    if (skipping) continue;
    if (current) current.lines.push(line);
    else segment?.head.push(line);
  }

  const problems = [];
  for (const s of segments) {
    s.items = s.items.map((raw) => {
      // NCM: as primeiras palavras (na linha do item ou nas seguintes) que têm forma de código.
      const words = raw.lines.join(' ').split(/\s+/).filter(Boolean);
      const ncms = [];
      let at = 0;
      while (at < words.length && NCM.test(words[at])) ncms.push(words[at++].replace(/\./g, ''));
      const rest = words.slice(at).join(' ');
      const description = [];
      for (const piece of rest.split(/\s+/)) {
        if (LEGAL.test(piece) || /^\d{1,3}(?:,\d{1,2})?%$/.test(piece)) break;
        description.push(piece);
      }
      const mva = MVA_RUN.exec(rest);
      if (!knownCest.has(raw.cest)) problems.push(`${s.code} ${raw.cest}`);
      return {
        item: raw.item,
        cest: raw.cest,
        ncms: [...new Set(ncms)],
        description: description.join(' ').trim(),
        mva: mva ? percent(mva[1]) : null,
      };
    });
    // Autopeças: a MVA não vem no item, e sim no quadro do início do segmento (índice de
    // fidelidade e demais casos).
    const [fidelity, others] = s.head.join(' ').split(/Demais Casos/i);
    const first = (text) => (text ? MVA_RUN.exec(text)?.[1] : undefined);
    s.headMvas = [first(fidelity), first(others)].filter(Boolean).map(percent);
    delete s.head;
  }
  const items = segments.flatMap((s) => s.items);
  if (items.length < 800) {
    throw new Error(`Esperava o Anexo I da IN DIAT 1/2023 inteiro; achei ${items.length} itens`);
  }
  if (problems.length > items.length / 20) {
    throw new Error(
      `IN DIAT 1/2023 (AC): muitos CEST fora do Convênio (${problems.slice(0, 5).join(', ')})`,
    );
  }
  return { segments: segments.filter((s) => s.items.length > 0), unknown: problems };
}

const sentence = (upper) => upper.charAt(0) + upper.slice(1).toLocaleLowerCase('pt-BR');

/** IN DIAT 1/2023 (AC) no formato de st-references.json. */
export function acStReferences({ segments }, { url, segmentName }) {
  const ACT = 'RICMS/AC (Decreto 008/1998), Tabela I do Anexo I, na IN DIAT 1/2023 da SEFAZ-AC';
  const references = segments
    .map((s) => {
      const fidelity = s.code === '01' && s.headMvas.length >= 2;
      const items = fidelity
        ? s.items.flatMap((i) => [
            {
              ...i,
              item: `${i.item}/1`,
              description: `${i.description} — saída de fabricante para atender índice de fidelidade (Protocolo ICMS 41/2008)`,
              mva: s.headMvas[0],
            },
            {
              ...i,
              item: `${i.item}/2`,
              description: `${i.description} — demais casos`,
              mva: s.headMvas[1],
            },
          ])
        : s.items;
      return {
        uf: 'AC',
        segment: s.code,
        segmentName: segmentName(s.code) ?? sentence(s.name),
        act: `${ACT}, segmento ${Number(s.code)}`,
        source: 'stAcIn12023',
        url,
        validFrom: '2023-04-01',
        validTo: null,
        note: 'MVA original. Nas entradas interestaduais o Decreto 9.147/2021 manda usar a MVA original para os segmentos que lista (bebidas, ferramentas, limpeza, papéis e vidros, alimentícios, papelaria, perfumaria, eletrônicos e outros); nos demais vale a MVA ajustada, que a tabela também traz. A IN avisa que alterações posteriores na legislação prevalecem sobre ela.',
        items: items
          .filter((i) => i.mva && i.ncms.length > 0)
          .map(({ item, cest, ncms, description, mva }) => ({
            item,
            cest,
            ncms,
            description,
            mva,
          })),
      };
    })
    .filter((r) => r.items.length > 0);
  return {
    segment: {
      uf: 'AC',
      act: ACT,
      source: 'stAcIn12023',
      url,
      annexes: segments.map((s) => ({
        annex: s.code,
        name: segmentName(s.code) ?? sentence(s.name),
        cests: [
          ...new Map([
            ...s.items.map((i) => [
              i.cest,
              { cest: i.cest, ...(i.ncms.length > 0 && { ncms: i.ncms }) },
            ]),
            ...(s.revoked ?? [])
              .filter((r) => !s.items.some((i) => i.cest === r.cest))
              .map((r) => [
                r.cest,
                { cest: r.cest, excludedFrom: r.excludedFrom, excludedBy: r.excludedBy },
              ]),
          ]).values(),
        ],
      })),
    },
    references,
  };
}
