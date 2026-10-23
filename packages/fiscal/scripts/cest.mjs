// Extrai a tabela de CEST do texto consolidado do Convênio ICMS 142/18, como publicado pelo
// CONFAZ. O texto mistura a redação vigente com redações anteriores e itens revogados; as regras
// de leitura estão comentadas em cada passo, e o que foge do esperado interrompe a importação.

const ENTITIES = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  ordm: 'º',
  ordf: 'ª',
  deg: '°',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  ndash: '–',
  mdash: '—',
  sect: '§',
};

/** Texto de um trecho de HTML: sem tags, com as entidades trocadas e os espaços normalizados. */
export function htmlText(html) {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&([a-zA-Z]+);/g, (whole, name) => {
      if (!(name in ENTITIES)) throw new Error(`Entidade HTML não prevista: ${whole}`);
      return ENTITIES[name];
    })
    .replace(/\s+/g, ' ')
    .trim();
}

const ROMAN = { I: 1, V: 5, X: 10, L: 50 };
const roman = (text) =>
  [...text].reduce((sum, ch, i, all) => {
    const value = ROMAN[ch];
    return sum + (value < (ROMAN[all[i + 1]] ?? 0) ? -value : value);
  }, 0);

/** "02.05.22" ou "01.08.21." → "2022-05-02". */
const shortDate = (text) => {
  const match = /^(\d{2})\.(\d{2})\.(\d{2})\.?$/.exec(text);
  if (!match) throw new Error(`Data inesperada no convênio: "${text}"`);
  return `20${match[3]}-${match[2]}-${match[1]}`;
};
/** As datas que aparecem numa nota depois da palavra "efeitos", na ordem. */
const effectDates = (note) => {
  const at = note.search(/efeitos/i);
  if (at < 0) return [];
  return [...note.slice(at).matchAll(/\d{2}\.\d{2}\.\d{2}/g)].map((match) => shortDate(match[0]));
};
const nextDay = (iso) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

const CEST = /^\d{2}\.\d{3}\.\d{2}$/;
const NCM_TOKEN = /^\d{2,4}(\.\d{1,2}){0,2}$/;
// O convênio produz efeitos desde 01/01/2019 (cláusula trigésima quinta).
const CONVENIO_START = '2019-01-01';
// Anexos II a XXVI: um por segmento. O XXVII (escala industrial não relevante) é outra lista.
const FIRST_ANNEX = 2;
const LAST_ANNEX = 26;

/**
 * @param {string} html página do Convênio ICMS 142/18 no site do CONFAZ
 * @param {string} downloadedAt data em que a página foi baixada (AAAA-MM-DD)
 */
