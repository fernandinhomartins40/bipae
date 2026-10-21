// Extrai, do texto consolidado da Resolução SEFA 571/2019 (Paraná) guardado em sources/, a MVA
// original de cada item de ST: seção, inciso, item, CEST, NCM, descrição e percentual (F3-26.c).
// O texto consolidado traz, depois de cada item alterado, a "redação original" que já não vale;
// ela fica de fora. Itens e seções revogados também. Nenhum valor é digitado à mão.

const ROMAN = { I: 1, V: 5, X: 10, L: 50 };
const roman = (text) =>
  [...text].reduce(
    (acc, ch, i, all) => acc + (ROMAN[ch] < (ROMAN[all[i + 1]] ?? 0) ? -ROMAN[ch] : ROMAN[ch]),
    0,
  );

/** Cabeçalho e número das páginas, que o PDF repete e cortam os itens ao meio. */
const PAGE_HEADER = new Set([
  'Estado do Paraná',
  'Secretaria de Estado da Fazenda',
  'Receita Estadual do Paraná',
  'Coordenação da Receita do Estado',
]);

const NCM_TOKEN = /^\*?(?:\d{4}(?:\.\d{1,2}){0,2}|\d{2}\.\d{2}(?:\.\d{2}){0,2}),?$/;
const ITEM_START = /^(\d+)(?:[-.]([A-Z]))?\s+(\d{2}\.\d{3}\.\d{2})(?:\s+(.*))?$/;
const MVA_LINE = /^\d{1,3}(?:,\d{1,2})?$/;

const isoFromBr = (text) => {
  const m = /(\d{1,2})º?\.(\d{1,2})\.(\d{4})/.exec(text);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
};

/** Ordem do item na tabela ("10-A" vem logo depois do 10). */
const orderOf = (num, suffix) => Number(num) + (suffix ? (suffix.charCodeAt(0) - 64) / 100 : 0);

/** Linha que só pode vir depois de um item completo (outro item, nota de alteração, seção). */
function closesItem(next) {
  return (
    ITEM_START.test(next) ||
    /^(Nova redação|Redação|Acrescido|Revogado|Retificado|SEÇÃO |Art\. |ITEM CEST|[IVXL]+ - )/.test(
      next,
    ) ||
    next === ''
  );
}

function withoutPageHeaders(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (PAGE_HEADER.has(lines[i])) {
      // O número da página vem logo depois do cabeçalho.
      while (i + 1 < lines.length && PAGE_HEADER.has(lines[i + 1])) i++;
      if (/^\d+$/.test(lines[i + 1] ?? '')) i++;
      continue;
    }
    out.push(lines[i]);
  }
  return out;
}

/** Separa o começo da linha do item em posições de NCM e o início da descrição. */
function splitNcm(tokens) {
  const ncm = [];
  let i = 0;
  while (i < tokens.length && (NCM_TOKEN.test(tokens[i]) || /^[Ee]$/.test(tokens[i]))) {
    ncm.push(tokens[i]);
    i++;
  }
  return { ncm, rest: tokens.slice(i) };
}

/**
 * @param lines linhas do PDF oficial (pdf-text.mjs)
 * @param knownCest CEST do Convênio ICMS 142/18 (sem pontos), para conferir
 * @returns tabelas por seção e inciso, cada uma com a data em que passou a valer
 */
