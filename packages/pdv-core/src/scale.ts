/**
 * Retail scale protocols over serial (Toledo Prix and Filizola family, common in Brazil).
 * The platform only moves bytes (desktop: serial port; web: WebSerial or Conector);
 * request/response framing lives here so it is testable.
 *
 * Request: ENQ (0x05). Response: STX (0x02) + 5–6 ASCII digits with the weight in grams + ETX (0x03).
 * Special payloads: "IIIII" unstable, "NNNNN" negative, "SSSSS" overload.
 */
export const SCALE_REQUEST = Uint8Array.from([0x05]);

export type ScaleParse =
  { status: 'ok'; grams: number } | { status: 'unstable' | 'negative' | 'overload' | 'invalid' };

export function parseScaleResponse(bytes: Uint8Array): ScaleParse {
  const stx = bytes.indexOf(0x02);
  const etx = bytes.indexOf(0x03, stx + 1);
  if (stx < 0 || etx < 0) return { status: 'invalid' };
  const payload = String.fromCharCode(...bytes.slice(stx + 1, etx)).trim();
  if (/^I+$/.test(payload)) return { status: 'unstable' };
  if (/^N+$/.test(payload)) return { status: 'negative' };
  if (/^S+$/.test(payload)) return { status: 'overload' };
  if (!/^\d{5,6}$/.test(payload)) return { status: 'invalid' };
  return { status: 'ok', grams: Number(payload) };
}

export const SCALE_MESSAGES: Record<Exclude<ScaleParse['status'], 'ok'>, string> = {
  unstable: 'A balança ainda está estabilizando. Espere um instante.',
  negative: 'A balança está com peso negativo. Tire tudo do prato e zere a balança.',
  overload: 'Peso acima da capacidade da balança.',
  invalid:
    'Não entendemos a resposta da balança. Confira o cabo e a configuração (velocidade e protocolo).',
};
