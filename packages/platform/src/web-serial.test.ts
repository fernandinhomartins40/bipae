import { describe, expect, it } from 'vitest';
import type { PreferencesPort } from './ports';
import { WEB_SERIAL_SCALE_KEY, WebSerialScale, type SerialPortLike } from './web-serial';

/** F2-06: balança pela Web Serial, com uma porta simulada. */

function memoryPrefs(): PreferencesPort {
  const map = new Map<string, string>();
  return {
    get: async (k) => map.get(k) ?? null,
    set: async (k, v) => void map.set(k, v),
    remove: async (k) => void map.delete(k),
  };
}

/** Porta que responde STX + "01250" + ETX em dois pedaços, ou nunca responde. */
function fakePort(reply: number[][] | null) {
  const written: number[] = [];
  const state = { opened: 0, closed: 0 };
  const port: SerialPortLike = {
    open: async () => void state.opened++,
    close: async () => void state.closed++,
    writable: new WritableStream<Uint8Array>({ write: (c) => void written.push(...c) }),
    readable: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of reply ?? []) controller.enqueue(Uint8Array.from(chunk));
      },
    }),
  };
  return { port, written, state };
}

const options = (port: SerialPortLike | null) => ({
  request: Uint8Array.from([0x05]),
  complete: (b: Uint8Array) => b.includes(0x03),
  parse: (b: Uint8Array) => ({
    grams: Number(String.fromCharCode(...b.slice(1, -1))),
    stable: true,
  }),
  timeoutMs: 50,
  serial: port
    ? { getPorts: async () => [port], requestPort: async () => port }
    : { getPorts: async () => [], requestPort: async () => Promise.reject(new Error('cancelado')) },
});

describe('balança pela Web Serial (F2-06)', () => {
  it('pede o peso, junta a resposta em pedaços e fecha a porta', async () => {
    const { port, written, state } = fakePort([
      [0x02, 0x30, 0x31],
      [0x32, 0x35, 0x30, 0x03],
    ]);
    const prefs = memoryPrefs();
    const scale = new WebSerialScale(prefs, options(port));
    expect(scale.supported).toBe(true);
    expect(await scale.isPaired()).toBe(false);
    await expect(scale.read()).rejects.toThrow('Escolha a porta da balança');
    await scale.pair(9600);
    expect(JSON.parse((await prefs.get(WEB_SERIAL_SCALE_KEY))!)).toEqual({ baudRate: 9600 });
    expect(await scale.isPaired()).toBe(true);
    expect(await scale.read()).toEqual({ grams: 1250, stable: true });
    expect(written).toEqual([0x05]);
    expect(state).toEqual({ opened: 1, closed: 1 });
    await scale.forget();
    expect(await scale.isPaired()).toBe(false);
  });

  it('balança que não responde vira mensagem clara; navegador sem serial também', async () => {
    const { port, state } = fakePort(null);
    const prefs = memoryPrefs();
    const scale = new WebSerialScale(prefs, options(port));
    await scale.pair(4800);
    await expect(scale.read()).rejects.toThrow('A balança não respondeu');
    expect(state.closed).toBe(1);
    const semSerial = new WebSerialScale(memoryPrefs(), { ...options(port), serial: null });
    expect(semSerial.supported).toBe(false);
    expect(await semSerial.isPaired()).toBe(false);
    await expect(semSerial.pair(9600)).rejects.toThrow('Use o Chrome ou o Edge');
  });
});

describe('balança pela Web Serial: casos de borda', () => {
  it('preferência corrompida conta como não configurada; leitura que acaba sem fim de mensagem vai para o protocolo', async () => {
    const prefs = memoryPrefs();
    await prefs.set(WEB_SERIAL_SCALE_KEY, '{quebrado');
    const closing: SerialPortLike = {
      open: async () => undefined,
      close: async () => undefined,
      writable: new WritableStream<Uint8Array>(),
      readable: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(Uint8Array.from([0x02, 0x31]));
          controller.close();
        },
      }),
    };
    const scale = new WebSerialScale(prefs, {
      ...options(closing),
      parse: (b) => {
        if (!b.includes(0x03)) throw new Error('Resposta incompleta da balança.');
        return { grams: 0, stable: true };
      },
    });
    expect(await scale.isPaired()).toBe(false);
    await prefs.set(WEB_SERIAL_SCALE_KEY, JSON.stringify({ baudRate: 'x' }));
    expect(await scale.isPaired()).toBe(false);
    await prefs.set(WEB_SERIAL_SCALE_KEY, JSON.stringify({ baudRate: 9600 }));
    await expect(scale.read()).rejects.toThrow('Resposta incompleta da balança.');
  });
});

describe('mensagem da balança no navegador (F2-06)', () => {
  it('sem Conector, a explicação lembra que dá para usar a Web Serial', async () => {
    const { explainCapability } = await import('./capabilities');
    const msg = explainCapability('scale', { available: false, reason: 'needs-connector' }, 'web');
    expect(msg?.message).toContain('escolher a porta da balança');
    const drawer = explainCapability(
      'cashDrawer',
      { available: false, reason: 'needs-connector' },
      'web',
    );
    expect(drawer?.message).not.toContain('balança');
  });
});
