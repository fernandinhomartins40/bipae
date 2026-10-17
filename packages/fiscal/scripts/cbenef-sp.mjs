// Extrai, da planilha oficial "Tabela CST x cBenef" da SEFAZ-SP (portal da NF-e), cada código de
// benefício com os CST em que vale, o dispositivo legal e a descrição (F3-27.b.SP). A planilha
// não tem coluna de vigência: o fim vem da observação ("Vigorou até ..." ou "Utilização não
// permitida a partir de ..."). Nada é digitado à mão.

const iso = (d, m, y) => `${y}-${m}-${d}`;
const dayBefore = (isoDate) => {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/** Fim da vigência pela observação da SEFAZ-SP. */
function endOf(note) {
  const text = (note ?? '').replace(/\s+/g, ' ');
  const until = /Vigorou até (\d{2})\/(\d{2})\/(\d{4})/i.exec(text);
  if (until) return iso(until[1], until[2], until[3]);
  const from = /não permitida a partir de (\d{2})\/(\d{2})\/(\d{4})/i.exec(text);
  if (from) return dayBefore(iso(from[1], from[2], from[3]));
  return null;
}

/** @param sheets planilhas lidas por readXlsx */
export function parseCbenefSp(sheets) {
  const sheet = sheets.find((s) => s.rows.some((r) => (r[0] ?? '').trim() === 'Código'));
  if (!sheet) throw new Error('Não achei a aba com a coluna Código na tabela cBenef de SP');
  const head = sheet.rows.findIndex((r) => (r[0] ?? '').trim() === 'Código');
  const header = sheet.rows[head].map((h) => h.replace(/\s+/g, ' ').trim());
  const cstCols = header.map((h, i) => [/^CST (\d{2})$/.exec(h)?.[1], i]).filter(([cst]) => cst);
  const legal = header.indexOf('Dispositivo');
  const desc = header.findIndex((h) => /^Objeto/.test(h));
  const note = header.indexOf('Observação');
  if (cstCols.length < 10 || desc < 0) throw new Error('A tabela cBenef de SP mudou de colunas');
  const codes = sheet.rows
    .slice(head + 1)
    .filter((r) => /^(SP\d{6}|SEM CBENEF)$/.test((r[0] ?? '').trim()))
    .map((r) => ({
      code: r[0].trim(),
      csts: cstCols
        .filter(([, i]) => (r[i] ?? '').trim().toUpperCase() === 'SIM')
        .map(([cst]) => cst),
      from: null,
      to: endOf(r[note]),
      description: [r[desc], legal >= 0 && r[legal] ? `(${r[legal].trim()})` : '']
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    }));
  if (codes.length < 250)
    throw new Error(`Esperava a tabela cBenef de SP inteira; achei ${codes.length} códigos`);
  return codes;
}
