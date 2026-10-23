// Extrai, dos Anexos 4.x do RICMS/MA (Decreto 19.714/2003), as mercadorias em substituição
// tributária e a MVA-ST original de cada uma (F3-26.d.MA). O Maranhão não publica lista única
// por CEST (o Anexo 45, que listava os CEST, foi revogado em 01/01/2021 pela RA 27/2020): cada
// segmento tem o seu anexo, num formato próprio. Os PDFs saem do portal da SEFAZ-MA
// (repositório 430 da API /sgc/api, "Anexos do RICMS").
//
// O que cada anexo traz:
// - Tabela com CEST, NCM e descrição (4.5, 4.13, 4.16, 4.17, 4.19, 4.21, 4.22, 4.33, 4.38, 4.46);
//   a MVA vem numa coluna da tabela (4.13, 4.16) ou no texto do artigo (os demais).
// - 4.45 (sorvetes): o CEST e as posições da NCM no próprio artigo.
// - 4.41 (autopeças): desde a RA 01/2023 a tabela do anexo foi revogada e o artigo remete ao
//   Anexo II do Convênio ICMS 142/2018 (segmento 01 do CEST); as duas MVAs vêm do artigo.
// - 4.2 (bebidas frias): só a MVA por descrição e embalagem, sem NCM por linha e sem CEST. A linha
//   vira CEST do Convênio ICMS 142/2018 só quando a correspondência é clara (a mesma MVA vale para
//   todas as embalagens do produto); senão fica sem CEST ("não confirmado").
//
// Nos textos consolidados a redação anterior aparece junto da nova ("(NR – RA 38/22)"): quando o
// mesmo CEST aparece mais de uma vez na tabela, vale a última redação, que reproduz o item do
// Convênio ICMS 142/2018; o NCM e a descrição vêm então da tabela do CEST já gerada (cest.json),
// conferidos contra os códigos que estão na tabela do anexo. Nenhuma MVA é digitada à mão.

/** Portal da SEFAZ-MA (aplicação Angular sobre a API /sgc/api). */
export const MA_PORTAL = 'https://portal.sefaz.ma.gov.br';
export const MA_PORTAL_API = `${MA_PORTAL}/sgc/api`;
/** Repositório "Anexos do RICMS" na API do portal. */
export const MA_ANNEX_REPOSITORY = 430;

/**
 * Login anônimo do portal, o mesmo que a página faz no navegador: o identificador do cliente e a
 * chave pública vêm do pacote JavaScript do próprio site (nada é guardado no Bipaê).
 * @param get função que baixa um endereço e devolve o texto
 * @param post função que faz POST de JSON e devolve o JSON da resposta
 */
export async function maPortalLogin(get, post) {
  const index = await get(`${MA_PORTAL}/`);
  const main = /src="(main\.[0-9a-f]+\.js)"/.exec(index);
  if (!main) throw new Error('portal da SEFAZ-MA: não achei o pacote principal da página');
  const bundle = await get(`${MA_PORTAL}/${main[1]}`);
  const client = /clientId:"(\d+)",secret:"([^"]+)"/.exec(bundle);
  if (!client) throw new Error('portal da SEFAZ-MA: não achei o login anônimo no pacote');
  const answer = await post(`${MA_PORTAL_API}/login`, {
    id_cliente: client[1],
    senha: client[2],
    portal: true,
  });
  if (!answer?.authtoken) throw new Error('portal da SEFAZ-MA: o login anônimo não respondeu');
  return answer.authtoken;
}

/** Anexos lidos e a chave de cada PDF no sources/manifest.json. */
export const MA_ANNEX_SOURCES = [
  { annex: '4.2', key: 'stMaAnexo4_2' },
  { annex: '4.5', key: 'stMaAnexo4_5' },
  { annex: '4.13', key: 'stMaAnexo4_13' },
  { annex: '4.16', key: 'stMaAnexo4_16' },
  { annex: '4.17', key: 'stMaAnexo4_17' },
  { annex: '4.19', key: 'stMaAnexo4_19' },
  { annex: '4.21', key: 'stMaAnexo4_21' },
  { annex: '4.22', key: 'stMaAnexo4_22' },
  { annex: '4.33', key: 'stMaAnexo4_33' },
  { annex: '4.38', key: 'stMaAnexo4_38' },
  { annex: '4.41', key: 'stMaAnexo4_41' },
  { annex: '4.45', key: 'stMaAnexo4_45' },
  { annex: '4.46', key: 'stMaAnexo4_46' },
];

