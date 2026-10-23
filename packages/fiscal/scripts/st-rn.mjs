// Extrai, do Anexo 007 do RICMS/RN (Decreto 31.825/2022) no PDF consolidado da SEFAZ-RN, as
// mercadorias em substituição tributária e a MVA de cada uma (F3-26.d.RN). O PDF guarda a redação
// anterior de cada dispositivo tachada, logo antes ou logo depois da redação nova: o texto chega
// aqui sem o que está riscado (pdfLines com `withoutStruck`), e o texto completo só é usado para
// achar a lista dos segmentos que saíram da ST.
//
// O anexo tem uma seção por segmento. Os quadros de itens (ITEM, CEST, NCM/SH, DESCRIÇÃO) não
// trazem a MVA em coluna, exceto o de pneus: ela vem no texto da seção ("A MVA-ST original é de
// 20%") ou nos quadros de MVA ajustada por CEST (medicamentos, perfumaria, tintas), dos quais se
// lê a MVA original, conferida pela fórmula do art. 3º, § 6º, com a alíquota interna do quadro.
// O Art. 2º vigente diz que segmentos continuam na ST; os que saíram (lâmpadas e rações, desde
// 01/11/2023) entram com a data. Seções sem MVA (base em PMPF, valor da operação ou percentual
// sobre a base) ficam sem MVA e aparecem como "falta configurar". Nenhum valor é digitado à mão.

