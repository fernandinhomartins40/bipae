-- Cancelamento da NFS-e Nacional (F5-13.g): o pedido de registro do evento 101101 vai à Sefin
-- pela fila; quando o evento é registrado, a nota fica cancelada e o XML do evento é guardado.
alter table nfse_documents drop constraint nfse_documents_status_check;
alter table nfse_documents add constraint nfse_documents_status_check
  check (status in ('pending', 'error', 'not_configured', 'authorized', 'rejected', 'cancelled'));
alter table nfse_documents
  add column cancel_status text check (cancel_status in ('pending', 'error', 'registered', 'rejected')),
  add column cancel_code text check (cancel_code in ('1', '2', '9')),
  add column cancel_reason text,
  add column cancel_errors jsonb not null default '[]',
  add column cancel_signed text,
  add column cancel_event_xml text,
  add column cancel_attempts integer not null default 0,
  add column cancel_last_error text,
  add column cancel_requested_at timestamptz,
  add column cancelled_at timestamptz;
