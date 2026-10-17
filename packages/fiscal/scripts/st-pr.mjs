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
  return { tables: result, unknownCest: [...unknownCest].sort() };
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
 * Junta a resolução (MVA por item) e o Anexo IX (o que saiu da ST e quando) no formato de
 * st-references.json. Seção que o RICMS revogou deixa de sugerir MVA a partir da revogação, mesmo
 * que a resolução ainda não tenha sido atualizada (eletrônicos e celulares em 1º/03/2026).
 */
export function prStReferences(res, anexo, { resUrl, anexoUrl }) {
  const byAnnex = new Map(anexo.map((s) => [s.annex, s]));
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
  return {
    segment: {
      uf: 'PR',
      act: 'RICMS/PR, Anexo IX (texto consolidado), com os itens da Resolução SEFA 571/2019',
      source: 'stPrAnexoIX',
      url: anexoUrl,
      annexes,
    },
    references,
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
