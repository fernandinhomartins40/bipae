import { describe, expect, it } from 'vitest';
import { crc16, normalizePixKey, staticPixPayload } from './pix';

/** F8-08: QR Code estático do Pix, pelo Manual de Padrões para Iniciação do Pix (BCB). */

describe('BR Code estático do Pix', () => {
  it('bate com o exemplo do manual do Banco Central, inclusive o CRC', () => {
    const payload = staticPixPayload({
      key: '123e4567-e12b-12d1-a456-426655440000',
      merchantName: 'Fulano de Tal',
      city: 'BRASILIA',
    });
    expect(payload).toBe(
      '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D',
    );
  });

  it('leva o valor e o identificador da venda, e o CRC confere', () => {
    const payload = staticPixPayload({
      key: 'loja@exemplo.com.br',
      merchantName: 'Mercearia São João',
      city: 'Guarapuava',
      amountCents: 4590,
      txid: 'VENDA-0042',
    });
    expect(payload).toContain('540545.90');
    expect(payload).toContain('5918Mercearia Sao Joao');
    expect(payload).toContain('62130509VENDA0042');
    const body = payload.slice(0, -4);
    expect(payload.slice(-4)).toBe(crc16(body));
  });

  it('corta nome e cidade nos tamanhos do padrão', () => {
    const payload = staticPixPayload({
      key: '+5542999990000',
      merchantName: 'Supermercado Bom Preço da Esquina Ltda',
      city: 'São José dos Pinhais',
    });
    expect(payload).toContain('5925Supermercado Bom Preco da');
    expect(payload).toContain('6015Sao Jose dos Pi');
  });

  it('recusa chave inválida com mensagem clara', () => {
    expect(() =>
      staticPixPayload({ key: 'não é chave', merchantName: 'Loja', city: 'Curitiba' }),
    ).toThrow('Chave Pix inválida');
  });
});

describe('chave Pix', () => {
  it('reconhece CPF, CNPJ, e-mail, celular e chave aleatória', () => {
    expect(normalizePixKey('529.982.247-25')).toEqual({ kind: 'cpf', key: '52998224725' });
    expect(normalizePixKey('11.222.333/0001-81')).toEqual({ kind: 'cnpj', key: '11222333000181' });
    expect(normalizePixKey('Loja@Exemplo.com.br')).toEqual({
      kind: 'email',
      key: 'loja@exemplo.com.br',
    });
    expect(normalizePixKey('+55 (42) 99999-0000')).toEqual({
      kind: 'phone',
      key: '+5542999990000',
    });
    expect(normalizePixKey('(42) 99999-0000')).toEqual({ kind: 'phone', key: '+5542999990000' });
    expect(normalizePixKey('123E4567-E12B-12D1-A456-426655440000')?.kind).toBe('random');
  });

  it('recusa o que não é chave', () => {
    for (const bad of ['', 'abc', '123.456.789-00', '11.111.111/1111-11', '+1 555 0100']) {
      expect(normalizePixKey(bad), bad).toBeNull();
    }
  });
});
