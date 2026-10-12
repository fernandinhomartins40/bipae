# Architecture Decision Records

Formato: contexto → decisão → alternativas → consequências. Status: `proposta` (aguardando aprovação), `aceita`, `substituída por ADR-XXXX`.

| ADR | Título | Status |
|---|---|---|
| [0001](0001-monorepo.md) | Monorepo TypeScript com pnpm + Turborepo | aceita |
| [0002](0002-backend.md) | Backend NestJS sobre Fastify, PostgreSQL, Drizzle, BullMQ | aceita |
| [0003](0003-multi-tenant-rls.md) | Multi-tenant com Row-Level Security | aceita |
| [0004](0004-offline-first-sync.md) | Offline-first: banco local + log de eventos idempotente | aceita |
| [0005](0005-frontends.md) | Um PDV, duas embalagens (PWA e Tauri); backoffice em Vite | substituída pela 0012 |
| [0006](0006-motor-fiscal.md) | Motor fiscal puro com regras versionadas por vigência | aceita |
| [0007](0007-xml-fiscal.md) | XML fiscal próprio em TypeScript (sem lib GPL) | aceita |
| [0008](0008-dinheiro-arredondamento.md) | Dinheiro em centavos inteiros; decimal para cálculo fiscal | aceita |
| [0009](0009-pagamentos.md) | Pagamentos por adaptadores, prontos para split payment | aceita |
| [0010](0010-seguranca-lgpd.md) | Certificados, auditoria imutável e LGPD | aceita |
| [0011](0011-assistente-ia.md) | Assistente de IA opcional, com confirmação humana | aceita |
| [0012](0012-pdv-web-desktop-codigo-compartilhado.md) | PDV web + desktop com código compartilhado (Adendo 01) | aceita |
