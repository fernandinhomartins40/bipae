-- Avisos por e-mail da conta (P-04.d): teste terminando e conta suspensa, uma vez cada. A data do
-- envio fica na conta para o aviso não repetir; o de suspensão vale para cada suspensão.
alter table tenants add column trial_notice_sent_at timestamptz;
alter table tenants add column suspension_notice_sent_at timestamptz;