export function parseCest(html, downloadedAt) {
  const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/gi)];
  const rowsOf = (table) =>
    [...table.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((row) => ({
      cells: [...row[0].matchAll(/<t[dh][\s\S]*?<\/t[dh]>/gi)].map((cell) => htmlText(cell[0])),
      // O site pinta de verde (classes "...verde") as redações que já foram substituídas.
      green: /class="[^"]*verde/i.test(row[0]),
    }));

  // Anexo I: os segmentos. A ordem das linhas é a ordem dos anexos seguintes (II em diante).
  const segments = rowsOf(tables[0][0])
    .map((row) => row.cells)
    .filter((row) => row.length === 3 && /^\d{2}$/.test(row[0]) && /^\d{2}$/.test(row[2]))
    .map((row) => ({ code: row[2], name: row[1] }));
  if (segments.length !== LAST_ANNEX - FIRST_ANNEX + 1) {
    throw new Error(
      `Anexo I com ${segments.length} segmentos; esperados ${LAST_ANNEX - FIRST_ANNEX + 1}`,
    );
  }

  const items = [];
  let previousEnd = tables[0].index + tables[0][0].length;
  for (let n = FIRST_ANNEX; n <= LAST_ANNEX; n++) {
    const table = tables[n - 1];
    // O título do anexo fica entre o fim da tabela anterior e o começo desta.
    const heading = /ANEXO ([IVXL]+)\s/.exec(htmlText(html.slice(previousEnd, table.index)));
    if (!heading || roman(heading[1]) !== n) {
      throw new Error(`Esperava o Anexo ${n} e encontrei "${heading?.[0] ?? 'nada'}"`);
    }
    previousEnd = table.index + table[0].length;
    const segment = segments[n - FIRST_ANNEX];

    // A nota de uma coluna vale para a linha de dados logo abaixo dela. Quando a nota é de redação
    // antiga e cobre vários itens ("itens 49.2 ao 49.7"), as linhas verdes seguintes a herdam.
    let note = '';
    let oldNote = null;
    for (const { cells, green } of rowsOf(table[0])) {
      // Algumas tabelas têm uma coluna vazia a mais no fim, inclusive nas linhas de nota.
      const data = [...cells];
      while (data.length > 0 && data.at(-1) === '') data.pop();
      if (data.length === 0) continue;
      if (data.length === 1) {
        note = data[0];
        continue;
      }
      // Os itens "999" não têm NCM: a célula vazia do meio continua contando.
      while (data.length < 4 && cells.length >= 4) data.push('');
      if (data.length !== 4 || !CEST.test(data[1])) {
        if (data.some((cell) => CEST.test(cell)))
          throw new Error(`Linha de CEST fora do formato: ${JSON.stringify(cells)}`);
        continue; // cabeçalho ou linha vazia
      }
      const [item, cest, ncmCell, description] = data;
      const rowNote = note;
      note = '';
      if (cest.slice(0, 2) !== segment.code) {
        throw new Error(`CEST ${cest} no Anexo ${heading[1]}, que é do segmento ${segment.code}`);
      }
      // Item revogado continua listado, só com a palavra no lugar da descrição.
      if (/^REVOGAD/i.test(description)) continue;
      if (!description) throw new Error(`CEST ${cest} sem descrição`);

      let start = CONVENIO_START;
      let end;
      // A nota diz desde quando, ou até quando, a linha abaixo dela vale. O texto do site varia
      // muito ("efeitos até 31.05.24", "efeitos de 01.06.21. a 31.08.24.", "efeitos a partir de
      // 01.02.21. a 31.07.21.", "xRedação original..."), então a leitura se apoia nas datas que
      // vêm depois da palavra "efeitos": duas = início e fim; uma = fim ("até") ou início ("a
      // partir de"). Qualquer outra forma interrompe a importação.
      if (rowNote) {
        const dates = effectDates(rowNote);
        const tail = rowNote.slice(rowNote.search(/efeitos/i));
        if (dates.length === 0 && /sem efeitos/i.test(rowNote)) {
          oldNote = { never: true };
          continue; // nunca valeu
        }
        if (dates.length === 2) {
          start = dates[0];
          end = nextDay(dates[1]);
        } else if (dates.length === 1 && /\sat[ée]\s/i.test(tail)) {
          end = nextDay(dates[0]);
        } else if (dates.length === 1 && /a partir de/i.test(tail)) {
          start = dates[0];
        } else {
          throw new Error(`Nota sem vigência clara antes do CEST ${cest}: "${rowNote}"`);
        }
        oldNote = end === undefined ? null : { start, end };
      } else if (green) {
        // Linha verde sem nota própria: vale a última nota de redação antiga.
        if (!oldNote)
          throw new Error(`Redação antiga do CEST ${cest} sem nota que diga até quando valeu`);
        if (oldNote.never) continue;
        ({ start, end } = oldNote);
      } else {
        oldNote = null;
      }
      if (green && end === undefined) {
        throw new Error(
          `CEST ${cest}: linha marcada como redação antiga, mas a nota não tem fim de vigência`,
        );
      }
      // Redação já substituída só interessa se ainda valia no dia em que a página foi baixada
      // (acontece quando a nova redação tem efeito futuro).
      if (end !== undefined && end <= downloadedAt) continue;

      const tokens = ncmCell.split(/[\s,]+/).filter(Boolean);
      const ncm = tokens
        .filter((token) => NCM_TOKEN.test(token))
        .map((token) => token.replaceAll('.', ''));
      const plain = tokens.every((token) => NCM_TOKEN.test(token));
      items.push({
        cest: cest.replaceAll('.', ''),
        item,
        segment: segment.code,
        // Prefixos de NCM/SH a que o CEST se aplica (vazio = qualquer NCM, como nos itens 999).
        ncm,
        // Quando a coluna traz texto ("Capítulos 39, 49..."), ele fica guardado como veio.
        ...(!plain && { ncmText: ncmCell }),
        description,
        start,
        ...(end && { end }),
      });
    }
  }

  // Um mesmo CEST só pode aparecer mais de uma vez com vigências que não se cruzam.
  const byCode = new Map();
  for (const item of items) byCode.set(item.cest, [...(byCode.get(item.cest) ?? []), item]);
  const conflicts = [];
  for (const [code, versions] of byCode) {
    versions.sort((a, b) => (a.start < b.start ? -1 : 1));
    for (let i = 1; i < versions.length; i++) {
      const previous = versions[i - 1];
      if (previous.end === undefined || previous.end > versions[i].start) {
        conflicts.push(
          `${code} (itens ${previous.item} de ${previous.start} e ${versions[i].item} de ${versions[i].start})`,
        );
      }
    }
  }
  if (conflicts.length > 0) {
    throw new Error(`CEST com duas redações valendo ao mesmo tempo: ${conflicts.join('; ')}`);
  }
  items.sort((a, b) =>
    a.cest === b.cest ? (a.start < b.start ? -1 : 1) : a.cest < b.cest ? -1 : 1,
  );
  return { segments, items };
}
