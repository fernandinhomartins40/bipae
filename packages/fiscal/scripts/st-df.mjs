// Extrai, do Caderno I do Anexo IV do RICMS/DF (Decreto 18.955/1997), no texto compilado que a
// Receita-DF publica no seu portal de legislação, as mercadorias em substituição tributária com
// item, CEST, NCM e a MVA (F3-26.d.DF). O texto compilado guarda a redação anterior de cada linha
// alterada, seguida da nota "nova redação dada ao subitem ..." e da linha nova: vale só a última.
// Linhas revogadas ("fica revogado o subitem ...") saem; as repristinadas voltam. A MVA vem da
// coluna da tabela (itens 9 e 38 a 42) ou do texto do próprio item, quando ele a fixa (cigarros,
// cimento, veículos, tintas, sorvetes, autopeças e bebidas quentes). Itens cuja base vem de pauta,
// PMPF ou portaria ficam sem MVA (falta configurar). Nenhum valor é digitado à mão.

/** Portal de legislação da Receita-DF: a API que a página de visualização usa. */
export const DF_LEGISLATION_API =
  'https://ww1.receita.fazenda.df.gov.br/WPI/api/legislacao/obter-legislacao';
export const DF_ANEXO_IV_REQUEST = {
  Ano: 1997,
  Numero: 18955,
  CodigoTipo: '6',
  Parte: 'ANEXO 04 CADERNO 01 COMPILADO',
  Setor: null,
};

const ENTITIES = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  ordm: 'º',
  ordf: 'ª',
  deg: '°',
  sect: '§',
  ndash: '–',
  mdash: '—',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  shy: '',
};

const CELL = '\u0001';

