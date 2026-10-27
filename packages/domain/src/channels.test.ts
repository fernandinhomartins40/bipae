import { describe, expect, it } from 'vitest';
import {
  availableChannelActions,
  boletoDueFactor,
  boletoInput,
  boletoMod10,
  channelIntegrationInput,
  channelLinkInput,
  channelRejectInput,
  channelStatusAfter,
  isValidBoletoLine,
  normalizedOrderSchema,
} from './channels';

const pedido = {
  externalId: 'abc-1',
  displayId: '1234',
  createdAt: '2026-10-27T12:00:00-03:00',
  customer: { name: 'Maria' },
  items: [{ sku: 'X1', name: 'Pizza', quantity: 2, unitPriceCents: 2500, totalCents: 5000 }],
  subtotalCents: 5000,
  deliveryFeeCents: 500,
  discountCents: 0,
  totalCents: 5500,
  payment: { method: 'online' as const, prepaid: true },
};

describe('pedidos de canais (F6-05)', () => {
  it('pedido recebido aceita aceitar e recusar; pedido fechado não aceita nada', () => {
    const acoes = availableChannelActions('received');
    expect(acoes).toContain('accept');
    expect(acoes).toContain('reject');
    for (const a of acoes) expect(channelStatusAfter('received', a)).not.toBeNull();
    for (const status of ['concluded', 'cancelled', 'rejected'] as const) {
      expect(availableChannelActions(status)).toEqual([]);
    }
  });

  it('ação fora de hora não muda a situação', () => {
    expect(channelStatusAfter('received', 'dispatch')).toBeNull();
    expect(channelStatusAfter('concluded', 'accept')).toBeNull();
  });

  it('o pedido normalizado confere itens, taxa e desconto com o total', () => {
    expect(normalizedOrderSchema.safeParse(pedido).success).toBe(true);
    const total = normalizedOrderSchema.safeParse({ ...pedido, totalCents: 5000 });
    expect(total.success).toBe(false);
    const itens = normalizedOrderSchema.safeParse({
      ...pedido,
      subtotalCents: 4000,
      totalCents: 4500,
    });
    expect(itens.success).toBe(false);
  });

  it('cadastro da integração tem padrões e exige loja', () => {
    const ok = channelIntegrationInput.parse({
      provider: 'ifood',
      name: 'iFood centro',
      storeId: '0197f0e0-0000-7000-8000-000000000001',
    });
    expect(ok.autoAccept).toBe(false);
    expect(ok.settlementDays).toBe(30);
    expect(ok.commissionBps).toBe(0);
    expect(channelIntegrationInput.safeParse({ provider: 'ifood', name: 'x' }).success).toBe(false);
  });

  it('ligação de produto e recusa pedem os campos certos', () => {
    expect(channelLinkInput.safeParse({ sku: 'X1', productId: 'nao-e-uuid' }).success).toBe(false);
    expect(channelRejectInput.safeParse({ reason: 'ok' }).success).toBe(false);
    expect(channelRejectInput.safeParse({ reason: 'Sem estoque' }).success).toBe(true);
  });
});

describe('boletos (F4-15)', () => {
  it('pede valor mínimo de R$ 5,00 e data válida', () => {
    const base = {
      payerName: 'Maria Silva',
      payerTaxId: '12345678909',
      amountCents: 10_000,
      dueDate: '2026-11-10',
      description: 'Mensalidade',
    };
    expect(boletoInput.safeParse(base).success).toBe(true);
    expect(boletoInput.safeParse({ ...base, amountCents: 499 }).success).toBe(false);
    expect(boletoInput.safeParse({ ...base, dueDate: '10/11/2026' }).success).toBe(false);
  });

  it('módulo 10 da linha digitável (exemplo conhecido)', () => {
    // 0019050095 → DV 5 (campo 1 do exemplo da FEBRABAN)
    expect(boletoMod10('001905009')).toBe(5);
  });

  it('confere a linha digitável e recusa tamanho e dígito errados', () => {
    const campo = (base: string) => base + String(boletoMod10(base));
    const completa =
      campo('001905009') + campo('4014481606') + campo('0680935031') + '4' + '10001234500000';
    // 9+1 + 10+1 + 10+1 + 1 + 14 = 47 dígitos
    const d = completa.replace(/\D/g, '');
    expect(d.length).toBe(47);
    expect(isValidBoletoLine(d)).toBe(true);
    const errada = d.slice(0, 9) + String((Number(d[9]) + 1) % 10) + d.slice(10);
    expect(isValidBoletoLine(errada)).toBe(false);
    expect(isValidBoletoLine('123')).toBe(false);
  });

  it('fator de vencimento conta de 07/10/1997 e recomeça em 1000 depois de 9999', () => {
    expect(boletoDueFactor('1997-10-07')).toBe(0);
    expect(boletoDueFactor('2000-07-03')).toBe(1000);
    expect(boletoDueFactor('2025-02-21')).toBe(9999);
    expect(boletoDueFactor('2025-02-22')).toBe(1000);
  });
});
