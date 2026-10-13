/** Montagem de XML sem dependências: elementos em ordem, texto escapado, sem espaços entre tags. */
export type XmlNode = string | null | undefined | false | XmlNode[];

const escape = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Normaliza o texto como o leiaute pede: sem quebras de linha nem espaços repetidos. */
const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();

export function el(
  name: string,
  content: XmlNode | number,
  attrs: Record<string, string> = {},
): string {
  const attrText = Object.entries(attrs)
    .map(([key, value]) => ` ${key}="${escape(value)}"`)
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
  return escape(normalize(value));
}

function render(node: XmlNode): string {
  if (node === null || node === undefined || node === false) return '';
  if (Array.isArray(node)) return node.map(render).join('');
  return node;
}
