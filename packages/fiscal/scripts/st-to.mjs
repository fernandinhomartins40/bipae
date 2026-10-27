// Extrai do RICMS/TO (Decreto 2.912/2006), no texto consolidado do LegisWeb, as mercadorias em
// substituição tributária dos Anexos XXI (16 seções, com NCM/SH, CEST e MVA original) e XXII
// (veículos), com a data de cada linha pelas notas de alteração (F3-26.d.TO). A página traz a
// redação em vigor primeiro e, depois, as redações antigas do mesmo anexo; só a primeira é lida.
// Nada é digitado à mão: o que o texto não fecha (CEST ou NCM malformado, MVA que depende de
// embalagem que a descrição não traz) vai para `pending` e não vira regra.

import {
  cestOf,
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

const ITEM = /^\d{1,3}(?:\.\s?\d+){0,2}(?:\s*\|\s*\d{1,3}(?:\.\s?\d+){0,2})?$/;
const TODAY = '2026-10-27';
const day = (n) => n.effectDate ?? n.decreeDate;
const br = (date) => date.split('-').reverse().join('/');

/** Nome da seção: o título entre o número e "(Art. ...)", ou a primeira linha da tabela. */
function sectionName(number, pre, rows) {
  for (const m of pre.slice(-450).matchAll(/(?:^|[\s.)])(\d{1,2})\s*-\s+([^(:]+?)\s*(?:\(|:|$)/g)) {
    if (Number(m[1]) === number) return m[2].trim();
  }
  const title = rows.find(
    (r) => r.length === 1 && /^[A-ZÀ-Ú]/.test(r[0].text) && !/^Âmbito|^ITEM/i.test(r[0].text),
  );
  return title ? sentence(title[0].text.replace(/[:.]+$/, '')) : `Seção ${number}`;
}

/** Faixa de embalagem da farinha em kg: [limite inferior, limite superior], ou null. */
function flourRange(description) {
  const d = description.toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ');
  const num = (s) => Number(s.replace(',', '.'));
  let m = /superior a ([\d,.]+)\s*kg e inferior (?:ou|e) igual a ([\d,.]+)\s*kg/.exec(d);
  if (m) return [num(m[1]), num(m[2])];
  m = /superior a ([\d,.]+)\s*kg e inferior a ([\d,.]+)\s*kg/.exec(d);
  if (m) return [num(m[1]), num(m[2])];
  m = /inferior ou igual a ([\d,.]+)\s*kg/.exec(d);
  if (m) return [0, num(m[1])];
  m = /superior a ([\d,.]+)\s*kg/.exec(d);
  if (m) return [num(m[1]), Infinity];
  m = /igual a ([\d,.]+)\s*kg/.exec(d);
  if (m) return [num(m[1]) - 0.001, num(m[1])];
  return null;
}

/** As MVAs do quadro que valem para o item, ou o motivo de não valer nenhuma. */
function pickMva(quadro, item) {
  if (quadro.kind === 'plain') return { mvas: quadro.values };
  if (quadro.kind === 'flour') {
    if (!/farinha/i.test(item.description)) {
      return {
        reason:
          'o item vem na tabela da farinha de trigo, mas não é farinha, e o texto não diz a MVA dele',
      };
    }
    const range = flourRange(item.description);
    if (!range) return { reason: 'a descrição não traz a embalagem da farinha' };
    // Uso doméstico: embalagem até 5 kg; uso industrial: acima de 5 kg (o quadro do texto).
    if (range[1] <= 5) return { mvas: [{ mva: quadro.domestic }] };
    if (range[0] >= 5) return { mvas: [{ mva: quadro.industrial }] };
    return { reason: 'a embalagem atravessa os 5 kg do quadro' };
  }
  const d = item.description.toLocaleLowerCase('pt-BR');
  const kind = d.includes('refinado')
    ? 'refinado'
    : d.includes('cristal')
      ? 'cristal'
      : 'outros tipos';
  const found = quadro.types.find((t) => t.name.toLocaleLowerCase('pt-BR') === kind);
  return found ? { mvas: [{ mva: found.mva }] } : { reason: 'tipo de açúcar sem MVA no quadro' };
}

/** Quadro de MVA de uma tabela sem itens, ou null se não for um. */
function mvaQuadro(rows) {
  const titles = rows.filter(
    (r) => r.length === 1 && /MARGEM DE VALOR AGREGADO|^MVA/i.test(r[0].text),
  );
  if (titles.length === 0) return null;
  const types = [
    ...titles[0][0].text.matchAll(
      /(Cristal|Refinado|Outros tipos)\s*-\s*(\d{1,3}(?:,\d{1,2})?)\s*%/g,
    ),
  ].map((m) => ({ name: m[1], mva: percent(m[2]) }));
  if (types.length > 0) return { kind: 'sugar', types };
  const domestic = rows.find((r) => r.some((c) => /Uso Dom[ée]stico/i.test(c.text)));
  const industrial = rows.find((r) => r.some((c) => /Uso Industrial/i.test(c.text)));
  if (domestic && industrial) {
    const last = (r) => percent(r[r.length - 1].text);
    return { kind: 'flour', domestic: last(domestic), industrial: last(industrial) };
  }
  const values = titles
    .map((t) => /(\d{1,3}(?:,\d{1,2})?)\s*%\s*\.?\s*$/.exec(t[0].text))
    .filter(Boolean)
    .map((m) => percent(m[1]));
  if (values.length === 0) return null;
  // Mais de um quadro na mesma tabela (autopeças): o texto não diz qual vale em cada caso.
  return {
    kind: 'plain',
    values: values.map((mva, k) => ({
      mva,
      label:
        values.length > 1
          ? `MVA do ${k + 1}º quadro do anexo; o texto não diz qual quadro vale em cada caso`
          : null,
    })),
  };
}

/**
 * @param buffer bytes da página do LegisWeb
 * @param knownCest CEST do Convênio ICMS 142/18 (sem pontos)
 */
export function parseToRicms(buffer, knownCest) {
  const tables = legisWebTables(legisWebHtml(buffer));
  const startXxi = tables.findIndex((t) =>
    /ANEXO XXI do Regulamento do ICMS \(Art\. 42/.test(t.pre),
  );
  const endXxi = tables.findIndex(
    (t, i) => i > startXxi && /Reda..o do anexo dada pelo Decreto N\S* 5520/.test(t.pre),
  );
  const startXxii = tables.findIndex((t) => /ANEXO XXII do Regulamento do ICMS/.test(t.pre));
  const endXxii = tables.findIndex((t, i) => i > startXxii && /ANEXO XXIII/.test(t.pre));
  if (startXxi < 0 || endXxi < 0 || startXxii < 0 || endXxii < 0) {
    throw new Error('RICMS/TO: não achei os Anexos XXI e XXII na página');
  }

  const sections = new Map();
  const pending = [];
  const note = (message, section) => pending.push({ annex: section.label, message });

  const run = (from, to, isVehicles) => {
    let baseline = null;
    let waiting = [];
    let vehicleTables = 0;
    for (let t = from; t < to; t++) {
      const { pre, rows } = tables[t];
      const lastNote = legisWebNotes(pre.slice(-450)).at(-1) ?? null;
      if (t === from) baseline = lastNote ? day(lastNote) : null;
      const isItem = (r) => r.length >= 4 && ITEM.test(r[0].text) && !/^ITEM$/i.test(r[0].text);
      const itemRows = rows.filter(isItem);

      if (itemRows.length === 0) {
        const quadro = mvaQuadro(rows);
        if (!quadro) continue;
        const mvaDate = lastNote?.kind === 'redacao' ? day(lastNote) : null;
        for (const w of waiting) {
          const pick = pickMva(quadro, w);
          if (pick.reason) {
            note(`MVA do item ${w.item} (${w.cest}) não resolvida: ${pick.reason}`, w.section);
            w.dropped = true;
            continue;
          }
          const original = { ...w };
          pick.mvas.forEach((m, k) => {
            const target = k === 0 ? w : { ...original };
            if (k > 0) w.section.items.push(target);
            if (pick.mvas.length > 1) {
              target.item = `${original.item}/${k + 1}`;
              target.description = `${original.description} (${m.label})`;
            }
            target.mva = m.mva;
            target.validFrom = maxDate([original.validFrom, mvaDate]);
          });
        }
        waiting = [];
        continue;
      }

      const first = itemRows[0][0].text;
      const number = Number(first.split('.')[0]);
      let key;
      if (isVehicles) key = `XXII.${++vehicleTables}`;
      else key = `XXI.${number}`;
      if (!sections.has(key)) {
        const name = sectionName(number, pre, rows);
        sections.set(key, {
          annex: key,
          label: isVehicles
            ? `Anexo XXII, ${name.toLocaleLowerCase('pt-BR')}`
            : `Anexo XXI, seção ${number}`,
          name,
          items: [],
          revoked: [],
        });
      }
      const section = sections.get(key);
      const tableRevoked = lastNote?.kind === 'revogado' ? lastNote : null;
      const tableDate = lastNote?.kind === 'redacao' ? day(lastNote) : null;

      let mvaCols = [];
      let notes = [];
      for (const row of rows) {
        const lead = row[0]?.text ?? '';
        if (/^ITEM$/i.test(lead)) {
          mvaCols = row
            .map((c, i) => ({ h: c.text, i }))
            .filter(({ h }) => /^MVA\s*[-–]\s*ORIGINAL$/i.test(h) || /^Valor Agregado/i.test(h));
          continue;
        }
        if (row.every((c, i) => i === 0 || c.text === '')) {
          notes.push(...legisWebNotes(lead));
          continue;
        }
        if (!isItem(row)) continue;
        const cells = row.map((c) => c.text);
        for (const c of cells) notes.push(...legisWebNotes(c));
        const itemNotes = notes;
        notes = [];
        const description = withoutNotes(cells[3] ?? '');
        const dates = legisWebDescriptionDates(description);
        const cestText = withoutNotes(cells[1] ?? '');
        const ncmText = withoutNotes(cells[2] ?? '');
        const revoked = tableRevoked ?? itemNotes.find((n) => n.kind === 'revogado') ?? null;
        const partial = itemNotes.find((n) => n.kind === 'excluido') ?? null;
        const itemNumber = lead.replace(/\s+/g, '').replace(/\|/g, '/');
        const cest = cestOf(cestText);
        const expired = dates.until && dates.until < TODAY;
        if (!cest || (!revoked && !knownCest.has(cest))) {
          if (!revoked && !expired) {
            note(
              `item ${itemNumber}: CEST "${cestText}" não é um CEST do Convênio ICMS 142/18`,
              section,
            );
          }
          continue;
        }
        if (revoked) {
          // A data de início da linha revogada serve para dar continuidade a uma linha igual que o
          // mesmo decreto reabre no mesmo dia (veículos, Decreto 7.219/2026).
          const { ncms: revokedNcms } = legisWebNcms(ncmText);
          const since = maxDate([
            baseline,
            tableDate,
            dates.from,
            ...itemNotes.filter((n) => n.kind === 'redacao').map(day),
          ]);
          section.revoked.push({
            cest,
            from: day(revoked),
            by: revoked.decree,
            since,
            ncms: revokedNcms,
          });
          continue;
        }
        if (expired) continue; // redação com prazo vencido ("vigência até 30.09.2016")
        const { ncms, invalid } = legisWebNcms(ncmText);
        if (invalid.length > 0 || ncms.length === 0) {
          note(
            `item ${itemNumber} (${cest}): NCM "${ncmText}" não pôde ser lido com segurança`,
            section,
          );
          continue;
        }
        const own = itemNotes.filter((n) => n.kind === 'redacao').map(day);
        const validFrom = maxDate([baseline, tableDate, dates.from, ...own]);
        const text = partial
          ? `${description} (excluído da ST nas saídas internas de fabricante estabelecido no TO desde ${br(day(partial))}, ${partial.decree})`
          : description;
        const make = (item, description, mva) => ({
          item,
          cest,
          ncms,
          description,
          mva,
          validFrom,
          section,
        });
        const withMva = mvaCols
          .map(({ h, i }) => ({ h, text: cells[i] ?? '' }))
          .filter((c) => /^\d/.test(c.text));
        if (mvaCols.length === 0) {
          const item = make(itemNumber, text, null);
          section.items.push(item);
          waiting.push(item);
        } else if (withMva.length === 1) {
          section.items.push(make(itemNumber, text, percent(withMva[0].text)));
        } else {
          withMva.forEach((c, k) => {
            const who = /Distribuidor/i.test(c.h)
              ? 'MVA do distribuidor, depósito ou atacadista'
              : 'MVA da indústria, importador, arrematante ou engarrafador';
            section.items.push(make(`${itemNumber}/${k + 1}`, `${text} (${who})`, percent(c.text)));
          });
        }
      }
    }
    for (const w of waiting)
      note(`item ${w.item} (${w.cest}) sem quadro de MVA depois da tabela`, w.section);
  };
  run(startXxi, endXxi, false);
  run(startXxii, endXxii, true);

  for (const s of sections.values()) {
    for (const i of s.items) {
      const reopened = s.revoked.find(
        (r) => r.cest === i.cest && r.from === i.validFrom && r.ncms.join(',') === i.ncms.join(','),
      );
      if (reopened && reopened.since < i.validFrom) i.validFrom = reopened.since;
    }
    // A numeração antiga e a nova do texto repetem a mesma linha (mesmo CEST, NCM e MVA): fica a
    // de início mais antigo.
    const byKey = new Map();
    for (const i of s.items) {
      if (i.dropped) continue;
      const k = `${i.cest}|${i.ncms.join(',')}|${i.mva}|${i.description}`;
      const old = byKey.get(k);
      if (!old) byKey.set(k, i);
      else if (i.validFrom < old.validFrom) old.validFrom = i.validFrom;
    }
    s.items = [...byKey.values()];
    s.revoked = [...new Map(s.revoked.map((r) => [r.cest, r])).values()].filter(
      (r) => !s.items.some((i) => i.cest === r.cest),
    );
  }
  return { sections: [...sections.values()], pending };
}

/** Anexos XXI e XXII do RICMS/TO no formato de st-references.json. */
export function toStReferences({ sections }, { url, segmentName }) {
  return legisWebStReferences(
    sections.map(({ items, ...s }) => ({
      ...s,
      items: items.map(({ section: _s, dropped: _d, ...i }) => i),
    })),
    {
      uf: 'TO',
      act: 'RICMS/TO (Decreto 2.912/2006)',
      source: 'stToRicms',
      url,
      segmentName,
      note: 'MVA original (ST interna) do quadro do anexo; a MVA ajustada das operações interestaduais (4%, 7% e 12%) vem da fórmula do convênio. A data de início é a da última alteração da linha, da tabela de MVA (Decreto 6.696/2023) ou do anexo, lida das notas do texto consolidado do LegisWeb (cópia de terceiros); quando a nota não traz "efeitos a partir de", vale a data do decreto.',
    },
  );
}