export function parsePrRes571(lines, knownCest) {
  const text = withoutPageHeaders(lines);
  const tables = [];
  let section = null;
  let table = null;
  let item = null;
  // "Redação original ... que produziu efeitos": o que vem depois já não vale.
  let history = null; // null | 'item' | 'table'
  let pendingFrom = null;
  const unknownCest = new Set();
  let article = null;
  const problems = [];

  const finishItem = () => {
    if (!item || item.ignored) {
      item = null;
      return;
    }
    if (!item.revoked && table.revoked) {
      // Redação antiga de seção revogada: basta saber o CEST que saiu da ST.
      table.items.push({ item: item.item, cest: item.cest });
    } else if (!item.revoked) {
      if (item.ncms.length === 0) problems.push(`Item ${item.item} (${item.cest}) sem NCM`);
      if (!item.mva) problems.push(`Item ${item.item} (${item.cest}) sem MVA`);
      table.items.push({
        item: item.item,
        cest: item.cest,
        ncms: item.ncms,
        ncmText: item.ncmText,
        description: item.description.join(' ').replace(/\s+/g, ' ').trim(),
        mva: item.mva,
      });
    }
    item = null;
  };
  const openTable = (inciso, name) => {
    finishItem();
    table = {
      section: section.roman,
      sectionName: section.name,
      // Seção revogada na própria resolução: os itens só servem para saber os CEST que saíram.
      revoked: section.revoked,
      inciso,
      name,
      article,
      validFrom: pendingFrom ?? '2019-07-04',
      items: [],
      seen: new Set(),
      max: 0,
    };
    pendingFrom = null;
    tables.push(table);
    history = null;
  };

  for (let i = 0; i < text.length; i++) {
    const line = text[i];
    const sec = /^SEÇÃO ([IVXL]+)$/.exec(line);
    if (sec) {
      finishItem();
      const nameLines = [];
      let j = i + 1;
      while (j < text.length && /^[A-ZÀ-Ú0-9 ,()-]+$/.test(text[j]) && !/^ITEM/.test(text[j])) {
        nameLines.push(text[j]);
        j++;
      }
      const name = nameLines.join(' ').replace(/\s+/g, ' ').trim();
      // A redação antiga de uma seção revogada vem logo depois, com o mesmo número.
      const revoked =
        /^Revogada a Seção/.test(text[j] ?? '') ||
        /\(REVOGADA\)/.test(name) ||
        (section?.revoked === true && section.roman === sec[1]);
      section = {
        roman: sec[1],
        name: name.replace(/\s*\(REVOGADA\)$/, '').replace(/^DAS OPERAÇÕES COM /, ''),
        revoked,
      };
      table = null;
      history = null;
      i = j - 1;
      continue;
    }
    if (!section) continue;

    const inc = /^([IVXL]+) - (.+):$/.exec(line);
    if (inc && (!item || item.ignored || item.mva)) {
      openTable(inc[1], inc[2]);
      continue;
    }
    // Inciso revogado ("VII -" e a nota): a tabela antiga que vem depois já não vale.
    if (/^[IVXL]+ -$/.test(line) && /^Revogado o inciso/.test(text[i + 1] ?? '')) {
      openTable(line.replace(/ -$/, ''), null);
      table.skip = true;
      continue;
    }
    if (table?.skip) continue;
    if (/^Tabela com redação dada/.test(line)) {
      // "... produzindo efeitos a partir de 1º.4.2026:" pode quebrar em várias linhas.
      const joined = text.slice(i, i + 4).join(' ');
      pendingFrom = isoFromBr(joined.slice(joined.indexOf('a partir de')));
      if (table && table.items.length === 0) table.validFrom = pendingFrom ?? table.validFrom;
      continue;
    }
    // Outro artigo na mesma seção (o leite, no art. 23) é outra tabela.
    const art = /^Art\. (\d+)/.exec(line);
    if (art && history === null) {
      finishItem();
      table = null;
      article = art[1];
      continue;
    }
    if (/^(ITEM|POSIÇÃO) CEST NCM\/SH/.test(line)) {
      if (!table) openTable(null, null);
      else if (pendingFrom && table.items.length === 0) table.validFrom = pendingFrom;
      continue;
    }
    if (/produziu efeitos/.test(line)) {
      finishItem();
      history = /^Redação original da tabela/.test(line) ? 'table' : 'item';
      continue;
    }

    const start = ITEM_START.exec(line);
    if (start && table) {
      const [, num, suffix, cestText, rest = ''] = start;
      const order = orderOf(num, suffix);
      const key = `${num}${suffix ? `-${suffix}` : ''}`;
      const cest = cestText.replace(/\./g, '');
      // Item que passa de uma página para outra: o PDF repete a primeira linha dele.
      const previous = item && !item.ignored ? item : table.items[table.items.length - 1];
      if (previous && previous.item === key && previous.cest === cest) {
        if (item !== previous) item = { ignored: true };
        continue;
      }
      // Na redação antiga os itens repetem números que já passaram; o próximo item novo encerra.
      if (
        history === 'table' ||
        (history === 'item' && (order <= table.max || table.seen.has(key)))
      ) {
        finishItem();
        item = { ignored: true };
        continue;
      }
      finishItem();
      history = null;
      // O PR ainda lista alguns CEST que o Convênio ICMS 142/18 já tirou; o NCM é o que vale aqui.
      if (!knownCest.has(cest)) unknownCest.add(cestText);
      const { ncm, rest: desc } = splitNcm(rest.split(/\s+/).filter(Boolean));
      table.seen.add(key);
      table.max = Math.max(table.max, order);
      item = {
        item: key,
        cest,
        ncmTokens: ncm,
        ncms: [],
        ncmText: '',
        description: desc,
        mva: null,
        revoked: /\(REVOGADO\)/.test(rest),
        phase: desc.length > 0 ? 'desc' : 'ncm',
      };
      const last = desc[desc.length - 1] ?? '';
      if (desc.length > 1 && MVA_LINE.test(last) && closesItem(text[i + 1] ?? '')) {
        item.mva = last.replace(',', '.');
        item.description = desc.slice(0, -1);
      }
      const updateNcm = () => {
        item.ncmText = item.ncmTokens.join(' ').replace(/\s+,/g, ',');
        item.ncms = [
          ...new Set(
            item.ncmTokens.filter((t) => !/^[Ee]$/.test(t)).map((t) => t.replace(/[.,*]/g, '')),
          ),
        ];
      };
      updateNcm();
      item.updateNcm = updateNcm;
      continue;
    }
    const revokedItem =
      /^\d+(?:[-.][A-Z])? \(REVOGADO\)/.test(line) ||
      (/^\d+(?:[-.][A-Z])?$/.test(line) && /^Revogado o item/.test(text[i + 1] ?? ''));
    if (revokedItem) {
      finishItem();
      if (table) {
        const [, num, suffix] = /^(\d+)(?:[-.]([A-Z]))?/.exec(line);
        table.max = Math.max(table.max, orderOf(num, suffix));
        table.seen.add(`${num}${suffix ? `-${suffix}` : ''}`);
      }
      continue;
    }
    if (!item || item.ignored || item.mva) continue;
    if (item.phase === 'ncm') {
      const tokens = line.split(/\s+/);
      const { ncm, rest } = splitNcm(tokens);
      if (ncm.length > 0 && rest.length === 0) {
        item.ncmTokens.push(...ncm);
        item.updateNcm();
        continue;
      }
      item.phase = 'desc';
    }
    if (MVA_LINE.test(line)) {
      item.mva = line.replace(',', '.');
      continue;
    }
    // Às vezes a MVA vem no fim da última linha da descrição ("Chope 140").
    const tail = /^(.*\S)\s+(\d{1,3}(?:,\d{1,2})?)$/.exec(line);
    if (tail && closesItem(text[i + 1] ?? '')) {
      item.description.push(tail[1]);
      item.mva = tail[2].replace(',', '.');
      continue;
    }
    item.description.push(line);
  }
  finishItem();

  if (problems.length > 0) throw new Error(`Resolução SEFA 571/2019: ${problems.join('; ')}`);
  const result = tables
    .filter((t) => t.items.length > 0)
    .map(({ seen: _s, max: _m, skip: _k, ...t }) => t);
  const total = result.reduce((n, t) => n + t.items.length, 0);
  if (total < 400) {
    throw new Error(`Esperava a Resolução SEFA 571/2019 inteira; achei ${total} itens`);
  }
  return { tables: result, articles: articleMvas(text), unknownCest: [...unknownCest].sort() };
}

