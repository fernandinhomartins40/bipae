// Lê, da página "Diversos" do Portal Nacional da NF-e, o item "Tabela cBenef x CST - Relacionada à
// Nota Técnica 2019.001" (F3-27.c): a lista das UFs que usam o cBenef, com o link da tabela de cada
// uma, e a observação oficial "Os demais Estados não utilizam a tabela cBenef". Nada é digitado à
// mão: se a observação sumir ou aparecer uma UF que o leitor não conhece, a geração para.

/** Nome da UF como o portal escreve (sem "Estado de/do") → sigla. */
const UF_BY_NAME = {
  acre: 'AC',
  alagoas: 'AL',
  amapá: 'AP',
  amazonas: 'AM',
  bahia: 'BA',
  ceará: 'CE',
  'distrito federal': 'DF',
  'espírito santo': 'ES',
  goiás: 'GO',
  maranhão: 'MA',
  'mato grosso': 'MT',
  'mato grosso do sul': 'MS',
  'minas gerais': 'MG',
  pará: 'PA',
  paraíba: 'PB',
  paraná: 'PR',
  pernambuco: 'PE',
  piauí: 'PI',
  'rio de janeiro': 'RJ',
  'rio grande do norte': 'RN',
  'rio grande do sul': 'RS',
  rondônia: 'RO',
  roraima: 'RR',
  'santa catarina': 'SC',
  'são paulo': 'SP',
  sergipe: 'SE',
  tocantins: 'TO',
};

/** As 27 UFs. */
export const ALL_UFS = Object.values(UF_BY_NAME).sort();

const TITLE = 'Tabela cBenef x CST - Relacionada à Nota Técnica 2019.001';
const OTHERS = 'Os demais Estados não utilizam a tabela cBenef';

const plain = (html) =>
  html
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[ \t\u00a0]+/g, ' ');

/**
 * Devolve a data da atualização, as UFs listadas (com o link) e as que, pela observação do portal,
 * não usam a tabela cBenef (todas as outras).
 */
export function parseCbenefPortal(html) {
  const start = html.indexOf(TITLE);
  if (start < 0) throw new Error(`cBenef no Portal da NF-e: não achei "${TITLE}"`);
  const end = html.indexOf(OTHERS, start);
  if (end < 0) throw new Error(`cBenef no Portal da NF-e: não achei a observação "${OTHERS}"`);
  const block = html.slice(start, end);
  const updated = /Atualizada em (\d{2})\/(\d{2})\/(\d{4})/i.exec(block);
  if (!updated) throw new Error('cBenef no Portal da NF-e: não achei a data da atualização');

  const listed = [];
  // Cada UF vem num parágrafo próprio ("Estado do Paraná", "Distrito Federal (Atualizada em ...)"),
  // seguido do parágrafo com o link.
  const lines = plain(block)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  for (const [i, line] of lines.entries()) {
    const name = /^(?:Estado d[eo] )?(.+?)(?: \(Atualizada em [^)]*\))?$/i
      .exec(line)?.[1]
      ?.toLowerCase();
    const uf = name && UF_BY_NAME[name];
    if (!uf) continue;
    const link = lines.slice(i + 1).find((l) => /^https?:\/\//.test(l));
    if (!link) throw new Error(`cBenef no Portal da NF-e: ${uf} sem o link da tabela`);
    listed.push({ uf, url: link });
  }
  if (listed.length === 0) throw new Error('cBenef no Portal da NF-e: nenhuma UF listada');
  const used = new Set(listed.map((l) => l.uf));
  return {
    updatedAt: `${updated[3]}-${updated[2]}-${updated[1]}`,
    listed,
    notUsed: ALL_UFS.filter((uf) => !used.has(uf)),
    note: `${OTHERS}.`,
  };
}
