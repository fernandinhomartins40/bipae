import { describe, expect, it } from 'vitest';
import { paymentSettingsInput, PAYMENT_PROVIDERS, PIX_PSP_INFO } from './payments';

/** Caminhos dos problemas da validação, para conferir o campo que a tela destaca. */
const issues = (input: unknown) => {
  const r = paymentSettingsInput.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
};

describe('meios de pagamento da loja (F8-08 a F8-10)', () => {
  it('padrão: cartão e Pix manuais, sem exigir nada', () => {
    expect(paymentSettingsInput.parse({})).toMatchObject({ card: 'manual', pix: 'manual' });
  });

  it('QR estático pede chave válida, nome e cidade', () => {
    expect(issues({ pix: 'static_qr', pixKey: 'não é chave' })).toEqual([
      'pixKey: Chave Pix inválida. Use CPF, CNPJ, e-mail, celular ou a chave aleatória.',
      'pixMerchantName: Informe o nome',
      'pixCity: Informe a cidade',
    ]);
    expect(
      issues({
        pix: 'static_qr',
        pixKey: 'loja@exemplo.com.br',
        pixMerchantName: 'Loja',
        pixCity: 'Curitiba',
      }),
    ).toEqual([]);
  });

  it('API Pix do banco pede os dados da API e a chave da conta', () => {
    expect(issues({ pix: 'api' })).toEqual([
      'pixApi: Informe os dados da API Pix',
      'pixKey: Informe a chave Pix da conta que recebe.',
    ]);
    expect(
      issues({
        pix: 'api',
        pixKey: 'loja@exemplo.com.br',
        pixApi: { baseUrl: 'http://x.example', tokenUrl: 'https://x.example/t', clientId: 'a' },
      }),
    ).toEqual(['pixApi.baseUrl: Use um endereço https://']);
  });

  it('Point do Mercado Pago pede o ID do terminal', () => {
    expect(issues({ card: 'mp_point' })).toEqual([
      'mpPoint.terminalId: Informe o ID do terminal da Point',
    ]);
    expect(
      issues({ card: 'mp_point', mpPoint: { terminalId: 'NEWLAND_N950__SBX0000001' } }),
    ).toEqual([]);
  });
});

describe('Pix pelo parceiro (F8-09.c)', () => {
  it('sem parceiro escolhido', () => {
    expect(issues({ pix: 'psp' })).toEqual(['pixPsp: Escolha o parceiro do Pix']);
  });

  it('Mercado Pago: e-mail do pagador obrigatório; CPF/CNPJ só se informado', () => {
    expect(issues({ pix: 'psp', pixPsp: { provider: 'mercadopago' } })).toEqual([
      'pixPsp.payerEmail: Informe o e-mail do pagador padrão',
    ]);
    expect(
      issues({
        pix: 'psp',
        pixPsp: { provider: 'mercadopago', payerEmail: 'caixa@loja.com.br', payerTaxId: '123' },
      }),
    ).toEqual(['pixPsp.payerTaxId: CPF ou CNPJ inválido']);
    const ok = paymentSettingsInput.parse({
      pix: 'psp',
      pixPsp: { provider: 'mercadopago', payerEmail: 'caixa@loja.com.br' },
    });
    expect(ok.pixPsp).toMatchObject({ environment: 'production' });
  });

  it('PagBank: nome e sobrenome, e-mail e CPF/CNPJ válido', () => {
    expect(
      issues({ pix: 'psp', pixPsp: { provider: 'pagbank', payerName: 'Consumidor' } }),
    ).toEqual([
      'pixPsp.payerEmail: Informe o e-mail do pagador padrão',
      'pixPsp.payerName: Informe nome e sobrenome do pagador padrão',
      'pixPsp.payerTaxId: CPF ou CNPJ inválido',
    ]);
    expect(
      issues({
        pix: 'psp',
        pixPsp: {
          provider: 'pagbank',
          environment: 'sandbox',
          payerName: 'Consumidor Final',
          payerEmail: 'caixa@loja.com.br',
          payerTaxId: '11144477735',
        },
      }),
    ).toEqual([]);
  });

  it('Asaas: só o ID do cliente; chave Pix, se vier, precisa ser válida', () => {
    expect(issues({ pix: 'psp', pixPsp: { provider: 'asaas' } })).toEqual([
      'pixPsp.customerId: Informe o ID do cliente no Asaas, como cus_000005219613',
    ]);
    expect(
      issues({
        pix: 'psp',
        pixKey: 'não é chave',
        pixPsp: { provider: 'asaas', customerId: 'cus_000005219613' },
      }),
    ).toEqual(['pixKey: Chave Pix inválida.']);
  });

  it('os três parceiros ficam "Em homologação" até o teste com conta real (E9)', () => {
    for (const id of ['mercadopago-pix', 'pagbank-pix', 'asaas-pix']) {
      expect(PAYMENT_PROVIDERS.find((p) => p.id === id)?.status, id).toBe('homologation');
    }
    for (const info of Object.values(PIX_PSP_INFO)) {
      expect(info.source).toMatch(/^https:\/\//);
    }
  });
});
