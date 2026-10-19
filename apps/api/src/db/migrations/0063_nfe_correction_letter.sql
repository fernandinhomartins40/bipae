-- Carta de correção da NF-e (F3-33.g): evento 110110, até 20 por nota, cada uma com o seu número
-- de sequência (nSeqEvento). O cancelamento continua com sequência 1.
alter table fiscal_events drop constraint fiscal_events_type_check;
alter table fiscal_events add constraint fiscal_events_type_check
  check (type in ('110110', '110111', '110112'));
alter table fiscal_events add column sequence integer not null default 1
  check (sequence between 1 and 20);
alter table fiscal_events drop constraint fiscal_events_tenant_id_document_id_type_key;
alter table fiscal_events add constraint fiscal_events_tenant_document_type_sequence_key
  unique (tenant_id, document_id, type, sequence);
