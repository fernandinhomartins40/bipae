import { describe, expect, it } from 'vitest';
import {
  CliSiTefDriver,
  DriverTefPort,
  MissingCliSiTefLib,
  SITEF_CANCELLED_BY_CUSTOMER,
  SITEF_CANCELLED_BY_OPERATOR,
  SITEF_COMMAND,
  SITEF_CONTINUE,
  SITEF_FIELD,
  type CliSiTefContinue,
  type CliSiTefLib,
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

  it('trata todos os comandos do laço do SiTef (roteiro de biblioteca)', async () => {
    const cmd = (command: number, buffer = '', extra: Partial<CliSiTefContinue> = {}) => ({
      ret: SITEF_CONTINUE,
      command,
      fieldType: 0,
      minLength: 0,
      maxLength: 0,
      buffer,
      ...extra,
    });
    const fim = (ret: number) => ({ ...cmd(0), ret });
    const respostas: string[] = [];
    let abortou = false;
    const roteiro = [
      cmd(SITEF_COMMAND.menuTitle, 'Forma de pagamento'),
      cmd(SITEF_COMMAND.header, 'cabeçalho'),
      cmd(SITEF_COMMAND.clearHeader),
      cmd(SITEF_COMMAND.clearOperator),
      cmd(SITEF_COMMAND.clearCustomer),
      cmd(SITEF_COMMAND.clearBoth),
      cmd(SITEF_COMMAND.clearMenuTitle),
      cmd(SITEF_COMMAND.checkInterrupt),
      cmd(SITEF_COMMAND.messageOperator, 'Para o operador'),
      cmd(SITEF_COMMAND.messageCustomer, 'Para o cliente'),
      cmd(SITEF_COMMAND.pause, 'Aguarde'),
      cmd(SITEF_COMMAND.menu, '1:Crédito;2:Débito;'),
      cmd(SITEF_COMMAND.collectField, 'Número de parcelas', { minLength: 1, maxLength: 2 }),
      cmd(SITEF_COMMAND.collectMoney, 'Valor', { minLength: 1, maxLength: 9 }),
      cmd(SITEF_COMMAND.collectSensitive, 'Código de segurança', { minLength: 3, maxLength: 4 }),
      cmd(SITEF_COMMAND.confirm, 'Confirma?'),
      cmd(SITEF_COMMAND.fieldResult, 'AUT123', { fieldType: SITEF_FIELD.authorizationCode }),
      cmd(SITEF_COMMAND.fieldResult, 'H77', { fieldType: SITEF_FIELD.nsuHost }),
      fim(0),
    ];
    let i = 0;
    const lib: CliSiTefLib = {
      configure: async () => 0,
      start: async () => SITEF_CONTINUE,
      continue: async ({ buffer, abort }) => {
        if (abort) {
          abortou = true;
          return fim(SITEF_CANCELLED_BY_OPERATOR);
        }
        respostas.push(buffer);
        return roteiro[i++]!;
      },
      finish: async () => undefined,
    };
    const driver = new CliSiTefDriver(lib, {
      ...CONFIG,
      modalities: { credit: 3, cancel: 200 },
      extra: '[ParmsClient=1]',
    });
    const vistas: string[] = [];
    const tela: TefUi = {
      show: (step) => void vistas.push(step.text),
      menu: async (step) => step.options[1]!.value,
      input: async (step) => (step.secret ? '123' : step.format === 'money' ? '10,00' : '2'),
      confirm: async () => false,
    };
    const result = await new DriverTefPort(driver, tela).pay({
      amountCents: 1000,
      method: 'credit',
      saleId: 'venda-roteiro',
    });
    expect(result).toMatchObject({ approved: true, authorizationCode: 'AUT123' });
    expect(vistas).toEqual(['Para o operador', 'Para o cliente', 'Aguarde']);
    expect(respostas).toContain('2'); // menu: débito
    expect(respostas).toContain('1'); // confirmação recusada: "1" = não
    expect(abortou).toBe(false);
  });

  it('cancelamento no pinpad, comando desconhecido e passo sem fim viram resultado claro', async () => {
    const base = {
      fieldType: 0,
      minLength: 0,
      maxLength: 0,
      buffer: '',
    };
    const libCom = (
      start: number,
      depois: (n: number) => { ret: number; command: number } & typeof base,
    ): CliSiTefLib & { abortos: number } => {
      let n = 0;
      const l = {
        abortos: 0,
        configure: async () => 0,
        start: async () => start,
        continue: async ({ abort }: { abort: boolean }) => {
          if (abort) {
            l.abortos++;
            return { ...base, ret: SITEF_CANCELLED_BY_OPERATOR, command: 0 };
          }
          return depois(n++);
        },
        finish: async () => undefined,
      };
      return l;
    };
    const pagar = (lib: CliSiTefLib, tela = ui().screen) =>
      new DriverTefPort(new CliSiTefDriver(lib, CONFIG), tela).pay({
        amountCents: 1000,
        method: 'credit',
        saleId: 'v9',
      });

    // O cliente cancela no pinpad.
    const cliente = await pagar(
      libCom(SITEF_CONTINUE, () => ({ ...base, ret: SITEF_CANCELLED_BY_CUSTOMER, command: 0 })),
    );
    expect(cliente.message).toContain('cliente no pinpad');

    // O SiTef recusa já na abertura.
    const abertura = await pagar(
      libCom(SITEF_CANCELLED_BY_OPERATOR, () => ({ ...base, ret: 0, command: 0 })),
    );
    expect(abertura.approved).toBe(false);

    // Comando que o Bipaê não conhece: cancela e avisa.
    const desconhecido = libCom(SITEF_CONTINUE, () => ({
      ...base,
      ret: SITEF_CONTINUE,
      command: 999,
    }));
    expect((await pagar(desconhecido)).message).toContain('ainda não trata (999)');
    expect(desconhecido.abortos).toBe(1);

    // Só comandos silenciosos, para sempre: desiste depois de 500 voltas.
    const mudo = libCom(SITEF_CONTINUE, () => ({
      ...base,
      ret: SITEF_CONTINUE,
      command: SITEF_COMMAND.clearBoth,
    }));
    expect((await pagar(mudo)).message).toContain('não terminou');
    expect(mudo.abortos).toBe(1);

    // Resposta "cancelar" da tela: manda abortar o laço.
    const cancelaNaTela = libCom(SITEF_CONTINUE, () => ({
      ...base,
      ret: SITEF_CONTINUE,
      command: SITEF_COMMAND.menu,
      buffer: '1:Crédito;',
    }));
    const r = await pagar(cancelaNaTela, ui({ menu: null }).screen);
    expect(r.approved).toBe(false);
  });

  it('diz o que falta configurar, sem prometer o que não existe', () => {
    expect(tefMissing(undefined, false)).toEqual([]);
    expect(tefMissing({ provider: 'simulator' }, false)).toEqual([]);
    expect(tefMissing({ provider: 'sitef' }, false)).toHaveLength(4);
    expect(tefMissing({ provider: 'sitef', sitef: CONFIG }, true)).toEqual([]);
    expect(tefMissing({ provider: 'paygo' }, true)[0]).toContain('PayGo');
  });
});
