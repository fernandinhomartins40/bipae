// Texto de um .doc (Word 97) oficial, com as células das tabelas separadas por tabulação.
// Usa o word-extractor, para a geração das tabelas não depender de programa instalado na máquina.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const WordExtractor = require('word-extractor');

export async function docText(bytes) {
  const doc = await new WordExtractor().extract(Buffer.from(bytes));
  return doc.getBody();
}
