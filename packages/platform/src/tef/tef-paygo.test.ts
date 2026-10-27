import { describe, expect, it } from 'vitest';
import {
  ConnectorClient,
  ConnectorCore,
  createTefDriver,
  DriverTefPort,
  loadTefConfig,
  MissingPayGoLib,
  PayGoDriver,
  runTef,
  saveTefConfig,
  SimulatedCliSiTefLib,
  SimulatedPayGoLib,
  tefMissing,
  type ConnectorDevices,
  type ConnectorRequest,
  type ConnectorSocket,
  type TefHost,
  type TefUi,
} from '../index';
import { MemoryPreferences } from '../simulators';

const PAYGO = { automationName: 'Bipae', automationVersion: '1.0', captureTerminal: '1234567' };

function ui(menu: string | null = 'credit'): { screen: TefUi; shown: string[] } {
  const shown: string[] = [];
  return {
    shown,
    screen: {
      show: (step) => void shown.push(step.text),
      menu: async () => menu,
      input: async () => '1234',
      confirm: async () => true,
    },
  };
}

const pay = (amountCents: number, method?: 'credit') =>
  ({
    kind: 'sale' as const,
    amountCents,
    saleId: 'abc',
    ...(method && { method }),
  }) as never;

describe('TEF PayGo pelo protocolo em TypeScript (F8-11)', () => {
  it('aprova no pinpad simulado, devolve recibos e fecha na segunda fase', async () => {
    const lib = new SimulatedPayGoLib();
    const driver = new PayGoDriver(lib, PAYGO);
    const tela = ui();
    const port = new DriverTefPort(driver, tela.screen, 'PayGo');
    const r = await port.pay({ amountCents: 1890, method: 'credit', saleId: 'abc' });
    expect(r).toMatchObject({ approved: true, nsu: '000001', acquirer: 'PayGo (simulador)' });
    expect(r.receipts?.customer[1]).toBe('VIA CLIENTE');
    expect(tela.shown).toContain('Digite a senha no pinpad');
    await port.finish(r.transactionId!, true);
    await port.finish(r.transactionId!, true); // repetir não estraga
    expect(lib.confirmed).toEqual([{ pendingId: 'PG1', confirm: true }]);
  });

  it('desfaz quando a venda não foi gravada', async () => {
    const lib = new SimulatedPayGoLib();
    const port = new DriverTefPort(new PayGoDriver(lib, PAYGO), ui().screen);
    const r = await port.pay({ amountCents: 500, method: 'debit', saleId: 'x' });
    await port.finish(r.transactionId!, false);
    expect(lib.confirmed[0]).toMatchObject({ confirm: false });
  });

  it('pergunta a forma de pagamento quando o caixa não define', async () => {
    const lib = new SimulatedPayGoLib();
    const driver = new PayGoDriver(lib, PAYGO);
    const session = await driver.begin(pay(1000));
    const result = await runTef(session, ui('debit').screen);
    expect(result.approved).toBe(true);
    expect(lib.params.get(1)).toBe('debit');
  });

  it('nega pelo emissor (centavos 13) e não deixa transação pendente', async () => {
    const lib = new SimulatedPayGoLib();
    const port = new DriverTefPort(new PayGoDriver(lib, PAYGO), ui().screen);
    const r = await port.pay({ amountCents: 1013, method: 'credit', saleId: 'x' });
    expect(r.approved).toBe(false);
    expect(r.message).toContain('negada');
    expect(r.transactionId).toBeUndefined();
  });

  it('fora do ar (centavos 99) vira mensagem, não derruba a venda', async () => {
    const port = new DriverTefPort(new PayGoDriver(new SimulatedPayGoLib(), PAYGO), ui().screen);
    const r = await port.pay({ amountCents: 1099, method: 'credit', saleId: 'x' });
    expect(r).toMatchObject({ approved: false });
    expect(r.message).toContain('Sem comunicação');
  });

  it('o operador cancela no menu e a operação é desfeita', async () => {
    const lib = new SimulatedPayGoLib();
    const driver = new PayGoDriver(lib, PAYGO);
    const result = await runTef(await driver.begin(pay(1000)), ui(null).screen);
    expect(result).toMatchObject({ approved: false, message: 'Operação cancelada pelo operador.' });
  });

  it('configuração incompleta, recusada ou sem biblioteca diz "falta configurar"', async () => {
    const vazio = new PayGoDriver(new SimulatedPayGoLib(), { ...PAYGO, captureTerminal: '' });
    await expect(vazio.begin(pay(100))).rejects.toThrow('Falta configurar a PayGo');
    const recusada = new PayGoDriver(new SimulatedPayGoLib({ initReturns: 7 }), PAYGO);
    await expect(recusada.begin(pay(100))).rejects.toThrow('código 7');
    const semLib = new PayGoDriver(new MissingPayGoLib(), PAYGO);
    const r = await new DriverTefPort(semLib, ui().screen).pay({
      amountCents: 100,
      method: 'credit',
      saleId: 'x',
    });
    expect(r.message).toContain('Falta configurar');
    const lib = new MissingPayGoLib();
    expect(() => lib.begin()).toThrow('PGWebLib');
    expect(() => lib.addParam()).toThrow();
    expect(() => lib.exec()).toThrow();
    expect(() => lib.result()).toThrow();
    expect(() => lib.confirm()).toThrow();
    expect(() => lib.abort()).toThrow();
  });

  it('cancelamento de venda anterior leva NSU e data', async () => {
    const lib = new SimulatedPayGoLib();
    const port = new DriverTefPort(new PayGoDriver(lib, PAYGO), ui().screen);
    const r = await port.cancel('000001', { amountCents: 2000, originalDate: '2026-10-26' });
    expect(r.approved).toBe(true);
  });

  it('diz o que falta configurar na PayGo', () => {
    expect(tefMissing({ provider: 'paygo' }, false)).toHaveLength(4);
    expect(tefMissing({ provider: 'paygo', paygo: PAYGO }, true)).toEqual([]);
  });
});

