// Extrai, das páginas oficiais guardadas em sources/, os endereços da NFC-e de cada UF: quem
// autoriza (webservices de homologação e produção), a URL do QR Code e a URL de consulta pela
// chave (urlChave). Nenhum endereço é digitado à mão.

const UFS = {
  Acre: 'AC',
  Alagoas: 'AL',
  Amapá: 'AP',
  Amazonas: 'AM',
  Bahia: 'BA',
  Ceará: 'CE',
  'Distrito Federal': 'DF',
  'Espírito Santo': 'ES',
  Goiás: 'GO',
  Maranhão: 'MA',
  'Mato Grosso': 'MT',
  'Mato Grosso do Sul': 'MS',
  'Minas Gerais': 'MG',
  Pará: 'PA',
  Paraíba: 'PB',
  Paraná: 'PR',
  Pernambuco: 'PE',
  Piauí: 'PI',
  Piaui: 'PI',
  'Rio de Janeiro': 'RJ',
  'Rio Grande do Norte': 'RN',
  'Rio Grande do Sul': 'RS',
  Rondônia: 'RO',
  Roraima: 'RR',
  'Santa Catarina': 'SC',
  'São Paulo': 'SP',
  Sergipe: 'SE',
  Tocantins: 'TO',
};

const ENTITIES = {
  nbsp: ' ',
  amp: '&',
  aacute: 'á',
  eacute: 'é',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
  atilde: 'ã',
  otilde: 'õ',
  ccedil: 'ç',
  ecirc: 'ê',
  ocirc: 'ô',
};

/** Linhas de texto de uma página (sem tags), na ordem. */
export function pageLines(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, '\n')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&([a-z]+);/gi, (whole, name) => ENTITIES[name] ?? whole)
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

const URL_TOKEN =
  /(?:https?:\/\/)?[a-z0-9.-]+\.(?:gov\.br|org)(?:\/[^\s?]*)?|(?:https?:\/\/)?\d+\.\d+\.\d+\.\d+(?::\d+)?\/[^\s?]*/gi;

/**
 * O endereço vigente de uma célula da tabela. Quando a célula traz o endereço antigo e o novo
 * ("... até 30/08/2025 - ... a partir de 16/06/2025"), vale o último; quando diz que o último já
 * venceu ("esta última até 01/04/2024"), vale o primeiro. Parâmetros de exemplo (?chNFe=...) e o
 * "?" final são retirados.
 */
export function currentUrl(cell) {
  const urls = [...cell.matchAll(URL_TOKEN)].map((m) => m[0].replace(/[?.]+$/, ''));
  if (urls.length === 0) return null;
  return /esta última até/i.test(cell) ? urls[0] : urls[urls.length - 1];
}

/**
 * Tabelas "UF | endereço" das páginas do ENCAT, entre duas posições. A célula do endereço pode
 * ocupar várias linhas (endereço antigo e novo): junta tudo até a próxima UF.
 */
function ufTable(lines, from, to) {
  const result = {};
  for (let i = from; i < to; i++) {
    const uf = UFS[lines[i]];
    if (!uf || result[uf]) continue;
    const cell = [];
    for (
      let j = i + 1;
      j < to && !UFS[lines[j]] && !/^(Unidade Federada|Endereço da Consulta)/.test(lines[j]);
      j++
    ) {
      cell.push(lines[j]);
    }
    const text = cell
      .join(' ')
      .replace(/URL QRCODE NFCe 4\.00 - /g, '')
      // Erro de digitação na página oficial ("homolog acao").
      .replace(/homolog acao/, 'homologacao');
    const url = currentUrl(text);
    if (url) result[uf] = { url, raw: text };
  }
  return result;
}

function indexOf(lines, pattern, after = 0) {
  const i = lines.findIndex((line, n) => n >= after && pattern.test(line));
  if (i < 0) throw new Error(`Trecho não encontrado na página oficial: ${pattern}`);
  return i;
}

const SERVICE =
  /^(NFeAutorizacao|NFeRetAutorizacao|NFeInutilizacao|NFeConsultaProtocolo|NFeStatusServico|RecepcaoEvento)$/i;
