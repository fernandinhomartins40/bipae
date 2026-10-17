// Extrai, da planilha oficial "Tabela cBenef x CST" da Receita Estadual do RS (Central de Conteúdo),
// cada código de benefício com os CST em que vale, a vigência e a descrição (F3-27.b.RS). Nada é
// digitado à mão.

/** "1102016" ou "10082020" (dia sem o zero da frente) → "2016-10-01" / "2020-08-10". */
const isoFromRs = (text) => {
  const digits = String(text ?? '').replace(/\D/g, '');
  if (digits.length < 7) return null;
  const full = digits.padStart(8, '0');
  return `${full.slice(4, 8)}-${full.slice(2, 4)}-${full.slice(0, 2)}`;
};

/** @param sheets planilhas lidas por readXlsx */
export function parseCbenefRs(sheets) {
  const sheet = sheets.find((s) => s.rows.some((r) => r[0] === 'CÓDIGO'));
  if (!sheet) throw new Error('Não achei a aba com a coluna CÓDIGO na tabela cBenef do RS');
  const head = sheet.rows.findIndex((r) => r[0] === 'CÓDIGO');
  const header = sheet.rows[head];
  const cstCols = header
    .map((h, i) => [/^CST (\d{2})$/.exec(h.trim())?.[1], i])
    .filter(([cst]) => cst);
  const col = (name) => header.findIndex((h) => h.trim() === name);
  const [start, end, legal, readable] = [
    col('DATA INÍCIO'),
    col('DATA FIM'),
    col('DESCRIÇÃO'),
    col('DESCRIÇÃO PARA NFA-e'),
  ];
  if (cstCols.length < 10 || start < 0 || end < 0 || legal < 0) {
    throw new Error('A tabela cBenef do RS mudou de colunas');
  }
  const codes = sheet.rows
    .slice(head + 1)
    .filter((r) => /^(RS\d{6}|SEM CBENEF)$/.test((r[0] ?? '').trim()))
    .map((r) => ({
      code: r[0].trim(),
      csts: cstCols
        .filter(([, i]) => (r[i] ?? '').trim().toUpperCase() === 'SIM')
        .map(([cst]) => cst),
      from: isoFromRs(r[start]),
      to: isoFromRs(r[end]),
      // Descrição legível e, entre parênteses, a referência legal (quando é outro texto).
      description: [
        r[readable],
        r[legal] && r[legal].trim() !== (r[readable] ?? '').trim() ? `(${r[legal].trim()})` : '',
      ]
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    }));
  if (codes.length < 500)
    throw new Error(`Esperava a tabela cBenef do RS inteira; achei ${codes.length} códigos`);
  return codes;
}