describe('fábrica do driver e configuração guardada', () => {
  it('escolhe o driver pelo provedor', async () => {
    expect(createTefDriver(undefined, {})).toBeNull();
    expect(createTefDriver({ provider: 'none' }, {})).toBeNull();
    expect(createTefDriver({ provider: 'simulator' }, {})?.id).toBe('sitef');
    expect(createTefDriver({ provider: 'sitef' }, {})?.id).toBe('sitef');
    expect(createTefDriver({ provider: 'paygo' }, {})?.id).toBe('paygo');
    const sitef = createTefDriver(
      {
        provider: 'sitef',
        sitef: {
          host: 'h',
          storeCode: '1',
          terminalId: 'T',
          extra: 'x',
          modalities: { credit: 3 },
        },
      },
      { sitef: new SimulatedCliSiTefLib() },
    )!;
    const port = new DriverTefPort(sitef, ui().screen);
    expect((await port.pay({ amountCents: 1000, method: 'credit', saleId: 'v' })).approved).toBe(
      true,
    );
    const comHost = createTefDriver(
      { provider: 'paygo', paygo: { ...PAYGO, host: 'srv' } },
      { paygo: new SimulatedPayGoLib() },
    )!;
    expect(
      (
        await new DriverTefPort(comHost, ui().screen).pay({
          amountCents: 1000,
          method: 'credit',
          saleId: 'v',
        })
      ).approved,
    ).toBe(true);
  });

  it('o simulador roda sem biblioteca nenhuma', async () => {
    const port = new DriverTefPort(createTefDriver({ provider: 'simulator' }, {})!, ui().screen);
    const r = await port.pay({ amountCents: 2500, method: 'credit', saleId: 'v' });
    expect(r.approved).toBe(true);
  });

  it('guarda e lê a configuração, tolerando lixo', async () => {
    const prefs = new MemoryPreferences();
    expect(await loadTefConfig(prefs)).toEqual({ provider: 'none' });
    await saveTefConfig(prefs, { provider: 'paygo', paygo: PAYGO });
    expect((await loadTefConfig(prefs)).provider).toBe('paygo');
    await prefs.set('bipae.tef.config', '{oops');
    expect(await loadTefConfig(prefs)).toEqual({ provider: 'none' });
    await prefs.set('bipae.tef.config', '42');
    expect(await loadTefConfig(prefs)).toEqual({ provider: 'none' });
  });
});

/** O Conector repassa as chamadas às bibliotecas; aqui as bibliotecas são os simuladores. */
function connectorWith(tef?: TefHost) {
  const devices: ConnectorDevices = {
    print: async () => {},
    openDrawer: async () => {},
    readScale: async () => 0,
    listPorts: async () => [],
    ...(tef && { tef }),
  };
  const core = new ConnectorCore('123456', devices);
  const connect = async (): Promise<ConnectorSocket> => {
    const session = { authed: false };
    const socket: ConnectorSocket = {
      onmessage: null,
      onclose: null,
      send: (data) => {
        void core
          .handle(session, JSON.parse(data) as ConnectorRequest)
          .then((r) => socket.onmessage?.({ data: JSON.stringify(r) }));
      },
      close: () => socket.onclose?.(),
    };
    return socket;
  };
  return { core, client: new ConnectorClient(new MemoryPreferences(), connect) };
}