/** Linhas das tabelas (as internas e a externa), cada uma com as células em texto. */
function linesOf(html) {
  return html
    .replace(/\s+/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/t[dh]>/gi, CELL)
    .replace(/<br[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&([a-zA-Z]+);/g, (all, name) => ENTITIES[name] ?? all)
    .replace(/­/g, '')
    .split('\n')
    .map((line) => line.split(CELL).map((c) => c.replace(/\s+/g, ' ').trim()))
    .map((cells) => {
      while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
      return cells;
    });
}

const SUB = /^\d+(?:\.\d*)?(?:-[A-Za-z])?$/;
const CESTS = /^\d{2}\.\d{3}\.\d{2}(?:\s+\d{2}\.\d{3}\.\d{2})*$/;
const NUMBER = /^\d{1,3}(?:,\d{1,2})?$/;
const PROSE_SUB = /^\d+\.\d+$/;

/** "9." e "109" viram "9.0" e "109.0"; "1.0-A" fica "1.0-A". */
const subOf = (text) => {
  const t = text.replace(/\.$/, '').toUpperCase();
  return /^\d+$/.test(t) ? `${t}.0` : t;
};

/** "3815.12.10 3815.12.90" → ["38151210", "38151290"] */
const ncmsOf = (text) => [
  ...new Set(
    text
      .split(/\s+/)
      .map((t) => t.replace(/\D/g, ''))
      .filter((t) => t.length >= 2),
  ),
];

const mvaOf = (text) => text.replace(',', '.');

const textLine = (cells) => cells.filter(Boolean).join(' ');

/** Nome curto do item: o texto antes de "conforme especificado na tabela". */
const nameOf = (text) =>
  text
    .replace(/\s*ITEM$/, '')
    .split(/,?\s*conforme especificad/i)[0]
    .replace(/[:,]\s*$/, '')
    .trim();

/**
 * Lê o HTML do Caderno I (campo `Documento` da resposta da API). `known` são os CEST do Convênio
 * ICMS 142/2018 (sem pontos).
 */
export function parseDfAnexoIV(html, known) {
  const items = [];
  let item = null;
  let group = null;
  let pending = null;
  const skipped = { orphanRows: 0, malformedCest: [] };
  for (const cells of linesOf(html)) {
    if (cells.length === 0) continue;
    const [first = '', second = ''] = cells;
    // Cabeçalho do item: "1 || Cigarros ..., conforme especificado na tabela abaixo: ITEM || ...".
    if (
      /^\d+$/.test(first) &&
      second &&
      !/^\d/.test(second) &&
      (!item || Number(first) > item.number)
    ) {
      item = {
        number: Number(first),
        name: nameOf(second),
        rows: [],
        prose: [],
        groups: new Map(),
      };
      items.push(item);
      group = null;
      pending = null;
      continue;
    }
    if (!item) continue;
    // Grupo dentro do item 40: "I – Chocolates, conforme especificado na tabela abaixo: ITEM".
    const groupCell = cells.find((c) => /^[IVX]+\s*[–-]\s*.+?,\s*conforme especificad/i.test(c));
    if (groupCell && item.prose.length === 0) {
      const [, roman, name] = /^([IVX]+)\s*[–-]\s*(.+?),\s*conforme especificad/i.exec(groupCell);
      group = roman;
      item.groups.set(roman, name.trim());
      continue;
    }
    // Linha de produto: subitem, CEST, NCM, descrição e (às vezes) as MVAs.
    if (SUB.test(first) && CESTS.test(second)) {
      if (item.prose.length > 0) {
        // Tabela repetida depois do texto do item (cópia solta no fim do item 42): não vale.
        skipped.orphanRows++;
        continue;
      }
      const sub = subOf(first);
      const row = {
        group,
        sub,
        cests: second.split(/\s+/).map((c) => c.replace(/\D/g, '')),
        ncmText: cells[2] ?? '',
        description: cells[3] ?? '',
        // Colunas de MVA pela posição (a célula vazia não desloca as outras). Na água sanitária a
        // célula repete o número para dois grupos de UF de origem ("55,66 ___ 55,66"): vale o
        // número quando os dois lados são iguais.
        mvas: cells.slice(4).map((c) => {
          const twin = /^(\S+)\s*_+\s*(\S+)$/.exec(c);
          return twin && twin[1] === twin[2] ? twin[1] : c;
        }),
      };
      if (pending?.kind === 'replace') {
        if (pending.sub && pending.sub !== sub) {
          throw new Error(
            `Anexo IV do RICMS/DF, item ${item.number}: a nova redação é do subitem ${pending.sub}, mas a linha seguinte é o ${sub}`,
          );
        }
        const at = item.rows.findLastIndex((r) => r.group === group && r.sub === sub);
        if (at < 0) {
          throw new Error(
            `Anexo IV do RICMS/DF, item ${item.number}: nova redação do subitem ${sub} sem a redação anterior`,
          );
        }
        item.rows[at] = row;
      } else {
        item.rows.push(row);
      }
      pending = null;
      continue;
    }
    // CEST com dígito faltando no texto oficial ("01.082.0"): não dá para usar sem adivinhar.
    if (SUB.test(first) && /^\d[\d.]*\.\d[\d.]*$/.test(second) && cells.length >= 4) {
      if (item.prose.length === 0) skipped.malformedCest.push(`${item.number}/${first} ${second}`);
      continue;
    }
    // Notas de alteração dentro da tabela (a primeira célula traz o texto).
    if (first && /^(?:nova reda[çc][ãa]o|ficam?\b)/i.test(first) && item.prose.length === 0) {
      const subMatch = /(?:sub)?item (\d+(?:\.\d+)?(?:-[A-Za-z])?)/i.exec(first);
      const target = subMatch ? subOf(subMatch[1]) : null;
      const itemMatch =
        /\bdo (?:caput do )?item (\d+)\b|tabela do item (\d+)\b|ao item (\d+)\b/i.exec(
          first.slice(subMatch ? subMatch.index + subMatch[0].length : 0),
        );
      const itemNumber = itemMatch ? Number(itemMatch[1] ?? itemMatch[2] ?? itemMatch[3]) : null;
      if (itemNumber !== null && itemNumber !== item.number) {
        throw new Error(
          `Anexo IV do RICMS/DF: nota de alteração do item ${itemNumber} dentro do item ${item.number}`,
        );
      }
      if (/^nova reda/i.test(first)) {
        pending = { kind: 'replace', sub: target };
      } else if (/revogad|exclu[ií]d/i.test(first)) {
        const at = item.rows.findLastIndex((r) => r.group === group && r.sub === target);
        if (at < 0) {
          throw new Error(
            `Anexo IV do RICMS/DF, item ${item.number}: revogação do subitem ${target} que não está na tabela`,
          );
        }
        item.rows.splice(at, 1);
        pending = null;
      } else if (/acrescentad|repristinad/i.test(first)) {
        pending = null;
      } else {
        throw new Error(`Anexo IV do RICMS/DF: nota de alteração desconhecida: ${first}`);
      }
      continue;
    }
    // Texto do item (subitens "1.1", "28.5", incisos e notas).
    if (PROSE_SUB.test(first) && first.startsWith(`${item.number}.`)) {
      item.prose.push({ sub: first, text: textLine(cells.slice(1)), cells });
      continue;
    }
    if (item.prose.length > 0) item.prose.push({ sub: null, text: textLine(cells), cells });
  }
  if (items.length < 20) {
    throw new Error(`Esperava o Caderno I do Anexo IV inteiro; achei ${items.length} itens`);
  }
  const unknown = new Set();
  for (const i of items) {
    for (const r of i.rows) for (const c of r.cests) if (!known.has(c)) unknown.add(c);
  }
  const total = items.reduce((n, i) => n + i.rows.length, 0);
  if (total < 500) throw new Error(`Anexo IV do RICMS/DF: só ${total} linhas de produto`);
  if (unknown.size > total / 10) {
    throw new Error('Anexo IV do RICMS/DF: muitos CEST fora do Convênio ICMS 142/18');
  }
  return {
    items: items.map((i) => ({
      number: i.number,
      name: i.name,
      groups: Object.fromEntries(i.groups),
      rows: i.rows,
      mva: mvaRulesOf(i),
    })),
    validFrom: latestDodf(html),
    unknown: [...unknown].sort(),
    skipped,
  };
}

/** Data do DODF mais recente citada no texto: desde quando a redação compilada vale inteira. */
function latestDodf(html) {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
  let latest = '';
  for (const m of text.matchAll(/DODF\s+(?:de\s+)?(\d{1,2})\/(\d{1,2})\/(\d{4})\b/gi)) {
    const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    if (iso > latest) latest = iso;
  }
  if (!latest) throw new Error('Anexo IV do RICMS/DF: nenhuma data de DODF no texto');
  return latest;
}

const PERCENT = String.raw`(\d{1,3}(?:,\d{1,2})?)\s?%`;
const SINGLE = new RegExp(
  String.raw`(?:Margem de Valor Agregado \(MVA[^)]*\)[^%:]*?é de|Percentual a ser aplicado para determinação da base de cálculo da substituição:)\s*${PERCENT}`,
  'i',
);
const LIST_START =
  /Margem de Valor Agregado \(MVA[^)]*\)[^%]*?é de:|A MVA-ST original é:|“?MVA ST original”? corresponde às seguintes margens/i;
