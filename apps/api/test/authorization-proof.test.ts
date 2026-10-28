import { describe, expect, it } from 'vitest';
import { AuthorizationProofs } from '../src/common/authorization-proof';

const proofs = new AuthorizationProofs('segredo-de-teste-com-mais-de-32-caracteres');
const tenant = '01900000-0000-7000-8000-000000000001';
const gerente = '01900000-0000-7000-8000-000000000002';
const outro = '01900000-0000-7000-8000-000000000003';
const agora = new Date('2026-10-28T12:00:00Z');
const min = (n: number) => new Date(agora.getTime() + n * 60_000);

describe('prova da autorização do gerente (PIE ACH-03)', () => {
  const prova = proofs.issue(tenant, gerente, 'pos.sale.cancel', agora);

  it('confere para a mesma empresa, gerente e permissão, perto da hora da ação', () => {
    expect(proofs.verify(tenant, gerente, 'pos.sale.cancel', prova, min(1))).toBe(true);
    expect(proofs.verify(tenant, gerente, 'pos.sale.cancel', prova, min(-4))).toBe(true);
  });

  it('não serve para outro gerente, outra permissão ou outra empresa', () => {
    expect(proofs.verify(tenant, outro, 'pos.sale.cancel', prova, min(1))).toBe(false);
    expect(proofs.verify(tenant, gerente, 'pos.cash.withdrawal', prova, min(1))).toBe(false);
    expect(proofs.verify(outro, gerente, 'pos.sale.cancel', prova, min(1))).toBe(false);
  });

  it('recusa prova velha, do futuro, adulterada ou assinada com outro segredo', () => {
    expect(proofs.verify(tenant, gerente, 'pos.sale.cancel', prova, min(31))).toBe(false);
    expect(proofs.verify(tenant, gerente, 'pos.sale.cancel', prova, min(-6))).toBe(false);
    const [v, emitida, mac] = prova.split('.');
    const outraHora = `${v}.${Number(emitida) + 1}.${mac}`;
    expect(proofs.verify(tenant, gerente, 'pos.sale.cancel', outraHora, min(1))).toBe(false);
    const alheia = new AuthorizationProofs('outro-segredo-com-mais-de-32-caracteres!!');
    const falsa = alheia.issue(tenant, gerente, 'pos.sale.cancel', agora);
    expect(proofs.verify(tenant, gerente, 'pos.sale.cancel', falsa, min(1))).toBe(false);
    expect(proofs.verify(tenant, gerente, 'pos.sale.cancel', null, min(1))).toBe(false);
    expect(proofs.verify(tenant, gerente, 'pos.sale.cancel', 'lixo', min(1))).toBe(false);
  });
});