describe('TEF pelo Bipaê Conector (F8-11.b)', () => {
  it('uma venda inteira passa pelo Conector e só repassa chamadas', async () => {
    const sitef = new SimulatedCliSiTefLib();
    const calls: string[] = [];
    const host: TefHost = {
      status: async () => ({ sitef: true, paygo: false }),
      call: async (lib, method, args) => {
        calls.push(`${lib}.${method}`);
        const target = (lib === 'sitef' ? sitef : new SimulatedPayGoLib()) as unknown as Record<
          string,
          (...a: unknown[]) => Promise<unknown>
        >;
        return target[method]!(...(args as unknown[]));
      },
    };
    const { client } = connectorWith(host);
    await client.pair('123456', 'Chrome');
    expect(await client.tefStatus()).toEqual({ sitef: true, paygo: false });
    const driver = createTefDriver(
      { provider: 'sitef', sitef: { host: 'h', storeCode: '1', terminalId: 'T' } },
      client.tefLibs(),
    )!;
    const port = new DriverTefPort(driver, ui().screen);
    const r = await port.pay({ amountCents: 4200, method: 'credit', saleId: 'v1' });
    expect(r).toMatchObject({ approved: true, nsu: '000001' });
    await port.finish(r.transactionId!, true);
    expect(calls[0]).toBe('sitef.configure');
    expect(calls).toContain('sitef.finish');
    expect(sitef.finished).toHaveLength(1);
  });

  it('PayGo pelo Conector também funciona', async () => {
    const paygo = new SimulatedPayGoLib();
    const host: TefHost = {
      status: async () => ({ sitef: false, paygo: true }),
      call: async (_lib, method, args) =>
        (paygo as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[method]!(
          ...(args as unknown[]),
        ),
    };
    const { client } = connectorWith(host);
    await client.pair('123456', 'Chrome');
    const driver = createTefDriver({ provider: 'paygo', paygo: PAYGO }, client.tefLibs())!;
    const r = await new DriverTefPort(driver, ui().screen).pay({
      amountCents: 3000,
      method: 'credit',
      saleId: 'v2',
    });
    expect(r.approved).toBe(true);
  });

  it('sem biblioteca no Conector: "falta configurar", e a venda segue', async () => {
    const { client } = connectorWith();
    await client.pair('123456', 'Chrome');
    expect(await client.tefStatus()).toEqual({ sitef: false, paygo: false });
    const driver = createTefDriver(
      { provider: 'sitef', sitef: { host: 'h', storeCode: '1', terminalId: 'T' } },
      client.tefLibs(),
    )!;
    const r = await new DriverTefPort(driver, ui().screen).pay({
      amountCents: 1000,
      method: 'credit',
      saleId: 'v3',
    });
    expect(r.approved).toBe(false);
    expect(r.message).toContain('Falta instalar a biblioteca');
  });

  it('só aceita chamadas da lista fechada e exige pareamento', async () => {
    const { core } = connectorWith({
      status: async () => ({ sitef: true, paygo: true }),
      call: async () => 1,
    });
    const semPareamento = await core.handle({ authed: false }, { id: 1, type: 'tef-status' });
    expect(semPareamento).toMatchObject({ ok: false, code: 'unpaired' });
    const ruim = await core.handle(
      { authed: true },
      { id: 2, type: 'tef-call', lib: 'sitef', method: 'system', args: [] },
    );
    expect(ruim).toMatchObject({ ok: false, error: 'Chamada de TEF não permitida.' });
    const outra = await core.handle(
      { authed: true },
      { id: 3, type: 'tef-call', lib: 'x' as never, method: 'start', args: [] },
    );
    expect(outra).toMatchObject({ ok: false });
  });

  it('erro de conexão com o Conector vira erro de TEF', async () => {
    const client = new ConnectorClient(new MemoryPreferences(), async () => {
      throw new Error('O Bipaê Conector não está aberto neste computador.');
    });
    const driver = createTefDriver(
      { provider: 'sitef', sitef: { host: 'h', storeCode: '1', terminalId: 'T' } },
      client.tefLibs(),
    )!;
    const r = await new DriverTefPort(driver, ui().screen).pay({
      amountCents: 1000,
      method: 'credit',
      saleId: 'v4',
    });
    expect(r.message).toContain('não está aberto');
  });
});