/** Onde a MVA de cada anexo com tabela de CEST está escrita. */
const TABLE_MVA = {
  // "na saída dos demais produtos [sem preço final sugerido] ... percentual de 50%"
  4.5: 'others',
  // coluna "MVA ST" do Anexo Único
  4.13: 'column',
  // coluna "MVA-ST original (%)" da Tabela I
  4.16: 'column',
  // quadro "LISTA DOS PRODUTOS / MVA ST original aplicável" (negativa, positiva, neutra)
  4.17: 'list',
  // "I - 35% ... itens 1.0 e 2.0; II - 50% ... item 3.0"
  4.19: 'items',
  // "A MVA-ST original é 30%" (uma só para a tabela inteira)
  4.21: 'single',
  4.22: 'single',
  4.33: 'single',
  4.38: 'single',
  4.46: 'single',
};

/**
 * Data de efeito dos atos que alteraram as tabelas ou as MVAs, conferida no texto de cada ato no
 * portal da SEFAZ-MA (o anexo consolidado só traz o número). A vigência de cada anexo é a mais
 * recente entre as datas do cabeçalho do anexo e as destes atos citados nele.
 */
const ACT_DATES = new Map([
  // Decreto 20.407, de 07/04/2004 (bebidas frias: isotônicos e energéticos)
  ['Dec 20.407/04', '2004-04-07'],
  // Decreto 20.914, de 25/11/2004 (bebidas frias: art. 4º-A)
  ['Dec 20.914/04', '2004-11-25'],
  // RA 39/2020, art. 4º: efeitos a partir de 1º/01/2021 (bebidas quentes)
  ['RA 39/20', '2021-01-01'],
  // RA 12/2021 (DOE de 09/04/2021), retroagindo a 1º/01/2021 (tintas)
  ['RA 12/21', '2021-01-01'],
  // RA 09/2022: em vigor em 1º/03/2022 (motos)
  ['RA 09/22', '2022-03-01'],
  // RA 38/2022, DOE de 26/05/2022, em vigor na publicação (lâmpadas, farmacêuticos, tintas, celulares)
  ['RA 38/22', '2022-05-26'],
  // RA 64/2022, DOE de 24/10/2022, em vigor na publicação (higiene pessoal)
  ['RA 64/22', '2022-10-24'],
  // RA 01/2023, art. 3º: efeitos a partir de 1º/02/2023 (autopeças)
  ['RA 01/23', '2023-02-01'],
  // RA 32/2023, DOE de 18/07/2023, em vigor na publicação (sorvetes)
  ['RA 32/23', '2023-07-18'],
]);

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

const CEST_AT = /^(\d{2}\.\d{3}\.\d{2})(?=\s|$)/;
const ITEM_LINE = /^(\d{1,3}\.\d{1,2})$/;
const ITEM_BEFORE_CEST = /^(\d{1,3}(?:\.\d{1,2})?)\.?\s+(?=\d{2}\.\d{3}\.\d{2}(?:\s|$))/;
const NCM_TOKEN = /^(\d{4}(?:\.\d{1,2}){0,2}|\d{2}\.\d{2})[,;]?$/;
const MVA_TOKEN = /^\d{1,3}(?:,\d{1,2})?$/;
const NOTE = /\((?:NR|AC)\s*[–-][^)]*\)/g;

const ncmCode = (token) => token.replace(/[,;]$/, '').replace(/\./g, '');
const cestCode = (dotted) => dotted.replace(/\./g, '');
const percent = (text) =>
  text
    .replace(/\s?%$/, '')
    .replace(',', '.')
    .replace(/\.0+$/, '')
    .replace(/(\.\d)0$/, '$1');
const clean = (s) => s.replace(/\s+/g, ' ').trim();
const sentence = (s) => s.charAt(0).toLocaleUpperCase('pt-BR') + s.slice(1);

