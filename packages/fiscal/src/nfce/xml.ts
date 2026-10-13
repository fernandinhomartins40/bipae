/**
 * Montagem de XML sem dependências: elementos em ordem, texto escapado, sem espaços entre tags e
 * sem elementos vazios abreviados. O XML já sai na forma canônica (C14N) que a assinatura usa:
 * o escape segue as regras da canonicalização, para o documento assinado ser igual ao gerado.
 */
export type XmlNode = string | null | undefined | false | XmlNode[];

/** Texto (C14N): só &, < e >. Aspas ficam como estão. */
const escapeText = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#xD;');

/** Valor de atributo (C14N): &, <, aspas duplas e quebras. */
const escapeAttr = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;')
    .replace(/\t/g, '&#x9;')
    .replace(/\n/g, '&#xA;')
    .replace(/\r/g, '&#xD;');

/** Normaliza o texto como o leiaute pede: sem quebras de linha nem espaços repetidos. */
const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();

export function el(
  name: string,
  content: XmlNode | number,
  attrs: Record<string, string> = {},
): string {
  const attrText = Object.entries(attrs)
    .map(([key, value]) => ` ${key}="${escapeAttr(value)}"`)
    .join('');
  const body = typeof content === 'number' ? String(content) : render(content);
  return `<${name}${attrText}>${body}</${name}>`;
}

/** Elemento opcional: só sai quando há valor. */
export function opt(name: string, value: string | number | null | undefined): string {
  return value === null || value === undefined || value === ''
    ? ''
    : el(name, typeof value === 'number' ? value : text(value));
}

/** Texto já escapado e normalizado, para usar como conteúdo de `el`. */
export function text(value: string): string {
  return escapeText(normalize(value));
}

function render(node: XmlNode): string {
  if (node === null || node === undefined || node === false) return '';
  if (Array.isArray(node)) return node.map(render).join('');
  return node;
}
