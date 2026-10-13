/**
 * Leitor de XML mínimo para a NF-e: elementos, atributos e texto, com as entidades do XML.
 * Basta para o XML da nota, para o nfeProc e para os retornos da SEFAZ (sem DTD nem CDATA). O DANFE
 * é sempre montado a partir do XML, porque o manual proíbe imprimir o que não está nele.
 */
export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  text: string;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity[0] === '#') {
      const code =
        entity[1] === 'x' || entity[1] === 'X'
          ? parseInt(entity.slice(2), 16)
          : Number(entity.slice(1));
      return String.fromCodePoint(code);
    }
    const value = ENTITIES[entity];
    if (value === undefined) throw new Error(`Entidade desconhecida no XML: ${whole}`);
    return value;
  });
}

/** Nome sem o prefixo do namespace ("ds:Signature" vira "Signature"). */
const localName = (name: string) => name.slice(name.indexOf(':') + 1);

export function parseXml(xml: string): XmlElement {
  const root: XmlElement = { name: '#document', attrs: {}, children: [], text: '' };
  const stack: XmlElement[] = [root];
  const tag =
    /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<\?[\s\S]*?\?>|<!--[\s\S]*?-->/g;
  let last = 0;
  for (const m of xml.matchAll(tag)) {
    const between = xml.slice(last, m.index);
    if (between.includes('<')) throw new Error('XML inválido: marcação que não fecha.');
    stack[stack.length - 1]!.text += decode(between);
    last = m.index + m[0].length;
    if (m[2] === undefined) continue; // declaração ou comentário
    const [, closing, rawName, rawAttrs, selfClosing] = m as unknown as string[];
    const name = localName(rawName!);
    if (closing) {
      const open = stack.pop()!;
      if (open.name !== name || stack.length === 0)
        throw new Error(`XML inválido: </${rawName}> fora de ordem.`);
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of rawAttrs!.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      attrs[localName(a[1]!)] = decode(a[2] ?? a[3] ?? '');
    }
    const element: XmlElement = { name, attrs, children: [], text: '' };
    stack[stack.length - 1]!.children.push(element);
    if (!selfClosing) stack.push(element);
  }
  if (xml.slice(last).trim() !== '' || stack.length !== 1)
    throw new Error('XML inválido: elemento sem fechamento.');
  if (root.children.length !== 1)
    throw new Error('XML inválido: precisa de exatamente um elemento raiz.');
  return root.children[0]!;
}

/** Primeiro elemento no caminho ("emit/enderEmit/xMun"), ou null. */
export function find(node: XmlElement | null | undefined, path: string): XmlElement | null {
  let current: XmlElement | null = node ?? null;
  for (const part of path.split('/')) {
    if (!current) return null;
    current = current.children.find((c) => c.name === part) ?? null;
  }
  return current;
}

/** Todos os filhos diretos com o nome. */
export function findAll(node: XmlElement | null | undefined, name: string): XmlElement[] {
  return node ? node.children.filter((c) => c.name === name) : [];
}

/** Texto do elemento no caminho, ou undefined quando não existe. */
export function textOf(node: XmlElement | null | undefined, path: string): string | undefined {
  const found = find(node, path);
  return found ? found.text : undefined;
}

/** Busca em profundidade do primeiro elemento com o nome. */
export function descendant(node: XmlElement | null | undefined, name: string): XmlElement | null {
  if (!node) return null;
  for (const child of node.children) {
    if (child.name === name) return child;
    const found = descendant(child, name);
    if (found) return found;
  }
  return null;
}