const LIST_ENTRY = new RegExp(
  String.raw`^(?:[IVX]+\s*[–-]\s*|[a-z]\)\s*)${PERCENT}\s*(?:\([^)]*\))?\s*,?\s*(.*)$`,
);

/**
 * A MVA que o texto do item fixa. Devolve uma lista de regras { mva, label, subs?, ncms? }:
 * `subs` limita aos subitens da tabela; `ncms` às posições da NCM; sem os dois vale para o item.
 * Vazio quando o item não traz MVA (base por pauta, PMPF ou portaria).
 */
function mvaRulesOf(item) {
  const rules = [];
  const lines = item.prose;
  for (let i = 0; i < lines.length; i++) {
    const { text } = lines[i];
    // Bebidas quentes: tabela de "percentual de agregação"; a linha da alíquota interna é a MVA
    // das operações internas (as outras já vêm ajustadas para cada alíquota interestadual).
    if (/^Alíquota interna$/i.test(lines[i].cells[0] ?? '')) {
      const m = new RegExp(`^${PERCENT}$`).exec(lines[i].cells[1] ?? '');
      if (m)
        rules.push({ mva: mvaOf(m[1]), label: 'operações internas (percentual de agregação)' });
      continue;
    }
    const single = SINGLE.exec(text);
    if (single) {
      rules.push({ mva: mvaOf(single[1]), label: null, from: lines[i].sub });
      continue;
    }
    if (!LIST_START.test(text)) continue;
    const from = lines[i].sub ?? lines.slice(0, i).findLast((l) => l.sub)?.sub ?? null;
    for (let j = i + 1; j < lines.length && !lines[j].sub; j++) {
      const entry = LIST_ENTRY.exec(lines[j].text);
      if (!entry) continue;
      const [, value, rest] = entry;
      const subs = /\bite(?:ns|m) ((?:\d+\.\d+)(?:(?:,\s*|\s+e\s+)\d+\.\d+)*) da tabela/i.exec(
        rest,
      );
      const ncms = /posi[çc](?:ão|ões) ([\d.,\s]+(?:\s+e\s+[\d.]+)?) da NCM/i.exec(rest);
      if (subs) {
        rules.push({ mva: mvaOf(value), label: null, from, subs: subs[1].split(/,\s*|\s+e\s+/) });
      } else if (ncms) {
        rules.push({
          mva: mvaOf(value),
          label: null,
          from,
          ncms: ncmsOf(ncms[1].replace(/\s+e\s+/g, ' ').replace(/,/g, ' ')),
        });
      } else {
        // Alternativa sem filtro (autopeças: com índice de fidelidade ou nos demais casos): o
        // rótulo é o texto do inciso e das alíneas que vêm logo abaixo.
        const extra = [];
        for (
          let k = j + 1;
          k < lines.length && !lines[k].sub && !LIST_ENTRY.test(lines[k].text);
          k++
        ) {
          if (/^(?:nota\b|ficam?\b|nova reda)/i.test(lines[k].text)) continue;
          extra.push(lines[k].text);
        }
        rules.push({
          mva: mvaOf(value),
          label: [rest, ...extra].join(' ').replace(/\s+/g, ' ').trim(),
          from,
        });
      }
    }
  }
  const singles = rules.filter((r) => !r.subs && !r.ncms && !r.label);
  if (new Set(singles.map((r) => r.mva)).size > 1) {
    throw new Error(`Anexo IV do RICMS/DF, item ${item.number}: duas MVAs diferentes no texto`);
  }
  return rules;
}

