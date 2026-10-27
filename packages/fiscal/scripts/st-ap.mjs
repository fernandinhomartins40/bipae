// Extrai do RICMS/AP (Decreto 2.269/1998), no texto consolidado do LegisWeb, os Apêndices II a XXVI
// do Anexo III (substituição tributária e antecipação com encerramento), um por segmento, com CEST,
// NCM/SH e MVA original, e a data de cada linha pelas notas de alteração (F3-26.d.AP). Os anexos
// antigos (V e VI, revogados pelo Decreto 5.097/2017) e o Apêndice XXVII em diante não entram. Nada
// é digitado à mão: o que o texto não fecha vai para `pending` e não vira regra.

import {
  cestOf,
  isPercent,
  legisWebDescriptionDates,
  legisWebHtml,
  legisWebNcms,
  legisWebNotes,
  legisWebStReferences,
  legisWebTables,
  maxDate,
  percent,
  sentence,
  withoutNotes,
} from './st-legisweb.mjs';

const ITEM = /^\d{1,3}\.\d+$/;
const TODAY = '2026-10-27';
// O Anexo III atual foi acrescentado ao regulamento pelo Decreto 5.097, de 28/12/2017: as linhas
// sem nota de alteração valem desde essa data.
const ANNEX_FROM = '2017-12-28';
const day = (n) => n.effectDate ?? n.decreeDate;

const heading = /AP[ÊE]NDICE\s+([IVXL]+)\s+(.+?)\s*$/;

/** O que cada coluna de MVA do cabeçalho quer dizer. */
function mvaColumns(header) {
  const cols = header
    .map((h, i) => ({ h: h.text, i }))
    .filter(({ h, i }) => i >= 4 && /MVA/i.test(h));
  const label = (h) =>
    `MVA para ${h
      .replace(/^%\s*MVA\s*-?\s*(?:ST\s+)?(?:PARA\s+)?/i, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLocaleLowerCase('pt-BR')}`;
  return cols.length > 1
    ? cols.map((c) => ({ i: c.i, label: label(c.h) }))
    : [{ i: cols[0]?.i ?? 4, label: null }];
}

/**
 * @param buffer bytes da página do LegisWeb
 * @param knownCest CEST do Convênio ICMS 142/18 (sem pontos)
 */