/** "1º de janeiro de 2021", "01.02.2000", "01/02/14" → ISO. */
function headerDates(text) {
  const out = [];
  const re =
    /efeitos\s+(?:a\s+partir\s+de|desde)\s+(\d{1,2})[º°]?\s*(?:de\s+([a-zç]+)\s+de\s+(\d{4})|[./](\d{1,2})[./](\d{2,4}))/gi;
  for (const m of text.matchAll(re)) {
    let year;
    let month;
    if (m[2]) {
      month = MONTHS.indexOf(m[2].toLocaleLowerCase('pt-BR')) + 1;
      year = Number(m[3]);
      if (month === 0) continue;
    } else {
      month = Number(m[4]);
      year = Number(m[5].length === 2 ? `20${m[5]}` : m[5]);
    }
    out.push(`${year}-${String(month).padStart(2, '0')}-${m[1].padStart(2, '0')}`);
  }
  return out;
}

/** Atos citados no trecho ("RA 38/22", "Resolução Administrativa nº 39/20", "Dec. 20.407/04"). */
function actsOf(text) {
  const acts = new Set();
  for (const m of text.matchAll(
    /(?:\bRA\b|Resolução\s+Administrativa)\s*(?:n[º°o]\.?\s*)?(\d{1,3})\/(\d{2,4})/gi,
  )) {
    acts.add(`RA ${m[1].padStart(2, '0').slice(-2)}/${m[2].slice(-2)}`);
  }
  for (const m of text.matchAll(/\bDec(?:reto)?\.?\s*(?:n[º°]\s*)?(\d{2}\.\d{3})\/(\d{2,4})/gi)) {
    acts.add(`Dec ${m[1]}/${m[2].slice(-2)}`);
  }
  return [...acts];
}

/** Vigência: a data mais recente do cabeçalho ou dos atos (com data conhecida) citados. */
function validFromOf(header, cited) {
  const acts = actsOf(cited);
  const dates = [
    ...headerDates(header),
    ...acts.map((a) => ACT_DATES.get(a)).filter((d) => d !== undefined),
  ];
  if (dates.length === 0) throw new Error('RICMS/MA: anexo sem data de efeitos');
  return {
    validFrom: dates.sort().at(-1),
    unknownActs: acts.filter((a) => !ACT_DATES.has(a)).sort(),
  };
}

/** Cabeçalho do anexo: as linhas antes do primeiro artigo. */
const headerOf = (lines) => {
  const end = lines.findIndex((l) => /^Art\.?\s*1/.test(l));
  return lines.slice(0, end < 0 ? 15 : end).join(' ');
};

/** A tabela de CEST: do cabeçalho "ITEM CEST NCM" até o próximo título de tabela ou de anexo. */
function tableRange(lines) {
  const from = lines.findIndex((l) => /^ITEM\s+CEST\s+NCM/i.test(l));
  if (from < 0) return null;
  let to = lines.length;
  for (let i = from + 1; i < lines.length; i++) {
    if (/^(TABELA\b|ANEXOS?\s*4\.\s?\d)/i.test(lines[i])) {
      to = i;
      break;
    }
  }
  return { from, to };
}

/**
 * Linhas da tabela agrupadas por CEST. Um CEST que reaparece (redação anterior e nova, ou a tabela
 * repetida) junta as linhas e fica marcado com `copies` > 1.
 */
function cestRows(lines, { from, to }) {
  const rows = [];
  const byCest = new Map();
  let pendingItem = null;
  let row = null;
  for (let i = from + 1; i < to; i++) {
    const line = lines[i];
    if (/^ITEM\s+CEST/i.test(line)) continue;
    // Linha de nota de alteração solta ("NR Resolução Administrativa 39/20").
    if (/^(NR|AC)\b\s*(Resolução|RA\b)/i.test(line)) continue;
    const itemOnly = ITEM_LINE.exec(line);
    if (itemOnly && !CEST_AT.test(lines[i - 1] ?? '')) {
      pendingItem = itemOnly[1];
      continue;
    }
    let rest = line;
    let item = null;
    const im = ITEM_BEFORE_CEST.exec(rest);
    if (im) {
      item = im[1];
      rest = rest.slice(im[0].length);
    }
    // "exceto os classificados no CEST" / "26.001.01; carros laterais.": o CEST citado na
    // descrição não começa linha nova.
    const cm = /CEST$/i.test(lines[i - 1] ?? '') ? null : CEST_AT.exec(rest);
    if (cm) {
      const cest = cestCode(cm[1]);
      rest = rest.slice(cm[0].length).trim();
      item = item ?? pendingItem;
      pendingItem = null;
      const known = byCest.get(cest);
      if (known) {
        // Redação anterior e nova ("1.0 / 1.0 / 21.053.00 / 21.053.00") ou a tabela repetida.
        known.copies += 1;
        known.item = known.item ?? item;
        row = known;
      } else {
        row = { item, cest, lines: [], copies: 1 };
        rows.push(row);
        byCest.set(cest, row);
      }
      if (rest) row.lines.push(rest);
      continue;
    }
    if (row) row.lines.push(line);
  }
  return rows;
}

