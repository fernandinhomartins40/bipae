/** Tipos do leitor de planilhas e zip usado pelo importador (e pelos testes que leem os XSD). */
export function unzip(buffer: Uint8Array): Map<string, Buffer>;
export function readXlsx(path: string): { name: string; rows: string[][] }[];
