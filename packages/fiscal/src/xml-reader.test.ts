import { describe, expect, it } from 'vitest';
import { descendant, find, findAll, parseXml, textOf } from './xml-reader';

describe('leitor de XML', () => {
  it('lê elementos, atributos, entidades e ignora prefixo de namespace', () => {
    const root = parseXml(
      '<?xml version="1.0"?><!-- nota --><a x="1" y=\'&quot;2&quot;\'><ds:b>Zé &amp; Cia &#233;&#x41;</ds:b><c/></a>',
    );
    expect(root.name).toBe('a');
    expect(root.attrs).toEqual({ x: '1', y: '"2"' });
    expect(root.children.map((c) => c.name)).toEqual(['b', 'c']);
    expect(root.children[0]!.text).toBe('Zé & Cia éA');
  });

  it('recusa XML quebrado', () => {
    expect(() => parseXml('<a><b></a>')).toThrow('fora de ordem');
    expect(() => parseXml('<a>')).toThrow('sem fechamento');
    expect(() => parseXml('<a/><b/>')).toThrow('um elemento raiz');
    expect(() => parseXml('<a>&nbsp;</a>')).toThrow('Entidade desconhecida');
    expect(() => parseXml('<a>x < y</a>')).toThrow('não fecha');
  });
});

describe('busca no XML', () => {
  it('acha por caminho, lista filhos e procura em profundidade', () => {
    const root = parseXml('<a><b><c>1</c><c>2</c></b><d><e><f>x</f></e></d></a>');
    expect(textOf(root, 'b/c')).toBe('1');
    expect(textOf(root, 'b/z')).toBeUndefined();
    expect(find(null, 'b')).toBeNull();
    expect(findAll(find(root, 'b'), 'c').map((c) => c.text)).toEqual(['1', '2']);
    expect(findAll(null, 'c')).toEqual([]);
    expect(descendant(root, 'f')?.text).toBe('x');
    expect(descendant(root, 'nada')).toBeNull();
    expect(descendant(null, 'f')).toBeNull();
  });
});