/**
 * Códigos de NCM no começo da célula (o resto é a descrição). Depois que a descrição começa, só
 * conta a linha feita só de códigos ("1000 cm³" é descrição).
 */
function splitRow(rowLines, withMva) {
  const ncms = [];
  const words = [];
  for (const line of rowLines) {
    const tokens = line.replace(NOTE, ' ').split(/\s+/).filter(Boolean);
    let k = 0;
    if (words.length === 0 || tokens.every((t) => NCM_TOKEN.test(t))) {
      while (k < tokens.length && NCM_TOKEN.test(tokens[k])) ncms.push(ncmCode(tokens[k++]));
    }
    words.push(...tokens.slice(k));
  }
  let mva = null;
  if (withMva) {
    const last = words.at(-1);
    if (last && MVA_TOKEN.test(last)) {
      mva = percent(last);
      words.pop();
    }
  }
  return { ncms: [...new Set(ncms)], description: clean(words.join(' ')), mva };
}

/** Todos os códigos de NCM que aparecem nas linhas do item (para conferir a redação nova). */
const allCodes = (rowLines) =>
  rowLines
    .join(' ')
    .split(/\s+/)
    .filter((t) => NCM_TOKEN.test(t))
    .map(ncmCode);

/** Itens da tabela de CEST de um anexo, com NCM e descrição da redação em vigor. */
function tableItems(lines, range, cestByCode, withMva) {
  const items = [];
  for (const row of cestRows(lines, range)) {
    const ref = cestByCode.get(row.cest);
    if (!ref) throw new Error(`RICMS/MA: CEST ${row.cest} fora do Convênio ICMS 142/2018`);
    const text = row.lines.join(' ');
    const replaced = row.copies > 1 || /\(NR\s*[–-]/.test(text);
    const split = splitRow(row.lines, withMva);
    if (!replaced) {
      items.push({ item: row.item ?? ref.item, cest: row.cest, ...split });
      continue;
    }
    // Redação anterior e nova juntas: vale a do Convênio, que tem de estar entre os códigos da
    // tabela do anexo.
    const codes = allCodes(row.lines);
    const missing = ref.ncm.filter((n) => !codes.includes(n));
    if (missing.length > 0) {
      throw new Error(
        `RICMS/MA: CEST ${row.cest} com redação nova que não bate com o Convênio (${missing.join(', ')})`,
      );
    }
    // A MVA da coluna: a da última redação (a última na célula).
    items.push({
      item: row.item ?? ref.item,
      cest: row.cest,
      ncms: ref.ncm,
      description: ref.description,
      mva: split.mva,
    });
  }
  return items;
}

const UNIQUE = (values, what) => {
  const set = [...new Set(values)];
  if (set.length !== 1) throw new Error(`RICMS/MA: esperava uma MVA ${what}; achei ${set.length}`);
  return set[0];
};

/** Anexos com tabela de CEST (4.5, 4.13, 4.16, 4.17, 4.19, 4.21, 4.22, 4.33, 4.38, 4.46). */
function parseTableAnnex(annex, lines, cestByCode) {
  const range = tableRange(lines);
  if (!range) throw new Error(`RICMS/MA, Anexo ${annex}: não achei a tabela de CEST`);
  const kind = TABLE_MVA[annex];
  const items = tableItems(lines, range, cestByCode, kind === 'column');
  const before = clean(lines.slice(0, range.from).join(' '));
  const doubts = [];
  let withMva;
  if (kind === 'column') {
    withMva = items.map((i) => {
      if (!i.mva) throw new Error(`RICMS/MA, Anexo ${annex}: item ${i.item} sem MVA na coluna`);
      return i;
    });
  } else if (kind === 'single') {
    const mva = percent(
      UNIQUE(
        [...before.matchAll(/MVA-ST original é (?:de )?(\d+(?:,\d+)?)\s?%/g)].map((m) => m[1]),
        `no Anexo ${annex}`,
      ),
    );
    withMva = items.map((i) => ({ ...i, mva }));
  } else if (kind === 'others') {
    const m = /demais produtos,[^%]*?percentual de (\d+(?:,\d+)?)\s?%/.exec(before);
    if (!m) throw new Error(`RICMS/MA, Anexo ${annex}: não achei a MVA dos demais produtos`);
    withMva = items.map((i) => ({ ...i, mva: percent(m[1]) }));
  } else if (kind === 'list') {
    const byList = new Map(
      [...before.matchAll(/\b(NEGATIVA|POSITIVA|NEUTRA)\s+(\d+,\d+)\s?%/g)].map((m) => [
        m[1].toLowerCase(),
        percent(m[2]),
      ]),
    );
    if (byList.size !== 3)
      throw new Error(`RICMS/MA, Anexo ${annex}: quadro das listas incompleto`);
    withMva = items.map((i) => {
      const list = [...i.description.matchAll(/\b(positiva|negativa|neutra)\b/gi)].at(-1);
      if (!list) throw new Error(`RICMS/MA, Anexo ${annex}: item ${i.item} sem lista`);
      return { ...i, mva: byList.get(list[1].toLowerCase()) };
    });
  } else if (kind === 'items') {
    const byItem = new Map();
    for (const m of before.matchAll(
      /(\d+(?:,\d+)?)%\s*\([^)]*\),?\s*para os produtos relacionados\s*n[oa]s?\s*ite(?:ns|m)\s+([\d.]+(?:\s*(?:,|e)\s*[\d.]+)*)/g,
    )) {
      for (const item of m[2].split(/\s*(?:,|e)\s*/)) byItem.set(item, percent(m[1]));
    }
    if (byItem.size === 0) throw new Error(`RICMS/MA, Anexo ${annex}: não achei as MVAs por item`);
    withMva = [];
    for (const i of items) {
      const mva = byItem.get(i.item);
      if (mva) withMva.push({ ...i, mva });
      else doubts.push({ item: i.item, cest: i.cest, reason: 'item sem MVA no artigo' });
    }
  } else {
    throw new Error(`RICMS/MA: Anexo ${annex} sem leitor`);
  }
  const { validFrom, unknownActs } = validFromOf(
    headerOf(lines),
    `${before} ${lines.slice(range.from, range.to).join(' ')}`,
  );
  return { annex, validFrom, unknownActs, items: withMva, doubts };
}

