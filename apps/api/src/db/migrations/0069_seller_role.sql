-- Vendedor sem caixa (F8-05, decisão do dono em 20/10/2026): lançar pedidos e comandas pelo
-- celular vira permissão própria. Quem já usava a tela de pedidos (dono, gerente e operador de
-- caixa) continua usando; o papel novo "Vendedor" lança pedidos sem receber pagamento.
set local role bipae_platform;
update roles set permissions = array_append(permissions, 'pos.order')
  where system_key in ('owner', 'manager', 'cashier') and not ('pos.order' = any (permissions));
insert into roles (id, tenant_id, system_key, name, permissions)
  select gen_random_uuid(), t.id, 'seller', 'Vendedor',
         array['catalog.read', 'parties.read', 'pos.order']
  from tenants t
  where not exists (select 1 from roles r where r.tenant_id = t.id and r.system_key = 'seller');
reset role;