/**
 * Seções em que a resolução escreve a MVA no texto do artigo, uma por hipótese, para os produtos
 * da tabela do Anexo IX (autopeças, no art. 5º, e veículos, no art. 29), em vez de uma tabela.
 */
function articleMvas(text) {
  const out = [];
  let section = null;
  let hypothesis = null;
  for (let i = 0; i < text.length; i++) {
    const line = text[i];
    const sec = /^SEÇÃO ([IVXL]+)$/.exec(line);
    if (sec) {
      hypothesis = null;
      section = {
        roman: sec[1],
        name: (text[i + 1] ?? '').replace(/^DAS OPERAÇÕES COM /, ''),
        revoked: /^Revogada a Seção/.test(text[i + 1] ?? ''),
        article: null,
      };
      continue;
    }
    if (!section || section.revoked) continue;
    const art = /^Art\. (\d+)\.º? Os percentuais correspondentes à MVA original/.exec(line);
    if (art) {
      const head = text.slice(i, i + 4).join(' ');
      const annex = /art\. (\d+) do\s+Anexo IX/.exec(head);
      section.article = { article: art[1], annexArticle: annex?.[1] ?? null, hypotheses: [] };
      out.push({ section: section.roman, sectionName: section.name, ...section.article });
      continue;
    }
    if (!section.article) continue;
    const inc = /^([IVXL]+) - (\d{1,3}(?:,\d{1,2})?)% (.*)$/.exec(line);
    if (inc) {
      hypothesis = { inciso: inc[1], mva: inc[2].replace(',', '.'), text: [inc[3]] };
      section.article.hypotheses.push(hypothesis);
      continue;
    }
    if (/^(ITEM|POSIÇÃO) CEST|^Art\. |^Redação|^Nova redação/.test(line)) {
      // Artigo com tabela: a MVA está nos itens, não no texto.
      section.article.hypotheses.length = 0;
      section.article = null;
      hypothesis = null;
      continue;
    }
    hypothesis?.text.push(line);
  }
  return out
    .filter((a) => a.hypotheses.length > 0)
    .map((a) => ({
      ...a,
      hypotheses: a.hypotheses.map((h) => ({
        ...h,
        // Tira o percentual por extenso: "(trinta e seis inteiros ... por cento), nas demais".
        text: h.text
          .join(' ')
          .replace(/^\([^)]*\),?\s*/, '')
          .replace(/\s+/g, ' ')
          .trim(),
      })),
    }));
}