const TABLE_NOTE =
  'MVA-ST interna da tabela do item. A tabela também traz a MVA para as entradas com 12%, 7% e 4%. Onde a MVA muda conforme o substituto (industrial ou importador, ou atacadista), a descrição diz qual é. Vale a redação atual do texto compilado.';

/** No formato de st-references.json. */
export function dfStReferences(parsed, { url }) {
  const act = 'RICMS/DF (Decreto 18.955/1997), Anexo IV, Caderno I';
  const annexes = [];
  const references = [];
  for (const item of parsed.items) {
    const groups = Object.keys(item.groups);
    const parts =
      groups.length > 0
        ? groups.map((g) => ({
            annex: `${item.number}-${g}`,
            name: item.groups[g],
            rows: item.rows.filter((r) => r.group === g),
          }))
        : [{ annex: String(item.number), name: item.name, rows: item.rows }];
    for (const part of parts) {
      const lines = part.rows.flatMap((r) =>
        r.cests.map((cest, k) => ({
          ...r,
          cest,
          ncms:
            r.cests.length > 1 && ncmsOf(r.ncmText).length === r.cests.length
              ? [ncmsOf(r.ncmText)[k]]
              : ncmsOf(r.ncmText),
        })),
      );
      if (lines.length === 0) continue;
      const cests = new Map();
      for (const l of lines) {
        const list = cests.get(l.cest) ?? [];
        for (const n of l.ncms) if (!list.includes(n)) list.push(n);
        cests.set(l.cest, list);
      }
      annexes.push({
        annex: part.annex,
        name: part.name,
        cests: [...cests].map(([cest, ncms]) => (ncms.length > 0 ? { cest, ncms } : { cest })),
      });
      const base = (l) => ({ cest: l.cest, ncms: l.ncms, ncmText: l.ncmText });
      const fromTable = lines.some((l) => l.mvas.some((c) => NUMBER.test(c)));
      let refItems = [];
      let note;
      if (fromTable) {
        refItems = lines.flatMap((l) => {
          if (l.mvas.length === 1 && NUMBER.test(l.mvas[0])) {
            return [{ item: l.sub, ...base(l), description: l.description, mva: mvaOf(l.mvas[0]) }];
          }
          // Interna da indústria, interna dos atacadistas, 12%, 7%, 4% (e a UF de origem no 41).
          if (l.mvas.length >= 4 && NUMBER.test(l.mvas[0]) && NUMBER.test(l.mvas[1])) {
            return [
              {
                item: `${l.sub}/I`,
                ...base(l),
                description: `${l.description} — substituto industrial ou importador (coluna MVA-ST interna da indústria)`,
                mva: mvaOf(l.mvas[0]),
              },
              {
                item: `${l.sub}/A`,
                ...base(l),
                description: `${l.description} — substituto atacadista (coluna MVA-ST interna dos atacadistas)`,
                mva: mvaOf(l.mvas[1]),
              },
            ];
          }
          if (l.mvas.every((c) => c === '')) return [];
          throw new Error(
            `Anexo IV do RICMS/DF, item ${item.number}/${l.sub}: colunas de MVA fora do padrão (${l.mvas.join(' | ')})`,
          );
        });
        note = lines.every((l) => l.mvas.length <= 1)
          ? 'MVA-ST original da tabela do item. Vale a redação atual do texto compilado.'
          : TABLE_NOTE;
      } else if (item.mva.length > 0) {
        refItems = item.mva.flatMap((rule, k) => {
          const chosen = lines
            .filter((l) => !rule.subs || rule.subs.includes(l.sub))
            .map((l) => ({
              ...l,
              ncms: rule.ncms
                ? l.ncms.filter((n) => rule.ncms.some((p) => n.startsWith(p) || p.startsWith(n)))
                : l.ncms,
            }))
            .filter((l) => l.ncms.length > 0);
          return chosen.map((l) => ({
            item: item.mva.length > 1 && !rule.subs && !rule.ncms ? `${l.sub}/${k + 1}` : l.sub,
            ...base(l),
            description: rule.label
              ? `${l.description} — ${rule.from ? `subitem ${rule.from}: ` : ''}${rule.label}`
              : l.description,
            mva: rule.mva,
          }));
        });
        note = `MVA fixada no texto do item ${item.number} do Caderno I (vale quando não houver preço máximo, sugerido ou de pauta, conforme o item). Vale a redação atual do texto compilado.`;
      }
      if (refItems.length === 0) continue;
      references.push({
        uf: 'DF',
        segment: part.annex,
        segmentName: part.name,
        act: `${act}, item ${item.number}`,
        source: 'stDfAnexoIV',
        url,
        validFrom: parsed.validFrom,
        validTo: null,
        note,
        items: refItems.filter((i) => i.ncms.length > 0),
      });
    }
  }
  return {
    segment: {
      uf: 'DF',
      act: `${act} (texto compilado da Receita-DF)`,
      source: 'stDfAnexoIV',
      url,
      annexes,
    },
    references,
  };
}
