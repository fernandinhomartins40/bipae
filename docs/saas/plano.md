# SaaS multi-clientes e painel super admin: plano

> 12/10/2026. Complementa ADR-0003 (multi-tenant com RLS). Decisão registrada em [ADR-0013](../adr/0013-plataforma-saas-super-admin.md).

## Conceitos

| Termo | No sistema | Exemplo |
|---|---|---|
| **Cliente** (conta) | `tenant` | "Mercadinho do Rafael" |
| **Empresa** | `company` (um CNPJ) dentro do cliente | matriz e filial com CNPJs diferentes |
| **Loja** | `store` de uma empresa | Loja Centro, Loja Bairro |
| **Caixa** | `terminal` de uma loja | Caixa 1 (desktop), Tablet (web) |
| **Equipe Bipaê** | `platform_admins` | quem opera o SaaS (super admin) |

Uma pessoa (`user`) pode participar de vários clientes (o contador, por exemplo) e trocar entre eles.

## O que entra

1. **Planos e assinatura**:
   - planos com limites (empresas, lojas, caixas, usuários, produtos) e recursos;
   - status do cliente: `active`, `trial`, `suspended` ou `cancelled`;
   - teste com data de fim;
   - histórico de cada mudança.
2. **Aplicação dos limites** na API, com mensagem clara ("Seu plano permite até 1 caixa…"). O bloqueio de conta suspensa ou de teste vencido nunca recusa o envio de vendas já feitas.
3. **Equipe Bipaê**:
   - papéis `owner`, `support` e `viewer`;
   - login separado (`/v1/admin/auth`) com sessão própria e curta;
   - **2FA (TOTP) obrigatório**;
   - papel de banco `bipae_platform` (BYPASSRLS), usado só pelo painel e nunca pelas rotas dos clientes.
4. **Acesso de suporte** ("entrar como o cliente"):
   - pede motivo e 2FA;
   - dura 30 minutos e pode ser só leitura;
   - aparece com faixa na tela do cliente;
   - tudo que for feito fica marcado na auditoria do cliente e na auditoria da plataforma.
5. **Auditoria da plataforma** encadeada por hash, como a dos clientes.
6. **Painel** (`/app/admin`):
   - visão geral (clientes por status e plano, novos cadastros, vendas na plataforma, caixas ativos, receita mensal estimada);
   - clientes (busca e filtros);
   - ficha do cliente (empresas, lojas, caixas, equipe, uso, vendas, auditoria, ações);
   - pessoas (busca global);
   - planos;
   - avisos;
   - equipe Bipaê;
   - auditoria;
   - sistema (versões, banco, migrações).
7. **Cliente**: telas de empresas e lojas, troca de cliente/empresa, "Minha assinatura", faixa de avisos, tela de conta suspensa.
8. **Ferramenta de linha de comando** para promover o primeiro super admin na VPS.

## Fora deste passo

- Cobrança automática (PSP/boleto/cartão recorrente). Por ora o plano é atribuído no painel; a integração entra junto com o PSP (Fase 6).
- Permissões por loja dentro do cliente (`memberships.store_ids`).
