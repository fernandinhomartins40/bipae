import data from './data/icp-brasil.json';

/**
 * Certificados das autoridades certificadoras da ICP-Brasil, extraídos do arquivo oficial do ITI
 * (origem e data em TABLE_SOURCES). Os servidores da SEFAZ usam certificados dessa cadeia, que
 * não vem na lista padrão do Node: quem conecta soma estes aos certificados padrão.
 * Fica fora do índice do pacote para não pesar no aplicativo do navegador.
 */
export const ICP_BRASIL_CERTIFICATES: readonly { name: string; pem: string }[] = data;
