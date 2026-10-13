// Extrai, da "Relação de Serviços Web" do Portal Nacional da NF-e (páginas de produção e de
// homologação guardadas em sources/), quem autoriza a NF-e de cada UF, quem atende em
// contingência e os endereços dos webservices. Nenhum endereço é digitado à mão.
import { pageLines } from './nfce-endpoints.mjs';

const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];

const SERVICE_NAMES = {
  nfeautorizacao: 'NFeAutorizacao',
  nferetautorizacao: 'NFeRetAutorizacao',
  nfeinutilizacao: 'NFeInutilizacao',
  nfeconsultaprotocolo: 'NFeConsultaProtocolo',
  nfestatusservico: 'NFeStatusServico',
  nfeconsultacadastro: 'NFeConsultaCadastro',
  recepcaoevento: 'RecepcaoEvento',
  nfedistribuicaodfe: 'NFeDistribuicaoDFe',
};

const ufList = (line) => line.split(',').map((uf) => uf.trim()).filter((uf) => /^[A-Z]{2}$/.test(uf));

function after(lines, pattern, from = 0) {
  const i = lines.findIndex((line, n) => n >= from && pattern.test(line));
  if (i < 0) throw new Error(`Trecho não encontrado na página oficial: ${pattern}`);
  return i;
}

/** Uma página (produção ou homologação): quem atende cada UF e os serviços de cada autorizador. */
function parsePage(html) {
  const lines = pageLines(html);
  const svan = after(lines, /^SVAN$/);
  const svrs = after(lines, /^SVRS$/, svan);
  const cadastro = after(lines, /^- Para serviço de Consulta Cadastro:$/, svrs);
  const demais = after(lines, /^- Para demais serviços/, cadastro);
  const svcAn = after(lines, /^SVC-AN$/, demais);
  const svcRs = after(lines, /^SVC-RS$/, svcAn);
  const own = after(lines, /^Autorizadores:$/, svcRs);
  const lists = {
    SVAN: ufList(lines[svan + 2]),
    SVRS: ufList(lines[demais + 1]),
    SVRSCadastro: ufList(lines[cadastro + 1]),
    'SVC-AN': ufList(lines[svcAn + 2]),
    'SVC-RS': ufList(lines[svcRs + 2]),
    own: [],
  };
  for (let i = own + 1; i < lines.length && /^[A-Z]{2}$|^SV|^AN$/.test(lines[i]); i++) {
    if (/^[A-Z]{2}$/.test(lines[i]) && lines[i] !== 'AN') lists.own.push(lines[i]);
  }

  const services = {};
  for (let i = 0; i < lines.length; i++) {
    const m = / - \(([A-Z-]+)\)$/.exec(lines[i]);
    if (!m) continue;
    const found = {};
    for (let j = i + 1; j < lines.length && !/^Voltar ao topo/.test(lines[j]); j++) {
      const name = SERVICE_NAMES[lines[j].toLowerCase()];
      const url = lines[j + 2] ?? '';
      // A primeira ocorrência vale; "?wsdl" é só o endereço da descrição do serviço.
      if (name && /^https:\/\//.test(url) && !found[name]) found[name] = url.replace(/\?wsdl$/i, '');
    }
    services[m[1]] = found;
  }
  return { lists, services };
}

export function parseNfeEndpoints({ producaoHtml, homologacaoHtml }) {
  const pages = { producao: parsePage(producaoHtml), homologacao: parsePage(homologacaoHtml) };
  const authorizerOf = (lists, uf) => {
    const options = [
      lists.own.includes(uf) && uf,
      lists.SVAN.includes(uf) && 'SVAN',
      lists.SVRS.includes(uf) && 'SVRS',
    ].filter(Boolean);
    if (options.length !== 1) throw new Error(`UF ${uf} com ${options.length} autorizadores na página oficial`);
    return options[0];
  };
  const contingencyOf = (lists, uf) => {
    const options = ['SVC-AN', 'SVC-RS'].filter((svc) => lists[svc].includes(uf));
    if (options.length !== 1) throw new Error(`UF ${uf} com ${options.length} autorizadores de contingência`);
    return options[0];
  };
  return {
    national: { producao: pages.producao.services.AN, homologacao: pages.homologacao.services.AN },
    ufs: UFS.map((uf) => {
      const result = { uf, authorizer: {}, contingency: {}, webservices: {}, contingencyWebservices: {} };
      for (const [env, page] of Object.entries(pages)) {
        const authorizer = authorizerOf(page.lists, uf);
        const contingency = contingencyOf(page.lists, uf);
        const services = { ...page.services[authorizer] };
        // A consulta cadastro da SVRS atende só as UFs listadas; as demais não oferecem o serviço.
        if (authorizer === 'SVRS' && !page.lists.SVRSCadastro.includes(uf)) delete services.NFeConsultaCadastro;
        if (Object.keys(services).length === 0) throw new Error(`Sem serviços para ${uf} (${authorizer})`);
        result.authorizer[env] = authorizer;
        result.contingency[env] = contingency;
        result.webservices[env] = services;
        result.contingencyWebservices[env] = page.services[contingency];
      }
      return result;
    }),
  };
}
