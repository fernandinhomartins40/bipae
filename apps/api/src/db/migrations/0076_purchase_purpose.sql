-- Finalidade da compra (F4-14.b.2, dúvida D-039): decide o CFOP de entrada e o crédito do ICMS
-- da nota no arquivo da EFD ICMS/IPI. As notas já importadas ficam como revenda, o caso do varejo.
alter table purchase_invoices
  add column purpose text not null default 'resale'
    check (purpose in ('resale', 'industrialization', 'consumption', 'fixed_asset'));
