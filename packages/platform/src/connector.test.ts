import { describe, expect, it } from 'vitest';
import {
  ConnectorClient,
  ConnectorCore,
  fromBase64,
  isAllowedOrigin,
  parseDeviceConfig,
  randomPairingCode,
  toBase64,
  type ConnectorDevices,
  type ConnectorRequest,
  type ConnectorSocket,
} from './index';
import { MemoryPreferences } from './simulators';

/** Simulated hardware behind the Conector (Adendo 01 §8: printer and scale simulated). */
function simulatedDevices() {
  const state = { printed: [] as Uint8Array[], drawer: 0, grams: 1250, stable: true };
  const devices: ConnectorDevices = {
    print: async (bytes) => void state.printed.push(bytes),
    openDrawer: async () => void state.drawer++,
    readScale: async () => {
      if (!state.stable) throw new Error('A balança ainda está estabilizando. Espere um instante.');
      return state.grams;
    },
    listPorts: async () => ['COM3', 'COM4'],
  };
  return { state, devices };
}

/** In-memory socket wired to a ConnectorCore, as the Rust server would be. */
function socketTo(core: ConnectorCore) {
  return async (): Promise<ConnectorSocket> => {
    const session = { authed: false };
    const socket: ConnectorSocket = {
      onmessage: null,
      onclose: null,
      send: (data) => {
        void core.handle(session, JSON.parse(data) as ConnectorRequest).then((r) =>
          socket.onmessage?.({ data: JSON.stringify(r) }),
        );
      },
      close: () => socket.onclose?.(),
    };
    return socket;
  };
}

describe('Bipaê Conector', () => {
  it('only accepts official origins (dev origins only in dev builds)', () => {
    expect(isAllowedOrigin('https://app.bipae.com.br', false)).toBe(true);
    expect(isAllowedOrigin('https://homolog.bipae.com.br', false)).toBe(true);
    expect(isAllowedOrigin('https://evil.example', false)).toBe(false);
    expect(isAllowedOrigin('http://localhost:5173', false)).toBe(false);
    expect(isAllowedOrigin('http://localhost:5173', true)).toBe(true);
    expect(isAllowedOrigin(undefined, true)).toBe(false);
  });

  it('pairs with the code, then prints, opens the drawer and reads the scale', async () => {
    const { state, devices } = simulatedDevices();
    const core = new ConnectorCore('123456', devices);
    const prefs = new MemoryPreferences();
    const client = new ConnectorClient(prefs, socketTo(core));

    expect(await client.isPaired()).toBe(false);
    await expect(client.print({ kind: 'escpos', data: Uint8Array.from([1]) })).rejects.toMatchObject({ code: 'unpaired' });
    await expect(client.pair('000000', 'Chrome')).rejects.toMatchObject({ code: 'bad_code' });
    await client.pair('123456', 'Chrome');
    expect(await client.isPaired()).toBe(true);

    await client.print({ kind: 'escpos', data: Uint8Array.from([0x1b, 0x40, 0xe7]) });
    await client.open();
    expect(await client.read()).toEqual({ grams: 1250, stable: true });
    expect(await client.listPorts()).toEqual(['COM3', 'COM4']);
    expect(Array.from(state.printed[0]!)).toEqual([0x1b, 0x40, 0xe7]);
    expect(state.drawer).toBe(1);

    state.stable = false;
    await expect(client.read()).rejects.toThrow('estabilizando');
    await expect(client.print({ kind: 'text', data: ['x'] })).rejects.toThrow('ESC/POS');
  });

  it('a new connection re-authenticates with the stored token; revoked tokens must pair again', async () => {
    const { devices } = simulatedDevices();
    const core = new ConnectorCore('654321', devices);
    const prefs = new MemoryPreferences();
    await new ConnectorClient(prefs, socketTo(core)).pair('654321', 'Edge');

    const later = new ConnectorClient(prefs, socketTo(core));
    await later.open();

    core.revoke([...core.tokens.keys()][0]!);
    const afterRevoke = new ConnectorClient(prefs, socketTo(core));
    await expect(afterRevoke.open()).rejects.toMatchObject({ code: 'unpaired' });
    expect(await afterRevoke.isPaired()).toBe(false);
  });

  it('locks pairing after 5 wrong codes until a new code is generated', async () => {
    const core = new ConnectorCore('111111', simulatedDevices().devices);
    const session = { authed: false };
    for (let i = 0; i < 5; i++) {
      expect((await core.handle(session, { id: i, type: 'pair', code: '999999', clientName: 'x' })).ok).toBe(false);
    }
    const locked = await core.handle(session, { id: 9, type: 'pair', code: '111111', clientName: 'x' });
    expect(locked).toMatchObject({ ok: false, code: 'locked' });
    core.regenerateCode('222222');
    expect((await core.handle(session, { id: 10, type: 'pair', code: '222222', clientName: 'x' })).ok).toBe(true);
  });

  it('rejects unknown commands and reports a dropped connection', async () => {
    const core = new ConnectorCore('1', simulatedDevices().devices);
    const session = { authed: true };
    const response = await core.handle(session, { id: 1, type: 'shell' } as unknown as ConnectorRequest);
    expect(response).toMatchObject({ ok: false, code: 'unknown_command' });

    const prefs = new MemoryPreferences();
    await prefs.set('bipae.connectorToken', 't');
    let captured: ConnectorSocket | null = null;
    const client = new ConnectorClient(prefs, async () => {
      captured = { onmessage: null, onclose: null, send: () => {}, close: () => captured!.onclose?.() };
      return captured;
    }, 'ws://x', 50);
    await expect(client.open()).rejects.toMatchObject({ code: 'timeout' });
    await client.unpair();
    expect(await client.isPaired()).toBe(false);
  });

  it('helpers', () => {
    expect(randomPairingCode(() => 0.000042)).toBe('000042');
    expect(Array.from(fromBase64(toBase64(Uint8Array.from([0, 255, 128]))))).toEqual([0, 255, 128]);
    expect(parseDeviceConfig(null)).toEqual({});
    expect(parseDeviceConfig('{oops')).toEqual({});
    expect(parseDeviceConfig('{"scale":{"port":"COM3","baudRate":9600}}').scale?.port).toBe('COM3');
  });
});
