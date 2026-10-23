-- Avisos (webhooks) do banco e dos parceiros de pagamento (F8-09.c.2, ADR-0018). O aviso só diz
-- "olhe esta cobrança": o Bipaê consulta o banco ou o parceiro antes de dar como paga.
-- webhook_token_sealed: segredo da loja, gerado pelo Bipaê. Vai no endereço da API Pix do banco
--   e no cabeçalho asaas-access-token do Asaas.
-- mp_webhook_secret_sealed: a "assinatura secreta" que o Mercado Pago gera para a loja, usada
--   para conferir o cabeçalho x-signature.
-- Os dois ficam selados (SecretBox) e fora da exportação de dados (*_sealed).
alter table payment_settings
  add column webhook_token_sealed text,
  add column mp_webhook_secret_sealed text;
