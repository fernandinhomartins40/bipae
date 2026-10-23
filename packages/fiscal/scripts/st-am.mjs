// Extrai, da Lei 6.108/2022 do Amazonas (texto "vigente" do SILT, o portal de legislação da
// SEFAZ-AM), as mercadorias em substituição tributária e antecipação com encerramento dos
// Anexos III a XXVI, um por segmento, com CEST, NCM e MVA (F3-26.d.AM). Desde 24/01/2023 essas
// listas substituem as resoluções GSEFAZ 30 a 41/2015 que especificavam o Anexo II-A do RICMS/AM.
// O HTML do SILT traz três versões da lei (multivigente, vigente e original); só a vigente é lida,
// e as notas de alteração ("Nova redação dada pela Lei nº ..., efeitos a partir de ...") dão a
// data de cada linha. Nada é digitado à mão.

const ROMAN = /ANEXO\s+([IVXL]+)\s+(.+)$/;
const CEST = /^(\d{2})\.(\d{3})\.(\d{2})$/;
const MVA = /^(\d{1,3}(?:,\d{1,2})?)\s?%$/;
const NOTE_DATE = /efeitos a partir de (\d{2})\/(\d{2})\/(\d{4})/g;
// Lei publicada no DOE de 23/12/2022, em vigor na publicação (art. 5º).
const LAW_FROM = '2022-12-23';

