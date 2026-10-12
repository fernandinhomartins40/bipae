# ADR-0001 — Monorepo TypeScript com pnpm + Turborepo

**Status:** aceita (12/10/2026) · **Data:** 11/10/2026

## Contexto
O produto tem API, backoffice web, PDV (PWA e desktop), apps auxiliares (KDS, garçom) e pacotes compartilhados críticos: motor fiscal, modelo de domínio, schema do banco local e motor de promoções. O mesmo código precisa rodar no servidor, no navegador e no PDV offline.

## Decisão
Monorepo pnpm workspaces + Turborepo, TypeScript estrito (`strict`, `noUncheckedIndexedAccess`).

```
apps/
  api/            NestJS (ADR-0002)
  web/            casca web (PWA): bootstrap + implementações web dos ports (ADR-0012)
  desktop/        casca Tauri 2: plugins Rust, ports nativos, modo Conector (ADR-0012)
packages/
  pdv-core/       estado e casos de uso do PDV — sem DOM, sem I/O
  pdv-ui/         telas do PDV (React)
  erp-ui/         telas da retaguarda (React)
  platform/       interfaces dos ports, capacidades e simuladores
  domain/         entidades, eventos, validações (CPF/CNPJ, GTIN...) — puro
  fiscal/         motor tributário e montagem de XML — puro (ADR-0006/0007)
  fiscal-rules/   tabelas de regras com vigência (dados versionados)
  promotions/     motor de promoções declarativo — puro
  local-db/       schema e migrações SQLite do PDV, comuns a WASM e nativo
  sync/           protocolo de sincronização cliente/servidor (ADR-0004)
  payments/       interfaces e simuladores de adaptadores (ADR-0009)
  ui/             componentes acessíveis (Radix + Tailwind), tokens da marca
  config/         eslint, tsconfig, prettier compartilhados
```

## Alternativas
- **Nx:** mais recursos, mais peso e acoplamento. Turborepo basta para cache e pipeline.
- **Repos separados:** quebraria o compartilhamento do motor fiscal e do schema local.

## Consequências
- Um PR pode mudar motor fiscal + API + PDV de forma atômica.
- Pacotes "puros" não podem importar nada de I/O: regra garantida por lint (`eslint-plugin-boundaries`).