const SECTION = /^Seção ([IVXL]+)$/;
const ROW = /^(\d{1,3}\.\d{1,2})(?=\s|$)\s*(.*)$/;
const CEST_AT = /^(\d{2})\.(\d{3})\.(\d{2})(?=[\s;.]|$)\s*(.*)$/;
const NCM = /^\d{4}(?:\.\d{1,2}){0,2}$/;
const PERCENT = /^\d{1,3},\d{2}%$/;
const CHAPTER_WORD = /^(?:\d{1,2},?|e|a)$/;
const TABLE_HEAD = /^ITEM (?:CEST|DO)\b/;
// Fim do quadro de itens: outro dispositivo, outro quadro ou um título em maiúsculas.
const TABLE_END =
  /^(?:§|Art\.|Seção\b|[IVXL]+ -|[a-z]\) |SEGMENTO\b|PRODUTOS\b|\(\*\)|\(Redação dada|\(Revogado|\(Incluíd)|^[A-ZÀ-Ý][A-ZÀ-Ý\s,:;“”"–-]{7,}$/;
// Notas de alteração e referências a convênios no fim da descrição.
const NOTE = /\s*\((?:Conv|CV|Convs|Prot|Prots|Redação|Incluíd|Revogado)[^)]*\)?/g;
// RICMS/RN em vigor desde 07/11/2022 (art. 762 do Decreto 31.825/2022).
const RICMS_FROM = '2022-11-07';
const MONTHS = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

/** "29,04" → "29.04"; "42,00" → "42"; "20" → "20". */
const percent = (text) =>
  text
    .replace(',', '.')
    .replace(/\.0+$/, '')
    .replace(/(\.\d)0$/, '$1');

const dotted = (cest) => `${cest.slice(0, 2)}.${cest.slice(2, 5)}.${cest.slice(5)}`;
const plain = (cest) => cest.replace(/\./g, '');
const fold = (text) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** "1º de novembro de 2023", "1º/05/2026", "20/03/25" → data ISO. */
export function rnDate(text) {
  const long = /(\d{1,2})º? de (\p{L}+) de (\d{4})/u.exec(text);
  if (long) {
    const month = MONTHS.indexOf(long[2].toLowerCase()) + 1;
    if (month > 0)
      return `${long[3]}-${String(month).padStart(2, '0')}-${long[1].padStart(2, '0')}`;
  }
  const short = /(\d{1,2})º?\/(\d{2})\/(\d{2}(?:\d{2})?)\b/.exec(text);
  if (short) {
    const year = short[3].length === 2 ? `20${short[3]}` : short[3];
    return `${year}-${short[2]}-${short[1].padStart(2, '0')}`;
  }
  return null;
}

/** Linhas de cada seção ("Seção I" a "Seção XIX"), com o nome da seção. */
function sectionsOf(lines) {
  const out = [];
  let current = null;
  for (let i = 0; i < lines.length; i++) {
    if (/^DOE Nº/.test(lines[i])) break;
    const m = SECTION.exec(lines[i]);
    if (m) {
      current = { roman: m[1], name: lines[i + 1] ?? '', lines: [] };
      out.push(current);
      i++;
      // Nome partido em duas linhas ("... Fundo Estadual de Combate à" / "Pobreza – FECOP").
      while (/\s(?:à|ao|de|do|da|e)$/.test(current.name) && lines[i + 1])
        current.name += ` ${lines[++i]}`;
      continue;
    }
    current?.lines.push(lines[i]);
  }
  return out;
}

/** Uma linha do quadro de itens: NCM no começo das linhas, capítulos, MVA (pneus) e descrição. */
function rowOf(raw) {
  const ncms = [];
  const chapters = [];
  const description = [];
  let mva = null;
  let inChapters = false;
  raw.lines.forEach((line, index) => {
    const words = line.split(' ').filter(Boolean);
    if (inChapters && words.length > 0 && words.every((w) => CHAPTER_WORD.test(w))) {
      chapters.push(...words);
      return;
    }
    inChapters = false;
    while (words.length > 0 && PERCENT.test(words[0])) mva = percent(words.shift().slice(0, -1));
    if (/^Cap[ií]tulos?$/.test(words[0] ?? '')) {
      words.shift();
      inChapters = true;
      while (words.length > 0 && CHAPTER_WORD.test(words[0])) chapters.push(words.shift());
      if (words.length > 0) inChapters = false;
    }
    while (words.length > 0 && NCM.test(words[0])) ncms.push(words.shift().replace(/\./g, ''));
    if (index === 0 || words.length > 0) description.push(...words);
  });
  // "Capítulos 13 e 15 a 23" → 13, 15, 16, ..., 23.
  const chapterText = chapters.join(' ').replace(/,/g, ' ');
  for (const m of chapterText.matchAll(/(\d{1,2})(?:\s+a\s+(\d{1,2}))?/g)) {
    const to = m[2] ? Number(m[2]) : Number(m[1]);
    for (let c = Number(m[1]); c <= to; c++) ncms.push(String(c).padStart(2, '0'));
  }
  return {
    item: raw.item,
    cest: raw.cest,
    ncms: [...new Set(ncms)],
    description: description
      .join(' ')
      .replace(NOTE, '')
      .replace(/,? a partir de \d{1,2}º? de \p{L}+ de \d{4}/u, '')
      .replace(/\s+/g, ' ')
      .replace(/[;.,\s]+$/, '')
      .trim(),
    mvaColumn: mva,
    footnote: raw.footnote,
  };
}

/** Quadros de itens das linhas, cada um com o texto que o introduz (`lead`). */
function tablesOf(lines) {
  const tables = [];
  let current = null;
  let row = null;
  let leadFrom = 0;
  const close = (at) => {
    if (row) current.rows.push(row);
    row = null;
    if (current) {
      tables.push({ ...current, rows: current.rows.map(rowOf) });
      leadFrom = at;
    }
    current = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (TABLE_HEAD.test(line)) {
      close(i);
      current = { lead: lines.slice(leadFrom, i).join(' '), rows: [] };
      continue;
    }
    if (!current) continue;
    const started = current.rows.length > 0 || row;
    const item = ROW.exec(line);
    if (item) {
      if (row) current.rows.push(row);
      row = { item: item[1], cest: null, lines: [], footnote: false };
      const cest = CEST_AT.exec(item[2]);
      if (cest) {
        row.cest = `${cest[1]}${cest[2]}${cest[3]}`;
        row.lines.push(cest[4]);
      }
      continue;
    }
    if (row && !row.cest) {
      // "7.0 (*) 12.007.00": item de outro anexo do Convênio, com nota de rodapé.
      if (/^[(*)]$/.test(line)) {
        row.footnote = true;
        continue;
      }
      const cest = CEST_AT.exec(line);
      if (cest) {
        row.cest = `${cest[1]}${cest[2]}${cest[3]}`;
        row.lines.push(cest[4]);
        continue;
      }
    }
    if (!started) continue;
    if (TABLE_END.test(line)) {
      close(i);
      continue;
    }
    row?.lines.push(line);
  }
  close(lines.length);
  for (const t of tables) {
    const bad = t.rows.find((r) => !r.cest);
    if (bad) throw new Error(`Anexo 007 do RICMS/RN: item ${bad.item} sem CEST no quadro`);
  }
  return tables;
}

/** O texto depois do último dispositivo ("a)", "IV -") do trecho que introduz o quadro. */
const lastProvision = (lead) => {
  const marks = [...lead.matchAll(/(?:^|\s)(?:[IVX]+ -|[a-z]\))\s/g)];
  return marks.length > 0 ? lead.slice(marks.at(-1).index) : lead;
};

/**
 * Lê os quadros de MVA ajustada ("CEST | ALÍQUOTA INTERESTADUAL | MVA AJUSTADA | MVA ORIGINAL")
 * e devolve a MVA original de cada CEST (ou de cada inciso, "I-", "II-"). Cada grupo traz a MVA
 * ajustada a 4%, 7% e 12%, conferida pela fórmula do art. 3º, § 6º, com a alíquota interna do
 * cabeçalho; o PDF mistura as colunas na ordem do texto, por isso a leitura é por grupo.
 */
export function rnMvaQuadros(text, sectionCests) {
  const heads = [...text.matchAll(/ALÍQUOTA\s+INTEREST[\s\S]*?ORIGIN[AÁ] ?L/g)];
  const byKey = new Map();
  heads.forEach((head, h) => {
    const intra = /Interna\s*(\d{1,2})%/i.exec(head[0]);
    if (!intra) throw new Error('Anexo 007 do RICMS/RN: quadro de MVA sem a alíquota interna');
    const from = head.index + head[0].length;
    const to = Math.min(
      heads[h + 1]?.index ?? text.length,
      ...[text.indexOf('(Redação dada', from)].filter((i) => i >= 0),
    );
    const body = text.slice(from, to).replace(/(\d{2}\.\d{3}\.\d)\s(\d)(?!\d)/g, '$1$2');
    const groups = [];
    let group = null;
    let rate = null;
    let rangeFrom = null;
    let lastWasCest = false;
    const open = (key) => {
      if (!group || group.closed || key) {
        group = { keys: [], adjusted: {}, originals: [], closed: false };
        groups.push(group);
      }
      if (key) group.keys.push(key);
    };
    for (const t of body.matchAll(
      /(\d{2}\.\d{3}\.\d{2})|(\d{1,3},\d{2})%|(?<=\s|;)(a)(?=\s)|\b(I{1,3}|IV|V)-(?=[A-ZÀ-Ý])/g,
    )) {
      if (t[1]) {
        const cest = plain(t[1]);
        if (!group || group.closed) open();
        if (rangeFrom) {
          for (const c of sectionCests) if (c > rangeFrom && c < cest) group.keys.push(c);
          rangeFrom = null;
        }
        group.keys.push(cest);
        lastWasCest = true;
        continue;
      }
      if (t[3]) {
        if (lastWasCest) rangeFrom = group.keys.at(-1);
        continue;
      }
      lastWasCest = false;
      if (t[4]) {
        open(t[4]);
        continue;
      }
      if (!group) continue;
      const value = t[2];
      if (rate) {
        group.adjusted[rate] = value;
        if (rate === '12,00') group.closed = true;
        rate = null;
      } else if (['4,00', '7,00', '12,00'].includes(value)) rate = value;
      else group.originals.push(value);
    }
    for (const g of groups) {
      if (g.originals.length !== 1) {
        throw new Error(
          `Anexo 007 do RICMS/RN: quadro de MVA com ${g.originals.length} MVA original para ${g.keys.join(', ')}`,
        );
      }
      if (Object.keys(g.adjusted).length !== 3) {
        throw new Error(`Anexo 007 do RICMS/RN: quadro de MVA incompleto em ${g.keys.join(', ')}`);
      }
      // A MVA original precisa explicar ao menos duas das três ajustadas: o quadro oficial tem
      // erro de digitação pontual (tintas, CEST 24.003.00: 74,34% a 7%, quando a conta dá 74,38%).
      const original = Number(g.originals[0].replace(',', '.'));
      const matches = Object.entries(g.adjusted).filter(([inter, adjusted]) => {
        const expected =
          ((1 + original / 100) * (1 - Number(inter.replace(',', '.')) / 100)) /
            (1 - Number(intra[1]) / 100) -
          1;
        return Math.abs(expected * 100 - Number(adjusted.replace(',', '.'))) <= 0.015;
      });
      if (matches.length < 2) {
        throw new Error(
          `Anexo 007 do RICMS/RN: MVA ajustada não bate com a original ${g.originals[0]}% (${g.keys.join(', ')})`,
        );
      }
      for (const key of g.keys) {
        const mva = percent(g.originals[0]);
        if (byKey.has(key) && byKey.get(key) !== mva) {
          throw new Error(
            `Anexo 007 do RICMS/RN: ${key} com duas MVAs (${byKey.get(key)} e ${mva})`,
          );
        }
        byKey.set(key, mva);
      }
    }
  });
  return byKey;
}

const pick = (re, text, what) => {
  const m = re.exec(text);
  if (!m) throw new Error(`Anexo 007 do RICMS/RN: não achei ${what}`);
  return m;
};

/** Itens do quadro, cada um com a MVA do mapa (todos precisam ter). */
function withQuadro(items, quadro, what) {
  return items.map((i) => {
    const mva = quadro.get(i.cest);
    if (!mva) throw new Error(`Anexo 007 do RICMS/RN, ${what}: CEST ${dotted(i.cest)} sem MVA`);
    return { ...i, mva };
  });
}

const SIGNATORY = 'procedente do exterior ou de UF signatária do Protocolo ICMS 53/2017';
const NON_SIGNATORY = 'procedente de UF não signatária do Protocolo ICMS 53/2017';

/**
 * Como cada segmento dá a MVA. Devolve grupos de linhas ({ label, items, validFrom }) e o
 * dispositivo de onde ela veio; segmentos sem MVA devolvem `null` com o motivo.
 */
const READERS = {
  // Cigarros: MVA na falta da lista de preço sugerido (art. 7º, § 2º).
  '04': ({ text, items }) => {
    const m = pick(
      /Margem de Valor Agregado \(MVA\) de (\d{1,3}(?:,\d{1,2})?)%/,
      text,
      'a MVA dos cigarros',
    );
    return {
      article: 'art. 7º, § 2º',
      groups: [{ items: items.map((i) => ({ ...i, mva: percent(m[1]) })) }],
    };
  },
  // Cimento: "A MVA-ST original é de 20%" (art. 8º, § 5º).
  '05': ({ text, items }) => {
    const m = pick(/A MVA-ST original é de (\d{1,3}(?:,\d{1,2})?)%/, text, 'a MVA do cimento');
    return {
      article: 'art. 8º, § 5º',
      groups: [{ items: items.map((i) => ({ ...i, mva: percent(m[1]) })) }],
    };
  },
  // Medicamentos: quadro do art. 12, § 5º, por lista (negativa, positiva e neutra).
  13: ({ text, items }) => ({
    article: 'art. 12, § 5º',
    groups: [
      {
        items: withQuadro(
          items,
          rnMvaQuadros(
            text,
            items.map((i) => i.cest),
          ),
          'medicamentos',
        ),
      },
    ],
  }),
  // Pneus: coluna "MVA ORIGINAL" do quadro de itens, conferida pelo quadro de MVA ajustada.
  16: ({ text, items }) => {
    const quadro = rnMvaQuadros(
      text,
      items.map((i) => i.cest),
    );
    for (const i of items) {
      if (!i.mvaColumn || quadro.get(i.cest) !== i.mvaColumn) {
        throw new Error(`Anexo 007 do RICMS/RN, pneus: MVA do CEST ${dotted(i.cest)} não confere`);
      }
    }
    return {
      article: 'art. 14, § 7º',
      groups: [{ items: items.map((i) => ({ ...i, mva: i.mvaColumn })) }],
    };
  },
  // Alimentícios (art. 15, § 2º): MVA pela origem (signatária ou não do Protocolo ICMS 53/2017).
  17: ({ tables, decreeDates }) => {
    if (tables.length !== 4) {
      throw new Error(
        `Anexo 007 do RICMS/RN, alimentícios: esperava 4 quadros, achei ${tables.length}`,
      );
    }
    const [ta, tb, tIII, tIV] = tables;
    pick(
      /I - nas operações procedentes do exterior ou de unidade federada signatária/,
      ta.lead,
      'o inciso I dos alimentícios',
    );
    const aSig = pick(
      /a\) (\d{1,3})% \([^)]*\), para produtos classificados/,
      ta.lead,
      'a alínea "a" do inciso I',
    );
    const bSig = pick(
      /b\) (\d{1,3})% \([^)]*\), para produtos classificados/,
      tb.lead,
      'a alínea "b" do inciso I',
    );
    const non = pick(
      /II - nas operações procedentes de unidade da Federação não signatária[^:]*: a\) (\d{1,3})% \([^)]*\) para produtos indicados na alínea “a” do inciso I[^;]*; b\) (\d{1,3})% \([^)]*\) para produtos indicados na alínea “b” do inciso I/,
      tIII.lead,
      'o inciso II dos alimentícios',
    );
    pick(
      /III - às entradas neste Estado[^:]*: a\) as MVAs previstas na alínea “a” do inciso I do § 2º ?para as massas alimentícias e na alínea “b” para os biscoitos e bolachas/,
      tIII.lead,
      'o inciso III dos alimentícios',
    );
    const iv = pick(
      /IV - às entradas neste Estado dos produtos constantes do quadro a seguir, aplicando-se a MVA de (\d{1,3})%/,
      tIV.lead,
      'o inciso IV dos alimentícios',
    );
    const fromOf = (lead) => {
      const note = /Redação dada pelo Decreto nº ([\d.]+), de \d{4}([^)]*)\)/.exec(
        lastProvision(lead),
      );
      if (!note) return RICMS_FROM;
      return rnDate(note[2]) ?? decreeDates.get(note[1]) ?? RICMS_FROM;
    };
    const both = (rows, sig, non) =>
      rows.flatMap((r) => [
        {
          ...r,
          item: `${r.item}/1`,
          description: `${r.description} — ${SIGNATORY}`,
          mva: percent(sig),
        },
        {
          ...r,
          item: `${r.item}/2`,
          description: `${r.description} — ${NON_SIGNATORY}`,
          mva: percent(non),
        },
      ]);
    const kindOf = (r) => {
      if (/^Massas/.test(r.description)) return 'a';
      if (/^Biscoitos/.test(r.description)) return 'b';
      throw new Error(`Anexo 007 do RICMS/RN, alimentícios: item ${r.item} nem massa nem biscoito`);
    };
    return {
      article: 'art. 15, § 2º',
      groups: [
        {
          provision: 'I, "a", e II, "a"',
          validFrom: fromOf(ta.lead),
          items: both(ta.rows, aSig[1], non[1]),
        },
        {
          provision: 'I, "b", e II, "b"',
          validFrom: fromOf(tb.lead),
          items: both(tb.rows, bSig[1], non[2]),
        },
        {
          provision: 'III',
          validFrom: fromOf(tIII.lead),
          items: tIII.rows.flatMap((r) =>
            kindOf(r) === 'a' ? both([r], aSig[1], non[1]) : both([r], bSig[1], non[2]),
          ),
        },
        {
          provision: 'IV',
          validFrom: fromOf(tIV.lead),
          items: tIV.rows.map((r) => ({ ...r, mva: percent(iv[1]) })),
        },
      ],
    };
  },
  // Perfumaria e higiene: quadros do art. 16, § 2º (Protocolos ICMS 16/85 e 58/18).
  20: ({ text, items }) => ({
    article: 'art. 16, § 2º',
    groups: [
      {
        items: withQuadro(
          items,
          rnMvaQuadros(
            text,
            items.map((i) => i.cest),
          ),
          'perfumaria',
        ),
      },
    ],
  }),
  // Sorvetes (art. 19): MVA-ST original do § 3º e a da operação interna do fabricante do § 6º.
  23: ({ text, items }) => {
    const original = pick(
      /MVA ST original” corresponde às seguintes margens de valor agregado: I - (\d{1,3})% \([^)]*\) para os produtos indicados no inciso I do caput deste artigo; II - (\d{1,3})% \([^)]*\) para os produtos indicados no inciso II/,
      text,
      'a MVA-ST original dos sorvetes',
    );
    const internal = pick(
      /Tratando-se de operação interna de fabricante[^:]*:(?: \([^)]*\))* I - (\d{1,3})% \([^)]*\) para o produto indicado no item (\d+\.\d) do quadro do § 10[^;]*; e II - (\d{1,3})% \([^)]*\) para os produtos indicados no item (\d+\.\d) do quadro do § 10/,
      text,
      'a MVA da operação interna do fabricante de sorvetes',
    );
    const caput = pick(
      /I - (\p{L}+) de qualquer espécie[^;]*; II - (\p{L}+) para fabricação/u,
      text,
      'os incisos do art. 19',
    );
    const quadro = rnMvaQuadros(text, []);
    if (quadro.get('I') !== percent(original[1]) || quadro.get('II') !== percent(original[2])) {
      throw new Error('Anexo 007 do RICMS/RN, sorvetes: quadro de MVA não confere com o § 3º');
    }
    // O § 6º liga o inciso I ao item 1.0 e o II ao item 2.0; a descrição do item confirma.
    const byInciso = [
      { item: internal[2], word: caput[1], original: original[1], internal: internal[1] },
      { item: internal[4], word: caput[2], original: original[2], internal: internal[3] },
    ];
    return {
      article: 'art. 19, §§ 3º e 6º',
      groups: [
        {
          items: byInciso.flatMap((b) => {
            const row = items.find((i) => i.item === b.item);
            if (!row || fold(row.description.split(' ')[0]) !== fold(b.word)) {
              throw new Error(`Anexo 007 do RICMS/RN, sorvetes: item ${b.item} não é "${b.word}"`);
            }
            return [
              {
                ...row,
                item: `${row.item}/1`,
                description: `${row.description} — MVA-ST original (nas entradas de outra UF, ajustada à alíquota interestadual)`,
                mva: percent(b.original),
              },
              {
                ...row,
                item: `${row.item}/2`,
                description: `${row.description} — operação interna do fabricante`,
                mva: percent(b.internal),
              },
            ];
          }),
        },
      ],
    };
  },
  // Tintas: quadro do art. 20, § 2º.
  24: ({ text, items }) => ({
    article: 'art. 20, § 2º',
    groups: [
      {
        items: withQuadro(
          items,
          rnMvaQuadros(
            text,
            items.map((i) => i.cest),
          ),
          'tintas',
        ),
      },
    ],
  }),
  // Veículos: MVA-ST original do art. 21, § 5º, para o Anexo XXIV do Convênio ICMS 142/2018.
  25: ({ text, items }) => {
    const m = pick(
      /Margem de Valor Agregado \(MVA-ST\) original de que trata [^.]*? é de (\d{1,3})%/,
      text,
      'a MVA dos veículos',
    );
    return {
      article: 'art. 21, § 5º',
      groups: [{ items: items.map((i) => ({ ...i, mva: percent(m[1]) })) }],
    };
  },
  // Motos: MVA-ST original do art. 22, § 4º.
  26: ({ text, items }) => {
    const m = pick(
      /Margem de Valor Agregado \(MVA-ST\) original referida [^.]*? é de (\d{1,3})%/,
      text,
      'a MVA dos veículos de duas e três rodas',
    );
    return {
      article: 'art. 22, § 4º',
      groups: [{ items: items.map((i) => ({ ...i, mva: percent(m[1]) })) }],
    };
  },
  // Porta a porta: "margem de valor agregado de 40%" (art. 23, § 2º).
  28: ({ text, items }) => {
    const m = pick(/margem de valor agregado de (\d{1,3})%/, text, 'a MVA da venda porta a porta');
    return {
      article: 'art. 23, § 2º',
      groups: [{ items: items.map((i) => ({ ...i, mva: percent(m[1]) })) }],
    };
  },
};

