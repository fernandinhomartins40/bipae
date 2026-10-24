-- Escolhas da empresa na carga líquida do Ceará (F3-26.d.CE.e, dúvida D-042), onde o texto dos
-- decretos deixa margem: a leitura da margem na transferência ("a base definida no caput, acrescida
-- de X%"), a carga opcional da cerâmica (Decreto 31.270, art. 2º-A) e o centro de distribuição do
-- RET dos farmacêuticos (Decreto 36.617, art. 7º). Vazio quer dizer "não escolheu": o cálculo volta
-- como "falta configurar". A tabela já tem RLS e grants; só ganha a coluna.
alter table companies
  add column st_net_load_options jsonb not null default '{}'::jsonb;