/** Anexo 4.45: sorvetes (CEST 23.001.00) e preparados (23.002.00), CEST e NCM no artigo. */
function parseSorvetes(lines, cestByCode) {
  const text = clean(lines.join(' '));
  const last = (re, what) => {
    const all = [...text.matchAll(re)];
    if (all.length === 0) throw new Error(`RICMS/MA, Anexo 4.45: não achei ${what}`);
    return all.at(-1);
  };
  const sorvete = last(
    /I - aos sorvetes de qualquer espécie, classificados na posição ([\d.]+)[^;]*?CEST\D*?(\d{2}\.\d{3}\.\d{2})/g,
    'o inciso I',
  );
  const preparado = last(
    /II - aos preparados para fabricação de sorvete em máquina, classificados nas posições ([\d, e]+?) da NCM\/SH,? e enquadrados no CEST (\d{2}\.\d{3}\.\d{2})/g,
    'o inciso II',
  );
  const mvaA = last(/a\) de (\d+(?:,\d+)?)%[^;]*?inciso I do § 1º/g, 'a MVA do inciso I');
  const mvaB = last(/b\) de (\d+(?:,\d+)?)%[^;]*?inciso II do § 1º/g, 'a MVA do inciso II');
  const item = (cest, ncms, mva) => {
    const ref = cestByCode.get(cest);
    if (!ref) throw new Error(`RICMS/MA, Anexo 4.45: CEST ${cest} fora do Convênio`);
    return { item: ref.item, cest, ncms, description: ref.description, mva: percent(mva) };
  };
  const { validFrom, unknownActs } = validFromOf(headerOf(lines), text);
  return {
    annex: '4.45',
    validFrom,
    unknownActs,
    doubts: [],
    items: [
      item(cestCode(sorvete[2]), [ncmCode(sorvete[1])], mvaA[1]),
      item(cestCode(preparado[2]), preparado[1].split(/\s*(?:,|e)\s*/).map(ncmCode), mvaB[1]),
    ],
  };
}

