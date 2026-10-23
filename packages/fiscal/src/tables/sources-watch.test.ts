import { describe, expect, it } from 'vitest';
import {
  diffRows,
  diffTitles,
  listingTitles,
  nfsePageEntries,
  reportMarkdown,
} from '../../scripts/sources-watch.mjs';

/** F3-31: conferência das fontes oficiais (comparação, sem rede). */

describe('conferência das fontes oficiais', () => {
  it('lê os títulos de uma lista do Portal da NF-e e acha o que entrou e saiu', () => {
    const html =
      '<a><span class="tituloConteudo">Nota Técnica 2026.008 v.1.00 - Publicada em 01/10/2026 </span></a>' +
      '<a><span class="tituloConteudo">Nota Técnica 2024.001 v.1.20 - Publicada em 29/08/2024</span></a>';
    const titles = listingTitles(html);
    expect(titles).toEqual([
      'Nota Técnica 2026.008 v.1.00 - Publicada em 01/10/2026',
      'Nota Técnica 2024.001 v.1.20 - Publicada em 29/08/2024',
    ]);
    expect(
      diffTitles(['Nota Técnica 2024.001 v.1.20 - Publicada em 29/08/2024', 'Antiga'], titles),
    ).toEqual({
      added: ['Nota Técnica 2026.008 v.1.00 - Publicada em 01/10/2026'],
      removed: ['Antiga'],
    });
  });

  it('página da NFS-e Nacional: esquema novo da produção restrita e data nova de implantação viram título novo (F5-13.j)', () => {
    const page = (schema: string, production: string) =>
      '<a href="https://www.gov.br/nfse/menu.pdf">Menu fora do conteúdo</a>' +
      '<div id="parent-fieldname-text">' +
      `<p><a href="https://www.gov.br/nfse/pt-br/x/${schema}.zip" class="internal-link">NFSe-ESQUEMAS_XSD-PRODREST &amp; cia</a></p>` +
      '<table><thead><tr><td></td><td>PRODUÇÃO</td><td>PRODUÇÃO RESTRITA</td></tr></thead><tbody>' +
      `<tr><td><strong>20/10/2026</strong></td><td><p>${production}</p></td><td><p>- Reposicionamento dos campos CST e cClassTrib (item 2.16 da Nota Técnica 009);</p></td></tr>` +
      '</tbody></table></div><div id="viewlet-below-content-body"><a href="rodape.pdf">Rodapé</a></div>';
    const before = nfsePageEntries(page('esquemas_prod_restrita_20261020', ' -'));
    expect(before).toEqual([
      'NFSe-ESQUEMAS_XSD-PRODREST & cia (esquemas_prod_restrita_20261020.zip)',
      '20/10/2026 | - | - Reposicionamento dos campos CST e cClassTrib (item 2.16 da Nota Técnica 009);',
    ]);
    const after = nfsePageEntries(page('esquemas_prod_restrita_20261201', 'Item 2.16 da NT 009'));
    expect(diffTitles(before, after).added).toEqual([
      'NFSe-ESQUEMAS_XSD-PRODREST & cia (esquemas_prod_restrita_20261201.zip)',
      '20/10/2026 | Item 2.16 da NT 009 | - Reposicionamento dos campos CST e cClassTrib (item 2.16 da Nota Técnica 009);',
    ]);
    expect(nfsePageEntries('<html>sem conteúdo</html>')).toEqual([]);
  });

  it('compara tabelas linha a linha, sem depender da ordem das chaves', () => {
    expect(diffRows([{ uf: 'SP', rate: '18' }], [{ rate: '18', uf: 'SP' }]).changed).toBe(false);
    const diff = diffRows([{ uf: 'SP', rate: '18' }], [{ uf: 'SP', rate: '19' }]);
    expect(diff).toMatchObject({ changed: true, added: 1, removed: 1 });
    expect(diff.examples[0]).toContain('"rate":"19"');
  });

  it('relatório em português, com o caminho para atualizar e o que não deu para conferir', () => {
    const report = reportMarkdown(
      [
        { title: 'CEST', page: 'https://confaz', status: 'mudou', details: ['2 linha(s) nova(s)'] },
        { title: 'NCM', page: 'https://siscomex', status: 'igual', details: [] },
        { title: 'NFC-e', page: 'https://svrs', status: 'erro', details: ['HTTP 503'] },
      ],
      '2026-10-14',
    );
    expect(report).toContain('**1 fonte(s) mudaram.**');
    expect(report).toContain('pnpm --filter @bipae/fiscal tables');
    expect(report).toContain('### CEST');
    expect(report).toContain('- NFC-e: HTTP 503');
    expect(reportMarkdown([], '2026-10-14')).toContain('Nenhuma fonte mudou.');
  });
});
