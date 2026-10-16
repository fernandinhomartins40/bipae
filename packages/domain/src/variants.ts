/**
 * Grade de variações (F1-04): a partir dos atributos de um modelo (ex.: Tamanho P, M, G e
 * Cor Azul, Preto) gera todas as combinações, cada uma vira um produto filho.
 */
export interface VariantAttribute {
  name: string;
  values: string[];
}

/** "P, M ,G,, M" → ["P", "M", "G"] (sem vazios nem repetidos). */
export function parseVariantValues(text: string): string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const raw of text.split(',')) {
    const value = raw.trim();
    if (!value || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    values.push(value);
  }
  return values;
}

/** Todas as combinações: [{Tamanho: 'P', Cor: 'Azul'}, {Tamanho: 'P', Cor: 'Preto'}, ...]. */
export function variantCombinations(attributes: VariantAttribute[]): Record<string, string>[] {
  const used = attributes.filter((a) => a.name.trim() && a.values.length > 0);
  if (used.length === 0) return [];
  return used.reduce<Record<string, string>[]>(
    (combos, attr) =>
      combos.flatMap((combo) => attr.values.map((v) => ({ ...combo, [attr.name.trim()]: v }))),
    [{}],
  );
}

/** "Camiseta Básica — P / Azul" */
export function variantName(baseName: string, attributes: Record<string, string>): string {
  return `${baseName} — ${Object.values(attributes).join(' / ')}`;
}

/** Mesma combinação, sem diferença de maiúsculas, para não criar a mesma variação duas vezes. */
export function sameVariant(
  a: Record<string, string> | null | undefined,
  b: Record<string, string>,
): boolean {
  if (!a) return false;
  const norm = (x: Record<string, string>) =>
    Object.entries(x)
      .map(([k, v]) => `${k.trim().toLowerCase()}=${v.trim().toLowerCase()}`)
      .sort()
      .join('|');
  return norm(a) === norm(b);
}

/** Grade em matriz (F5-12.a): linhas pelo primeiro atributo, colunas pelo segundo. */
export interface VariantGrid<T> {
  /** Nome do atributo das linhas (ex.: Tamanho) e das colunas (ex.: Cor; vazio se só há um). */
  rowName: string;
  colName: string;
  rows: string[];
  cols: string[];
  /** A variação de cada cruzamento, ou null quando a combinação não foi criada. */
  cell: (row: string, col: string) => T | null;
}

/**
 * Monta a matriz a partir das variações. Os valores seguem a ordem de criação (P, M, G),
 * sem diferença de maiúsculas. O banco não guarda a ordem dos atributos, então o que tem mais
 * valores vai nas linhas (a tabela cabe melhor na tela); `swap` troca linhas e colunas. Só vale
 * para um ou dois atributos; com mais, devolve null e a tela mostra a lista.
 */
export function variantGrid<T extends { id: string; attributes: Record<string, string> | null }>(
  variants: T[],
  swap = false,
): VariantGrid<T> | null {
  // IDs UUIDv7 seguem a ordem de criação, que é a ordem em que os valores foram digitados.
  const withAttrs = variants
    .filter((v) => v.attributes && Object.keys(v.attributes).length > 0)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (withAttrs.length === 0) return null;
  const names = Object.keys(withAttrs[0]!.attributes!);
  if (names.length > 2) return null;
  const key = (value: string | undefined) => (value ?? '').trim().toLowerCase();
  const count = (name: string) => new Set(withAttrs.map((v) => key(v.attributes![name]))).size;
  if (names.length === 2 && count(names[1]!) > count(names[0]!)) names.reverse();
  if (names.length === 2 && swap) names.reverse();
  const [rowName, colName = ''] = names;
  const distinct = (name: string) => {
    const seen = new Map<string, string>();
    for (const v of withAttrs) {
      const value = name ? (v.attributes![name] ?? '') : '';
      if (!seen.has(key(value))) seen.set(key(value), value.trim());
    }
    return [...seen.values()];
  };
  const index = new Map<string, T>();
  for (const v of withAttrs) {
    if (Object.keys(v.attributes!).length !== names.length) return null;
    index.set(`${key(v.attributes![rowName!])}|${key(colName ? v.attributes![colName] : '')}`, v);
  }
  return {
    rowName: rowName!,
    colName,
    rows: distinct(rowName!),
    cols: colName ? distinct(colName) : [''],
    cell: (row, col) => index.get(`${key(row)}|${key(col)}`) ?? null,
  };
}