/** Anexo 4.41: autopeças do Anexo II do Convênio ICMS 142/2018, com as duas MVAs do artigo. */
function parseAutopecas(lines, cests) {
  // Os artigos em vigor vêm antes da tabela revogada; depois dela está o texto antigo (Protocolo
  // ICMS 41/08 com o Anexo Único e MVAs de 2008).
  const end = lines.findIndex((l) => /^TABELA\b/i.test(l));
  if (end < 0) throw new Error('RICMS/MA, Anexo 4.41: não achei a tabela revogada');
  const text = clean(lines.slice(0, end).join(' '));
  if (!/listados no Anexo II do Convênio ICMS nº 142/.test(text)) {
    throw new Error('RICMS/MA, Anexo 4.41: o artigo 1º não remete mais ao Anexo II do Convênio');
  }
  const fidelity = [...text.matchAll(/I - (\d+,\d+)% \([^)]*\),?\s*tratando-se de/g)].at(-1);
  const others = [...text.matchAll(/II - (\d+,\d+)% \([^)]*\):?,?\s*nos\s+demais\s+casos/g)].at(-1);
  if (!fidelity || !others) throw new Error('RICMS/MA, Anexo 4.41: não achei as duas MVAs');
  // O item 999.0 ("outras peças") não tem NCM no Convênio: sem NCM não há como sugerir a MVA.
  const items = cests
    .filter((c) => c.segment === '01' && c.ncm.length > 0)
    .flatMap((c) => [
      {
        item: `${c.item}/1`,
        cest: c.cest,
        ncms: c.ncm,
        description: `${c.description} — saída do fabricante para atender índice ou contrato de fidelidade`,
        mva: percent(fidelity[1]),
      },
      {
        item: `${c.item}/2`,
        cest: c.cest,
        ncms: c.ncm,
        description: `${c.description} — demais casos`,
        mva: percent(others[1]),
      },
    ]);
  const { validFrom, unknownActs } = validFromOf(headerOf(lines), text);
  return { annex: '4.41', validFrom, unknownActs, doubts: [], items };
}

/**
 * Anexo 4.2: bebidas frias. O artigo 4º dá a MVA por produto e embalagem, uma lista para a venda do
 * distribuidor, depósito ou atacadista (§ 1º) e outra para a do industrial, importador,
 * arrematante ou engarrafador (§ 2º). O CEST só sai quando a correspondência com o Convênio ICMS
 * 142/2018 é clara: o produto inteiro com uma só MVA (cerveja, chope, e o refrigerante do industrial,
 * com as bebidas energéticas e hidroeletrolíticas que o § 2º do art. 1º equipara a ele) ou o xarope
 * para máquina pré-mix ou post-mix, que tem CEST próprio. A MVA que muda com a capacidade ou o tipo
 * de embalagem (águas, o refrigerante do atacadista) e o gelo ficam sem CEST.
 */
