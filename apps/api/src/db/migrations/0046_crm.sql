-- CRM (F6-08.a): exportar a lista de clientes que aceitaram ofertas é dado pessoal (LGPD), então
-- tem permissão própria e fica na auditoria. Dono e gerente dos clientes que já existem a recebem.
set local role bipae_platform;
update roles set permissions = array_append(permissions, 'crm.export')
  where system_key in ('owner', 'manager') and not ('crm.export' = any (permissions));
reset role;

-- Busca das compras de um cliente pelo CPF/CNPJ.
create index if not exists sales_customer_idx on sales (tenant_id, customer_tax_id, occurred_at)
  where customer_tax_id is not null;