/** Segmentos que continuam na ST sem MVA, com o motivo (vão para a cobertura como "falta configurar"). */
const WITHOUT_MVA = {
  '03': 'Base no PMPF do ato do Secretário; na falta dele, MVA por produto (cerveja, refrigerante, chope, xarope, água) e por tipo de remetente (indústria ou atacadista), sem ligação com o CEST no texto (art. 6º, § 7º; dúvida D-043).',
  '06': 'Base no PMPF (Convênio ICMS 142/2018, Anexo VII; art. 9º).',
  '07': 'Base no valor da operação, sem MVA (art. 10).',
  21: 'O imposto é um percentual sobre a base (4,5% nas aquisições interestaduais, 1,4% nas saídas internas do industrial), sem MVA (art. 17, § 3º).',
};

/**
 * Lê o Anexo 007.
 * @param clean linhas do PDF sem o texto tachado (pdfLines com `withoutStruck`)
 * @param raw linhas do PDF com tudo (para os segmentos que saíram da ST)
 * @param cest tabela do CEST (cest.json): segmentos na ordem dos anexos do Convênio e itens
 */
export function parseRnAnexo007(clean, raw, { segments, cests }) {
  if (!clean.slice(0, 3).some((l) => /^ANEXO 007 DO DECRETO Nº 31\.825/.test(l))) {
    throw new Error('Anexo 007 do RICMS/RN não encontrado');
  }
  const until = pick(
    /Atualizado até o Decreto nº ([\d.]+), de (\d{2}\/\d{2}\/\d{4})/,
    clean.slice(0, 5).join(' '),
    'a data de atualização do Anexo 007',
  );
  const known = new Set(cests.map((c) => c.cest));
  const segmentName = (code) => segments.find((s) => s.code === code)?.name ?? `Segmento ${code}`;

  // Data de publicação de cada decreto, do histórico de alterações no fim do anexo.
  const decreeDates = new Map(
    [
      ...raw
        .join(' ')
        .matchAll(
          /Decreto nº ([\d.]+), de \d{2}\/\d{2}\/\d{4},\s*(?:re)?publicado no DOE nº [\d.]+, de (\d{1,2})º?\/(\d{2})\/(\d{4})/g,
        ),
    ].map((m) => [m[1], `${m[4]}-${m[3]}-${m[2].padStart(2, '0')}`]),
  );

  // Art. 2º: segmentos na ST hoje (texto limpo) e os que já estiveram (texto com o tachado).
  const art2 = (lines) => {
    const from = lines.findIndex((l) => /^Art\. 2º O Estado do Rio Grande do Norte adota/.test(l));
    const to = lines.findIndex((l, i) => i > from && /^CAPÍTULO III/.test(l));
    if (from < 0 || to < 0) throw new Error('Anexo 007 do RICMS/RN: não achei o Art. 2º');
    const codes = new Map();
    for (const l of lines.slice(from, to)) {
      const m = /^\d{2} (.+) (\d{2})$/.exec(l);
      if (m) codes.set(m[2], m[1]);
    }
    return { codes, text: lines.slice(from, to).join(' ') };
  };
  const now = art2(clean);
  const ever = art2(raw);
  const art2Note = pick(
    /\(Redação dada pelo Decreto nº ([\d.]+), de (\d{4}), com vigência a partir de ([^)]+)\)/,
    now.text,
    'a redação do Art. 2º',
  );
  const removedCodes = [...ever.codes.keys()].filter((c) => !now.codes.has(c));
  if (now.codes.size < 10) throw new Error('Anexo 007 do RICMS/RN: Art. 2º com poucos segmentos');

  const sections = [];
  const unknown = [];
  for (const section of sectionsOf(clean)) {
    const text = section.lines.join(' ').replace(/\s+/g, ' ');
    const tables = tablesOf(section.lines);
    let items = tables.flatMap((t) => t.rows);
    for (const i of items) if (!known.has(i.cest)) unknown.push(i.cest);
    // Seções sem quadro que remetem ao anexo do Convênio (veículos, combustíveis).
    const byConvenio = /relacionados no Anexo ([IVXL]+) do Convênio (?:nº )?ICMS (?:nº )?142/.exec(
      text,
    );
    if (items.length === 0 && byConvenio) {
      const roman = [...byConvenio[1]].reduce((acc, ch, k, all) => {
        const v = { I: 1, V: 5, X: 10, L: 50 };
        return acc + (v[ch] < (v[all[k + 1]] ?? 0) ? -v[ch] : v[ch]);
      }, 0);
      const segment = segments[roman - 2];
      items = cests
        .filter((c) => c.segment === segment.code && !c.end)
        .map((c) => ({
          item: c.item,
          cest: c.cest,
          ncms: c.ncm,
          description: c.description,
          fromConvenio: true,
        }));
    }
    if (items.length === 0) {
      sections.push({
        roman: section.roman,
        name: section.name,
        segment: null,
        items: [],
        groups: [],
      });
      continue;
    }
    // Segmento da seção: o do CEST da maioria dos itens (o item com nota de rodapé é de outro).
    const count = new Map();
    for (const i of items)
      if (!i.footnote) count.set(i.cest.slice(0, 2), (count.get(i.cest.slice(0, 2)) ?? 0) + 1);
    const segment = [...count].sort((a, b) => b[1] - a[1])[0][0];
    if (!now.codes.has(segment)) {
      throw new Error(
        `Anexo 007 do RICMS/RN: seção ${section.roman} (segmento ${segment}) fora do Art. 2º`,
      );
    }
    const reader = READERS[segment];
    const read = reader ? reader({ text, items, tables, decreeDates }) : null;
    if (!reader && !WITHOUT_MVA[segment]) {
      throw new Error(
        `Anexo 007 do RICMS/RN: seção ${section.roman} (segmento ${segment}) sem leitura`,
      );
    }
    sections.push({
      roman: section.roman,
      name: section.name,
      segment,
      items,
      article: read?.article ?? null,
      groups: read?.groups ?? [],
      withoutMva: reader ? null : WITHOUT_MVA[segment],
    });
  }

  // Segmentos que saíram da ST: os itens vêm do quadro tachado da seção.
  const rawSections = sectionsOf(raw).map((s) => ({
    roman: s.roman,
    rows: tablesOf(s.lines).flatMap((t) => t.rows),
  }));
  const removed = removedCodes.map((code) => {
    const from = rawSections.filter((s) => s.rows.some((r) => r.cest.startsWith(code)));
    const rows = from.flatMap((s) => s.rows).filter((r) => r.cest.startsWith(code));
    if (rows.length === 0)
      throw new Error(`Anexo 007 do RICMS/RN: segmento ${code} sem itens no texto`);
    return {
      segment: code,
      sections: from.map((s) => s.roman),
      name: ever.codes.get(code),
      excludedFrom: rnDate(art2Note[3]),
      excludedBy: `Decreto ${art2Note[1]}/${art2Note[2]}`,
      items: [...new Map(rows.map((r) => [r.cest, r])).values()],
    };
  });

  const total = sections.reduce((n, s) => n + s.groups.reduce((m, g) => m + g.items.length, 0), 0);
  if (sections.length < 18 || total < 250) {
    throw new Error(
      `Esperava o Anexo 007 do RICMS/RN inteiro; achei ${sections.length} seções e ${total} linhas com MVA`,
    );
  }
  return {
    updatedBy: `Decreto ${until[1]}/${until[2].slice(-4)}`,
    updatedAt: until[2],
    sections,
    removed,
    unknown,
    // Seções que ficam fora da tabela de MVA, com o motivo.
    notRead: sections
      .filter((s) => s.groups.length === 0)
      .map((s) => {
        const text = clean.join(' ');
        const out = removed.find((r) => r.sections.includes(s.roman));
        const fecop = /Fundo Estadual de Combate à/.test(s.name)
          ? pick(
              /Margem de Valor Agregado – MVA de (\d{1,3})%/,
              text,
              'a MVA do adicional do FECOP',
            )
          : null;
        const aguardente = /^Aguardente/.test(s.name)
          ? pick(/§ 3º A MVA-ST original é de (\d{1,3},\d{2})%/, text, 'a MVA da aguardente')
          : null;
        let reason = s.withoutMva;
        if (out) {
          reason = `Saiu da ST em ${out.excludedFrom.split('-').reverse().join('/')} (${out.excludedBy}).`;
        } else if (fecop) {
          reason = `Adicional de 2 pontos do FECOP (arts. 24 a 26), por posição de NCM e sem CEST; MVA de ${fecop[1]}% na falta de preço final.`;
        } else if (aguardente) {
          reason = `O art. 4º fixa a MVA-ST original de ${aguardente[1]}% pelas NCM 2207.20 e 2208.40.00, sem quadro de CEST (dúvida D-043).`;
        }
        if (!reason)
          throw new Error(`Anexo 007 do RICMS/RN: seção ${s.roman} sem MVA e sem motivo`);
        return { section: s.roman, name: s.name, reason };
      }),
    segmentName,
  };
}

