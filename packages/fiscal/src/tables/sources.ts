import data from './data/sources.json';

/** De onde veio cada tabela: arquivo oficial, quem publica, quando saiu e quando foi baixado. */
export interface TableSource {
  /** Arquivo guardado em packages/fiscal/sources. */
  file: string;
  title: string;
  publisher: string;
  page: string;
  publishedAt: string;
  downloadedAt: string;
  /** Hash do arquivo, para saber que os dados gerados vieram dele. */
  sha256: string;
  /** Quando o arquivo guardado é um trecho do PDF oficial: as páginas e o hash do PDF inteiro. */
  pages?: string;
  originalSha256?: string;
}

export const TABLE_SOURCES: Readonly<Record<keyof typeof data, TableSource>> = data;
