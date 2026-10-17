// Extrai, do Anexo I do Livro II do RICMS/RJ (Decreto 27.427/2000, arquivo .doc publicado pela
// SEFAZ-RJ), as mercadorias em substituição tributária com CEST, NCM e a MVA original (F3-26.c.RJ).
// O texto vem do Word pelo word-extractor: células separadas por tabulação. Nas bebidas a MVA muda
// pela embalagem e por quem vende; cada combinação vira uma linha com o nome. Nada é digitado à mão.

const SUBITEM = /^\d{1,2}\.\d{1,3}(?:\.\d{1,2})?$/;
const CEST = /^\d{2}\.\d{3}\.\d{2}$/;
const PERCENT = /^(\d{1,3}(?:,\d{1,2})?)\s*%$/;
const SECTION = /^(?:\d{1,2}\.\s*)?([A-ZÀ-Ú][A-ZÀ-Ú ,()"\-–]{6,})$/;

/** Célula de NCM: códigos (às vezes colados, "2202.10.002202.99.00") ou "Capítulos 33 e 34". */
function ncmCell(cell) {
  const chapters = /^Cap[ií]tulos?\s+(.+)$/i.exec(cell);
  if (chapters) return [...chapters[1].matchAll(/\b\d{2}\b/g)].map((m) => m[0]);
  if (!/^[\d.\s]+$/.test(cell)) return null;
  const codes = [...cell.matchAll(/\d{4}(?:\.\d{2}(?:\.\d{2})?)?|\b\d{2}\b/g)].map((m) =>
    m[0].replace(/\./g, ''),
  );
  return codes.length > 0 ? codes : null;
}

/**
 * @param text corpo do documento (word-extractor)
 * @param knownCest CEST do Convênio ICMS 142/18 (sem pontos)
 */
export function parseRjAnexoI(text, knownCest) {
  const lines = text.split('\n').map((l) => l.replace(/\u00a0/g, ' '));
  const sections = [];
  let section = null;
  // A lista começa no primeiro título de segmento; o que vem antes é o título do anexo.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const next = lines.slice(i + 1, i + 5).join(' ');
    const title = SECTION.exec(line);
    if (title && /Fundamento normativo|Âmbito de aplicação/i.test(next)) {
      section = { name: title[1].trim(), beverages: false, tokens: [] };
      sections.push(section);
      continue;
    }
    if (!section) continue;
    if (/Embalagem com capacidade/.test(line)) section.beverages = true;
    section.tokens.push(...lines[i].split('\t').map((t) => t.trim()));
  }

  const problems = [];
  for (const s of sections) {
    const items = [];
    let current = null;
    const t = s.tokens;
    for (let k = 0; k < t.length; k++) {
      if (SUBITEM.test(t[k]) && CEST.test(t[k + 1] ?? '')) {
        current = { item: t[k], cest: t[k + 1].replace(/\./g, ''), rest: [] };
        items.push(current);
        k++;
        continue;
      }
      if (current) current.rest.push(t[k]);
    }
    s.items = items.flatMap((it) => {
      const rest = it.rest.filter((x) => x !== '');
      const ncms = [];
      let at = 0;
      while (at < rest.length && ncmCell(rest[at])) {
        ncms.push(...ncmCell(rest[at]));
        at++;
      }
      const description = rest[at] ?? '';
      const after = rest.slice(at + 1);
      if (!knownCest.has(it.cest)) problems.push(`CEST ${it.cest} do subitem ${it.item}`);
      const base = {
        item: it.item,
        cest: it.cest,
        ncms: [...new Set(ncms)],
        ncmText: ncms.join(' '),
        description,
      };
      if (s.beverages) {
        // Embalagem, MVA do industrial/importador, MVA dos demais substitutos; repetido por faixa.
        const out = [];
        for (let j = 0; j < after.length; j++) {
          if (PERCENT.test(after[j]) || !PERCENT.test(after[j + 1] ?? '')) continue;
          const size = after[j];
          const ind = PERCENT.exec(after[j + 1]);
          const other = PERCENT.exec(after[j + 2] ?? '');
          out.push({
            ...base,
            item: `${it.item}/${out.length + 1}`,
            description: `${description} — ${size}, industrial ou importador`,
            mva: ind[1].replace(',', '.'),
          });
          if (other) {
            out.push({
              ...base,
              item: `${it.item}/${out.length + 1}`,
              description: `${description} — ${size}, demais substitutos (atacadista, distribuidor)`,
              mva: other[1].replace(',', '.'),
            });
          }
          j += other ? 2 : 1;
        }
        if (out.length === 0) {
          const first = after.map((x) => PERCENT.exec(x)).find(Boolean);
          return first ? [{ ...base, mva: first[1].replace(',', '.') }] : [{ ...base, mva: null }];
        }
        return out;
      }
      const first = after.map((x) => PERCENT.exec(x)).find(Boolean);
      return [{ ...base, mva: first ? first[1].replace(',', '.') : null }];
    });
    delete s.tokens;
  }
  if (problems.length > sections.reduce((n, s) => n + s.items.length, 0) / 10) {
    throw new Error(
      `RICMS/RJ, Anexo I: muitos CEST fora do Convênio ICMS 142/18 (${problems.slice(0, 5).join('; ')})`,
    );
  }
  const result = sections.filter((s) => s.items.length > 0);
  const total = result.reduce((n, s) => n + s.items.length, 0);
  if (total < 300) throw new Error(`Esperava o Anexo I inteiro; achei ${total} linhas`);
  return result;
}

const sentence = (upper) => upper.charAt(0) + upper.slice(1).toLocaleLowerCase('pt-BR');

/** Anexo I no formato de st-references.json. */
export function rjStReferences(sections, { url }) {
  const annexes = sections.map((s, i) => ({
    annex: String(i + 1),
    name: sentence(s.name),
    cests: [...new Map(s.items.map((it) => [it.cest, it.ncms])).entries()].map(([cest, ncms]) =>
      ncms.length > 0 ? { cest, ncms } : { cest },
    ),
  }));
  const references = sections
    .map((s, i) => ({
      uf: 'RJ',
      segment: String(i + 1),
      segmentName: sentence(s.name),
      act: 'RICMS/RJ, Livro II, Anexo I',
      source: 'stRjAnexoI',
      url,
      validFrom: '2021-12-10',
      validTo: null,
      note: 'MVA original. Vindo de outra UF, a tabela traz a MVA ajustada para 12% e 4%. Nas bebidas a base é o PMPF da SEFAZ-RJ e a MVA só vale sem PMPF ou preço sugerido. Texto do Anexo I como a SEFAZ-RJ publica (Decreto 47.864/2021).',
      items: s.items.filter((it) => it.mva && it.ncms.length > 0),
    }))
    .filter((r) => r.items.length > 0);
  return {
    segment: { uf: 'RJ', act: 'RICMS/RJ, Livro II, Anexo I', source: 'stRjAnexoI', url, annexes },
    references,
  };
}