/** Anexo 007 (RN) no formato de st-references.json. */
export function rnStReferences(parsed, { url }) {
  const { sections, removed, segmentName } = parsed;
  const ACT = `RICMS/RN (Decreto 31.825/2022), Anexo 007, atualizado até o ${parsed.updatedBy}`;
  const NOTE =
    'MVA-ST original. Nas entradas de outra UF, a MVA é ajustada à alíquota interestadual (Anexo 007, art. 3º, § 6º). Quando o segmento tem preço máximo, preço sugerido pelo fabricante, PMC ou PMPF, a base é esse preço e a MVA só vale na falta dele.';
  const references = sections.flatMap((s) =>
    s.groups.map((g) => ({
      uf: 'RN',
      segment: s.segment,
      segmentName: segmentName(s.segment),
      act: `${ACT}, Seção ${s.roman}, ${s.article}${g.provision ? `, ${g.provision}` : ''}`,
      source: 'stRnAnexo007',
      url,
      validFrom: g.validFrom ?? RICMS_FROM,
      validTo: null,
      note:
        s.segment === '17'
          ? `${NOTE} Nos alimentícios a MVA depende da origem: UF signatária do Protocolo ICMS 53/2017 (ou exterior) e não signatária.`
          : NOTE,
      items: g.items
        .filter((i) => i.ncms.length > 0)
        .map(({ item, cest, ncms, description, mva }) => ({ item, cest, ncms, description, mva })),
    })),
  );
  const annexes = [
    ...sections
      .filter((s) => s.segment)
      .map((s) => ({
        annex: s.segment,
        name: segmentName(s.segment),
        cests: [
          ...new Map(
            s.items.map((i) => [
              i.cest,
              i.fromConvenio || i.ncms.length === 0
                ? { cest: i.cest }
                : { cest: i.cest, ncms: i.ncms },
            ]),
          ).values(),
        ],
      })),
    ...removed.map((r) => ({
      annex: r.segment,
      name: segmentName(r.segment),
      excludedFrom: r.excludedFrom,
      excludedBy: r.excludedBy,
      cests: r.items.map((i) =>
        i.ncms.length > 0 ? { cest: i.cest, ncms: i.ncms } : { cest: i.cest },
      ),
    })),
  ];
  return {
    segment: { uf: 'RN', act: ACT, source: 'stRnAnexo007', url, annexes },
    references: references.filter((r) => r.items.length > 0),
    notRead: parsed.notRead,
  };
}
