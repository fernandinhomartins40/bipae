// Extrai, da planilha oficial "cBenef ES" da SEFAZ-ES (Tabela cBenef x CST dos benefícios fiscais
// vigentes), cada código com os CST em que vale, a vigência, a descrição, a base legal e o tipo
// (F3-27.b.ES). Nada é digitado à mão.

/** Data da planilha: número de série do Excel (43160 = 01/03/2018) ou dd/mm/aaaa. */
const isoFromEs = (value) => {
  const text = String(value ?? '').trim();
  if (/^\d{5}$/.test(text)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Number(text) * 86_400_000);
    return d.toISOString().slice(0, 10);
  }
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

/**
 * Planilha "cBenef x CST" no layout do ES e do DF: Cbenef, CST..., início, fim, descrição,
 * capitulação legal e observação (o tipo do benefício).
 * @param sheets planilhas lidas por readXlsx
 */
export function parseCbenefSheet(sheets, { uf, min }) {
  const sheet = sheets[0];
  const head = sheet.rows.findIndex((r) => /^cbenef$/i.test((r[0] ?? '').trim()));
  if (head < 0) throw new Error(`Não achei o cabeçalho da tabela cBenef de ${uf}`);
  const header = sheet.rows[head].map((h) => h.replace(/\s+/g, ' ').trim());
  const cstCols = header.map((h, i) => [/^CST (\d{2})\b/.exec(h)?.[1], i]).filter(([cst]) => cst);
  const find = (re) => header.findIndex((h) => re.test(h));
  const start = find(/in[íi]cio/i);
  const end = find(/fim|final/i);
  const desc = find(/^descri/i);
  const legal = find(/legal|legisla|fundamento/i);
  const kind = find(/^observa/i);
  if (cstCols.length < 10 || start < 0 || desc < 0)
    throw new Error(`A tabela cBenef de ${uf} mudou de colunas`);
  const CODE = new RegExp(`^(${uf}\\d{6}|SEM CBENEF)$`);
  const codes = sheet.rows
    .slice(head + 1)
    .filter((r) => CODE.test((r[0] ?? '').trim()))
    .map((r) => ({
      code: r[0].trim(),
      csts: cstCols
        .filter(([, i]) => (r[i] ?? '').trim().toUpperCase() === 'SIM')
        .map(([cst]) => cst),
      from: isoFromEs(r[start]),
      to: end >= 0 ? isoFromEs(r[end]) : null,
      ...(kind >= 0 && r[kind] && { kind: r[kind].trim() }),
      description: [r[desc], legal >= 0 && r[legal] ? `(${r[legal].trim()})` : '']
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    }));
  if (codes.length < min)
    throw new Error(`Esperava a tabela cBenef de ${uf} inteira; achei ${codes.length} códigos`);
  return codes;
}

/** Espírito Santo: planilha cBenef ES. */
export const parseCbenefEs = (sheets) => parseCbenefSheet(sheets, { uf: 'ES', min: 200 });

/** Distrito Federal: Anexo Único do Ato Declaratório de cBenef. */
export const parseCbenefDf = (sheets) => parseCbenefSheet(sheets, { uf: 'DF', min: 200 });