export function parseApRicms(buffer, knownCest) {
  const tables = legisWebTables(legisWebHtml(buffer));
  const first = tables.findIndex((t) => /AP[ÊE]NDICE\s+II\s+AUTOPE/.test(t.pre.slice(-120)));
  if (first < 0) throw new Error('RICMS/AP: não achei o Apêndice II na página');
  const sections = [];
  const pending = [];

  for (let t = first; t < tables.length; t++) {
    const { pre, rows } = tables[t];
    if (/AP[ÊE]NDICE\s+XXVII\b/.test(pre)) break;
    const head = heading.exec(pre.slice(-220).replace(/\s*\(Conv[^)]*\)\s*$/, ''));
    if (!head || !/^ITEM$/i.test(rows[0]?.[0]?.text ?? '')) continue;
    const name = sentence(head[2].replace(/\s*\(Conv[^)]*\)\s*/g, '').trim());
    const section = {
      annex: head[1],
      label: `Anexo III, Apêndice ${head[1]}`,
      name,
      items: [],
      revoked: [],
    };
    const note = (message) => pending.push({ annex: section.label, message });
    const columns = mvaColumns(rows[0]);
    let notes = [];
    for (const row of rows.slice(1)) {
      const lead = row[0]?.text ?? '';
      if (row.every((c, i) => i === 0 || c.text === '')) {
        notes.push(...legisWebNotes(lead));
        continue;
      }
      if (!ITEM.test(lead) || row.length < 4) continue;
      const cells = row.map((c) => c.text);
      for (const c of cells) notes.push(...legisWebNotes(c));
      const itemNotes = notes;
      notes = [];
      const description = withoutNotes(cells[3] ?? '');
      const dates = legisWebDescriptionDates(description);
      const cestText = withoutNotes(cells[1] ?? '');
      const ncmText = withoutNotes(cells[2] ?? '');
      const revoked = itemNotes.find((n) => n.kind === 'revogado') ?? null;
      const cest = cestOf(cestText);
      // Linha revogada pode trazer um CEST que o Convênio ICMS 142/18 já trocou: vale o código do
      // texto, só para registrar que saiu da ST.
      if (!cest || (!revoked && !knownCest.has(cest))) {
        if (!revoked)
          note(`item ${lead}: CEST "${cestText}" não é um CEST do Convênio ICMS 142/18`);
        continue;
      }
      const own = itemNotes.filter((n) => n.kind === 'redacao').map(day);
      const since = maxDate([ANNEX_FROM, dates.from, ...own]);
      if (revoked) {
        section.revoked.push({
          cest,
          from: day(revoked),
          by: revoked.decree,
          since,
          ncms: legisWebNcms(ncmText).ncms,
        });
        continue;
      }
      if (dates.until && dates.until < TODAY) continue;
      const { ncms, invalid } = legisWebNcms(ncmText);
      if (invalid.length > 0 || ncms.length === 0) {
        note(`item ${lead} (${cest}): NCM "${ncmText}" não pôde ser lido com segurança`);
        continue;
      }
      const values = columns
        .map((c) => ({ ...c, text: cells[c.i] ?? '' }))
        .filter((c) => isPercent(c.text));
      const make = (item, text, mva) => ({
        item,
        cest,
        ncms,
        description: text,
        mva,
        validFrom: since,
      });
      if (values.length === 0) section.items.push(make(lead, description, null));
      else if (values.length === 1) {
        section.items.push(make(lead, description, percent(values[0].text)));
      } else {
        values.forEach((c, k) => {
          section.items.push(
            make(`${lead}/${k + 1}`, `${description} (${c.label})`, percent(c.text)),
          );
        });
      }
    }
    // Linha repetida (mesmo CEST, NCM, MVA e descrição): fica a de início mais antigo.
    const byKey = new Map();
    for (const i of section.items) {
      const k = `${i.cest}|${i.ncms.join(',')}|${i.mva}|${i.description}`;
      const old = byKey.get(k);
      if (!old) byKey.set(k, i);
      else if (i.validFrom < old.validFrom) old.validFrom = i.validFrom;
    }
    section.items = [...byKey.values()];
    section.revoked = [...new Map(section.revoked.map((r) => [r.cest, r])).values()].filter(
      (r) => !section.items.some((i) => i.cest === r.cest),
    );
    sections.push(section);
  }
  return { sections, pending };
}

/** Apêndices II a XXVI do Anexo III do RICMS/AP no formato de st-references.json. */
export function apStReferences({ sections }, { url, segmentName }) {
  return legisWebStReferences(sections, {
    uf: 'AP',
    act: 'RICMS/AP (Decreto 2.269/1998), Anexo III',
    source: 'stApRicms',
    url,
    segmentName,
    note: 'MVA original (MVA-ST original) do apêndice. A data de início é a da última alteração da linha pelas notas do texto consolidado do LegisWeb (cópia de terceiros): vale "efeitos a partir de" quando a nota traz e, sem ele, a data do decreto; a linha sem nota vale desde o Anexo III atual (Decreto 5.097, de 28/12/2017). Combustíveis, energia e veículos não têm MVA no apêndice.',
    annexNote: (s) =>
      s.annex === 'XVII'
        ? 'Atenção: o Protocolo ICMS 11/2026 (AP e SP) tira CEST de alimentos da retenção feita pelo remetente nas operações interestaduais destinadas ao Amapá desde 01/03/2026. Isso não altera esta lista do Anexo III, mas a nota de origem pode vir sem ST retida; confira o CEST do produto no protocolo.'
        : '',
  });
}
