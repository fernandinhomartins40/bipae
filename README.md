# Bipaê

> **Bipou? Bipaê!** PDV + ERP brasileiro, offline-first e pronto para a Reforma Tributária. · bipae.com.br

Um código, dois alvos: **Bipaê Online** (navegador, `app.bipae.com.br`) e **Bipaê Desktop** (app instalável, Windows primeiro). As mesmas telas e a mesma conta nos dois ([ADR-0012](docs/adr/0012-pdv-web-desktop-codigo-compartilhado.md)).

## Estado

| Fase | Situação |
|---|---|
| 0 — Pesquisa e benchmark | ✅ concluída |
| Adendo 01 — Web + desktop | ✅ análise aprovada, incorporado às Fases 1 e 2 |
| 1 — Fundação | ✅ entregue |
| **2 — PDV offline-first** | ✅ **entregue** (ver [CHANGELOG](CHANGELOG.md) e pendências em [docs/TAREFAS.md](docs/TAREFAS.md)) |
| 3 — Fiscal (NFC-e/NF-e, IBS/CBS) | próxima |

## Produção

- Site: https://www.bipae.com.br
- App: https://www.bipae.com.br/app/
- Como é publicado e operado: [docs/deploy.md](docs/deploy.md)

## Rodando localmente

Pré-requisitos: **Node.js 24** e **pnpm 10** (`corepack enable`). Docker **não** é necessário: sem `DATABASE_URL`, a API usa PostgreSQL embutido (PGlite) gravado em `apps/api/.data`.

```bash
pnpm install
pnpm db:seed      # cria o "Mercadinho Bipaê (demo)"
pnpm dev          # API em http://localhost:3333 · web em http://localhost:5173
```

Entre com **demo@bipae.com.br / bipae123** (dono) ou **caixa@bipae.com.br / bipae123** (operadora de caixa) e clique em **Abrir o caixa**. Atalhos e uso do caixa: [docs/plataformas.md](docs/plataformas.md).

Para testar periféricos no navegador sem hardware: `pnpm --filter @bipae/web connector:sim` (simulador do Bipaê Conector, código 123456).

### Com Docker (PostgreSQL real)

```bash
docker compose up --build
```

Site em <http://localhost:8080>, app em <http://localhost:8080/app/>, API em <http://localhost:8080/v1/health>, já com os dados de demonstração.

### App desktop (Tauri)

Precisa do [Rust](https://rustup.rs) e, no Windows, das *Visual Studio Build Tools* (C++). Detalhes em [docs/plataformas.md](docs/plataformas.md).

```bash
pnpm --filter @bipae/desktop tauri:dev     # janela de desenvolvimento
pnpm --filter @bipae/desktop tauri:build   # instaladores .msi/.exe (Windows) ou .deb/AppImage (Linux)
```

## Qualidade

```bash
pnpm lint && pnpm typecheck && pnpm test   # unitários e integração (API com PGlite)
pnpm test:e2e                              # Playwright: mesma suíte no web e no frontend do desktop
TEST_DATABASE_URL=postgres://... pnpm --filter @bipae/api test   # API contra PostgreSQL real
```

A CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) roda tudo isso, testa a API contra PostgreSQL 16 e gera os instaladores desktop para Windows e Linux.

## Estrutura

```
apps/
  api/        NestJS + Fastify, PostgreSQL/PGlite com RLS
  web/        casca web (PWA)
  desktop/    casca Tauri 2
packages/
  domain/     regras puras: dinheiro, CPF/CNPJ, GTIN, permissões, contratos e eventos
  local-db/   banco local do caixa (SQLite: node, WASM e nativo)
  pdv-core/   regras do caixa: carrinho, pagamentos, caixa, ESC/POS, balança
  sync/       sincronização do caixa com o servidor
  pdv-ui/     telas do caixa
  platform/   ports de plataforma, capacidades, protocolo do Conector e simuladores
  ui/         design system (claro, escuro, alto contraste, fonte grande)
  erp-ui/     todas as telas, compartilhadas pelas duas cascas
```

## Documentação

| Documento | Conteúdo |
|---|---|
| [docs/PRD.md](docs/PRD.md) | Requisitos do produto |
| [docs/adr/](docs/adr/) | Decisões de arquitetura |
| [docs/plataformas.md](docs/plataformas.md) | Diferenças entre Online e Desktop, instalação e suporte |
| [docs/fiscal/](docs/fiscal/) | Versões da legislação e dúvidas fiscais |
| [docs/benchmark/](docs/benchmark/) | Benchmark de mercado (sala limpa) |
| [docs/TAREFAS.md](docs/TAREFAS.md) | Lista de tarefas |
| [CLAUDE.md](CLAUDE.md) | Convenções do projeto |
