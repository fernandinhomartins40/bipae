# Tarefas

## Fase 0 — Pesquisa e benchmark ✅ (aguardando aprovação)

- [x] Validar a matriz de referências com fontes públicas → `docs/benchmark/`
- [x] Confirmar regras fiscais atuais e registrar versões → `docs/fiscal/versoes.md`
- [x] Registrar dúvidas fiscais → `docs/fiscal/duvidas.md`
- [x] PRD → `docs/PRD.md`
- [x] ADRs 0001–0011 → `docs/adr/`
- [x] `CLAUDE.md` com convenções
- [ ] **Aprovação do dono do projeto** (ADRs, PRD, divergências do briefing)
- [ ] Decisão sobre instalar a REA (ver `docs/benchmark/README.md`)
- [ ] Conferência manual do Portal da NF-e (o acesso automático falhou)
- [x] Adendo 01 (web + desktop): análise de impacto → `docs/adendos/01-analise-impacto.md`, ADR-0012
- [ ] **Aprovação da análise do Adendo 01** e decisão do `StoragePort` web; depois atualizar ADR-0001/0004/0005, PRD, CLAUDE.md e `duvidas.md` (D-010)

## Fase 1 — Fundação (próxima; planejar em modo de planejamento antes de começar)

- [ ] Monorepo pnpm + Turborepo + configs compartilhadas (ADR-0001)
- [ ] Docker Compose: PostgreSQL 16, Redis, API, web
- [ ] CI: lint, typecheck, testes, build
- [ ] API NestJS/Fastify + Drizzle + migrações (ADR-0002)
- [ ] Multi-tenant RLS + teste de isolamento por tabela (ADR-0003)
- [ ] Auth (Argon2id, refresh rotativo, 2FA opcional)
- [ ] Papéis e permissões por escopo
- [ ] Trilha de auditoria encadeada por hash (ADR-0010)
- [ ] Cadastros: produtos, clientes, fornecedores, unidades, tabelas de preço, perfis fiscais
- [ ] `packages/domain`: validação CPF/CNPJ/GTIN, tipo `Money` (ADR-0008)
- [ ] Backoffice: login, cadastros, tema claro/escuro, alto contraste
- [ ] Seeds de demonstração
- [ ] README, CHANGELOG, commit

## Fases 2–7

Ver escopo em `docs/PRD.md` §5. Detalhar ao iniciar cada fase.
