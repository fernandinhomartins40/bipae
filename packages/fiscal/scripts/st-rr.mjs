// Extrai, do RICMS/RR (Decreto 4.335-E/2001) consolidado até outubro de 2026, as mercadorias em
// substituição tributária e o percentual de cada uma (F3-26.d.RR). Roraima NÃO adota a lista do
// Convênio ICMS 142/2018 por CEST: o Capítulo II do Título III do Livro Segundo traz uma seção por
// produto, com a lista por NCM (ou NBM/SH) e o percentual no próprio artigo. Por isso as linhas
// saem sem CEST ("não confirmado" na tela): ligar a NBM de 1996 a um CEST seria escolha à mão.
//
// O PDF guarda cada redação antiga junto da nova ("Redação anterior", "Redação original"); a nova
// vem primeiro, e o leitor só usa o texto vigente de cada artigo. Nenhum percentual é digitado à
// mão: todos saem do texto, e a geração para se uma âncora do texto mudar. A data de cada seção é a
// do decreto que alterou o dispositivo (a lista de decretos do início do PDF dá a data) ou, nas
// partes sem marca de alteração, a do próprio Decreto 4.335-E.
//
// Fora (sem NCM no texto, base em preço ou regime que não é MVA): frango e óleo comestível, venda
// porta a porta, bebidas alcoólicas (exceto cerveja e chope), comerciantes de produtos
// farmacêuticos (por CNAE), combustíveis (PMPF e monofásico) e veículos faturados direto ao
// consumidor. Ficam como "falta configurar" (docs/fiscal/duvidas.md, D-053).

const MONTHS = {
  janeiro: 1,
  fevereiro: 2,
  março: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
};

const pad = (n) => String(n).padStart(2, '0');
const isoDate = (y, m, d) => {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return `${y}-${pad(m)}-${pad(d)}`;
};
const fullYear = (y) => (y >= 100 ? y : y <= 50 ? 2000 + y : 1900 + y);
const numKey = (n) => n.replace(/\./g, '');

/** Percentual do texto ("36,56") em decimal ("36.56"). */
const pct = (s) => s.replace(/\./g, '').replace(',', '.');

/** Primeira linha que casa com `re`, a partir de `from`; falha se a âncora mudou. */
function find(lines, re, from = 0, what = String(re)) {
  for (let i = from; i < lines.length; i++) if (re.test(lines[i])) return i;
  throw new Error(`RICMS/RR: âncora não encontrada (${what})`);
}