const decode = (s) =>
  s
    .replace(/<br\s*\/?>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
// Notas de alteração e redações anteriores ficam fora do texto da célula.
const cellText = (html) => decode(html.replace(/<p[^>]*class="v2_[^"]*"[^>]*>[\s\S]*?<\/p>/g, ' '));
const notesOf = (html) =>
  [...html.matchAll(/<p[^>]*class="v2_nota[^"]*"[^>]*>([\s\S]*?)<\/p>/g)].map((m) => decode(m[1]));

const percent = (text) =>
  text
    .replace(/\s?%$/, '')
    .replace(',', '.')
    .replace(/\.0+$/, '')
    .replace(/(\.\d)0$/, '$1');

/** Célula de NCM: "3815.12.10 3815.12.90", "Capítulos 13 e 15 a 23". */
function ncmsOf(text) {
  const chapters = /^Cap[ií]tulos?\s+(.+)$/i.exec(text);
  if (chapters) {
    const out = [];
    for (const m of chapters[1].matchAll(/(\d{1,2})(?:\s+a\s+(\d{1,2}))?/g)) {
      const from = Number(m[1]);
      const to = m[2] ? Number(m[2]) : from;
      for (let c = from; c <= to; c++) out.push(String(c).padStart(2, '0'));
    }
    return out;
  }
  return text
    .split(/\s+/)
    .filter((p) => /^\d{4}(?:\.\d{1,2}){0,2}$/.test(p))
    .map((p) => p.replace(/\./g, ''));
}

/**
 * @param html página do SILT com a Lei 6.108/2022 (ISO-8859-1 já decodificado)
 * @param knownCest CEST do Convênio ICMS 142/18 (sem pontos)
 */
export function parseAmLei6108(html, knownCest) {
  const start = html.indexOf('<div id="vigente"');
  const end = html.indexOf('<div id="original"');
  if (start < 0 || end < start) throw new Error('Lei 6.108/2022 (AM): não achei a versão vigente');
  const body = html.slice(start, end);

  const annexes = [];
  const unknown = [];
  let last = 0;
  for (const table of body.matchAll(/<table[\s\S]*?<\/table>/g)) {
    const head = ROMAN.exec(decode(body.slice(last, table.index)));
    last = table.index + table[0].length;
    if (!head) continue;
    const rows = [...table[0].matchAll(/<tr[\s\S]*?<\/tr>/g)].map((r) =>
      [...r[0].matchAll(/<td[\s\S]*?<\/td>/g)].map((c) => c[0]),
    );
    // Nota no cabeçalho (as colunas de MVA das autopeças mudaram pela Lei 6.222/2023) vale para
    // todas as linhas do anexo.
    const headDates = (rows[0] ?? [])
      .flatMap(notesOf)
      .flatMap((n) => [...n.matchAll(NOTE_DATE)].map((m) => `${m[3]}-${m[2]}-${m[1]}`));
    const items = [];
    for (const row of rows) {
      const cells = row.map(cellText);
      const cest = CEST.exec(cells[1] ?? '');
      if (!cest) continue;
      const mvas = cells
        .slice(4)
        .filter((c) => MVA.test(c))
        .map(percent);
      const dates = row
        .flatMap(notesOf)
        .flatMap((n) => [...n.matchAll(NOTE_DATE)].map((m) => `${m[3]}-${m[2]}-${m[1]}`));
      const code = `${cest[1]}${cest[2]}${cest[3]}`;
      if (!knownCest.has(code)) unknown.push(code);
      items.push({
        item: cells[0].replace(/\.$/, ''),
        cest: code,
        ncms: [...new Set(ncmsOf(cells[2] ?? ''))],
        description: cells[3] ?? '',
        mvas,
        validFrom: [LAW_FROM, ...headDates, ...dates].sort().at(-1),
      });
    }
    if (items.length === 0) continue;
    // Cabeçalho das colunas de MVA (as autopeças têm duas: com e sem índice de fidelidade).
    const header = (rows[0] ?? []).map(cellText).slice(4);
    annexes.push({ annex: head[1], name: head[2].trim(), mvaColumns: header, items });
  }
  const items = annexes.flatMap((a) => a.items);
  if (items.length < 700) {
    throw new Error(
      `Esperava os Anexos III a XXVI da Lei 6.108/2022 inteiros; achei ${items.length} itens`,
    );
  }
  return { annexes, unknown };
}

const sentence = (upper) => upper.charAt(0) + upper.slice(1).toLocaleLowerCase('pt-BR');

/** Lei 6.108/2022 (AM) no formato de st-references.json. */
export function amStReferences({ annexes }, { url, segmentName }) {
  const ACT = 'Lei 6.108/2022 (AM), alterada pela Lei 6.222/2023';
  const nameOf = (a) => segmentName(a.items[0].cest.slice(0, 2)) ?? sentence(a.name);
  const references = annexes
    .map((a) => {
      const two = a.mvaColumns.length > 1;
      const items = a.items.flatMap((i) =>
        i.mvas.map((mva, k) => ({
          item: two ? `${i.item}/${k + 1}` : i.item,
          cest: i.cest,
          ncms: i.ncms,
          description: two
            ? `${i.description} — ${a.mvaColumns[k]
                .replace(/^MVA\s*/i, '')
                .replace(/\s*\/\s*/g, '/')
                .toLocaleLowerCase('pt-BR')}`
            : i.description,
          mva,
          validFrom: i.validFrom,
        })),
      );
      return {
        uf: 'AM',
        segment: a.items[0].cest.slice(0, 2),
        segmentName: nameOf(a),
        act: `${ACT}, Anexo ${a.annex}`,
        source: 'stAmLei6108',
        url,
        validFrom: items.reduce((d, i) => (i.validFrom > d ? i.validFrom : d), '0000-00-00'),
        validTo: null,
        note: 'MVA publicada na lei (uma coluna por anexo; nas autopeças, com e sem índice ou contrato de fidelidade). Quando a mercadoria tem preço na pauta de preços mínimos ou PMPF, o RICMS/AM manda usar esse preço. O Poder Executivo pode excluir mercadorias da ST por decreto (art. 4º da lei).',
        items: items.filter((i) => i.ncms.length > 0).map(({ validFrom: _v, ...i }) => i),
      };
    })
    .filter((r) => r.items.length > 0);
  return {
    segment: {
      uf: 'AM',
      act: `${ACT} (Anexos III a XXVI)`,
      source: 'stAmLei6108',
      url,
      annexes: annexes.map((a) => ({
        annex: a.annex,
        name: nameOf(a),
        cests: [
          ...new Map(
            a.items.map((i) => [
              i.cest,
              { cest: i.cest, ...(i.ncms.length > 0 && { ncms: i.ncms }) },
            ]),
          ).values(),
        ],
      })),
    },
    references,
  };
}