function parseBebidasFrias(lines, cests) {
  const text = clean(lines.join(' '));
  const start = text.indexOf('OPERAÇÕES ORIGINADAS POR DISTRIBUIDOR');
  const middle = text.indexOf('OPERAÇÕES ORIGINADAS POR INDUSTRIAL');
  const end = text.indexOf('Art. 4º-A');
  if (start < 0 || middle < start || end < middle) {
    throw new Error('RICMS/MA, Anexo 4.2: não achei os dois quadros de percentuais do art. 4º');
  }
  // Títulos em maiúsculas que separam os produtos (sem \b: o "Á" não conta como letra no \b).
  const PRODUCTS = /(ÁGUA MINERAL OU POTÁVEL|REFRIGERANTE|CHOPE|CERVEJA|GELO)(?![a-zà-ú])/g;
  const entries = (block, seller) => {
    const out = [];
    const heads = [...block.matchAll(PRODUCTS)];
    heads.forEach((h, k) => {
      const part = block.slice(h.index + h[0].length, heads[k + 1]?.index ?? block.length);
      for (const m of part.matchAll(
        /(?:([a-z])\)\s*)?(\d+)%\s*\(\s*[^)]*\),?\s*(?:quando se tratar de\s+|nos\s+)?((?:demais casos|[^;.]*?)[^;]*?)(?:;|\.(?=\s|$))/g,
      )) {
        out.push({
          seller,
          product: h[1],
          letter: m[1] ?? null,
          mva: m[2],
          text: clean(m[3]),
        });
      }
    });
    return out;
  };
  const sellers = {
    atacadista: 'remetente distribuidor, depósito ou atacadista',
    industrial: 'remetente industrial, importador, arrematante ou engarrafador',
  };
  const all = [
    ...entries(text.slice(start, middle), 'atacadista'),
    ...entries(text.slice(middle, end), 'industrial'),
  ];
  const byDescription = (re) => cests.filter((c) => c.segment === '03' && re.test(c.description));
  // CEST de cada produto no Convênio ICMS 142/2018 (segmento 03).
  const premix = byDescription(/pré-mix/);
  const refrigerantes = byDescription(
    /^(Refrigerante em|Demais refrigerantes|Bebidas energéticas|Bebidas hidroeletrolíticas)/,
  );
  const CEST_OF = {
    CERVEJA: byDescription(/^Cerveja em/),
    CHOPE: byDescription(/^Chope$/),
    REFRIGERANTE: refrigerantes,
  };
  // NCM das linhas sem CEST: a posição 2201 (águas), as do refrigerante no Convênio e a do gelo.
  const NCMS_OF = {
    'ÁGUA MINERAL OU POTÁVEL': ['2201'],
    REFRIGERANTE: [
      ...new Set(byDescription(/^(Refrigerante em|Demais refrigerantes)/).flatMap((c) => c.ncm)),
    ],
    GELO: ['22019000'],
  };
  const items = [];
  let unconfirmed = 0;
  for (const seller of ['atacadista', 'industrial']) {
    const label = sellers[seller];
    const section = all.filter((e) => e.seller === seller);
    for (const product of new Set(section.map((e) => e.product))) {
      const group = section.filter((e) => e.product === product);
      const pre = group.filter((e) => /pré-mix|post-mix/.test(e.text));
      const rest = group.filter((e) => !pre.includes(e));
      for (const e of pre) {
        for (const c of premix) {
          items.push({
            item: `${seller}/${c.item}`,
            cest: c.cest,
            ncms: c.ncm,
            description: `${c.description} (${label})`,
            mva: percent(e.mva),
          });
        }
      }
      const sameMva = new Set(rest.map((e) => e.mva)).size === 1;
      if (sameMva && CEST_OF[product]) {
        for (const c of CEST_OF[product]) {
          items.push({
            item: `${seller}/${c.item}`,
            cest: c.cest,
            ncms: c.ncm,
            description: `${c.description} (${label})`,
            mva: percent(rest[0].mva),
          });
        }
        continue;
      }
      for (const e of rest) {
        const ncms = NCMS_OF[product];
        if (!ncms) throw new Error(`RICMS/MA, Anexo 4.2: ${product} sem CEST nem NCM`);
        unconfirmed += 1;
        items.push({
          item: `${seller}/${product.toLocaleLowerCase('pt-BR').split(' ')[0]}${e.letter ? `/${e.letter}` : ''}`,
          cest: '',
          ncms,
          description: `${sentence(e.text)} (${label})`,
          mva: percent(e.mva),
        });
      }
    }
  }
  const { validFrom, unknownActs } = validFromOf(headerOf(lines), headerOf(lines));
  return { annex: '4.2', validFrom, unknownActs, doubts: [], items, unconfirmed };
}

/**
 * Lê um anexo do RICMS/MA.
 * @param annex número do anexo ("4.2")
 * @param lines linhas do PDF (pdfLines)
 * @param cests itens da tabela do CEST (cest.json)
 */
export function parseMaAnnex(annex, lines, cests) {
  const cestByCode = new Map(cests.map((c) => [c.cest, c]));
  let parsed;
  if (annex === '4.2') parsed = parseBebidasFrias(lines, cests);
  else if (annex === '4.41') parsed = parseAutopecas(lines, cests);
  else if (annex === '4.45') parsed = parseSorvetes(lines, cestByCode);
  else parsed = parseTableAnnex(annex, lines, cestByCode);
  if (parsed.items.length === 0) throw new Error(`RICMS/MA, Anexo ${annex}: nenhum item`);
  for (const i of parsed.items) {
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(i.mva ?? '')) {
      throw new Error(`RICMS/MA, Anexo ${annex}: MVA estranha no item ${i.item}: ${i.mva}`);
    }
    if (i.ncms.length === 0) throw new Error(`RICMS/MA, Anexo ${annex}: item ${i.item} sem NCM`);
  }
  return { unconfirmed: 0, ...parsed };
}

