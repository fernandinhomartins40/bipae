# Veredito — Auditor-Chefe

> Auditoria PIE V2, modo AUDITORIA + CORREÇÃO, 27/10/2026.
> Escopo: todo o repositório acessível (API, web, caixa, pacotes, kit PDV Embed, deploy), mais a VPS em
> leitura. Linha de base `728df79`; correções na árvore de trabalho (lista em `RELATORIO_VALIDACAO_FINAL.md`).
> Ambiente de prova: Windows, PGlite, Playwright local. Produção roda `07bfa9a`.
> Nenhuma aprovação aqui é garantia de segurança absoluta.

## Veredito inicial (antes das correções): **REPROVADO**

Bloqueadores confirmados no código:

- **ACH-01**: aceitar convite permitia adivinhar senha e 2FA de qualquer pessoa sem limite e entregava a sessão dela (tomada de conta).
- **ACH-02**: IP do cliente falsificável, e o limite de login respondia 500.
- **ACH-03**: o caixa cancelava venda de outra loja, com autoria só pelo que vinha no evento.
- **ACH-04**: um evento com erro de banco travava o caixa para sempre, incluindo preços e catálogo.
- **ACH-05 a ACH-07**: preço, estoque e preço de plano gravados errados em silêncio.

## Veredito depois das correções

### Código desta auditoria: **APROVADO COM RESSALVAS** para commit

O que sustenta:

- os bloqueadores ACH-01, 02, 05, 06, 07, 08, 09, 12, 13, 14, 18 e 19 estão corrigidos e cobertos por testes que falham sem a correção;
- ACH-03 e ACH-04 estão corrigidos no essencial, sem perda de venda;
- lint e typecheck verdes;
- 438 testes da API e todos os pacotes tocados verdes;
- E2E sem regressão reproduzível: a única regressão achada (`nfce-contingency`) foi corrigida e passou;
- a revisão adversarial independente foi tratada item a item.

Ressalvas:

- ACH-04: o envio daquele caixa continua parado num evento com erro permanente de banco. A venda não se perde, mas falta a quarentena.
- ACH-03: a autorização do gerente ainda não tem prova verificável.
- ACH-09: sem teste automatizado de componente.
- E2E instável sob carga (ACH-28).

### Publicação em produção: **NÃO COMPROVADO**

Falta prova obrigatória e há decisão pendente do dono:

1. **36 commits locais nunca enviados**, com 8 migrações (0082–0089), vão junto no próximo push. O rollback automático roda código antigo sobre schema novo (ACH-24). Precisa do ok do dono.
2. **API contra PostgreSQL 16 real** e testes Rust só rodam na CI; não foram executados aqui.
3. **Backup** só no deploy, no mesmo disco e nunca restaurado (ACH-10). Um deploy com 8 migrações sem um backup externo verificado é risco de perda de dados.
4. Outra sessão está mudando o motor fiscal agora, e o teste de tabelas dela está vermelho na árvore de trabalho. O commit desta auditoria não leva esses arquivos, mas a CI do próximo push vai rodar sobre o que estiver na `main`.

Para virar **APROVADO PARA DEPLOY**:

- CI verde (lint, typecheck, testes com PostgreSQL real e E2E essencial);
- um backup do banco de produção copiado para fora da VPS antes do push;
- o ok do dono para enviar os 36 commits.

## Pendências por dono da decisão

| Quem | O quê |
|---|---|
| Dono | Enviar os 36 commits; backup externo e teste de restauração (custo); swap e limites das outras aplicações na VPS; usuário de deploy sem root; política de funcionalidades por plano; devolução em outra loja (R3/P10); grupo B de produto |
| Próxima rodada técnica | Lote 2 do `PLANO_MESTRE_AUDITORIA.md` (quarentena de eventos, prova do gerente, NFC-e com reserva, fila com `jobId`, outbox com versão, health de prontidão, imagem enxuta, migração ACH-30, menu em abas OP-08) |
