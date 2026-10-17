import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEMONSTRATION } from './demonstration';
import { TABLE_SOURCES } from './sources';

/** F5-12.c: as notas da venda condicional saem do texto oficial do Ajuste SINIEF 02/18. */
describe('notas da demonstração (Ajuste SINIEF 02/18)', () => {
  const source = TABLE_SOURCES[DEMONSTRATION.source as keyof typeof TABLE_SOURCES];
  const text = readFileSync(join(__dirname, '../../sources', source.file), 'utf8');
  const dotted = (c: string) => `${c[0]}.${c.slice(1)}`;

  it('cada natureza, CFOP e texto obrigatório está no ato guardado', () => {
    expect(DEMONSTRATION.maxDays).toBe(60);
    for (const [name, note] of Object.entries(DEMONSTRATION.notes)) {
      for (const t of note.texts) expect(text, `${name}: ${t}`).toContain(t);
      if (note.nature) expect(text, name).toContain(note.nature);
      if (note.cfop) {
        expect(text, name).toContain(
          `${dotted(note.cfop.interna)} ou ${dotted(note.cfop.interestadual)}`,
        );
      }
    }
    expect(DEMONSTRATION.notes.remessa.cfop).toEqual({ interna: '5912', interestadual: '6912' });
    expect(DEMONSTRATION.notes.venda).toMatchObject({ taxed: true, references: true, cfop: null });
  });
});
