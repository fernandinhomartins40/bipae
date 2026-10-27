import { lookup as dnsLookup } from 'node:dns';
import type { LookupAddress, LookupOptions } from 'node:dns';
import { isIP } from 'node:net';

/** Expande um IPv6 (com ou sem ::, com ou sem sufixo IPv4) nos 8 grupos de 16 bits. */
function ipv6Groups(ip: string): number[] | null {
  let text = ip.toLowerCase().split('%')[0]!;
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (dotted) {
    const [, a, b, c, d] = dotted.map(Number) as number[];
    text =
      text.slice(0, dotted.index) +
      ((a! << 8) | b!).toString(16) +
      ':' +
      ((c! << 8) | d!).toString(16);
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  const numbers = groups.map((g) => Number.parseInt(g, 16));
  return numbers.length === 8 && numbers.every((n) => n >= 0 && n <= 0xffff) ? numbers : null;
}

/**
 * Endereço de rede interna, que um aviso nunca pode alcançar (a VPS é compartilhada). Cobre
 * também IPv6 que embute IPv4 (::ffff:7f00:1, NAT64 e 6to4), que o Node escreve em hexadecimal.
 */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b, c] = ip.split('.').map(Number) as [number, number, number];
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  const g = ipv6Groups(ip);
  // Não conseguiu ler o endereço: na dúvida, recusa.
  if (!g) return true;
  const v4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  const first = g[0]!;
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff)
    return isPrivateAddress(v4(g[6]!, g[7]!));
  // IPv4 compatível (::a.b.c.d), :: e ::1.
  if (g.slice(0, 6).every((x) => x === 0)) return true;
  // NAT64 (64:ff9b::/96) e 6to4 (2002::/16) carregam um IPv4.
  if (first === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return isPrivateAddress(v4(g[6]!, g[7]!));
  }
  if (first === 0x2002) return isPrivateAddress(v4(g[1]!, g[2]!));
  return (
    (first & 0xfe00) === 0xfc00 || // fc00::/7 (local única)
    (first & 0xffc0) === 0xfe80 || // fe80::/10 (link local)
    (first & 0xffc0) === 0xfec0 || // fec0::/10 (site local, em desuso)
    (first & 0xff00) === 0xff00 || // ff00::/8 (multicast)
    (first === 0x2001 && g[1] === 0x0db8) // documentação
  );
}

const BLOCKED_NAMES = /(^|\.)(localhost|local|internal|localdomain|lan|home\.arpa)$/i;

/**
 * Confere uma URL que o cliente cadastrou e a API vai chamar (F7-02.c, ASVS 5.2.6): só https,
 * sem usuário e senha no endereço, e sem IP nem nome de rede interna. Devolve o motivo ou null.
 * Os nomes são resolvidos de novo na hora da chamada (`safeLookup`), contra DNS que muda depois.
 */
export function unsafeUrlReason(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'Endereço inválido.';
  }
  if (url.protocol !== 'https:') return 'O endereço precisa ser https://.';
  if (url.username || url.password) return 'O endereço não pode levar usuário e senha.';
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) ? isPrivateAddress(host) : BLOCKED_NAMES.test(host)) {
    return 'O endereço aponta para uma rede interna, que não pode ser usada aqui.';
  }
  return null;
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/**
 * Resolução de DNS para https.request/fetch que recusa endereço de rede interna: fecha a janela
 * entre conferir o nome e conectar (DNS rebinding) e vale também depois de redirecionamentos.
 */
export function safeLookup(
  hostname: string,
  options: LookupOptions | number | undefined,
  callback: LookupCallback,
): void {
  const opts: LookupOptions = typeof options === 'object' ? options : {};
  dnsLookup(hostname, { ...opts, all: true }, (error, addresses) => {
    if (error) return callback(error, '');
    const list = addresses as LookupAddress[];
    if (list.length === 0 || list.some((a) => isPrivateAddress(a.address))) {
      const blocked = new Error('Endereço de rede interna recusado.') as NodeJS.ErrnoException;
      blocked.code = 'EBLOCKED';
      return callback(blocked, '');
    }
    if (opts.all) return callback(null, list);
    callback(null, list[0]!.address, list[0]!.family);
  });
}
