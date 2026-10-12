# Tarefas

## Fase 0 — Pesquisa e benchmark ✅

- [x] Benchmark, versões fiscais, dúvidas fiscais, PRD, ADRs 0001–0012, `CLAUDE.md`
- [ ] Decisão sobre instalar a REA (ver `docs/benchmark/README.md`)
- [ ] Conferência manual do Portal da NF-e (o acesso automático falhou), **obrigatória antes da Fase 3**

## Fase 1 — Fundação ✅ (12/10/2026)

Entregue: monorepo, API com RLS, auth, permissões, auditoria encadeada, cadastros, caixas com série de NFC-e, telas da retaguarda, CI e Docker. Ver CHANGELOG.

Pendências (não bloqueiam):
- [ ] 2FA (TOTP) opcional para donos e gerentes
- [ ] Telas de empresa (CNPJ, UF), perfis fiscais e tabelas de preço (a API existe)
- [ ] Permissões por loja (`memberships.store_ids` ainda não aplicado)
- [ ] Convite com aceite (hoje um e-mail que já tem conta ganha acesso direto)
- [ ] Fotos de produto (depende de armazenamento de arquivos)
- [ ] Redis/BullMQ (entra com as filas da Fase 3)

## Fase 2 — PDV offline-first ✅ (12/10/2026)

Entregue: caixa completo nas duas cascas, banco local, sincronização, estoque por livro de movimentações, periféricos, Bipaê Conector, atualizador, testes do Adendo 01. Ver CHANGELOG e `docs/fase-2/plano.md`.

### Bloqueios que dependem de ação externa
- [ ] **Rodar a CI pela primeira vez** (o repositório não tem remoto). Até lá, nunca foram compilados nem executados:
  - todo o código Rust (banco nativo, periféricos, Conector, bandeja, atualizador);
  - as imagens Docker;
  - a suíte da API contra PostgreSQL real.
- [ ] Testar com hardware real: impressora térmica (rede e USB/serial), gaveta, balança Toledo/Filizola.
- [ ] Chaves do atualizador, hospedagem de `releases.bipae.com.br` e certificado de assinatura de código (ver `docs/plataformas.md`).

### Pendências técnicas
- [ ] E2E dentro do WebView real com `tauri-driver` (Windows e Linux) na CI
- [ ] Impressoras USB sem porta COM virtual (spooler do Windows em modo RAW)
- [ ] Balança direto no navegador por WebSerial (hoje só pelo Conector)
- [ ] Fallback IndexedDB para navegadores sem OPFS (hoje: banco em memória com aviso)
- [ ] Conector: atalho do instalador, iniciar com o sistema, página `bipae.com.br/download`
- [ ] Desconto por item na tela do caixa (o núcleo já suporta; a tela tem só desconto na venda)
- [ ] Crediário/convênio no pagamento (forma `store_credit` existe; falta limite por cliente)
- [ ] Troca de operador no mesmo caixa sem sair da conta
- [ ] Ao desativar um caixa, apagar os dados locais do aparelho após enviar pendências

## Fase 3 — Fiscal (próxima; planejar antes de começar)

- [ ] Revalidar NTs e cronograma (`docs/fiscal/versoes.md`) e dúvidas com contador
- [ ] `packages/fiscal`: motor com regras por vigência (ADR-0006), IBS/CBS/IS + tributos atuais
- [ ] XML NFC-e/NF-e a partir dos XSD, assinatura A1 (servidor, desktop e WebCrypto opcional), A3 via Conector
- [ ] Transmissão em homologação, QR Code, contingência offline e SVC, eventos, inutilização
- [ ] Numeração `nNF` a partir de `terminalSeq` na série do caixa
- [ ] Importação de XML de compra e Distribuição DF-e
- [ ] Rejeições da SEFAZ traduzidas

## Fases 4–7

Ver escopo em `docs/PRD.md` §5.
