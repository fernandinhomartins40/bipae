/**
 * Leiautes da DPS da NFS-e Nacional por ambiente e data (F5-13.j). A NT 009 entra aos poucos: a
 * página oficial "Atualizações e Implantações" (gov.br/nfse, guardada em sources) diz o que cada
 * ambiente passou a exigir e quando. Cada linha aponta o pacote de esquemas oficial guardado em
 * `packages/fiscal/sources`, contra o qual o teste valida a DPS.
 *
 * O código só lê esta tabela: quando a produção receber a NT 009, entra uma linha nova com a data
 * publicada, e o leiaute antigo continua valendo até ela.
 */
export type NfseEnvironment = 'producao' | 'producao-restrita';

export interface NfseDpsLayout {
  id: string;
  environment: NfseEnvironment;
  /** Desde quando o ambiente aceita este leiaute (AAAA-MM-DD). */
  since: string;
  /** Pacote de esquemas oficial em packages/fiscal/sources. */
  schemaFile: string;
  /** Pasta dos esquemas da versão 1.01 dentro do pacote ('' quando estão na raiz). */
  schemaDir: string;
  /** De onde vem a data. */
  source: string;
  /** finNFSe no infDPS, logo depois do tpEmit (NT 009, item 2.2). */
  finNFSe: boolean;
  /** xDescServ depois do cNBS e do cIntContrib no grupo cServ (esquema da produção restrita de 20/10/2026). */
  descriptionAfterNbs: boolean;
}

export const NFSE_DPS_LAYOUTS: readonly NfseDpsLayout[] = [
  {
    id: 'producao-v1.01-20260209',
    environment: 'producao',
    since: '2026-02-09',
    schemaFile: 'NFSe_Esquemas_XSD_v1.01_2026-02-09.zip',
    schemaDir: 'Schemas/1.01/',
    source:
      'Documentação Atual (Produção), NFSe-ESQUEMAS_XSD-v1.01-20260209; a produção ainda não tem data para a NT 009 (Atualizações e Implantações, 21/10/2026)',
    finNFSe: false,
    descriptionAfterNbs: false,
  },
  {
    id: 'producao-restrita-v1.01-20261020',
    environment: 'producao-restrita',
    since: '2026-10-20',
    schemaFile: 'NFSe_Esquemas_XSD_PRODREST_v1.01_2026-10-20.zip',
    schemaDir: '',
    source:
      'Atualizações e Implantações, produção restrita em 20/10/2026: itens 2.3 (vAjusteBC), 2.15 e 2.16 (CST e cClassTrib) da NT 009; NFSe-ESQUEMAS_XSD-PRODREST-v1.01-20261020',
    finNFSe: true,
    descriptionAfterNbs: true,
  },
];

/** O leiaute que o ambiente exige na data (AAAA-MM-DD), ou null quando nenhum vale ainda. */
export function nfseDpsLayout(
  environment: NfseEnvironment,
  date: string,
  layouts: readonly NfseDpsLayout[] = NFSE_DPS_LAYOUTS,
): NfseDpsLayout | null {
  return (
    layouts
      .filter((l) => l.environment === environment && l.since <= date)
      .sort((a, b) => b.since.localeCompare(a.since))[0] ?? null
  );
}