const serviceName = (name) => name.replace(/^Nfe/, 'NFe');

export function parseNfceEndpoints({ svrsHtml, encatWsHtml, qrHtml, chaveHtml }) {
  // ---------------------------------------------------------------- autorizadores (SVRS)
  const svrs = pageLines(svrsHtml);
  const authorizers = {};
  for (let i = 0; i < svrs.length; i++) {
    const m = /^SEFAZ .*\((\w+)\) - (Produção|Homologação)$/.exec(svrs[i]);
    if (!m) continue;
    const services = {};
    for (let j = i + 1; j < svrs.length && !/^Voltar ao topo/.test(svrs[j]); j++) {
      if (SERVICE.test(svrs[j]) && /^https:\/\//.test(svrs[j + 2] ?? ''))
        services[serviceName(svrs[j])] = svrs[j + 2];
    }
    authorizers[m[1]] ??= {};
    authorizers[m[1]][m[2] === 'Produção' ? 'producao' : 'homologacao'] = services;
  }

  // ---------------------------------------------------------------- MG (página do ENCAT)
  const encat = pageLines(encatWsHtml);
  const mg = indexOf(encat, /^Minas Gerais$/, indexOf(encat, /^AMBIENTE DE HOMOLOGAÇÃO$/));
  const mgServices = {};
  for (let j = mg + 1; j < encat.length && !UFS[encat[j]]; j++) {
    if (SERVICE.test(encat[j]) && /^https:\/\//.test(encat[j + 2] ?? ''))
      mgServices[serviceName(encat[j])] = encat[j + 2];
  }

  // ---------------------------------------------------------------- QR Code e consulta pela chave
  const qr = pageLines(qrHtml);
  const qrProdAt = indexOf(qr, /QR code: Ambiente de Produção/);
  const qrHomAt = indexOf(qr, /QR code: Ambiente de Homologação/, qrProdAt);
  const qrEnd = indexOf(qr, /^Institucional$/, qrHomAt);
  const qrProd = ufTable(qr, qrProdAt, qrHomAt);
  const qrHom = ufTable(qr, qrHomAt, qrEnd);
  // Consulta pela chave: uma tabela com o mesmo endereço nos dois ambientes e duas separadas.
  const chave = pageLines(chaveHtml);
  const bothAt = indexOf(chave, /^Acre$/);
  const prodAt = indexOf(chave, /Endereço da Consulta - PRODUÇÃO/, bothAt);
  const homAt = indexOf(chave, /Endereço da Consulta - HOMOLOGAÇÃO/, prodAt);
  const homEnd = indexOf(chave, /^Institucional$/, homAt);
  const chaveAll = ufTable(chave, bothAt, prodAt);
  const chaveProd = ufTable(chave, prodAt, homAt);
  const chaveHom = ufTable(chave, homAt, homEnd);

  const own = new Set(Object.keys(authorizers).filter((key) => key !== 'SVRS'));
  return [...new Set(Object.values(UFS))].sort().map((uf) => {
    const authorizer = own.has(uf) ? uf : uf === 'MG' ? 'MG' : 'SVRS';
    const webservices =
      uf === 'MG'
        ? { homologacao: mgServices }
        : {
            producao: authorizers[authorizer]?.producao ?? {},
            homologacao: authorizers[authorizer]?.homologacao ?? {},
          };
    return {
      uf,
      authorizer,
      ...(uf === 'MG' && {
        note: 'A relação da SEFAZ Virtual do RS não lista MG; a página do ENCAT lista ambiente próprio de NFC-e em MG. Dúvida D-022.',
      }),
      webservices,
      qrCode: { producao: qrProd[uf]?.url ?? null, homologacao: qrHom[uf]?.url ?? null },
      urlChave: {
        producao: chaveAll[uf]?.url ?? chaveProd[uf]?.url ?? null,
        homologacao: chaveAll[uf]?.url ?? chaveHom[uf]?.url ?? null,
      },
    };
  });
}
