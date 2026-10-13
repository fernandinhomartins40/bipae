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
