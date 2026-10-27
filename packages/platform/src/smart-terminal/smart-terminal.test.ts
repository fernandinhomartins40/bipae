import { describe, expect, it } from 'vitest';
import {
  BridgeTefDriver,
  createSmartTerminalTef,
  missingFields,
  missingSmartTerminalBridge,
  SMART_ACQUIRER_IDS,
  SMART_ACQUIRERS,
  SimulatedSmartTerminalBridge,
  smartTerminalMissing,
  type TefUi,
} from '../index';

const screen: TefUi = {
  show: () => undefined,
  menu: async (step) => step.options[0]!.value,
  input: async () => '1',
  confirm: async () => true,
};

const PAGBANK = { acquirer: 'pagbank', values: { activationCode: '403938' } } as const;
const MSITEF = {
  acquirer: 'msitef',
  values: { host: 'h', storeCode: '1', terminalId: '2' },
} as const;

describe('maquininhas no Android pelo plugin Kotlin (F8-12)', () => {
  it('cada adquirente diz o que precisa, sem fingir que funciona', () => {
    expect(SMART_ACQUIRER_IDS).toEqual(['pagbank', 'stone', 'cielo', 'getnet', 'msitef', 'paygo']);
    for (const id of SMART_ACQUIRER_IDS) {
      const info = SMART_ACQUIRERS[id];
      expect(info.id).toBe(id);
      expect(info.needs.length).toBeGreaterThan(0);
      expect(info.fields.length).toBeGreaterThan(0);
    }
  });

  it('lista o que falta: campos, SDK e aparelho', () => {
    expect(missingFields({ acquirer: 'none' })).toEqual([]);
    expect(
      missingFields({ acquirer: 'msitef', values: { host: '10.0.0.1', storeCode: ' ' } }),
    ).toEqual(['Código da loja no SiTef', 'Número do terminal no SiTef']);
    expect(smartTerminalMissing(undefined, null)).toEqual([]);
    expect(smartTerminalMissing({ acquirer: 'none' }, null)).toEqual([]);
    expect(smartTerminalMissing(PAGBANK, null)).toEqual([
      'SDK PlugPagServiceWrapper (PagSeguro) dentro do app',
    ]);
    expect(
      smartTerminalMissing(PAGBANK, { sdkPresent: true, secretsStored: true, deviceReady: false }),
    ).toEqual(['Maquininha smart da adquirente']);
    expect(smartTerminalMissing(MSITEF, { sdkPresent: true, deviceReady: false })).toEqual([
      'Pinpad pareado',
    ]);
    expect(
      smartTerminalMissing(PAGBANK, { sdkPresent: true, secretsStored: true, deviceReady: true }),
    ).toEqual([]);
  });

  it('aprova pela maquininha simulada e só fecha na segunda fase', async () => {
    const bridge = new SimulatedSmartTerminalBridge();
    const port = createSmartTerminalTef(bridge, screen, PAGBANK)!;
    const result = await port.pay({ amountCents: 1000, method: 'credit', saleId: 's1' });
    expect(result.approved).toBe(true);
    expect(result.acquirer).toBe('Simulador pagbank');
    expect(result.receipts?.customer).toContain('VIA CLIENTE');
    expect(bridge.configured).toEqual([{ acquirer: 'pagbank', values: PAGBANK.values }]);
    await port.finish!(result.transactionId!, true);
    expect(bridge.finished).toEqual([{ transactionId: result.transactionId, confirmed: true }]);
  });

  it('nega no centavo 13 e avisa maquininha fora do ar no 99', async () => {
    const port = createSmartTerminalTef(new SimulatedSmartTerminalBridge(), screen, PAGBANK)!;
    const denied = await port.pay({ amountCents: 1013, method: 'debit', saleId: 's2' });
    expect(denied.approved).toBe(false);
    expect(denied.message).toContain('negada');
    const down = await port.pay({ amountCents: 1099, method: 'debit', saleId: 's3' });
    expect(down.approved).toBe(false);
    expect(down.message).toContain('não respondeu');
  });

  it('cancela pelo plugin e desiste sem deixar sessão aberta', async () => {
    const bridge = new SimulatedSmartTerminalBridge();
    const port = createSmartTerminalTef(bridge, screen, PAGBANK)!;
    expect((await port.cancel('000001')).approved).toBe(false);
    const ok = await port.cancel('000001', { amountCents: 500, originalDate: '2026-10-27' });
    expect(ok.approved).toBe(true);
    const driver = new BridgeTefDriver(bridge, 'pagbank', PAGBANK.values);
    const session = await driver.begin({
      kind: 'sale',
      amountCents: 100,
      method: 'pix',
      saleId: 'x',
    });
    await session.abort();
    expect(await session.next()).toMatchObject({ kind: 'done' });
  });

  it('sem adquirente escolhida não há porta de TEF', () => {
    const bridge = new SimulatedSmartTerminalBridge();
    expect(createSmartTerminalTef(bridge, screen, undefined)).toBeUndefined();
    expect(createSmartTerminalTef(bridge, screen, { acquirer: 'none' })).toBeUndefined();
  });

  it('transforma configuração faltando, SDK ausente e aparelho fora em resposta negada em português', async () => {
    const pay = (port: ReturnType<typeof createSmartTerminalTef>) =>
      port!.pay({ amountCents: 1000, method: 'credit', saleId: 's' });
    const ok = new SimulatedSmartTerminalBridge();
    expect(
      (await pay(createSmartTerminalTef(ok, screen, { acquirer: 'stone' }))).message,
    ).toContain('Falta configurar Stone');
    expect(
      (await pay(createSmartTerminalTef(missingSmartTerminalBridge, screen, PAGBANK))).message,
    ).toBe('Este app ainda não traz o plugin das maquininhas.');
    const semSdk = new SimulatedSmartTerminalBridge({ sdkPresent: false });
    expect((await pay(createSmartTerminalTef(semSdk, screen, PAGBANK))).message).toContain(
      'SDK de PagBank',
    );
    const fora = new SimulatedSmartTerminalBridge({ deviceReady: false });
    expect((await pay(createSmartTerminalTef(fora, screen, PAGBANK))).message).toBe(
      'Este aparelho não é a maquininha.',
    );
    expect((await pay(createSmartTerminalTef(fora, screen, MSITEF))).message).toBe(
      'Nenhum pinpad pareado.',
    );
    const comNota = new SimulatedSmartTerminalBridge({
      deviceReady: false,
      note: 'Pinpad sem bateria.',
    });
    expect((await pay(createSmartTerminalTef(comNota, screen, MSITEF))).message).toBe(
      'Pinpad sem bateria.',
    );
  });

  it('segredo da adquirente fica no plugin: sem ele guardado, falta configurar', async () => {
    expect(smartTerminalMissing(PAGBANK, { sdkPresent: true, deviceReady: true })).toEqual([
      'Código de ativação do PagBank',
    ]);
    const semSegredo = new SimulatedSmartTerminalBridge({ secretsStored: false });
    const port = createSmartTerminalTef(semSegredo, screen, { acquirer: 'pagbank' })!;
    const result = await port.pay({ amountCents: 1000, method: 'credit', saleId: 's' });
    expect(result.message).toBe(
      'Falta configurar PagBank (PlugPag): Código de ativação do PagBank.',
    );
  });

  it('recusa forma de pagamento que o SDK não atende', async () => {
    const port = createSmartTerminalTef(new SimulatedSmartTerminalBridge(), screen, {
      acquirer: 'getnet',
      values: { merchantId: '1' },
    })!;
    const result = await port.pay({ amountCents: 1000, method: 'pix', saleId: 's' });
    expect(result.message).toBe('Getnet (Smart) não faz essa forma de pagamento.');
  });

  it('a ponte ausente responde sem quebrar', async () => {
    expect(await missingSmartTerminalBridge.status('stone')).toMatchObject({ sdkPresent: false });
    await missingSmartTerminalBridge.configure('stone', {});
    await missingSmartTerminalBridge.abort('x');
    await missingSmartTerminalBridge.finish('stone', 't', false);
    await expect(missingSmartTerminalBridge.next('x')).rejects.toThrow('Não há operação aberta.');
    await expect(
      missingSmartTerminalBridge.begin('stone', {
        kind: 'sale',
        amountCents: 1,
        method: 'credit',
        saleId: 's',
      }),
    ).rejects.toThrow('plugin');
  });
});
