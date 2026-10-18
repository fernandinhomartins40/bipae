-- Pauta da ST (F3-26.f): o item da pauta da UF (marca e embalagem) ligado ao produto. Na NF-e
-- para essa UF, a base da ST é o valor da pauta × quantidade, no lugar de valor × (1 + MVA).
alter table products add column st_pauta jsonb;
