import { uuidv7 } from '@bipae/domain';
import { createStorage } from '@bipae/local-db';
import { nodeSqliteDriver } from '@bipae/local-db/node';
import { beforeEach, describe, expect, it } from 'vitest';
import { OrderDevice, type QueuedOrder, type SendResult } from './order-device';

/** F8-04: o celular do vendedor monta e guarda pedidos sem internet. */

let device: OrderDevice;
const STORE = uuidv7();
const camisa = { id: uuidv7(), name: 'Camisa Pólo Azul', priceCents: 8990, barcodes: ['78900011'] };
const calca = { id: uuidv7(), name: 'Calça Jeans', priceCents: 15_990, barcodes: [] };

beforeEach(async () => {
  device = await OrderDevice.open(createStorage(nodeSqliteDriver()));
  await device.replaceCatalog([camisa, calca], new Date('2026-10-20T12:00:00Z'));
});

const pedido = (label: string) => ({
  storeId: STORE,
  label,
  items: [{ productId: camisa.id, quantityMilli: 1000, name: camisa.name }],
});

describe('aparelho de vendas (F8-04)', () => {
  it('acha produto sem internet pelo nome sem acento ou pelo código', async () => {
    expect((await device.search('polo azul')).map((p) => p.name)).toEqual(['Camisa Pólo Azul']);
    expect((await device.search('78900011'))[0]?.id).toBe(camisa.id);
    expect(await device.search('sapato')).toEqual([]);
    expect(await device.catalogAt()).toBe('2026-10-20T12:00:00.000Z');
    await device.replaceCatalog([calca]);
    expect(await device.search('camisa')).toEqual([]);
  });

  it('sem rede o pedido fica na fila, em ordem, e sai uma vez quando a rede volta', async () => {
    const a = await device.enqueue(pedido('Maria'));
    const b = await device.enqueue(pedido('Mesa 4'));
    expect(a.id).not.toBe(b.id);
    const tries: string[] = [];
    let online = false;
    const send = async (o: QueuedOrder): Promise<SendResult> => {
      tries.push(o.label);
      return online ? { ok: true } : { ok: false, retry: true };
    };
    expect(await device.flush(send)).toEqual({ sent: 0 });
    // Sem rede, nem tenta o segundo: a ordem dos pedidos se mantém.
    expect(tries).toEqual(['Maria']);
    expect((await device.queued()).map((o) => o.label)).toEqual(['Maria', 'Mesa 4']);

    online = true;
    expect(await device.flush(send)).toEqual({ sent: 2 });
    expect(await device.queued()).toEqual([]);
    expect(await device.flush(send)).toEqual({ sent: 0 });
  });

  it('recusado de vez fica marcado com o motivo e não trava a fila', async () => {
    const ruim = await device.enqueue(pedido('Maria'));
    await device.enqueue(pedido('Mesa 4'));
    const send = async (o: QueuedOrder): Promise<SendResult> =>
      o.id === ruim.id ? { ok: false, error: 'Um dos produtos está inativo.' } : { ok: true };
    expect(await device.flush(send)).toEqual({ sent: 1 });
    const [falhou] = await device.queued();
    expect(falhou).toMatchObject({ status: 'failed', error: 'Um dos produtos está inativo.' });
    await device.discard(falhou!.id);
    expect(await device.queued()).toEqual([]);
  });
});