const OLD =
  /^(?:\(?Reda[cç][aã]o (?:anterior|original)|Reda[cç][õo]es (?:aqnteriores|anteriores)|redação anterior|redacao anterior|Redacao anterior|Redação Anterior|REDACAO ANTERIOR)/i;
/** Linhas de `from` até o próximo marcador de redação antiga. */
function untilOld(lines, from, to = lines.length) {
  const out = [];
  for (let i = from; i < to; i++) {
    if (OLD.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out;
}

// --- datas -----------------------------------------------------------------------------------

/** Datas dos decretos pela lista "Alterado pelo Decreto nº N, de D de mês de AAAA" do início. */
export function rrDecreeDates(lines) {
  const map = new Map();
  for (const l of lines) {
    const m =
      /^(?:Alterado pelo|Consolidado ate o) Decreto n[ºo°]\s*([\d.]+)(?:-E)?,?\s+de\s+(\d{1,2})\s+de\s+(\p{L}+)\s+de\s+(\d{4})/iu.exec(
        l,
      );
    if (m) {
      const month = MONTHS[m[3].toLowerCase()];
      const date = month && isoDate(Number(m[4]), month, Number(m[2]));
      if (date) map.set(numKey(m[1]), date);
    }
  }
  return map;
}

/**
 * Datas citadas num trecho: decretos (data da lista ou "de dd/mm/aa" ao lado do número) e
 * "efeitos a partir de dd/mm/aa". Decreto fora da lista e sem data ao lado vira `approx`, com a
 * data do primeiro decreto datado de número maior.
 */
function datesIn(lines, ctx) {
  const text = lines.filter((l) => !/revogad/i.test(l)).join(' ');
  const found = [];
  const approx = [];
  const re =
    /Decretos? n[ºo°.]*\s*([\d.]+)(?:\s*-\s*E)?(?:\s*[,;]?\s*de\s+(\d{1,2})\s*[/.]\s*(\d{1,2})\s*[/.]\s*(\d{2,4}))?/gi;
  for (const m of text.matchAll(re)) {
    let date = ctx.decrees.get(numKey(m[1])) ?? null;
    if (!date && m[2]) date = isoDate(fullYear(Number(m[4])), Number(m[3]), Number(m[2]));
    if (!date) {
      const n = Number(numKey(m[1]).replace(/E$/, ''));
      const next = [...ctx.decrees]
        .map(([k, d]) => [Number(k), d])
        .filter(([k]) => k > n)
        .sort((a, b) => a[0] - b[0])[0];
      if (next) {
        date = next[1];
        approx.push({ decree: m[1], used: date });
      }
    }
    if (date) found.push(date);
  }
  for (const m of text.matchAll(
    /efeitos?\s+(?:a\s+partir\s+)?de\s+(\d{1,2})º?\s*\/\s*(\d{1,2})\s*\/\s*(\d{2,4})/gi,
  )) {
    const date = isoDate(fullYear(Number(m[3])), Number(m[2]), Number(m[1]));
    if (date) found.push(date);
  }
  return { found, approx };
}

/** Vigência de uma seção: a maior data citada nos trechos vigentes, ou a do Decreto 4.335-E. */
function validFromOf(chunks, ctx) {
  const found = [];
  const approx = [];
  for (const c of chunks) {
    const r = datesIn(c, ctx);
    found.push(...r.found);
    approx.push(...r.approx);
  }
  const date = found.sort().at(-1) ?? ctx.base;
  const notes = approx
    .filter((a) => a.used === date)
    .filter((a, i, all) => all.findIndex((b) => b.decree === a.decree) === i)
    .map(
      (a) =>
        `A data do Decreto ${a.decree} não consta do texto; usada a do primeiro decreto datado seguinte da lista (${a.used.split('-').reverse().join('/')}).`,
    );
  return { validFrom: date, notes, usedBase: found.length === 0 };
}

// --- códigos NCM -----------------------------------------------------------------------------

const CODE = /^(?:\d{2}\.\d{2}(?:\.\d{1,2}){0,2}|\d{4}(?:\.\d{1,4}){0,2})$/;
function codeTok(token) {
  const t = token.replace(/^\(/, '').replace(/[),;.]+$/, '');
  return CODE.test(t) ? t : null;
}
const digits = (t) => t.replace(/\D/g, '');
const ZONE_WORDS = new Set([
  'e',
  'exceto',
  '(exceto',
  'posição',
  'posições',
  'NCM',
  'NCM/SH',
  'código',
]);

/**
 * Separa o fim da linha que são códigos (e as palavras que os ligam) do texto da descrição.
 * `afterExcept` marca que os códigos seguintes são exceções.
 */
function splitZone(line) {
  const toks = line.trim().split(/\s+/).filter(Boolean);
  let i = toks.length;
  while (i > 0) {
    const t = toks[i - 1];
    if (codeTok(t) || ZONE_WORDS.has(t.replace(/[,;]$/, ''))) i--;
    else break;
  }
  const rawStart = i;
  // Código que fecha uma frase ("... 84.08.") ou um parêntese no meio do texto não é da tabela.
  const tail = toks[toks.length - 1];
  if (rawStart > 0 && /[).]$/.test(tail) && codeTok(tail)) {
    return { text: line.trim(), codes: [], except: [], open: false };
  }
  while (i < toks.length && !codeTok(toks[i]) && !/^\(?exceto$/.test(toks[i])) i++;
  const zone = toks.slice(i);
  if (!zone.some((t) => codeTok(t)))
    return { text: line.trim(), codes: [], except: [], open: false };
  const codes = [];
  const except = [];
  let afterExcept = false;
  for (const t of zone) {
    if (/^\(?exceto$/.test(t)) afterExcept = true;
    else if (codeTok(t)) (afterExcept ? except : codes).push(digits(codeTok(t)));
  }
  const last = zone[zone.length - 1];
  return {
    text: toks.slice(0, rawStart).join(' '),
    codes,
    except,
    open: /^\(?exceto$/.test(last.replace(/[,;]$/, '')),
  };
}

/** Códigos que aparecem depois de "exceto" num texto corrido. */
function exceptIn(text) {
  const out = [];
  for (const m of text.matchAll(/exceto\b([^)]*)/gi)) {
    for (const t of m[1].split(/\s+/)) {
      const c = codeTok(t);
      if (c && digits(c).length >= 6) out.push(digits(c));
    }
  }
  return out;
}

/**
 * Lê um bloco (linhas de um item): descrição, códigos incluídos e exceções. A linha só com código
 * logo depois de uma linha com "exceto" sem código é exceção.
 */
function readBlock(lines) {
  const desc = [];
  const codes = [];
  const except = [];
  let pendingExcept = false;
  let inExcept = false;
  for (const raw of lines) {
    const line = raw.trim();
    // Notas de alteração ("(alterado pelo Decreto ...)") não são descrição.
    if (!line || /^\((?:alterado|acrescentado|redação|itens)\b/i.test(line)) continue;
    const z = splitZone(line);
    if (z.codes.length === 0 && z.except.length === 0) {
      desc.push(line);
      // "exceto pigmentos ... no código NCM/SH" na linha de cima e o código na seguinte.
      inExcept = inExcept || /\bexceto\b/i.test(line);
      pendingExcept = inExcept && /(?:NCM\/SH|NCM|código|posições?|exceto)$/i.test(line);
      continue;
    }
    if (z.text) desc.push(z.text);
    if (pendingExcept && !z.text) except.push(...z.codes);
    else codes.push(...z.codes);
    except.push(...z.except);
    pendingExcept = z.open;
    inExcept = false;
    if (z.text) pendingExcept = pendingExcept || false;
  }
  const text = desc.join(' ').replace(/\s+/g, ' ').trim();
  for (const c of exceptIn(text)) except.push(c);
  const included = [...new Set(codes)].filter((c) => !except.includes(c));
  const exceptNcms = [...new Set(except)].filter((e) =>
    included.some((c) => e.startsWith(c) && e !== c),
  );
  return { description: text, ncms: included, exceptNcms };
}

// --- blocos por item -------------------------------------------------------------------------

const ROMAN = [
  'I',
  'II',
  'III',
  'IV',
  'V',
  'VI',
  'VII',
  'VIII',
  'IX',
  'X',
  'XI',
  'XII',
  'XIII',
  'XIV',
  'XV',
  'XVI',
  'XVII',
  'XVIII',
];

/**
 * Divide uma tabela de itens em blocos. `numeral(line)` devolve o número do item no começo da
 * linha (ou null); a linha começa um bloco quando o item é o próximo ou repete o anterior (a
 * redação antiga). Blocos de redação antiga e revogados ficam de fora; um bloco para na primeira
 * marca de redação antiga.
 */
function itemBlocks(lines, numeral, { dropStray = null } = {}) {
  const blocks = [];
  let cur = null;
  let max = 0;
  for (const raw of lines) {
    const line = raw.trim();
    const n = numeral(line);
    if (n !== null && (n === max + 1 || (cur && n === cur.n))) {
      // O número repetido é a redação anterior do mesmo item.
      const repeated = Boolean(cur && n === cur.n);
      cur = { n, lines: [line.slice(line.search(/\s|$/)).trim()], old: repeated };
      blocks.push(cur);
      if (n > max) max = n;
      continue;
    }
    if (!cur) continue;
    if (dropStray?.(line)) continue;
    cur.lines.push(line);
  }
  const out = [];
  for (const b of blocks) {
    if (b.old) continue;
    const body = b.lines.filter(Boolean);
    const mark = body.findIndex((l) => OLD.test(l));
    if (mark === 0) continue; // bloco inteiro de redação antiga
    const current = mark > 0 ? body.slice(0, mark) : body;
    if (current.some((l) => /revogad/i.test(l))) continue;
    if (current.length === 0) continue;
    out.push({ n: b.n, lines: current });
  }
  return out;
}

const romanNumeral = (line) => {
  const m = /^(XVIII|XVII|XVI|XV|XIV|XIII|XII|XI|X|IX|VIII|VII|VI|V|IV|III|II|I)(?=\s|$)/.exec(
    line,
  );
  return m ? ROMAN.indexOf(m[1]) + 1 : null;
};

// --- seções ----------------------------------------------------------------------------------

function item(id, d, mva, extra = {}) {
  return {
    item: id,
    cest: '',
    ncms: d.ncms,
    ...(d.exceptNcms?.length ? { exceptNcms: d.exceptNcms } : {}),
    description: d.description,
    mva,
    ...extra,
  };
}

function section(name, act, lines, ctx, items, note, chunks) {
  const v = validFromOf(chunks, ctx);
  return {
    segmentName: name,
    act,
    validFrom: v.validFrom,
    note: [
      note,
      ...v.notes,
      v.usedBase
        ? 'Sem marca de alteração no texto: vale desde o Decreto 4.335-E, de 03/08/2001.'
        : '',
    ]
      .filter(Boolean)
      .join(' '),
    items,
  };
}

function cigarros(lines, ctx) {
  const a = find(lines, /^Art\. 765\./);
  const b = find(lines, /^Art\. 766\./, a);
  const text = lines.slice(a, b + 14).join(' ');
  const ncm = /posição (\d{4}) e na subposição (\d{4}\.\d)/.exec(text);
  const mva = /Margem de Valor Agregado \(MVA\) de (\d+(?:,\d+)?)%/i.exec(text);
  if (!ncm || !mva) throw new Error('RICMS/RR: art. 765/766 (cigarros) mudou');
  const head = lines.slice(Math.max(0, a - 4), a + 1);
  const items = [
    item(
      'art. 765',
      {
        ncms: [ncm[1], digits(ncm[2])],
        description:
          'Cigarros e outros produtos derivados do fumo (posição 2402 e subposição 2403.1 da NCM)',
      },
      pct(mva[1]),
    ),
  ];
  return [
    section(
      'Cigarros e derivados do fumo',
      'RICMS/RR (Decreto 4.335-E/2001), arts. 765 e 766',
      lines,
      ctx,
      items,
      'Base: preço final a consumidor sugerido por fabricante ou importador; sem ele, preço praticado pelo remetente com frete, seguro e encargos mais a MVA (art. 766, II).',
      [head, lines.slice(b, b + 14)],
    ),
  ];
}

function bebidas(lines, ctx) {
  const a = find(lines, /^Art\. 768\./);
  const cur = untilOld(lines, a);
  const text = cur.join('\n');
  const take = (re, what) => {
    const m = re.exec(text);
    if (!m) throw new Error(`RICMS/RR: art. 768 mudou (${what})`);
    return pct(m[1]);
  };
  // Inciso I (distribuidor, depósito ou atacadista), alínea b, itens 1 a 8.
  const itemText = (n) => {
    const m = new RegExp(
      `^${n}\\. (\\d+)% \\(([^)]*)\\)(?:,| ,)? ?([\\s\\S]*?)(?=\\n\\d\\. |\\nII - |(?![\\s\\S]))`,
      'm',
    ).exec(text);
    if (!m) throw new Error(`RICMS/RR: art. 768, § 1º, I, b, ${n}`);
    return { pct: m[1], text: m[3].replace(/\s+/g, ' ') };
  };
  const i = [1, 2, 3, 4, 5, 6, 7, 8].map(itemText);
  const expect = (n, re) => {
    if (!re.test(i[n - 1].text)) throw new Error(`RICMS/RR: art. 768, § 1º, I, b, ${n} mudou`);
  };
  expect(1, /refrigerantes em garrafa/);
  expect(2, /água mineral.*1\.500 ml/);
  expect(3, /pr[eé]-mix ou post-mix/);
  expect(4, /chope/);
  expect(5, /garrafa de vidro/);
  expect(6, /5\.000 ml/);
  expect(7, /vidro, não retornável/);
  expect(8, /demais casos/);
  const industrial = take(
    /^1\. (\d+)% \([^)]*\), nos casos das mercadorias arroladas/m,
    'indústria',
  );
  const desc = {
    refri600: 'Refrigerante em garrafa com capacidade igual ou superior a 600 ml',
    premix:
      'Refrigerante pré-mix ou post-mix (e xarope ou extrato concentrado para preparo em máquina)',
    chope: 'Chope',
    cerveja: 'Cerveja (demais casos)',
    refriOutros: 'Refrigerante e bebidas equiparadas (isotônicos e energéticos) nos demais casos',
  };
  const REFRI = ['2202'];
  const XAROPE = ['21069010'];
  const AGUA = ['2201'];
  const dist = 'distribuidor, depósito ou atacadista (art. 768, § 1º, I)';
  const ind = 'industrial, importador, arrematante ou engarrafador (art. 768, § 1º, II)';
  const items = [
    item('768 I-b-1', { ncms: REFRI, description: `${desc.refri600} · ${dist}` }, i[0].pct),
    item(
      '768 I-b-3',
      { ncms: [...REFRI, ...XAROPE], description: `${desc.premix} · ${dist}` },
      i[2].pct,
    ),
    item('768 I-b-4', { ncms: ['2203'], description: `${desc.chope} · ${dist}` }, i[3].pct),
    item('768 I-b-8', { ncms: ['2203'], description: `${desc.cerveja} · ${dist}` }, i[7].pct),
    item('768 I-b-8', { ncms: REFRI, description: `${desc.refriOutros} · ${dist}` }, i[7].pct),
    item(
      '768 II-b-1',
      {
        ncms: [...REFRI, ...XAROPE],
        description: `Refrigerante em qualquer embalagem (inclusive pré-mix e post-mix) · ${ind}`,
      },
      industrial,
    ),
    item('768 II-b-1', { ncms: ['2203'], description: `Chope e cerveja · ${ind}` }, industrial),
    item(
      '768 I-b-2',
      {
        ncms: AGUA,
        description: `Água mineral, gasosa ou não, ou potável, natural, em garrafa plástica de 1.500 ml · qualquer origem (inciso II, b, 2: mesmo percentual)`,
      },
      i[1].pct,
    ),
    item(
      '768 I-b-3',
      {
        ncms: AGUA,
        description: `Água mineral ou potável em copos e embalagem plástica de até 500 ml · qualquer origem`,
      },
      i[2].pct,
    ),
    item(
      '768 I-b-5',
      {
        ncms: AGUA,
        description: `Água mineral ou potável em garrafa de vidro, retornável ou não, de até 500 ml · qualquer origem`,
      },
      i[4].pct,
    ),
    item(
      '768 I-b-6',
      {
        ncms: AGUA,
        description: `Água mineral ou potável em embalagem de 5.000 ml ou mais · qualquer origem`,
      },
      i[5].pct,
    ),
    item(
      '768 I-b-7',
      {
        ncms: AGUA,
        description: `Água mineral ou potável em embalagem de vidro não retornável de até 300 ml · qualquer origem`,
      },
      i[6].pct,
    ),
    item(
      '768 I-b-8',
      {
        ncms: AGUA,
        description: `Água mineral ou potável nos demais casos, inclusive gaseificada ou aromatizada artificialmente · qualquer origem`,
      },
      i[7].pct,
    ),
  ];
  const head = find(lines, /^\(Art\. 768, alterado pelo Decreto/);
  return [
    section(
      'Água mineral, refrigerante, cerveja e chope',
      'RICMS/RR (Decreto 4.335-E/2001), arts. 767 e 768 (Decreto 35.559-E/2024)',
      lines,
      ctx,
      items,
      'A base é o preço máximo de venda a varejo da tabela do órgão competente (a Portaria SEFAZ/DITRI/DEPAR 337/2024 fixa os de refrigerantes, isotônicos e energéticos); o percentual vale só na falta dele (art. 768, § 1º). O texto cita as posições 2201 a 2203 e não liga cada embalagem a um NCM: a empresa escolhe a linha pela descrição. Gelo (art. 767, caput) não tem percentual na redação vigente do art. 768 e fica sem MVA.',
      [lines.slice(head, head + 2)],
    ),
  ];
}

/** Itens do quadro "Código NBM/SH a que se refere o art. 769" (veículos), pela linha com o código. */
function veiculos(lines, ctx) {
  const a = find(lines, /^Código NBM\/SH a que se refere o art\. 769/);
  const b = find(lines, /^Art\. 770\./, a);
  const rows = [];
  for (const raw of lines.slice(a + 1, b)) {
    const line = raw.trim();
    if (/^(?:\(alterado|CÓDIGO|NBM\/SH|DESCRIÇÃO)/.test(line) || /^\d{3}$/.test(line)) continue;
    const m = /^(\d{4}\.\d{2}\.\d{2})\s*(.*)$/.exec(line);
    if (m) rows.push({ code: digits(m[1]), text: [m[2]] });
    else if (rows.length) rows.at(-1).text.push(line);
  }
  if (rows.length < 20) throw new Error('RICMS/RR: quadro do art. 769 mudou');
  const art770 = lines.slice(b, b + 60);
  const m =
    /§ 4º A MVA-ST original é (\d+(?:,\d+)?)%\.?\s*\(acrescentado pelo Decreto nº ([\d.]+)-E/.exec(
      art770.join(' '),
    );
  if (!m) throw new Error('RICMS/RR: art. 770, § 4º mudou');
  const items = rows.map((r) =>
    item(
      `769 ${r.code.slice(0, 4)}.${r.code.slice(4, 6)}.${r.code.slice(6)}`,
      { ncms: [r.code], description: r.text.join(' ').replace(/\s+/g, ' ').trim() },
      pct(m[1]),
    ),
  );
  const head = find(lines, /^Código NBM\/SH a que se refere o art\. 769/);
  return [
    section(
      'Veículos automotores, exceto os de duas rodas',
      'RICMS/RR (Decreto 4.335-E/2001), arts. 769 e 770',
      lines,
      ctx,
      items,
      'Base: preço de venda a consumidor fixado ou sugerido (tabela do fabricante); na falta, valor da operação com frete, seguro e encargos mais a MVA ajustada (art. 770, II). Códigos da tabela do art. 769 como o decreto os escreve (NBM/SH, redação de 2013); as exceções (carro celular, carro funerário, ambulância, carro-forte, caminhão acima de 3,9 t e carros de corrida) estão na descrição.',
      [lines.slice(head, head + 2), art770.filter((l) => /MVA-ST original é|16\.271/.test(l))],
    ),
  ];
}

function motos(lines, ctx) {
  const a = find(lines, /^Art\. 772\./);
  const b = find(lines, /^Art\. 773\./, a);
  const ncm = /posição (\d{4}) da Nomenclatura/.exec(lines.slice(a, a + 4).join(' '));
  const body = lines.slice(b, b + 60).join(' ');
  const mva = /§ 3º A MVA-ST original é (\d+(?:,\d+)?)%/.exec(body);
  if (!ncm || !mva) throw new Error('RICMS/RR: arts. 772/773 (motos) mudaram');
  const items = [
    item(
      'art. 772',
      {
        ncms: [ncm[1]],
        description: 'Veículos automotores novos de duas rodas (posição 8711 da NBM/SH)',
      },
      pct(mva[1]),
    ),
  ];
  return [
    section(
      'Veículos automotores de duas e três rodas',
      'RICMS/RR (Decreto 4.335-E/2001), arts. 772 e 773',
      lines,
      ctx,
      items,
      'Base: preço de venda a consumidor fixado ou sugerido pelo fabricante; na falta, valor da operação com frete, seguro e encargos mais a MVA ajustada (art. 773, § 1º). O quadro de códigos de 10 dígitos que aparece depois do art. 773 é a lista de automóveis do art. 769 e não entra aqui.',
      [lines.slice(b, b + 45)],
    ),
  ];
}

function pneus(lines, ctx) {
  const a = find(lines, /^Item NCM\/SH DESCRIÇÃO MVA-ST original/);
  const end = find(lines, /^Reda[cç][aã]o anterior/, a);
  const body = lines.slice(a + 1, end).filter((l) => !/^\d{3}$/.test(l.trim()));
  const rows = [];
  for (const raw of body) {
    const line = raw.trim();
    const m = /^([1-5])(?:\s+(.*))?$/.exec(line);
    if (m && Number(m[1]) === rows.length + 1) rows.push({ n: Number(m[1]), text: [m[2] ?? ''] });
    else if (rows.length) rows.at(-1).text.push(line);
  }
  if (rows.length !== 5) throw new Error('RICMS/RR: quadro de pneumáticos mudou');
  const items = rows.map((r) => {
    // O percentual é o primeiro número de dois dígitos que fecha uma linha do item.
    const at = r.text.findIndex((l) => /(?:^|\s)\d{2}$/.test(l.trim()));
    if (at < 0) throw new Error('RICMS/RR: MVA do quadro de pneumáticos mudou');
    const parts = r.text[at].trim().split(/\s+/);
    const mva = parts.pop();
    const toks = [...r.text.slice(0, at), parts.join(' '), ...r.text.slice(at + 1)]
      .join(' ')
      .split(/\s+/)
      .filter(Boolean);
    const codes = [];
    const words = [];
    for (const t of toks) (codeTok(t) ? codes : words).push(t);
    return item(
      `784 ${r.n}`,
      { ncms: [...new Set(codes.map((c) => digits(c)))], description: words.join(' ') },
      mva,
    );
  });
  const head = lines.findIndex((l) => /^\(§1º alterado pelo Decreto nº 13\.713-E/.test(l));
  return [
    section(
      'Pneumáticos, câmaras de ar e protetores de borracha',
      'RICMS/RR (Decreto 4.335-E/2001), arts. 782 a 784 (Decreto 13.713-E/2012)',
      lines,
      ctx,
      items,
      'Base: preço de venda a consumidor da tabela do órgão competente mais o frete; na falta, valor da operação com frete, seguro e encargos mais a MVA ajustada (art. 784, § 1º). Não se aplica a pneus e câmaras de bicicleta (art. 783, III).',
      [head >= 0 ? lines.slice(head, head + 1) : []],
    ),
  ];
}

function cimento(lines, ctx) {
  const a = find(lines, /^Art\. 785\. Nas operações interestaduais e de importação/);
  const ncm = /posição (\d{4}) da Nomenclatura/.exec(lines.slice(a, a + 3).join(' '));
  const b = find(lines, /^§ 2º A MVA-ST original é/, a);
  const mva = /MVA-ST original é (\d+(?:,\d+)?)%/.exec(lines[b]);
  if (!ncm || !mva) throw new Error('RICMS/RR: arts. 785/786 (cimento) mudaram');
  return [
    section(
      'Cimento',
      'RICMS/RR (Decreto 4.335-E/2001), arts. 785 e 786 (Decreto 16.612-E/2014)',
      lines,
      ctx,
      [
        item(
          'art. 785',
          { ncms: [ncm[1]], description: 'Cimento de qualquer espécie (posição 2523 da NCM)' },
          pct(mva[1]),
        ),
      ],
      'Vale entre contribuintes de UFs signatárias do Protocolo ICMS 11/85. Base: preço máximo de venda a varejo fixado pela autoridade (a SEFAZ-RR publica o PMPF do cimento); na falta, preço do substituto com IPI, frete, seguro e encargos mais a MVA ajustada (art. 786, § 1º).',
      [lines.slice(a, a + 6), lines.slice(b, b + 2)],
    ),
  ];
}

function trigo(lines, ctx) {
  const a = find(lines, /^Art\. 787\. O estabelecimento que adquirir em operações interestaduais/);
  const mix = /codificação (\d{8}) da NCM/.exec(lines.slice(a, a + 4).join(' '));
  const b = find(lines, /^Art\. 788\./, a);
  const txt = lines.slice(b, b + 40).join(' ');
  const farinha = /II [–-] (\d+,\d+)%[^;]*farinha de trigo ou mistura/.exec(txt);
  const deriv = /III [–-] (\d+)%[^.]*produtos derivados de farinha/.exec(txt);
  const c = find(lines, /^Art\. 789/, b);
  const massa = /código NCM (\d{4}\.\d{2}\.\d{2}) a (\d{4}\.\d{2}\.\d{2})/.exec(
    lines.slice(c, c + 12).join(' '),
  );
  if (!mix || !farinha || !deriv || !massa)
    throw new Error('RICMS/RR: arts. 787 a 789 (trigo) mudaram');
  const lo = digits(massa[1]);
  const hi = digits(massa[2]);
  const ncms = ['19021100', '19021900', '19022000', '19023000'].filter((n) => n >= lo && n <= hi);
  const note =
    'Não é retenção pelo remetente: o adquirente em operação interestadual recolhe o imposto antecipado (art. 787), e as saídas internas seguintes ficam dispensadas de nova tributação (art. 789). O texto não traz NCM do trigo em grão (94,12%) nem da farinha de trigo (76,48%), só o da mistura de farinha de trigo; ficam como "falta configurar". Base: preço final ao consumidor fixado pela autoridade ou, na falta, valor da operação com IPI, frete e encargos mais a margem (art. 788, § 1º).';
  return [
    section(
      'Farinha de trigo, mistura e derivados',
      'RICMS/RR (Decreto 4.335-E/2001), arts. 787 a 789 (Decreto 5.941-E/2004)',
      lines,
      ctx,
      [
        item(
          '787 mistura',
          {
            ncms: [mix[1]],
            description:
              'Mistura de farinha de trigo (NCM 1901.20.00); margem de agregação das operações com farinha de trigo ou mistura',
          },
          pct(farinha[1]),
        ),
        item(
          '789 derivados',
          {
            ncms,
            description:
              'Macarrão, talharim, massa para lasanha, sopa e massa crua, semicrua e cozida (NCM 1902.11.00 a 1902.30.00); margem dos derivados da farinha de trigo',
          },
          deriv[1],
        ),
      ],
      note,
      [lines.slice(a - 3, a), lines.slice(c, c + 12)],
    ),
  ];
}

function farmaceuticos(lines, ctx) {
  const a = find(lines, /^CLASSIFICAÇÃO [–-] NBM\/SH/);
  const end = find(lines, /^Reda[cç][aã]o anterior|^Redacao anterior/i, a);
  const blocks = itemBlocks(lines.slice(a + 2, end), romanNumeral, {
    dropStray: (l) => /^\d{3}$/.test(l),
  });
  const mva = /§ 2º A MVA-ST original é de (\d+(?:,\d+)?)%/.exec(
    lines
      .slice(find(lines, /^Art\. 799\./, end))
      .slice(0, 40)
      .join(' '),
  );
  if (blocks.length !== 18 || !mva)
    throw new Error('RICMS/RR: art. 798/799 (farmacêuticos) mudaram');
  const items = blocks.map((b) => {
    const d = readBlock(b.lines);
    return item(`798 ${ROMAN[b.n - 1]}`, d, pct(mva[1]));
  });
  const art799 = find(lines, /^Art\. 799\./, end);
  return [
    section(
      'Produtos farmacêuticos',
      'RICMS/RR (Decreto 4.335-E/2001), arts. 798 e 799 (Decreto 27.614-E/2019)',
      lines,
      ctx,
      items,
      'Só mercadorias de uso humano (art. 798, parágrafo único). Base: preço da tabela sugerida pelo órgão competente ou preço máximo sugerido pela indústria; na falta, preço do substituto com IPI, frete, seguro e encargos mais a MVA ajustada (art. 799, § 1º).',
      [
        lines.slice(a - 3, a),
        lines.slice(art799, art799 + 14).filter((l) => /22\.349|24\.641|efeitos/.test(l)),
      ],
    ),
  ];
}

function perfumes(lines, ctx) {
  const a = find(lines, /^Art\. 800\./);
  const chap = /Capítulo (\d{2}) da Nomenclatura/.exec(lines.slice(a, a + 3).join(' '));
  const b = find(lines, /^Art\. 801\./, a);
  const mva = /percentual de (\d+(?:,\d+)?)%/.exec(lines.slice(b, b + 8).join(' '));
  if (!chap || !mva) throw new Error('RICMS/RR: arts. 800/801 (perfumes) mudaram');
  return [
    section(
      'Perfumes e cosméticos',
      'RICMS/RR (Decreto 4.335-E/2001), arts. 800 e 801',
      lines,
      ctx,
      [
        item(
          'art. 800',
          { ncms: [chap[1]], description: 'Perfumes e cosméticos do Capítulo 33 da NBM/SH' },
          pct(mva[1]),
        ),
      ],
      'Operações internas. Base: preço da tabela sugerida pelo órgão competente ou preço máximo sugerido pela indústria; na falta, preço do substituto com IPI, frete e despesas mais a MVA (art. 801, parágrafo único). Os dentifrícios e itens de higiene bucal do Capítulo 33 também estão na seção de farmacêuticos, com a mesma MVA.',
      [],
    ),
  ];
}

function tintas(lines, ctx) {
  const a = find(lines, /^ITEM ESPECIFICAÇÃO POSIÇÃO NA NCM/);
  const end = find(lines, /^Parágrafo único\. Inexistindo o valor/, a);
  const blocks = itemBlocks(lines.slice(a + 1, end), romanNumeral, {
    dropStray: (l) => /^(?:I|V|X)$/.test(l) || /^\d{3}$/.test(l),
  });
  const art = find(lines, /^§ 2º A MVA-ST original é:/);
  const txt = lines.slice(art, art + 8).join(' ');
  const low = /I - (\d+)% \([^)]*\), para os produtos relacionados conforme itens I a IX/.exec(txt);
  const high = /II - (\d+)% \([^)]*\) para os produtos relacionados conforme item X/.exec(txt);
  if (blocks.length !== 10 || !low || !high)
    throw new Error('RICMS/RR: arts. 824/825 (tintas) mudaram');
  const items = blocks.map((b) =>
    item(`825 ${ROMAN[b.n - 1]}`, readBlock(b.lines), b.n === 10 ? high[1] : low[1]),
  );
  const chunks = [
    lines.slice(art - 1, art + 1),
    blocks.flatMap((b) => b.lines).filter((l) => /Decreto/.test(l)),
  ];
  return [
    section(
      'Tintas, vernizes e outras mercadorias da indústria química',
      'RICMS/RR (Decreto 4.335-E/2001), arts. 824 e 825',
      lines,
      ctx,
      items,
      'Base: preço de venda a consumidor da tabela do órgão competente mais o frete; na falta, preço do substituto com IPI, frete, seguro e encargos mais a MVA ajustada (art. 825, § 1º). Itens I a IX a 35% e o item X (corantes) a 50% (art. 825, § 2º).',
      chunks,
    ),
  ];
}

function laminasLampadas(lines, ctx) {
  const a = find(
    lines,
    /^Art\. 838\.\s+Nas operações internas e interestaduais entre contribuintes situados nas unida/,
  );
  const art839 = find(
    lines,
    /^Art\. 839\. A base de cálculo do imposto, para fins de substituição tributária em relação às operações/,
    a,
  );
  const mvaI = /I - (\d+)% \([^)]*\) para os produtos mencionados no inciso I do art\. 838/.exec(
    lines.slice(art839, art839 + 30).join(' '),
  );
  if (!mvaI) throw new Error('RICMS/RR: art. 839, § 2º, I mudou');
  // Quadro do art. 838 (sem MVA): aparelhos e lâminas de barbear.
  const barb = [];
  for (const l of lines.slice(a, art839)) {
    const m = /^(\d)\. (Aparelhos de barbear|Lâminas de barbear)\s+(\d{4}\.\d{2}\.\d{2})$/.exec(
      l.trim(),
    );
    if (m) barb.push(item(`838 I-${m[1]}`, { ncms: [digits(m[3])], description: m[2] }, mvaI[1]));
  }
  const rows = [];
  const start = find(lines, /^II [–-] conforme tabela abaixo/, art839);
  const stop = find(lines, /^§ 3º Na hipótese da “ALQ intra”/, start);
  const joined = lines
    .slice(start + 2, stop)
    .join(' ')
    .replace(/\s+/g, ' ')
    .split(/5\. Reda[cç][aã]o anterior/)[0];
  const rowRe =
    /(\d)\.\s*(?:\(redação pelo Decreto nº ([\d.]+)\/(\d{2})\)\s*)?([^\d]+?)\s+(\d{4}(?:\.\d{2}\.\d{2}|\.\d{2})?)\s+([\d,]+)%/g;
  for (const m of joined.matchAll(rowRe)) {
    rows.push({
      led: Boolean(m[2]),
      item: m[1],
      text: m[4].trim(),
      ncm: digits(m[5]),
      mva: pct(m[6]),
      dec: m[2],
    });
  }
  if (barb.length !== 2 || rows.length !== 5)
    throw new Error('RICMS/RR: quadros dos arts. 838/839 mudaram');
  const head = find(lines, /^\(A Seção XVII do Capítulo II/);
  const out = [
    section(
      'Lâminas e aparelhos de barbear descartáveis',
      'RICMS/RR (Decreto 4.335-E/2001), arts. 838 e 839 (Decreto 26.414-E/2018)',
      lines,
      ctx,
      barb,
      'Entre contribuintes de UFs signatárias dos Protocolos ICM 16/85 e 17/85 e na importação. Base: preço final a consumidor fixado por órgão público ou sugerido pelo fabricante; na falta, valor da operação com frete, seguro e encargos mais a MVA ajustada (art. 839, § 1º).',
      [lines.slice(head, head + 3)],
    ),
    section(
      'Lâmpadas, reatores e "starter"',
      'RICMS/RR (Decreto 4.335-E/2001), arts. 838 e 839, § 2º, II (Decreto 26.414-E/2018)',
      lines,
      ctx,
      rows
        .filter((r) => !r.led)
        .map((r) => item(`839 II-${r.item}`, { ncms: [r.ncm], description: r.text }, r.mva)),
      'Mesmo regime e base das lâminas e aparelhos de barbear; a MVA vem do quadro do art. 839, § 2º, II. Remetente do Simples Nacional também usa a MVA do quadro (art. 839, § 4º).',
      [lines.slice(head, head + 3)],
    ),
  ];
  const led = rows.find((r) => r.led);
  out.push(
    section(
      'Lâmpadas de LED',
      'RICMS/RR (Decreto 4.335-E/2001), art. 839, § 2º, II, item 5 (Decreto 28.036-E/2019)',
      lines,
      ctx,
      [item('839 II-5', { ncms: [led.ncm], description: led.text }, led.mva)],
      'Mesma base e regime das demais lâmpadas; a redação do Decreto 28.036-E/2019 tirou o NCM 8543.70.99 do item.',
      [[`Decreto nº ${led.dec}`]],
    ),
  );
  return out;
}

function telhas(lines, ctx) {
  const a = find(lines, /^Art\. 839-B - Nas operações interestaduais com telhas/);
  const txt = lines.slice(a, a + 5).join(' ');
  const m = /classificados nos códigos ([\d., e]+) da Nomenclatura Comum/.exec(txt);
  const c = find(lines, /^Art\. 839-C\./, a);
  const mvaWords = /“MVA ST original” é de (\p{L}+) por cento/u.exec(
    lines.slice(c, c + 14).join(' '),
  );
  const WORDS = { trinta: '30' };
  if (!m || !mvaWords || !WORDS[mvaWords[1]])
    throw new Error('RICMS/RR: arts. 839-B/839-C mudaram');
  const ncms = m[1]
    .split(/\s*(?:,|e)\s*/)
    .map((t) => digits(t))
    .filter(Boolean);
  return [
    section(
      "Telhas, cumeeiras e caixas d'água",
      'RICMS/RR (Decreto 4.335-E/2001), arts. 839-B e 839-C (Decreto 11.495-E/2010)',
      lines,
      ctx,
      [
        item(
          '839-B',
          {
            ncms,
            description:
              "Telhas, cumeeiras e caixas d'água de cimento, amianto, fibrocimento, polietileno e fibra de vidro, inclusive suas tampas",
          },
          WORDS[mvaWords[1]],
        ),
      ],
      'Operações interestaduais com o estabelecimento industrial ou importador. Base: preço máximo de venda a varejo ou, na falta, o sugerido pelo fabricante; sem eles, valor da operação com frete, seguro e encargos mais a MVA ajustada (art. 839-C, § 1º); nas operações internas vale a MVA original.',
      [lines.slice(a, a + 5), lines.slice(c, c + 14)],
    ),
  ];
}

/** Autopeças: quadro do art. 839-E (125 itens, NCM) e as duas MVAs do art. 839-F, § 2º. */
function autopecas(lines, ctx) {
  const sec = find(lines, /^Seção XX$/);
  const a = find(lines, /^ITEM DESCRIÇÃO NCM\/SH$/, sec);
  const end = find(lines, /^§ 1º O disposto nesta Seção aplica-se às operações com peças/, a);
  const blocks = itemBlocks(
    lines.slice(a + 1, end).filter((l) => !(/^\d{3}$/.test(l.trim()) && Number(l) > 200)),
    (l) => {
      const m = /^(\d{1,3})(?:\s|$)/.exec(l);
      return m ? Number(m[1]) : null;
    },
    { dropStray: (l) => /^\(itens 102 a 125/.test(l) },
  );
  const f = find(lines, /^§ 2º A MVA-ST original é:/, end);
  const txt = lines.slice(f, f + 14).join(' ');
  const fidel = /I – (\d+,\d+)% \([^)]*\), tratando-se de:/.exec(txt);
  const outros = /II – (\d+,\d+)% \([^)]*\): nos demais casos/.exec(txt);
  if (!fidel || !outros || blocks.length < 100)
    throw new Error('RICMS/RR: arts. 839-E/839-F mudaram');
  const items = [];
  for (const b of blocks) {
    const d = readBlock(b.lines);
    if (d.ncms.length === 0) continue; // item 125 ("outras peças", sem NCM)
    items.push({ n: b.n, d });
  }
  const dateLines = lines.slice(f - 1, f + 1);
  const mk = (label, mva) =>
    section(
      `Peças, componentes e acessórios para autopropulsados (${label})`,
      'RICMS/RR (Decreto 4.335-E/2001), arts. 839-E e 839-F, § 2º (Decreto 18.492-E/2015)',
      lines,
      ctx,
      items.map(({ n, d }) => item(`839-E ${n}`, d, pct(mva))),
      'Operações interestaduais entre contribuintes de UFs signatárias dos Protocolos ICMS 41/08 e 97/10; o remetente retém. O quadro vale para o uso especificamente automotivo (art. 839-E, § 1º). Base: preço máximo de venda a varejo ou o sugerido; na falta, valor da operação com frete, seguro e encargos mais a MVA ajustada (art. 839-F, § 1º). Os itens com NCM em posição ampla têm a exceção na descrição.',
      [dateLines],
    );
  return [
    mk(
      'saída de fabricante de veículos para atender o índice de fidelidade de compra, ou distribuição exclusiva por contrato de fidelidade',
      fidel[1],
    ),
    mk('demais casos', outros[1]),
  ];
}

function racoes(lines, ctx) {
  const a = find(
    lines,
    /^Art\. 839-H\. Nas operações interestaduais com destino a este Estado de rações/,
  );
  const ncm = /Posição (\d{4}) da Nomenclatura/.exec(lines.slice(a, a + 3).join(' '));
  const b = find(lines, /^§ 2º A MVA ST original é/, a);
  const mva = /MVA ST original é (\d+(?:,\d+)?)%/.exec(lines[b]);
  if (!ncm || !mva) throw new Error('RICMS/RR: arts. 839-H/839-I mudaram');
  return [
    section(
      'Rações para animais domésticos',
      'RICMS/RR (Decreto 4.335-E/2001), arts. 839-H e 839-I (Decreto 16.271-E/2013)',
      lines,
      ctx,
      [
        item(
          '839-H',
          {
            ncms: [ncm[1]],
            description: 'Rações tipo "pet" para animais domésticos (posição 2309 da NBM/SH)',
          },
          pct(mva[1]),
        ),
      ],
      'Operações interestaduais com destino a Roraima; o industrial ou importador retém. Base: preço máximo de venda a varejo ou o sugerido; na falta, valor da operação com frete, seguro e encargos mais a MVA ajustada (art. 839-I, § 1º).',
      [lines.slice(b, b + 1)],
    ),
  ];
}

/** Materiais de construção: o quadro do § 1º, II (mercadorias para destinatário fora dos CNAE). */
function construcao(lines, ctx) {
  const a = find(lines, /^Art\. 839-Q\./);
  const t = find(lines, /^NCM\/SH MERCADORIAS$/, a);
  const end = find(lines, /^Reda[cç][aã]o anterior/i, t);
  const entries = [];
  let cur = null;
  for (const raw of lines.slice(t + 1, end)) {
    const line = raw.trim().replace(/(\d)\(exceto/g, '$1 (exceto');
    if (!line || /^\d{3}$/.test(line)) continue;
    const rangeLine = /^(\d{4}) a (\d{4})\b(.*)$/.exec(line);
    if (rangeLine) {
      cur = {
        codes: [],
        except: [],
        range: [Number(rangeLine[1]), Number(rangeLine[2])],
        text: [rangeLine[3].trim()],
        hasText: true,
        open: false,
      };
      entries.push(cur);
      continue;
    }
    // Começo da linha: códigos e as palavras que os ligam ("e", "(exceto"); o resto é descrição.
    const toks = line.split(/\s+/);
    let j = 0;
    const leadCodes = [];
    const leadExcept = [];
    let afterExcept = cur?.open ?? false;
    while (j < toks.length) {
      const w = toks[j].replace(/[,;]$/, '');
      if (/^\(?exceto$/.test(w)) afterExcept = true;
      else if (codeTok(toks[j]))
        (afterExcept ? leadExcept : leadCodes).push(digits(codeTok(toks[j])));
      else if (w !== 'e') break;
      j++;
    }
    const rest = toks.slice(j).join(' ');
    if (leadCodes.length + leadExcept.length === 0) {
      if (cur) {
        cur.text.push(line);
        cur.hasText = true;
        cur.open = false;
      }
      continue;
    }
    // Código novo depois de uma descrição já lida abre outro item; a lista de exceções continua o mesmo.
    if (!cur || (cur.hasText && !cur.open) || (cur.hasText && leadCodes.length > 0 && !cur.open)) {
      cur = { codes: [], except: [], text: [], hasText: false, open: false };
      entries.push(cur);
    }
    cur.codes.push(...leadCodes);
    cur.except.push(...leadExcept);
    // "(exceto telhas, ..." sem código: a exceção em palavras fica na descrição.
    const textualExcept = afterExcept && leadExcept.length === 0 && rest.length > 0;
    cur.open = afterExcept && rest.length === 0;
    if (rest) {
      cur.text.push(textualExcept ? `(exceto ${rest}` : rest);
      cur.hasText = true;
    }
  }
  const items = [];
  for (const e of entries) {
    const text = e.text.join(' ').replace(/\s+/g, ' ').trim();
    const exc = [...e.except, ...exceptIn(text)];
    const ncms = e.range
      ? Array.from({ length: e.range[1] - e.range[0] + 1 }, (_, k) => String(e.range[0] + k))
      : [...new Set(e.codes)];
    if (ncms.length === 0) continue;
    const exceptNcms = [...new Set(exc)].filter((x) =>
      ncms.some((c) => x.startsWith(c) && x !== c),
    );
    items.push(
      item(`839-Q ${ncms[0]}`, { ncms, exceptNcms, description: text.replace(/;$/, '') }, '35'),
    );
  }
  const m3 = lines.findIndex(
    (l, i) =>
      i > end &&
      /adicionado da parcela resultante da aplicação, sobre o referido montante, do percentual de margem de valor/.test(
        l,
      ),
  );
  const mvaText = lines.slice(m3, m3 + 3).join(' ');
  const mva =
    /agregado de (\d+)% \([^)]*\)\.\s*\(§ 3º alterado pelo Decre\s?to nº ([\d.]+), de (\d{2}\/\d{2}\/\d{2}), com efeitos a partir/.exec(
      mvaText,
    );
  if (m3 < 0 || !mva || items.length < 40) throw new Error('RICMS/RR: art. 839-Q mudou');
  const eff = lines.slice(m3, m3 + 4).join(' ');
  return [
    section(
      'Materiais de construção',
      'RICMS/RR (Decreto 4.335-E/2001), art. 839-Q (Decreto 26.413-E/2018)',
      lines,
      ctx,
      items.map((i) => ({ ...i, mva: mva[1] })),
      "Não é retenção pelo remetente: o estabelecimento inscrito nos CNAE do caput (comércio atacadista e varejista de materiais de construção) recolhe o imposto antecipado. A lista de NCM é a do § 1º, II (mercadorias para destinatário fora desses CNAE); a MVA de 35% é a do § 3º, na falta de preço fixado ou sugerido. Sem a lista do caput por NCM, o regime dos CNAE vale para qualquer mercadoria. As exceções em palavras (telhas, cumeeiras e caixas d'água) estão na descrição.",
      [[eff]],
    ),
  ];
}

function sorvetes(lines, ctx) {
  const a = find(lines, /^Art\. 839-R\./);
  const txt = lines.slice(a, a + 80).join(' ');
  const i =
    /I - aos sorvetes de qualquer espécie[^.]*classificados na posição (\d{4})\.(\d{2}) da NCM/.exec(
      txt,
    );
  const ii =
    /II - aos preparados para fabricação de sorvete em máquina, classificados nas posições ([\d, e]+) da NCM/.exec(
      txt,
    );
  const m70 = /a\) de (\d+)% \([^)]*\) para os produtos indicados no inciso I do § 1º/.exec(txt);
  const m328 = /b\) de (\d+)% \([^)]*\) para os produtos indicados no inciso II do § 1º/.exec(txt);
  if (!i || !ii || !m70 || !m328) throw new Error('RICMS/RR: art. 839-R mudou');
  const prep = ii[1]
    .split(/\s*(?:,|e)\s*/)
    .map((t) => digits(t))
    .filter(Boolean);
  const dateLines = lines.slice(a, a + 80).filter((l) => /13\.224|9\.692/.test(l));
  return [
    section(
      'Sorvetes e preparados para sorvete em máquina',
      'RICMS/RR (Decreto 4.335-E/2001), art. 839-R (Decreto 13.224/2011)',
      lines,
      ctx,
      [
        item(
          '839-R I',
          {
            ncms: [`${i[1]}`],
            description:
              'Sorvetes de qualquer espécie, inclusive picolés e sanduíches de sorvete (posição 2105.00 da NCM)',
          },
          m70[1],
        ),
        item(
          '839-R II',
          {
            ncms: prep,
            description:
              'Preparados para fabricação de sorvete em máquina (posições 1806, 1901 e 2106 da NCM)',
          },
          m328[1],
        ),
      ],
      'O industrial, importador ou estabelecimento de outra UF retém. Base: preço máximo de venda a varejo da tabela da autoridade ou do próprio industrial; na falta, valor da operação com frete, seguro e encargos mais a MVA ajustada (art. 839-R, § 3º).',
      [dateLines],
    ),
  ];
}

function celulares(lines, ctx) {
  const a = find(lines, /^Art\. 839 ?-T\./);
  const txt = lines.slice(a, a + 30).join(' ');
  const i =
    /I [–-] telefones para redes celulares classificados na posição (\d{4}\.\d{2}\.\d)/.exec(txt);
  const ii = /II [–-] cartões inteligentes[^.]*classificados na posição (\d{4}\.\d{2}\.\d{2})/.exec(
    txt,
  );
  const mva = /“MVA-ST original” é (\d+)% \(/.exec(txt);
  if (!i || !ii || !mva) throw new Error('RICMS/RR: art. 839-T mudou');
  const head = find(lines, /^\(artigo 839-T, acrescentado pelo Decreto nº 28\.405-E/);
  return [
    section(
      'Aparelhos celulares e cartões inteligentes',
      'RICMS/RR (Decreto 4.335-E/2001), art. 839-T (Decreto 28.405-E/2020)',
      lines,
      ctx,
      [
        item(
          '839-T I',
          {
            ncms: [digits(i[1])],
            description:
              'Telefones para redes celulares (posição 8517.12.3 da NCM), exceto por satélite e os de uso automotivo',
          },
          mva[1],
        ),
        item(
          '839-T II',
          {
            ncms: [digits(ii[1])],
            description:
              'Cartões inteligentes ("smart cards" e "sim cards") da posição 8523.52.00 da NCM',
          },
          mva[1],
        ),
      ],
      'Operações interestaduais e de importação; o remetente retém (também nas operações internas, art. 839-T, § 5º). Base: preço máximo ou sugerido; na falta, valor da operação com frete, IPI e despesas mais a MVA ajustada (art. 839-T, § 3º).',
      [lines.slice(head, head + 2)],
    ),
  ];
}

/** Lê o RICMS/RR (linhas do PDF) e devolve as seções de ST com percentual e NCM. */
export function parseRrRicms(lines) {
  const decrees = rrDecreeDates(lines);
  if (decrees.size < 100) throw new Error('RICMS/RR: lista de decretos do início não encontrada');
  const title = lines.slice(0, 40).join(' ');
  const base = /DECRETO 4\.335 DE (\d{2})\.(\d{2})\.(\d{2})/.exec(title);
  const baseDate = base
    ? isoDate(fullYear(Number(base[3])), Number(base[2]), Number(base[1]))
    : null;
  // O título não vem com a data em todas as cópias; o decreto é de 03/08/2001 (nome do arquivo).
  const ctx = { decrees, base: baseDate ?? '2001-08-03' };
  // O Capítulo II começa depois do art. 764.
  const cap = find(lines, /^DAS OPERAÇÕES SUJEITAS AO REGIME DE SUBSTITUIÇÃO TRIBUTÁRIA$/);
  const body = lines.slice(cap);
  const out = [
    ...cigarros(body, ctx),
    ...bebidas(body, ctx),
    ...veiculos(body, ctx),
    ...motos(body, ctx),
    ...pneus(body, ctx),
    ...cimento(body, ctx),
    ...trigo(body, ctx),
    ...farmaceuticos(body, ctx),
    ...perfumes(body, ctx),
    ...tintas(body, ctx),
    ...laminasLampadas(body, ctx),
    ...telhas(body, ctx),
    ...autopecas(body, ctx),
    ...racoes(body, ctx),
    ...construcao(body, ctx),
    ...sorvetes(body, ctx),
    ...celulares(body, ctx),
  ];
  return { sections: out, decreesCount: decrees.size };
}

/** Referências para `st-references.json`: sem CEST e sem segmento do Convênio ICMS 142/2018. */
export function rrStReferences(parsed, { url, source }) {
  return parsed.sections.map((s) => ({
    uf: 'RR',
    segment: '',
    segmentName: s.segmentName,
    act: s.act,
    source,
    url,
    validFrom: s.validFrom,
    validTo: null,
    note: s.note,
    items: s.items.map((i) => ({
      item: i.item,
      cest: '',
      ncms: i.ncms,
      ...(i.exceptNcms ? { exceptNcms: i.exceptNcms } : {}),
      ncmText: i.ncms.join(' '),
      description: i.description,
      mva: i.mva,
    })),
  }));
}
