// Tabelas oficiais (ADR-0006). Ficam fora do índice principal do pacote: quem só calcula não
// carrega os dados; quem precisa deles importa de '@bipae/fiscal/tables'.
export * from './cest';
export * from './cfop';
export * from './class-trib';
export * from './rates';
export * from './sources';
export * from './tax-situations';
export * from './transition';
export * from './icms-uf';
export * from './payment-means';
