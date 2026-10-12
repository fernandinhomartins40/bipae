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
- [x] CI e deploy rodando no GitHub (12/10/2026): testes Rust compilaram e passaram em Windows e Linux; API testada contra PostgreSQL real; site no ar em https://www.bipae.com.br
- [ ] Testar com hardware real: impressora térmica (rede e USB/serial), gaveta, balança Toledo/Filizola.
- [ ] Chaves do atualizador, hospedagem de `releases.bipae.com.br` e certificado de assinatura de código (ver `docs/plataformas.md`).
- [ ] Landing: definir preços dos planos pagos, contato (e-mail/WhatsApp), política de privacidade e termos de uso (LGPD) antes de divulgar.

### Pendências técnicas
- [ ] E2E dentro do WebView real com `tauri-driver` (Windows e Linux) na CI
- [ ] Impressoras USB sem porta COM virtual (spooler do Windows em modo RAW)
- [ ] Balança direto no navegador por WebSerial (hoje só pelo Conector)
- [ ] Fallback IndexedDB para navegadores sem OPFS (hoje: banco em memória com aviso)
- [x] Página de download do desktop: `www.bipae.com.br/app/download` e menu "Baixar o desktop" (12/10/2026)
- [ ] Conector: atalho do instalador e iniciar com o sistema
- [ ] Desconto por item na tela do caixa (o núcleo já suporta; a tela tem só desconto na venda)
- [ ] Crediário/convênio no pagamento (forma `store_credit` existe; falta limite por cliente)
- [ ] Troca de operador no mesmo caixa sem sair da conta
- [ ] Ao desativar um caixa, apagar os dados locais do aparelho após enviar pendências

## Plataforma SaaS e painel super admin ✅ (12/10/2026)

Entregue: planos e limites, ciclo de vida da conta, multi-empresas, painel `/app/admin`, acesso de suporte, auditoria da plataforma. Ver ADR-0013 e `docs/saas/plano.md`.

- [x] Primeiro super admin promovido em produção (12/10/2026); falta ele ativar o 2FA no primeiro acesso
- [ ] Definir preços dos planos pagos no painel (hoje "no lançamento")
- [ ] Cobrança automática e troca de plano pelo próprio cliente (entra com o PSP, Fase 6)
- [ ] Permissões por loja dentro do cliente (`memberships.store_ids`)
- [ ] E-mails de ciclo de vida (teste terminando, conta suspensa) quando houver envio de e-mail
- [ ] Exportação dos dados do cliente (LGPD) e exclusão definitiva após cancelamento

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
