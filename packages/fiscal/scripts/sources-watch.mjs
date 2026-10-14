// Comparação entre o que está guardado em sources/ e o que os portais oficiais publicam hoje
// (F3-31). Funções puras: o download fica em check-sources.mjs.

/** Títulos dos documentos de uma lista do Portal Nacional da NF-e ("Nota Técnica 2024.001 v.1.20 ..."). */
export function listingTitles(html) {
  return [...html.matchAll(/<span class="tituloConteudo">([^<]+)<\/span>/g)]
    .map((match) => match[1].replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** O que entrou e o que saiu de uma lista de títulos. */
export function diffTitles(saved, current) {
  const before = new Set(saved);
  const now = new Set(current);
  return {
    added: current.filter((title) => !before.has(title)),
    removed: saved.filter((title) => !now.has(title)),
  };
}

const canonical = (value) =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );

/**
 * Compara a tabela gerada do arquivo guardado com a gerada da página de hoje, linha a linha
 * (cada linha em JSON canônico). Devolve quantas linhas entraram e saíram e alguns exemplos.
 */
export function diffRows(saved, current, examples = 3) {
  const before = new Set(saved.map(canonical));
  const now = new Set(current.map(canonical));
  const added = [...now].filter((row) => !before.has(row));
  const removed = [...before].filter((row) => !now.has(row));
  return {
    changed: added.length > 0 || removed.length > 0,
    added: added.length,
    removed: removed.length,
    examples: [
      ...added.slice(0, examples).map((r) => `+ ${r}`),
      ...removed.slice(0, examples).map((r) => `- ${r}`),
    ],
  };
}

/** Relatório em Markdown, em português, para o aviso no GitHub. */
export function reportMarkdown(results, checkedAt) {
  const changed = results.filter((r) => r.status === 'mudou');
  const failed = results.filter((r) => r.status === 'erro');
  const lines = [
    `Conferência das fontes fiscais oficiais em ${checkedAt}.`,
    '',
    changed.length === 0
      ? 'Nenhuma fonte mudou.'
      : `**${changed.length} fonte(s) mudaram.** Para atualizar: baixe o arquivo novo, troque em \`packages/fiscal/sources\`, ajuste o \`manifest.json\` e rode \`pnpm --filter @bipae/fiscal tables\`.`,
    '',
  ];
  for (const r of changed) {
    lines.push(
      `### ${r.title}`,
      '',
      `Página: ${r.page}`,
      '',
      ...r.details.map((d) => `- ${d}`),
      '',
    );
  }
  if (failed.length > 0) {
    lines.push('### Não foi possível conferir', '');
    for (const r of failed) lines.push(`- ${r.title}: ${r.details.join('; ')}`);
    lines.push('');
  }
  return lines.join('\n');
}
