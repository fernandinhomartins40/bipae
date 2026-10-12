# ADR-0002 — Backend NestJS sobre Fastify, PostgreSQL, Drizzle, BullMQ

**Status:** aceita (12/10/2026) · **Data:** 11/10/2026

## Contexto
O ERP tem muitos módulos (cadastros, estoque, compras, financeiro, fiscal, CRM, integrações) e vai crescer com equipe. Precisamos de estrutura modular, injeção de dependência e testabilidade, sem perder desempenho.

## Decisão
- **NestJS com adaptador Fastify.** Módulos do Nest = módulos do ERP; Fastify dá desempenho e validação por schema.
- **PostgreSQL 16** como fonte da verdade, com RLS (ADR-0003).
- **Drizzle ORM:** SQL explícito, tipos fortes, migrações versionadas e bom controle sobre `SET LOCAL` de sessão para RLS. O mesmo Drizzle gera o schema SQLite do PDV (ADR-0004).
- **Redis + BullMQ** para filas: transmissão à SEFAZ, retentativas de contingência, webhooks, importação de XML, integrações.
- **Zod** para contratos compartilhados com o front; OpenAPI gerada a partir deles (API pública, Fase 6).
- Auth: sessões com tokens de acesso curtos + refresh rotativo; senhas com Argon2id; 2FA (TOTP) opcional para donos e gerentes.

## Alternativas
- **Fastify puro:** mais leve, mas exigiria montar à mão a modularização que o Nest já dá.
- **Prisma:** ótimo DX, mas RLS por sessão e SQL avançado (ledger, relatórios) são mais trabalhosos.
- **Next.js full-stack:** mistura backoffice e API; ruim para a API pública e para workers.

## Consequências
- Workers BullMQ rodam no mesmo código da API, em processos separados.
- Relatórios pesados podem usar views materializadas sem brigar com o ORM.