/**
 * Tabelas de produtos de uma seção do Anexo IX (posição, CEST e NCM na redação atual). A redação
 * antiga vem entre aspas ou, quando a posição foi revogada, com números que já passaram.
 */
function annexTables(body) {
  const tables = [];
  let inciso = null;
  let table = null;
  let item = null;
  let history = false;
  const close = () => {
    item = null;
  };
  for (let i = 0; i < body.length; i++) {
    let line = body[i];
    // Às vezes o número da posição fica sozinho numa linha e o CEST vem na seguinte.
    if (/^\d+(?:-[A-Z])?$/.test(line) && /^\d{2}\.\d{3}\.\d{2}\b/.test(body[i + 1] ?? '')) {
      line = `${line} ${body[++i]}`;
    }
    const inc = /^([IVXL]+) - /.exec(line);
    if (inc && !table) {
      inciso = inc[1];
      continue;
    }
    if (/^POSIÇÃO CEST N(CM|BM\/SH) DESCRIÇÃO/.test(line)) {
      close();
      table = { inciso, items: [], seen: new Set(), max: 0 };
      tables.push(table);
      history = false;
      continue;
    }
    if (!table) continue;
    // Fim da tabela: parágrafo, outro artigo ou o próximo inciso do caput.
    if (/^(§ ?\d|Parágrafo único|Art\. )/.test(line) || (inc && !/^I+ - \(/.test(line))) {
      close();
      table = null;
      inciso = inc ? inc[1] : null;
      continue;
    }
    if (/produziu efeitos|^Redação (original|anterior)/.test(line)) {
      close();
      history = true;
      continue;
    }
    const start = ITEM_START.exec(line);
    if (start) {
      const [, num, suffix, cestText, rest = ''] = start;
      const key = `${num}${suffix ? `-${suffix}` : ''}`;
      const cest = cestText.replace(/\./g, '');
      const order = orderOf(num, suffix);
      const previous = item ?? table.items[table.items.length - 1];
      // Posição que passa de uma página para outra: o PDF repete a primeira linha dela.
      if (previous && previous.item === key && previous.cest === cest) {
        item = null;
        continue;
      }
      if (history && (order <= table.max || table.seen.has(key))) {
        close();
        continue;
      }
      history = false;
      table.seen.add(key);
      table.max = Math.max(table.max, order);
      const { ncm, rest: desc } = splitNcm(rest.split(/\s+/).filter(Boolean));
      item = { item: key, cest, ncmTokens: ncm, description: desc };
      table.items.push(item);
      continue;
    }
    const revoked = /^(\d+)(?:-([A-Z]))?$/.exec(line);
    if (revoked && /^Revogada a posição/.test(body[i + 1] ?? '')) {
      close();
      table.seen.add(`${revoked[1]}${revoked[2] ? `-${revoked[2]}` : ''}`);
      table.max = Math.max(table.max, orderOf(revoked[1], revoked[2]));
      continue;
    }
    if (!item) continue;
    const { ncm, rest } = splitNcm(line.split(/\s+/));
    if (item.description.length === 0 && ncm.length > 0 && rest.length === 0) {
      item.ncmTokens.push(...ncm);
      continue;
    }
    if (/^\(/.test(line) || /^"/.test(line)) {
      close();
      continue;
    }
    item.description.push(line);
  }
  return tables.map((t) => ({
    inciso: t.inciso,
    items: t.items
      .map((i) => ({
        item: i.item,
        cest: i.cest,
        ncms: [
          ...new Set(
            i.ncmTokens.filter((n) => !/^[Ee]$/.test(n)).map((n) => n.replace(/[.,*]/g, '')),
          ),
        ],
        ncmText: i.ncmTokens.join(' ').replace(/\s+,/g, ','),
        description: i.description.join(' ').replace(/\s+/g, ' ').trim(),
      }))
      // "Outras peças ... não relacionados" (NCM "-") não tem NCM para casar.
      .filter((i) => i.ncms.length > 0),
  }));
}

export { roman };

/**
 * Seções do Anexo IX do RICMS/PR (texto consolidado da SEFA): nome, se foi revogada (quando e por
 * qual decreto) e os CEST que aparecem no texto dela. A numeração das seções é a mesma da
 * Resolução SEFA 571/2019.
 */
export function parsePrAnexoIX(lines) {
  const text = withoutPageHeaders(lines);
  const sections = [];
  let current = null;
  for (let i = 0; i < text.length; i++) {
    const sec = /^SEÇÃO ([IVXL]+(?:-A)?)$/.exec(text[i]);
    // A redação antiga de uma seção revogada repete o título; continua sendo a mesma seção.
    if (sec && sec[1] !== current?.annex) {
      const nameLines = [];
      let j = i + 1;
      while (j < text.length && !/^\(art/.test(text[j]) && nameLines.length < 4) {
        nameLines.push(text[j]);
        j++;
      }
      current = {
        annex: sec[1],
        name: nameLines
          .join(' ')
          .replace(/\s*\(?REVOGADA\)?.*$/, '')
          .replace(/\s+\d+$/, '')
          .replace(/^DAS? (OPERAÇÕES|DISPOSIÇÕES|REGIME) (COM |DE )?/, '')
          .trim(),
        excludedFrom: null,
        excludedBy: null,
        body: [],
      };
      sections.push(current);
      continue;
    }
    if (!current) continue;
    if (/^Revogada a Seção/.test(text[i]) && current.body.length < 8 && !current.excludedFrom) {
      const note = text.slice(i, i + 4).join(' ');
      const by = /Decreto n\. ([\d.]+), de (\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(note);
      current.excludedFrom = isoFromBr(note.slice(note.indexOf('a partir de')));
      current.excludedBy = by ? `Decreto ${by[1]}/${by[4]}` : null;
      if (!current.excludedFrom || !current.excludedBy) {
        throw new Error(`Revogação da Seção ${current.annex} do Anexo IX sem data ou decreto`);
      }
    }
    current.body.push(text[i]);
  }
  return sections.map(({ body, ...s }) => ({
    ...s,
    tables: annexTables(body),
    // O CEST às vezes quebra no meio ("21.001." numa linha, "00" na outra).
    cests: [
      ...new Set(
        [...body.join(' ').matchAll(/\b(\d{2})\.(\d{3})\.\s?(\d{2})\b/g)].map(
          (m) => m[1] + m[2] + m[3],
        ),
      ),
    ].sort(),
  }));
}

const day = (iso, delta) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};
const sentence = (upper) => upper.charAt(0) + upper.slice(1).toLocaleLowerCase('pt-BR');
const words = (name) =>
  new Set(
    name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .split(/[^A-Z]+/)
      .filter((w) => w.length >= 5),
  );

/**
 * MVA escrita no artigo da resolução, uma por hipótese: a que tabela do Anexo IX cada hipótese se
 * aplica e como ela aparece para a empresa. `check` confere que o texto oficial ainda diz isso.
 * Cada hipótese vira uma referência separada; a empresa escolhe a dela, o Bipaê não escolhe.
 */
const ARTICLE_HYPOTHESES = {
  V: {
    I: {
      check: /fidelidade de compra.*contrato de\s+fidelidade/,
      name: 'Autopeças: saída do fabricante de veículos para a rede com índice ou contrato de fidelidade',
    },
    II: { check: /^nas demais hipóteses/, name: 'Autopeças: demais casos' },
  },
  XXVIII: {
    // Art. 136 do Anexo IX: inciso II do caput (veículos do inciso I do art. 134 sem preço de
    // tabela) e § 4º (veículos de duas rodas, inciso II do art. 134, sem preço de tabela).
    I: {
      check: /inciso II do .caput. do art\. 136/,
      tables: ['I'],
      name: 'Veículos automotores novos sem preço de tabela ou sugerido (art. 136, II, do Anexo IX)',
    },
    II: {
      check: /§ 4º do art\. 136/,
      tables: ['II'],
      name: 'Veículos novos de duas rodas sem preço de tabela ou sugerido (art. 136, § 4º, do Anexo IX)',
    },
  },
};

/**
 * Seções com MVA no texto do artigo que ainda não viram referência, e por quê. Seção nova que
 * aparecer na resolução para a geração até alguém decidir.
 */
const ARTICLE_PENDING = {
  // Art. 25: a hipótese depende da lista do PIS/COFINS (negativa, positiva ou neutra) e das
  // exceções de NCM do texto, que a tabela do art. 125 do Anexo IX não separa item a item.
  XXIV: 'farmacêuticos',
};

const ARTICLE_NOTES = {
  V: 'MVA original do art. 5º da resolução, para os produtos do art. 28 do Anexo IX do RICMS/PR. A base é o preço sugerido ao público quando houver (art. 29 do Anexo IX); a MVA vale na falta dele. Vindo de outra UF, usar a MVA ajustada pela fórmula do § 5º do art. 1º do Anexo IX.',
  XXVIII:
    'MVA original do art. 29 da resolução. Só vale quando não há preço de venda ao consumidor de tabela ou sugerido (art. 136 do Anexo IX); a MVA de 34% é para os veículos de duas rodas (§§ 3º e 4º); para triciclos, confira com a SEFA/PR. Vindo de outra UF, usar a MVA ajustada pela fórmula do § 5º do art. 1º do Anexo IX.',
};

/** Referências das seções com MVA no artigo (autopeças e veículos), item a item do Anexo IX. */
function articleReferences(articles, byAnnex, { resUrl, cestNames }) {
  const references = [];
  const annexes = [];
  for (const a of articles) {
    if (ARTICLE_PENDING[a.section]) continue;
    const plan = ARTICLE_HYPOTHESES[a.section];
    const ricms = byAnnex.get(a.section);
    if (!plan || !ricms) {
      throw new Error(
        `Seção ${a.section} (${a.sectionName}) da Resolução SEFA 571/2019 tem MVA no artigo e não está mapeada`,
      );
    }
    if (![...words(a.sectionName)].some((w) => words(ricms.name).has(w))) {
      throw new Error(`Seção ${a.section} da Resolução SEFA 571/2019 não bate com o Anexo IX`);
    }
    const known = Object.keys(plan).sort().join(',');
    const found = a.hypotheses
      .map((h) => h.inciso)
      .sort()
      .join(',');
    if (known !== found) {
      throw new Error(
        `Art. ${a.article} da Resolução SEFA 571/2019: hipóteses ${found}, esperava ${known}`,
      );
    }
    const describe = (item) => ({
      ...item,
      description: cestNames?.get(item.cest) ?? item.description,
    });
    for (const h of a.hypotheses) {
      const rule = plan[h.inciso];
      if (!rule.check.test(h.text)) {
        throw new Error(
          `Art. ${a.article}, ${h.inciso}, da Resolução SEFA 571/2019 mudou: ${h.text}`,
        );
      }
      const tables = ricms.tables.filter((t) => !rule.tables || rule.tables.includes(t.inciso));
      if (tables.length === 0 || (rule.tables && tables.length !== rule.tables.length)) {
        throw new Error(`Seção ${a.section} do Anexo IX sem a tabela da hipótese ${h.inciso}`);
      }
      references.push({
        uf: 'PR',
        segment: `${a.section}-${h.inciso}`,
        segmentName: rule.name,
        act: `Resolução SEFA 571/2019 (texto consolidado), art. ${a.article}, ${h.inciso}`,
        source: 'stPrRes571',
        url: resUrl,
        validFrom: '2019-07-04',
        validTo: ricms.excludedFrom ? day(ricms.excludedFrom, -1) : null,
        note: ARTICLE_NOTES[a.section],
        items: tables.flatMap((t) => t.items).map((i) => ({ ...describe(i), mva: h.mva })),
      });
    }
    const items = ricms.tables.flatMap((t) => t.items);
    const ncmsOf = new Map();
    for (const i of items)
      ncmsOf.set(i.cest, [...new Set([...(ncmsOf.get(i.cest) ?? []), ...i.ncms])]);
    annexes.push({
      annex: a.section,
      name: sentence(ricms.name),
      cests: [...ncmsOf.keys()].sort().map((cest) => ({ cest, ncms: ncmsOf.get(cest) })),
      ...(ricms.excludedFrom && { excludedFrom: ricms.excludedFrom, excludedBy: ricms.excludedBy }),
    });
  }
  return { references, annexes };
}

/**
 * Junta a resolução (MVA por item) e o Anexo IX (o que saiu da ST e quando) no formato de
 * st-references.json. Seção que o RICMS revogou deixa de sugerir MVA a partir da revogação, mesmo
 * que a resolução ainda não tenha sido atualizada (eletrônicos e celulares em 1º/03/2026).
 * `articles` são as seções com MVA no texto do artigo; `cestNames`, a descrição do CEST no
 * Convênio ICMS 142/18 (no PDF do Anexo IX a descrição às vezes cai fora do lugar).
 */
export function prStReferences(res, anexo, { resUrl, anexoUrl, articles = [], cestNames }) {
  const byAnnex = new Map(anexo.map((s) => [s.annex, s]));
  const byArticle = articleReferences(articles, byAnnex, { resUrl, cestNames });
  const annexes = [];
  const references = [];
  const sections = [...new Set(res.map((t) => t.section))];
  for (const roman of sections) {
    const tables = res.filter((t) => t.section === roman);
    const ricms = byAnnex.get(roman);
    const resName = tables[0].sectionName;
    // Seção revogada na resolução às vezes perde o título; aí vale só o número.
    const sameName = !resName || [...words(resName)].some((w) => words(ricms?.name ?? '').has(w));
    if (!ricms || !sameName) {
      throw new Error(
        `Seção ${roman} da Resolução SEFA 571/2019 (${resName}) não bate com o Anexo IX`,
      );
    }
    const revoked = tables.every((t) => t.revoked);
    if (revoked && !ricms.excludedFrom) {
      throw new Error(`Seção ${roman} revogada na resolução e não no Anexo IX`);
    }
    // NCM de cada CEST como o PR escreve (às vezes mais estreito que o Convênio ICMS 142/18).
    const ncmsOf = new Map();
    for (const item of tables.flatMap((t) => t.items)) {
      if (!item.ncms) continue;
      ncmsOf.set(item.cest, [...new Set([...(ncmsOf.get(item.cest) ?? []), ...item.ncms])]);
    }
    const cests = [
      ...new Set([
        ...tables.flatMap((t) => t.items.map((i) => i.cest)),
        ...(ricms.excludedFrom ? ricms.cests : []),
      ]),
    ].sort();
    annexes.push({
      annex: roman,
      name: sentence(ricms.name),
      cests: cests.map((cest) => (ncmsOf.has(cest) ? { cest, ncms: ncmsOf.get(cest) } : { cest })),
      ...(ricms.excludedFrom && { excludedFrom: ricms.excludedFrom, excludedBy: ricms.excludedBy }),
    });
    if (revoked) continue;
    for (const t of tables) {
      references.push({
        uf: 'PR',
        segment: t.inciso
          ? `${roman}-${t.inciso}`
          : tables.length > 1
            ? `${roman}-art${t.article}`
            : roman,
        segmentName: sentence(
          t.name
            ? `${resName}: ${t.name}`
            : tables.length > 1
              ? `${resName} (art. ${t.article})`
              : resName,
        ),
        act: 'Resolução SEFA 571/2019 (texto consolidado)',
        source: 'stPrRes571',
        url: resUrl,
        validFrom: t.validFrom,
        validTo: ricms.excludedFrom ? day(ricms.excludedFrom, -1) : null,
        note: 'MVA original. Vindo de outra UF, usar a MVA ajustada pela fórmula do § 5º do art. 1º do Anexo IX do RICMS/PR; o remetente do Simples Nacional usa a MVA original (§ 4º, III). Vale a redação atual de cada item.',
        items: t.items,
      });
    }
  }
  const order = (r) => roman(r.annex ?? r.segment.split('-')[0]);
  return {
    segment: {
      uf: 'PR',
      act: 'RICMS/PR, Anexo IX (texto consolidado), com os itens da Resolução SEFA 571/2019',
      source: 'stPrAnexoIX',
      url: anexoUrl,
      annexes: [...annexes, ...byArticle.annexes].sort((a, b) => order(a) - order(b)),
    },
    references: [...references, ...byArticle.references].sort((a, b) => order(a) - order(b)),
  };
}

/** Só o Anexo IX, do título "ANEXO IX" ao "ANEXO X" (serve para o PDF inteiro do RICMS/PR). */
export function anexoIXLines(lines) {
  const start = lines.findIndex(
    (l, i) => l === 'ANEXO IX' && /^DA SUBSTITUI/.test(lines[i + 1] ?? ''),
  );
  if (start < 0) throw new Error('Não achei o título do Anexo IX no RICMS/PR');
  const end = lines.indexOf('ANEXO X', start);
  return lines.slice(start, end < 0 ? undefined : end);
}

/** Linhas comparáveis (monitor semanal): MVA por item e a situação de cada seção. */
export function prStRows({ segment, references }) {
  return [
    ...references.flatMap((r) =>
      r.items.map((i) => [
        r.segment,
        i.item,
        i.cest,
        i.ncms.join(' '),
        i.mva,
        r.validFrom,
        r.validTo ?? '',
      ]),
    ),
    ...segment.annexes.map((a) => [
      a.annex,
      a.name,
      a.excludedFrom ?? '',
      a.excludedBy ?? '',
      String(a.cests.length),
    ]),
  ];
}
