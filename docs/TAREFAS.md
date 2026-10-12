# Tarefas

## Fase 0 — Pesquisa e benchmark ✅

- [x] Benchmark, versões fiscais, dúvidas fiscais, PRD, ADRs 0001–0011, `CLAUDE.md`
- [x] Adendo 01 (web + desktop): análise de impacto e ADR-0012, aprovados em 12/10/2026
- [ ] Decisão sobre instalar a REA (ver `docs/benchmark/README.md`)
- [ ] Conferência manual do Portal da NF-e (o acesso automático falhou), obrigatória antes da Fase 3

## Fase 1 — Fundação ✅ (12/10/2026)

- [x] Monorepo pnpm + Turborepo, TypeScript estrito, ESLint com fronteiras do ADR-0012
- [x] Núcleo compartilhado + cascas finas `apps/web` e `apps/desktop` (Adendo 01)
- [x] `packages/platform`: ports, capacidades, simuladores
- [x] API NestJS/Fastify + Drizzle + migrações SQL
- [x] Multi-tenant com RLS forçada + teste de isolamento de todas as tabelas
- [x] Auth: Argon2id, refresh rotativo com detecção de reuso, limite de tentativas, troca de empresa
- [x] Papéis e permissões (recarregadas a cada requisição)
- [x] Trilha de auditoria encadeada por hash e imutável
- [x] Cadastros: produtos (códigos de barras, variações, kits, pesáveis), unidades, perfis fiscais, tabelas de preço, clientes, fornecedores, empresas, lojas
- [x] Caixas (terminais) com série de NFC-e exclusiva e nunca reutilizada
- [x] API `/v1` com versão mínima de cliente (426), nunca bloqueando envio de vendas
- [x] Telas: entrar, criar conta, início, produtos, clientes, fornecedores, caixas, equipe, auditoria, configurações (tema, alto contraste, fonte grande, bip)
- [x] Seed de demonstração
- [x] Testes: unitários, integração (PGlite e PostgreSQL), E2E com a mesma suíte nas duas cascas
- [x] CI (lint, typecheck, testes, PostgreSQL real, E2E, instaladores desktop) e Docker Compose
- [x] README, CHANGELOG, `docs/plataformas.md`

### Pendências da Fase 1 (não bloqueiam a Fase 2)

- [ ] **Rodar a CI pela primeira vez:** o repositório não tem remoto no GitHub. Até lá, `docker compose`, build Tauri e testes contra PostgreSQL real **não foram executados**.
- [ ] 2FA (TOTP) opcional para donos e gerentes
- [ ] Telas de empresa (CNPJ, UF), perfis fiscais e tabelas de preço (a API já existe; falta a tela)
- [ ] Permissões por loja (`memberships.store_ids` existe, mas ainda não é aplicado)
- [ ] Convite com aceite: hoje, adicionar um e-mail que já tem conta dá acesso direto
- [ ] Fotos de produto (depende de armazenamento de arquivos, decisão de hospedagem)
- [ ] Redis/BullMQ: entra com as filas da Fase 3 (transmissão à SEFAZ)

## Fase 2 — PDV MVP offline-first (próxima; planejar antes de começar)

- [ ] `packages/local-db` (SQLite nativo + SQLite WASM/OPFS, mesmo schema) e `StoragePort`
- [ ] `packages/sync` (eventos idempotentes, pull incremental) e endpoint `/v1/sync`
- [ ] `packages/pdv-core` e `packages/pdv-ui`: venda, pagamentos (dinheiro, Pix e cartão simulados), caixa (abertura, sangria, suprimento, fechamento cego), troca/devolução por item, orçamento, CPF na nota
- [ ] Estoque como livro de movimentações
- [ ] Drivers nativos no Tauri: impressora ESC/POS, gaveta, balança (+ WebSerial na web)
- [ ] Bipaê Conector (bandeja, WebSocket local, pareamento, token, origem)
- [ ] Auto-update do desktop com canais estável/beta; assinatura pronta e desligada
- [ ] Testes do adendo: dois terminais offline (web + desktop), update com fila pendente, Conector com periféricos simulados, E2E dentro do WebView real (tauri-driver)

## Fases 3–7

Ver escopo em `docs/PRD.md` §5. Detalhar ao iniciar cada fase.
