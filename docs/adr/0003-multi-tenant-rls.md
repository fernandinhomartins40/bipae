# ADR-0003 — Multi-tenant com Row-Level Security

**Status:** aceita (12/10/2026) · **Data:** 11/10/2026

## Contexto
SaaS com milhares de pequenos clientes e caminho para redes. Vazamento entre clientes é inaceitável (LGPD e dados fiscais).

## Decisão
- Banco compartilhado, schema compartilhado, coluna `tenant_id uuid not null` em toda tabela de negócio.
- **RLS habilitada e forçada** (`FORCE ROW LEVEL SECURITY`) com política `tenant_id = current_setting('app.tenant_id')::uuid`.
- A API conecta com um papel **sem** `BYPASSRLS`; cada requisição abre transação e faz `SET LOCAL app.tenant_id`. Migrações e jobs administrativos usam outro papel, auditado.
- Hierarquia: `tenant → company (CNPJ) → store → register (caixa)`. Permissões por papel e por escopo (empresa/loja).
- Teste automatizado obrigatório: para cada tabela, um teste tenta ler/gravar dados de outro tenant e deve falhar.

## Alternativas
- **Schema por tenant:** isolamento forte, mas migrações e pool de conexões não escalam para milhares de tenants.
- **Banco por tenant:** reservado como opção futura para grandes redes (mesmo código; muda só a conexão).

## Consequências
- Índices compostos começam por `tenant_id`.
- Esquecer `SET LOCAL` = zero linhas (falha segura), nunca vazamento.
