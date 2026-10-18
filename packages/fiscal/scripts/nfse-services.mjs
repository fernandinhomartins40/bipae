// Extrai, do Anexo B oficial da NFS-e Nacional (planilha "LISTA.SERV.NAC."), os códigos de
// tributação nacional (cTribNac, 6 dígitos: item, subitem e desdobro da lista da LC 116/2003)
// com a descrição, e os grupos (item e subitem) para a busca (F5-13.a). Nada é digitado à mão.

const pad2 = (text) => String(text).trim().padStart(2, '0');

/** @param sheets planilhas lidas por readXlsx */
export function parseNfseServices(sheets) {
  const sheet = sheets.find((s) => /LISTA\.SERV\.NAC/i.test(s.name));
  if (!sheet) throw new Error('O Anexo B da NFS-e mudou: não achei a planilha da lista nacional');
  const head = sheet.rows.findIndex((r) => /C[ÓO]DIGO DE TRIBUTA/i.test(r[0] ?? ''));
  if (head < 0) throw new Error('O Anexo B da NFS-e mudou de colunas');
  const groups = new Map();
  const codes = [];
  for (const r of sheet.rows.slice(head + 1)) {
    const [code, item, subitem, desdobro, description] = r.map((c) => (c ?? '').trim());
    if (!item || !description) continue;
    const text = description.replace(/\s+/g, ' ');
    if (subitem === '0') {
      groups.set(pad2(item), text);
      continue;
    }
    if (desdobro === '0') {
      groups.set(`${pad2(item)}.${pad2(subitem)}`, text);
      continue;
    }
    if (!/^\d{4,6}$/.test(code)) continue;
    codes.push({
      code: code.padStart(6, '0'),
      item: pad2(item),
      subitem: `${pad2(item)}.${pad2(subitem)}`,
      description: text,
    });
  }
  if (codes.length < 300) {
    throw new Error(`Esperava a lista nacional de serviços inteira; achei ${codes.length} códigos`);
  }
  const bad = codes.filter((c) => c.code !== `${c.item}${c.subitem.slice(3)}${c.code.slice(4)}`);
  if (bad.length > 0) {
    throw new Error(`Código fora do item e subitem na lista nacional: ${bad[0].code}`);
  }
  return {
    groups: Object.fromEntries(groups),
    codes,
  };
}

/**
 * Do Anexo I oficial (planilha "MUN.INCID_INFO.SERV."): para cada código, onde o ISSQN incide
 * (estabelecimento do prestador, local da prestação ou estabelecimento do tomador, LC 116/2003,
 * art. 3º) e se a DPS exige o grupo de obra ou de evento.
 */
export function parseNfseIncidence(sheets) {
  const sheet = sheets.find((s) => /^MUN\.INCID/i.test(s.name));
  if (!sheet) throw new Error('O Anexo I da NFS-e mudou: não achei a planilha de incidência');
  const head = sheet.rows.findIndex((r) => /Estabelecimento\s*\/\s*Domic/i.test(r[2] ?? ''));
  if (head < 0) throw new Error('O Anexo I da NFS-e mudou de colunas (incidência)');
  const result = new Map();
  for (const r of sheet.rows.slice(head + 1)) {
    const code = (r[0] ?? '').trim();
    if (!/^\d{4,6}$/.test(code)) continue;
    const mark = (i) => /X/.test(r[i] ?? '');
    const incidence = mark(4) ? 'tomador' : mark(3) ? 'prestacao' : mark(2) ? 'prestador' : null;
    const group = (r[6] ?? '').trim();
    result.set(code.padStart(6, '0'), {
      incidence,
      requiredGroup: group === 'obra' || group === 'atvEvento' ? group : null,
    });
  }
  if (result.size < 300) {
    throw new Error(`Esperava a planilha de incidência inteira; achei ${result.size} códigos`);
  }
  return result;
}

/**
 * Endereços das APIs do Sistema Nacional NFS-e, lidos da página oficial "APIs - Prod. Restrita e
 * Produção" do portal gov.br/nfse: a tabela traz, em cada linha, o link da produção restrita e o
 * da produção. A base de cada serviço é o link sem o "/docs/index...".
 */
export function parseNfseApis(html) {
  const links = [...html.matchAll(/href="(https:\/\/[^"]*nfse\.gov\.br\/[^"]*\/docs\/index[^"]*)"/g)].map(
    (m) => m[1],
  );
  const base = (url) => url.replace(/\/docs\/index.*$/, '');
  const pick = (re) => {
    const found = [...new Set(links.filter((l) => re.test(l)).map(base))];
    const restricted = found.find((l) => /producaorestrita/.test(l));
    const production = found.find((l) => !/producaorestrita/.test(l));
    if (!restricted || !production) throw new Error(`Página das APIs da NFS-e mudou (${re})`);
    return { producaoRestrita: restricted, producao: production };
  };
  return {
    sefinNacional: pick(/sefin\.[^/]*nfse\.gov\.br\/(API\/)?SefinNacional/i),
    danfse: pick(/adn\.[^/]*nfse\.gov\.br\/danfse/),
    parametrizacao: pick(/adn\.[^/]*nfse\.gov\.br\/parametrizacao/),
    contribuintes: pick(/adn\.[^/]*nfse\.gov\.br\/contribuintes/),
  };
}
