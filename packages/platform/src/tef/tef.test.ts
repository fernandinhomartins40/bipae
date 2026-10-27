import { describe, expect, it } from 'vitest';
import {
  CliSiTefDriver,
  DriverTefPort,
  MissingCliSiTefLib,
  parseSitefMenu,
  runTef,
  sitefAmount,
  sitefDateTime,
  SimulatedCliSiTefLib,
  tefMissing,
  type TefStep,
  type TefUi,
} from '../index';

const CONFIG = { host: '127.0.0.1', storeCode: '00000000', terminalId: 'SE000001' };

/** Tela de teste: guarda o que foi mostrado e responde pelo roteiro. */
function ui(script: { menu?: string | null } = {}) {
  const shown: string[] = [];
  const menus: TefStep[] = [];
  const screen: TefUi = {
    show: (step) => void shown.push(step.text),
    menu: async (step) => {
      menus.push(step);
      return script.menu === undefined ? step.options[0]!.value : script.menu;
    },
    input: async () => '123',
    confirm: async () => true,
  };
  return { screen, shown, menus };
}

describe('TEF com pinpad: SiTef pelo protocolo em TypeScript (F8-11)', () => {
  it('formata valor, data e hora e lê o menu do jeito do SiTef', () => {
    expect(sitefAmount(123456)).toBe('1234,56');
    expect(sitefAmount(5)).toBe('0,05');
    expect(sitefDateTime(new Date('2026-10-27T01:30:05Z'))).toEqual({
      date: '20261026',
      time: '223005',
    });
    expect(parseSitefMenu('1:Cartão de crédito;2:Cartão de débito;')).toEqual([
      { value: '1', label: 'Cartão de crédito' },
      { value: '2', label: 'Cartão de débito' },
    ]);
  });

  it('aprova pelo pinpad simulado, devolve recibos e só fecha na segunda fase', async () => {
    const lib = new SimulatedCliSiTefLib();
    const driver = new CliSiTefDriver(lib, CONFIG, () => new Date('2026-10-27T15:00:00Z'));
    const tela = ui();
    const port = new DriverTefPort(driver, tela.screen, 'SiTef');

    const result = await port.pay({ amountCents: 4590, method: 'credit', saleId: 'venda-0001' });
    expect(result).toMatchObject({ approved: true, nsu: '000001', acquirer: 'SiTef' });
    expect(result.authorizationCode).toBe('SIM000001');
    expect(result.receipts?.customer).toContain('VIA CLIENTE');
    expect(result.receipts?.merchant).toContain('VIA ESTABELECIMENTO');
    expect(tela.shown).toContain('Insira, passe ou aproxime o cartão');
    expect(tela.menus).toHaveLength(1);
    expect(lib.menuChoice).toBe('1');

    expect(lib.finished).toEqual([]);
    await port.finish!(result.transactionId!, true);
    await port.finish!(result.transactionId!, true);
    expect(lib.finished).toHaveLength(1);
    expect(lib.finished[0]).toMatchObject({ confirm: true, receipt: 'venda0001' });
  });

  it('desfaz a transação quando a venda não foi gravada', async () => {
    const lib = new SimulatedCliSiTefLib();
    const port = new DriverTefPort(new CliSiTefDriver(lib, CONFIG), ui().screen);
    const result = await port.pay({ amountCents: 1000, method: 'debit', saleId: 'v2' });
    await port.finish!(result.transactionId!, false);
    expect(lib.finished).toEqual([{ confirm: false, receipt: 'v2' }]);
  });

  it('transação negada volta com a mensagem e sem pendência', async () => {
    const port = new DriverTefPort(
      new CliSiTefDriver(new SimulatedCliSiTefLib(), CONFIG),
      ui().screen,
    );
    const result = await port.pay({ amountCents: 1013, method: 'credit', saleId: 'v4' });
    expect(result).toMatchObject({
      approved: false,
      message: 'Transação negada pelo emissor (simulador)',
    });
    expect(result.transactionId).toBeUndefined();
  });

  it('o operador cancela no menu: desiste e nada fica pendente', async () => {
    const lib = new SimulatedCliSiTefLib();
    const result = await new DriverTefPort(
      new CliSiTefDriver(lib, CONFIG),
      ui({ menu: null }).screen,
    ).pay({ amountCents: 1000, method: 'credit', saleId: 'v5' });
    expect(result).toMatchObject({ approved: false, message: 'Operação cancelada pelo operador.' });
    expect(lib.finished).toEqual([]);
  });

  it('SiTef fora do ar e configuração faltando viram mensagem, nunca erro na venda', async () => {
    const pay = (driver: CliSiTefDriver, cents: number) =>
      new DriverTefPort(driver, ui().screen).pay({
        amountCents: cents,
        method: 'debit',
        saleId: 'x',
      });
    const lib = () => new SimulatedCliSiTefLib();
    expect((await pay(new CliSiTefDriver(lib(), CONFIG), 1099)).message).toContain(
      'Sem comunicação com o SiTef',
    );
    expect((await pay(new CliSiTefDriver(lib(), { ...CONFIG, host: '' }), 1000)).message).toContain(
      'Falta configurar o SiTef',
    );
    expect(
      (await pay(new CliSiTefDriver(new MissingCliSiTefLib(), CONFIG), 1000)).message,
    ).toContain('biblioteca do SiTef');
    expect(
      (
        await pay(
          new CliSiTefDriver(new SimulatedCliSiTefLib({ configureReturns: 7 }), CONFIG),
          1000,
        )
      ).message,
    ).toContain('recusou a configuração');
  });

  it('cancela uma venda anterior pelo NSU, com valor e data', async () => {
    const port = new DriverTefPort(
      new CliSiTefDriver(new SimulatedCliSiTefLib(), CONFIG),
      ui().screen,
    );
    expect((await port.cancel('H000001')).message).toContain('valor e a data');
    const r = await port.cancel('H000001', { amountCents: 2500, originalDate: '2026-10-26' });
    expect(r.approved).toBe(true);
  });

  it('um TEF que não para de pedir passos é tratado como defeito', async () => {
    const infinito = {
      next: async (): Promise<TefStep> => ({ kind: 'message', target: 'both', text: '...' }),
      abort: async () => undefined,
    };
    await expect(runTef(infinito, ui().screen)).rejects.toThrow('não terminou');
  });

  it('diz o que falta configurar, sem prometer o que não existe', () => {
    expect(tefMissing(undefined, false)).toEqual([]);
    expect(tefMissing({ provider: 'simulator' }, false)).toEqual([]);
    expect(tefMissing({ provider: 'sitef' }, false)).toHaveLength(4);
    expect(tefMissing({ provider: 'sitef', sitef: CONFIG }, true)).toEqual([]);
    expect(tefMissing({ provider: 'paygo' }, true)[0]).toContain('PayGo');
  });
});