/** Observação de cada anexo (de onde vem a base antes da MVA). */
const NOTES = {
  4.2: 'Base: preço máximo de venda a varejo fixado pela autoridade; sem ele, preço praticado mais a MVA do art. 4º (§ 1º para o distribuidor, depósito ou atacadista; § 2º para o industrial, importador, arrematante ou engarrafador). A Receita Estadual pode fixar a média ponderada de preços a consumidor (art. 4º-A). As linhas sem CEST têm a MVA por capacidade ou embalagem, que o CEST não separa: confira a embalagem do produto.',
  4.5: 'Base: preço final a consumidor sugerido pelo fabricante ou importador; a MVA de 50% vale para os produtos sem esse preço.',
  4.13: 'Base: preço máximo de venda a varejo ou preço sugerido pelo fabricante; sem eles, preço praticado mais a MVA (ajustada na entrada interestadual).',
  4.16: 'Base: preço máximo de venda a varejo ou preço sugerido pelo fabricante; sem eles, preço praticado mais a MVA (ajustada na entrada interestadual).',
  4.17: 'Medicamentos: a base é o preço da lista da CMED com o desconto do art. 2º ou o preço final a consumidor da legislação; a MVA (pela lista negativa, positiva ou neutra) só vale quando não há esses preços.',
  4.19: 'Base: preço de venda ao consumidor de tabela de órgão competente; sem ele, preço praticado mais a MVA (ajustada na entrada interestadual). O xadrez em embalagem acima de 1 kg (CEST 24.002.01) não tem MVA no artigo e fica de fora (D-044).',
  4.21: 'Base: preço final a consumidor fixado por órgão público ou sugerido pela montadora; sem eles, valor da operação mais a MVA (ajustada na entrada interestadual).',
  4.22: 'Base: preço final a consumidor fixado por órgão público ou sugerido pelo fabricante; sem eles, valor da operação mais a MVA (ajustada na entrada interestadual).',
  4.33: 'Base: preço final a consumidor da legislação; sem ele, preço praticado mais a MVA (ajustada na entrada interestadual). Vale para o varejo e o atacadista não credenciado; o atacadista credenciado tem carga de 8% na entrada (Anexo 4.33.1).',
  4.38: 'Base: preço máximo de venda a varejo ou preço sugerido pelo fabricante; sem eles, preço praticado mais a MVA (ajustada na entrada interestadual).',
  4.41: 'Lista do Anexo II do Convênio ICMS 142/2018 (RA 01/2023). Base: preço máximo ou sugerido ao público; sem eles, preço praticado mais a MVA: a menor na saída do fabricante para atender índice ou contrato de fidelidade, a maior nos demais casos.',
  4.45: 'Base: preço máximo ou único fixado por autoridade ou preço sugerido pelo fabricante; sem eles, preço praticado mais a MVA (ajustada na entrada interestadual).',
  4.46: 'Base: preço máximo de venda a varejo ou preço sugerido pelo fabricante; sem eles, preço praticado mais a MVA (ajustada na entrada interestadual).',
};

/** Anexos do RICMS/MA no formato de st-references.json. */
export function maStReferences(parsed, { urlOf, sourceOf, segmentName }) {
  return parsed.map((p) => {
    const counts = new Map();
    for (const i of p.items) {
      if (i.cest) counts.set(i.cest.slice(0, 2), (counts.get(i.cest.slice(0, 2)) ?? 0) + 1);
    }
    const segment = [...counts].sort((a, b) => b[1] - a[1])[0][0];
    return {
      uf: 'MA',
      segment,
      segmentName: segmentName(segment),
      act: `RICMS/MA (Decreto 19.714/2003), Anexo ${p.annex}`,
      source: sourceOf(p.annex),
      url: urlOf(p.annex),
      validFrom: p.validFrom,
      validTo: null,
      note: NOTES[p.annex],
      items: p.items.map((i) => ({
        item: i.item,
        cest: i.cest,
        ncms: i.ncms,
        ncmText: i.ncms.join(' '),
        description: i.description,
        mva: i.mva,
      })),
    };
  });
}
