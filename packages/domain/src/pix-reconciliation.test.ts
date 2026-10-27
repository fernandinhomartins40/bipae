import { describe, expect, it } from 'vitest';
import { parseOfx } from './ofx';
import {
  buildSimulatedPixStatement,
  decidePixMatch,
  extractEndToEndId,
  isPixMemo,
  memoMentionsName,
  PIX_MATCH_LABELS,
} from './pix-reconciliation';

const E2E = 'E00000000202610271200abcdefghij1';

describe('conciliação automática do Pix (F6-02)', () => {
  it('acha o código fim a fim e reconhece histórico de Pix', () => {
    expect(extractEndToEndId(`PIX RECEBIDO MARIA ${E2E}`)).toBe(E2E);
    expect(extractEndToEndId('PIX RECEBIDO MARIA')).toBeNull();
    expect(isPixMemo('Pix recebido')).toBe(true);
    expect(isPixMemo(`TRANSF ${E2E}`)).toBe(true);
    expect(isPixMemo('TED RECEBIDA')).toBe(false);
    expect(isPixMemo('PIXEL LOJA')).toBe(false);
  });

  it('o nome só vale com as palavras significativas, sem acento nem caixa', () => {
    expect(memoMentionsName('PIX RECEBIDO JOAO DA SILVA', 'João da Silva')).toBe(true);
    expect(memoMentionsName('PIX RECEBIDO JOAO PEREIRA', 'João da Silva')).toBe(false);
    expect(memoMentionsName('PIX RECEBIDO ME', 'ME')).toBe(false);
    expect(memoMentionsName('PIX RECEBIDO', null)).toBe(false);
    expect(memoMentionsName('PIX', 'DE DA')).toBe(false);
  });

  const receivables = [
    { id: 'a', amountCents: 10_000, dueDate: '2026-10-27', partyName: 'João da Silva' },
    { id: 'b', amountCents: 10_000, dueDate: '2026-10-28', partyName: 'Maria Souza' },
    { id: 'c', amountCents: 10_000, dueDate: '2026-12-31', partyName: 'Carlos Lima' },
    { id: 'd', amountCents: 5_000, dueDate: '2026-10-27', partyName: null },
  ];
  const line = (memo: string, amountCents = 10_000) => ({
    amountCents,
    postedOn: '2026-10-27',
    memo,
  });

  it('cobrança paga com o mesmo código fim a fim concilia na hora', () => {
    const charges = [{ id: 'ch1', endToEndId: E2E, entryId: 'a' }];
    expect(decidePixMatch(line(`PIX RECEBIDO X ${E2E}`), charges, receivables, 10)).toEqual({
      kind: 'charge',
      chargeId: 'ch1',
      entryId: 'a',
      reason: 'end_to_end',
    });
  });

  it('conta a receber: só com o nome do pagador apontando uma conta', () => {
    expect(decidePixMatch(line('PIX RECEBIDO JOAO SILVA'), [], receivables, 10)).toEqual({
      kind: 'entry',
      entryId: 'a',
      reason: 'name',
    });
    // Valor igual, mas sem nome: não concilia sozinho.
    expect(decidePixMatch(line('PIX RECEBIDO FULANO'), [], receivables, 10)).toEqual({
      kind: 'none',
      reason: 'no_name_evidence',
    });
    // Dois clientes com o mesmo nome no histórico: ambíguo.
    const twins = [
      { id: 'x', amountCents: 10_000, dueDate: '2026-10-27', partyName: 'Ana Costa' },
      { id: 'y', amountCents: 10_000, dueDate: '2026-10-27', partyName: 'Ana Costa' },
    ];
    expect(decidePixMatch(line('PIX ANA COSTA'), [], twins, 10)).toEqual({
      kind: 'none',
      reason: 'ambiguous',
    });
    // Fora da janela de vencimento: Carlos (31/12) não é candidato.
    expect(decidePixMatch(line('PIX CARLOS LIMA'), [], receivables, 10)).toEqual({
      kind: 'none',
      reason: 'no_name_evidence',
    });
    expect(decidePixMatch(line('PIX CARLOS LIMA'), [], [receivables[2]!], 10)).toEqual({
      kind: 'none',
      reason: 'no_candidate',
    });
    // Código fim a fim desconhecido cai nas regras de valor e nome.
    expect(
      decidePixMatch(
        line(`PIX JOAO SILVA ${E2E}`),
        [{ id: 'z', endToEndId: 'outro', entryId: null }],
        receivables,
        10,
      ),
    ).toMatchObject({ kind: 'entry', entryId: 'a' });
  });

  it('saída, lançamento que não é Pix e valor sem conta ficam pendentes', () => {
    expect(decidePixMatch(line('PIX ENVIADO', -10_000), [], receivables, 10)).toEqual({
      kind: 'none',
      reason: 'not_credit',
    });
    expect(decidePixMatch(line('TED RECEBIDA JOAO SILVA'), [], receivables, 10)).toEqual({
      kind: 'none',
      reason: 'not_pix',
    });
    expect(decidePixMatch(line('PIX JOAO SILVA', 777), [], receivables, 10)).toEqual({
      kind: 'none',
      reason: 'no_candidate',
    });
    expect(PIX_MATCH_LABELS.name).toContain('nome');
  });

  it('o simulador gera um OFX que o leitor entende', () => {
    const ofx = buildSimulatedPixStatement([
      {
        fitId: 'S1',
        postedOn: '2026-10-27',
        amountCents: 10_005,
        payer: 'JOAO SILVA',
        endToEndId: E2E,
      },
      { fitId: 'S2', postedOn: '2026-10-28', amountCents: 500, payer: 'MARIA' },
    ]);
    const statement = parseOfx(ofx);
    expect(statement.transactions).toEqual([
      expect.objectContaining({
        fitId: 'S1',
        amountCents: 10_005,
        memo: `PIX RECEBIDO JOAO SILVA ${E2E}`,
      }),
      expect.objectContaining({ fitId: 'S2', amountCents: 500, postedOn: '2026-10-28' }),
    ]);
  });
});
