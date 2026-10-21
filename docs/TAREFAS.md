# Backlog do Bipaê

Lista executável de tudo o que falta no plano (PRD §5), na ordem de execução: o fiscal vem antes dos ajustes da Fase 2, porque sem nota fiscal o Bipaê não pode ser usado pela maioria dos comércios. Fases 0, 1 e 2, a plataforma SaaS e o PDV Embed já foram entregues: veja o `CHANGELOG.md`.

**Como usar**
- `pnpm tarefas` mostra o progresso e as próximas tarefas liberadas.
- `pnpm tarefas proxima` mostra só a próxima tarefa liberada.
- `pnpm tarefas bloqueadas` mostra o que espera ação do dono do projeto.
- O protocolo para executar está no `CLAUDE.md`, seção "Backlog".

**Formato de cada linha:** `- [ ] CÓDIGO · Título — depende: X, Y · externo: E1`, com as linhas de baixo dizendo quando a tarefa está pronta.
- `[ ]` pendente, `[~]` em andamento, `[x]` feita.
- Uma tarefa está **liberada** quando todas as dependências (tarefas e itens externos) estão `[x]`.

---

## Externo — ações do dono do projeto

Itens que só o dono resolve. Marque `[x]` quando estiver feito e anote onde está, por exemplo o nome do secret, sem nunca colar o segredo aqui.

- [ ] E1 · Certificado digital A1 de homologação de um CNPJ real (o CSC deixou de ser necessário com o QR Code versão 3)
- [x] E2 · UF prioritária para começar a emissão
  - Decidido em 13/10/2026: o Bipaê cobre **as 27 UFs e todos os regimes** (ver `docs/fiscal/cobertura-ufs-regimes.md`). A primeira emissão em homologação será na UF do CNPJ do certificado do item E1.
- [ ] E3 · Contador parceiro para validar `docs/fiscal/duvidas.md`
- [ ] E4 · Chaves do atualizador do desktop (secrets do GitHub) e local para hospedar as atualizações
- [ ] E5 · Certificado de assinatura de código do Windows
- [ ] E6 · Hardware de teste: impressora térmica, gaveta, balança e leitor de código
- [ ] E7 · Textos de privacidade e termos de uso (LGPD) e contato oficial (e-mail/WhatsApp)
- [ ] E8 · Preços dos planos Essencial, Profissional e Rede
- [ ] E9 · Conta sandbox de PSP Pix e boleto
- [ ] E10 · Conta sandbox de integrador TEF
- [ ] E11 · Provedor de e-mail transacional e domínio de envio (SPF/DKIM)
- [ ] E12 · Aprovação para guardar arquivos (fotos, XMLs) num volume na VPS ou num serviço S3
- [ ] E13 · Chave de API de IA para o assistente
- [ ] E14 · Credenciais de parceiro iFood e de marketplaces
- [ ] E15 · Participantes para o teste de usabilidade e decisão sobre pentest externo
- [ ] E16 · Primeira aplicação real para integrar o PDV Embed
- [ ] E17 · Decisão sobre instalar a REA para benchmark (`docs/benchmark/README.md`)
- [ ] E20 · Formato da resposta de `GET /markets/{id}/local-prices` (nomes dos campos da mediana, p25, p75, menor preço e loja, raio), a combinar com o MercadoFlow
- [ ] E19 · Credenciais do parceiro Bipaê no MercadoFlow (client id e secret, gerados em Parceiros → Bipaê) no `.env` da VPS
- [ ] E18 · Token ou cartão A3 de teste (com a leitora) para a assinatura pelo desktop
- [ ] E21 · Decisão sobre gerar o SPED EFD ICMS/IPI no Bipaê ou deixar com o contador (dúvida D-031)
- [ ] E22 · Publicação oficial do recolhimento na liquidação financeira (split payment, LC 214/2025, arts. 31 a 36): data e leiaute da consulta de débitos extintos. Não depende de decisão do dono; marque quando a Receita e o Comitê Gestor publicarem (dúvida D-027)
- [ ] E23 · Conta de desenvolvedor da Apple (Developer ID) para assinar e notarizar o Bipaê Desktop do macOS; sem ela, o Mac pede para abrir com Control + clique
- [ ] E24 · Play Console: criar o app `br.com.bipae.app`, ativar o Play App Signing e colocar a chave de upload nos secrets do GitHub (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`) e a conta de serviço da Play (`PLAY_SERVICE_ACCOUNT_JSON`)
- [ ] E25 · Aparelhos Android de teste: um celular, um tablet e uma impressora térmica Bluetooth (de preferência também uma maquininha smart)
- [ ] E26 · Contas de desenvolvedor ou homologação nas adquirentes que vamos integrar primeiro (PagBank, Stone, Cielo, Getnet, Mercado Pago); cada adaptador real espera a sua

---

## Fase 1 — pendências

- [x] F1-01 · Verificação em duas etapas (TOTP) opcional para donos e gerentes
  - Pronto quando: ativar, entrar e desativar com código funciona na retaguarda, a semente é cifrada (SecretBox) e há teste de API e E2E.
- [x] F1-02 · Tela de perfis fiscais (lista, criar, editar, vincular ao produto)
  - Pronto quando: o perfil é escolhido no cadastro do produto e há E2E.
- [x] F1-03 · Tabelas de preço: tela e uso no caixa
  - Pronto quando: o caixa aplica a tabela da loja ou do cliente, com teste de cálculo e E2E.
- [x] F1-03.a · API: loja e cliente apontam para uma tabela de preço (migração, rotas, testes)
- [x] F1-03.b · Tela de tabelas de preço e escolha da tabela na loja e no cliente — depende: F1-03.a
- [x] F1-03.c · Caixa offline aplica o preço da tabela (sincronização, banco local, cálculo) — depende: F1-03.a
- [x] F1-03.d · E2E: venda com tabela da loja e do cliente — depende: F1-03.b, F1-03.c
- [x] F1-04 · Variações (grade) e kits no cadastro e no caixa
  - Pronto quando: variação aparece na busca, e o kit baixa o estoque dos componentes, com testes.
- [x] F1-04.a · Kit: a venda baixa o estoque dos componentes; cancelamento e devolução devolvem (servidor, testes)
- [x] F1-04.b · Tela do kit: composição no cadastro do produto — depende: F1-04.a
- [x] F1-04.c · Tela da grade: atributos (tamanho, cor...) geram as variações — depende: F1-04.a
- [x] F1-04.d · Caixa: as variações aparecem na busca e o modelo (produto pai) não, com E2E — depende: F1-04.b, F1-04.c
- [x] F1-05 · Permissões por loja (`memberships.store_ids`) aplicadas na API e nas telas
  - Pronto quando: um operador restrito não vê nem vende em outra loja, com teste de RLS/API.
- [x] F1-05.a · API: lojas permitidas na sessão e aplicadas em lojas, caixas, sincronização, vendas e estoque (testes)
- [x] F1-05.b · Tela da equipe: escolher as lojas de cada pessoa, com E2E — depende: F1-05.a
- [x] F1-06 · Convite de equipe com aceite por link (sem depender de e-mail)
  - Pronto quando: o convite gera um link de uso único que expira, e quem aceita entra com o papel definido.
- [x] F1-06.a · API: convites (criar, listar, revogar, consultar e aceitar pelo link); conta que já existe só entra por convite (testes)
- [x] F1-06.b · Telas: convidar por link na Equipe e página de aceite do convite, com E2E — depende: F1-06.a
- [x] F1-07 · Fila de tarefas (Redis + BullMQ) na API e no deploy
  - Pronto quando: um job de exemplo roda com nova tentativa, o Redis está no compose da VPS e há teste.
- [ ] F1-08 · Fotos de produto — externo: E12
  - Pronto quando: enviar, redimensionar e mostrar na busca do caixa, com limite de tamanho e tipo.

## Fase 3 — Fiscal

- [x] F3-01 · Revalidar NTs, leiautes e cronograma da Reforma em `docs/fiscal/versoes.md`, com conferência manual do Portal da NF-e
  - Pronto quando: cada versão tem fonte e data, e as dúvidas novas estão em `duvidas.md`.
- [x] F3-02 · `packages/fiscal`: estrutura, decimal de precisão, regras como dados versionados por vigência (ADR-0006) — depende: F3-01
  - Pronto quando: o motor puro carrega tabelas por data, e a cobertura é de pelo menos 90%.
- [x] F3-03 · Tabelas oficiais versionadas: NCM, CEST, CFOP, CST/CSOSN, cClassTrib e alíquotas de referência — depende: F3-02
  - Fontes: arquivos oficiais do Portal Nacional da NF-e, do Siscomex, do CONFAZ e do Planalto, guardados em `packages/fiscal/sources` com data e hash (ver `docs/fiscal/versoes.md` seção 0.1).
- [x] F3-03.a · Importador das planilhas oficiais; CFOP, CST e cClassTrib do IBS/CBS, alíquotas de referência (CBS, IBS) e FCP por UF
- [x] F3-03.b · NCM (tabela do Siscomex), com vigência — depende: F3-03.a
- [x] F3-03.c · CST do ICMS, CSOSN, CST de PIS, COFINS e IPI e origem da mercadoria, tirados dos schemas oficiais (XSD) — depende: F3-03.a
- [x] F3-03.d · CEST (Convênio ICMS 142/18) — depende: F3-03.a
- [x] F3-04 · Tributos atuais: ICMS (Simples/CSOSN, regime normal/CST, ST básico), PIS/COFINS e IPI, com explicação do cálculo — depende: F3-03
  - Pronto quando: há casos de teste por regime (Simples, Presumido, Real) e cada cálculo mostra seus passos.
- [x] F3-05 · IBS, CBS e IS com vigência (2026 teste, 2027, transição 2029–2032, 2033) — depende: F3-03
  - Pronto quando: há casos por período, e as ambiguidades viram configuração, nunca suposição.
- [x] F3-06 · Perfil fiscal do produto e da empresa ligado ao motor, com cálculo na venda — depende: F1-02, F3-04, F3-05
  - Trocar as listas digitadas do cadastro (`ICMS_ORIGINS` em `@bipae/domain`, campos livres de CST, CFOP e NCM) pelas tabelas de `@bipae/fiscal/tables`, com busca de NCM.
- [x] F3-06.a · API: valida NCM, CEST e os códigos do perfil fiscal nas tabelas oficiais; rotas de consulta (`/v1/fiscal/*`)
- [x] F3-06.b · Telas: perfil fiscal com as listas oficiais; busca de NCM e sugestão de CEST no produto — depende: F3-06.a
- [x] F3-06.c · Dados fiscais da empresa (regime tributário, que define o CRT de 1 a 4, e UF) e tabela do motor com as alíquotas interestaduais e a alíquota geral das UFs já confirmadas — depende: F3-06.a
  - Fonte e status de cada UF: `docs/fiscal/cobertura-ufs-regimes.md`, seção 2.1. Só entra o que estiver ✅.
- [x] F3-06.d · Cálculo dos tributos na venda, no caixa (offline) e conferido no servidor — depende: F3-06.c
- [x] F3-06.d1 · Motor: impostos do item de venda a partir da empresa, do perfil fiscal e do valor, com "falta configurar" explícito (`calculateSaleItemTaxes`) — depende: F3-06.c
- [x] F3-06.d2 · CST de PIS/COFINS no perfil fiscal; perfis fiscais e dados fiscais da empresa sincronizados para o caixa — depende: F3-06.d1
- [x] F3-06.d3 · O caixa calcula os impostos ao fechar a venda (sem internet), o evento leva o resultado e o servidor grava e confere — depende: F3-06.d2
- [x] F3-06.d4 · A retaguarda mostra os impostos de cada venda e o que falta configurar — depende: F3-06.d3
- [x] F3-06.e · Regras de tributo próprias da empresa, por vigência (alíquota por produto, redução de base, MVA), para o contador ajustar o que a tabela geral não cobre — depende: F3-06.d
- [x] F3-07 · XML da NFC-e (modelo 65) gerado a partir dos XSD, com validação automática — depende: F3-06
  - Feito em 13/10/2026: `buildNfce` em `packages/fiscal/src/nfce`, validado contra o PL_010f. ST (CST 10, 70, CSOSN 201 a 203) e diferimento (51) passaram a ser emitidos com a F3-08.a. Assinatura é a F3-09; QR Code, a F3-13; o mapeamento dos pagamentos do caixa para o tPag entra na F3-10.
  - Antes de começar: resolver a dúvida D-012 (qual pacote de schemas vale para a NT 2025.002 v1.52) e ler as NTs 2026.007, 2026.008 e 2026.006.
- [x] F3-08 · XML da NF-e (modelo 55), com validação automática — depende: F3-07
- [x] F3-08.a · XML da NF-e com destinatário, transporte, cobrança, IPI e ICMS com ST e diferimento, validado contra o schema; grupos de imposto comuns à NFC-e — depende: F3-07
- [x] F3-08.b · Endereços dos webservices da NF-e das 27 UFs (produção e homologação), extraídos da página oficial — depende: F3-28
- [x] F3-09 · Assinatura XML com certificado A1 no servidor — depende: F3-07
  - `signNfe` (WebCrypto, roda no servidor e no desktop), conferida pela biblioteca independente xml-crypto e pelo schema.
  - Pronto quando: os testes passam com certificado de teste gerado na hora, e o certificado real fica para F3-11.
- [x] F3-10 · Cadastro do certificado A1 com assistente (cifrado, aviso de vencimento) — depende: F3-09
- [ ] F3-11 · Webservices da SEFAZ em homologação: status, autorização e consulta — depende: F3-10, F1-07 · externo: E1, E2
- [x] F3-11.a · Cliente dos webservices: mensagens validadas nos schemas oficiais, SOAP 1.2 com o certificado A1 (mTLS) e a cadeia ICP-Brasil, leitura dos retornos, XML autorizado (nfeProc) e "Testar conexão com a SEFAZ" na tela da empresa, tudo testado contra uma SEFAZ simulada — depende: F3-10
  - Feito em 13/10/2026: `packages/fiscal/src/sefaz` e `apps/api/src/modules/fiscal/sefaz.*`.
- [ ] F3-11.b · Primeira conversa real com a SEFAZ de homologação (status e uma NFC-e autorizada) com o certificado da empresa — depende: F3-11.a · externo: E1
  - [x] F3-11.b.1 · Status do serviço na SEFAZ-PR de homologação com o certificado A1 real da empresa: respondeu 107 (Serviço em Operação) em 20/10/2026, pela tela "Testar conexão com a SEFAZ"
  - [x] F3-11.b.3 · Status do serviço nas SEFAZ de homologação das 27 UFs, NFC-e e NF-e, com o certificado A1 real: 54 de 54 responderam 107 em 20/10/2026 (MG leva cerca de 11 s)
  - [ ] F3-11.b.2 · Primeira NFC-e autorizada em homologação — depende: F3-11.b.1; a empresa precisa da inscrição estadual (emitente de NFC-e)
- [x] F3-12 · Numeração `nNF` a partir de `terminalSeq` na série do caixa — depende: F3-07
- [x] F3-13 · QR Code e DANFE da NFC-e (80 mm) e DANFE da NF-e (PDF) — depende: F3-07
- [x] F3-13.a · QR Code versão 3 (sem CSC) e grupo infNFeSupl no XML, validado contra o schema — depende: F3-28
- [x] F3-13.b · DANFE da NFC-e em 80 mm (impressora térmica e tela), com QR Code — depende: F3-13.a
  - `buildDanfeNfce` (pdv-core) nas divisões do manual 5.1; QR Code por GS ( k na térmica e em SVG na tela e no navegador (`receiptToHtml`). Ligar ao caixa e à reimpressão fica na F3-14.
- [x] F3-13.c · DANFE da NF-e em PDF — depende: F3-08
  - Pacote `@bipae/danfe`: lê o XML autorizado (nfeProc), monta o A4 retrato do Anexo II do MOC 7.0 com os quadros da NT 2026.010 e gera o PDF (pdf-lib). Chave com letras (CNPJ alfanumérico) sai com o código de barras híbrido CODE-128C/A da NT Conjunta 2025.001 (D-023, resolvida em 16/10/2026).
  - Seguir a NT 2025.001 (QR Code versão 3), a NT 2026.003 (DANFE Simplificado Tipo 2) e a NT 2026.010 (DANFE com tributos da Reforma); dúvida D-014.
- [x] F3-14 · Caixa emite NFC-e na venda (CPF na nota, fila, reimpressão) — depende: F3-11, F3-12, F3-13
  - Sem o certificado A1 (E1), tudo é feito e testado contra a SEFAZ simulada da F3-11.a; a primeira emissão real fica na F3-11.b.
  - [x] F3-14.a · Motor: venda → NFC-e (impostos completos de cada item, tPag das formas de pagamento, CPF/CNPJ do cliente, série e número do caixa), com "falta configurar" explícito e XML validado no schema — depende: F3-11.a
  - [x] F3-14.b · API: fila de emissão no servidor (assina com o A1, envia, consulta pela chave antes de reenviar, guarda o nfeProc), documento fiscal por venda e nova tentativa; sem certificado, "falta configurar" — depende: F3-14.a
  - [x] F3-14.c · Caixa e retaguarda: situação da nota, DANFE da NFC-e na impressão e na reimpressão, XML para baixar e reenvio — depende: F3-14.b
  - Imprimir com `buildDanfeNfce`: térmica por ESC/POS, navegador por `receiptToHtml` (job `html`). Nomes das formas de pagamento vindos da tabela tPag.
- [x] F3-15 · Contingência offline da NFC-e (emite sem rede e transmite no prazo) — depende: F3-14
  - Regras (pesquisadas em 15/10/2026, D-013): Manual de Especificações da Contingência Off-line v2.0, Anexo IV do MOC 7.0, Manual do DANFE NFC-e e QR Code v6.0 (QR versão 3 com assinatura RSA-SHA1 dos parâmetros) e NT 2026.002 v1.11 (emissão normal em até 5 minutos; contingência transmitida em até 24 horas).
  - [x] F3-15.a · Motor: NFC-e em contingência (tpEmis 9, dhCont, xJust, chave com tpEmis 9) e QR Code versão 3 de contingência assinado; validada no schema
  - [x] F3-15.b1 · Servidor: dados do emitente no retrato fiscal do caixa; aceita a NFC-e de contingência assinada pelo caixa e transmite o mesmo XML; venda que chega depois dos 5 minutos é emitida em contingência (tpEmis 9) — depende: F3-15.a
  - [x] F3-15.b2 · Caixa: sem internet e com o A1 no aparelho, monta e assina a NFC-e em contingência, imprime o DANFE "EMITIDA EM CONTINGÊNCIA" com a via do estabelecimento e manda o XML no evento — depende: F3-15.b1
  - [x] F3-15.c · E2E com a rede desligada: emite em contingência e transmite ao reconectar
  - Pronto quando: um E2E com rede desligada emite em contingência e transmite ao reconectar.
  - Antes de começar: ler a NT 2026.002 v1.10a (contingência com DANFE Simplificado Tipo 2) e resolver a dúvida D-013.
- [~] F3-16 · SVC para NF-e — depende: F3-11, F3-08
  - [x] F3-16.a · Motor: NF-e com tpEmis 6 (SVC-AN) ou 7 (SVC-RS) pela tabela da UF, na nota e na chave, com dhCont e xJust, válida no XSD; endereços da SVC da tabela oficial; NFC-e recusada antes da SEFAZ (rejeição 783); consulta pela chave vai à SVC quando o tipo de emissão é 6 ou 7 (MOC, regras B22-60 e B28) — depende: F3-08.b
  - [x] F3-16.b · API e tela: "Emitir em contingência (SVC)" quando a SEFAZ da UF não responde, com o motivo e auditoria; a chave da tentativa normal fica guardada e, com a UF de volta, a manutenção confere se ela também foi autorizada (a nota avisa para cancelar uma das duas); testada contra a SEFAZ simulada com a UF fora e a SVC no ar — depende: F3-16.a, F3-33.b
  - [x] F3-16.c.1 · Status da contingência SVC (SVC-AN e SVC-RS) para as 27 UFs com o certificado A1 real: todas responderam 107 em 20/10/2026; o teste de conexão da tela mostra NFC-e, NF-e e a contingência
  - [x] F3-11.b.4 · Consulta da nota pela chave (NFeConsultaProtocolo, usada na recuperação de nota perdida) nas SEFAZ de homologação das 27 UFs, NFC-e e NF-e, com o certificado A1 real e uma chave inexistente: 54 de 54 responderam 217 (não consta na base) em 20/10/2026
  - [ ] F3-16.c · Primeira NF-e autorizada na SVC de homologação com o certificado da empresa — depende: F3-16.b · externo: E1
- [x] F3-17 · Eventos: cancelamento, carta de correção e inutilização — depende: F3-11
  - Regras (MOC 7.0, pesquisadas em 15/10/2026): cancelamento 110111 até 24 horas da autorização e cancelamento por substituição 110112 (só NFC-e) até 168 horas, rejeição 501 fora do prazo (com exceção por lei estadual); métodos nfeRecepcaoEvento e nfeInutilizacaoNF; schemas nos pacotes Evento_Canc e Evento_CancSubst (NT 2018.004) e no PL_009q. A carta de correção (110110) é só da NF-e: entra com a F3-33.
  - [x] F3-17.a · Motor: pedidos de cancelamento, cancelamento por substituição e inutilização, assinados e validados nos schemas oficiais, e leitura dos retornos
  - [x] F3-17.b · API: cancelar a venda com NFC-e autorizada manda o cancelamento (no prazo); números sem nota (devoluções, notas não emitidas) vão para a inutilização — depende: F3-17.a
  - [x] F3-17.c · Telas da nota cancelada e da inutilização, com E2E — depende: F3-17.b
  - Feito em 15/10/2026 contra a SEFAZ simulada. Falta só a primeira conversa com a SEFAZ de homologação de verdade, que depende do certificado A1 (junto com a F3-11.b). O cancelamento por substituição (110112) está pronto no motor; entra na API quando houver caso de nota normal e de contingência para a mesma venda.
- [x] F3-18 · Rejeições da SEFAZ traduzidas, com causa e solução — depende: F3-11
  - Feito em 15/10/2026 contra a SEFAZ simulada: 49 códigos do Anexo I do MOC 7.0 (guardado em sources) com causa, o que fazer e se o Bipaê tenta de novo; os outros mostram o motivo da SEFAZ com a orientação geral.
- [x] F3-19 · Importação de XML de compra (cria produtos e fornecedores e dá entrada no estoque) — depende: F3-03
- [x] F3-19.a · Motor: leitura do XML do fornecedor (itens, valores, tributos), custo de aquisição e fator de conversão, sem ponto flutuante — depende: F3-03
- [x] F3-19.b · API: prévia e entrada (assinatura conferida, nota da empresa certa, uma vez só, fornecedor e produtos criados, código do fornecedor lembrado, estoque e custo), com auditoria — depende: F3-19.a
- [x] F3-19.c · Tela "Compras" na retaguarda, com E2E — depende: F3-19.b
  - Custo sem abater créditos até o contador decidir (dúvida D-024).
- [~] F3-20 · Distribuição DF-e e manifestação do destinatário — depende: F3-11, F3-19
  - [x] F3-20.a · Motor: pedido de distribuição (último NSU, NSU e chave), leitura do retorno com os documentos descompactados (resumo, nota completa e eventos) e os quatro eventos de manifestação (210200, 210210, 210220, 210240), válidos nos pacotes oficiais Distribuição de DF-e v1.04 e Manifesta Destinatário v1.01
  - [x] F3-20.b · API: busca de hora em hora pela manutenção e a pedido, respeitando a hora de espera do Ambiente Nacional (137 e 656); ciência que já baixa a nota completa; manifestação final com auditoria; cancelamento pelo emitente marcado; testada na SEFAZ simulada — depende: F3-20.a
  - [x] F3-20.c · Tela Compras: "Notas emitidas para a sua empresa", busca, ciência, manifestação final e "Dar entrada" pelo mesmo caminho do XML (F3-19); E2E — depende: F3-20.b
  - [x] F3-20.d · Primeira busca real no Ambiente Nacional de homologação com o certificado da empresa — depende: F3-20.c · externo: E1
    - Feito em 20/10/2026 com o certificado A1 da FUSE AGENCIA LTDA: o Ambiente Nacional de homologação respondeu sem documentos novos e o Bipaê agendou a próxima consulta para 1 hora depois, como manda a regra.
- [ ] F3-21 · Desktop: assinatura A1 local e A3 pelo Conector — depende: F3-09
- [x] F3-21.a · Certificado A1 instalado no aparelho (web e desktop): chave não exportável no armazenamento local, assinatura da nota sem internet e tela em Periféricos, com E2E nas duas cascas — depende: F3-09
- [ ] F3-21.b · Certificado A3 (token ou cartão) pelo desktop e pelo Conector, via PKCS#11 — depende: F3-21.a · externo: E18
- [ ] F3-22 · Validação com contador e teste de emissão com pessoas leigas — depende: F3-14 · externo: E3, E15
- [x] F3-23 · Matriz de cobertura UF × regime: teste que falha se alguma das 27 UFs ou dos 5 regimes ficar sem regra ou sem "falta configurar" explícito, e mapa no painel — depende: F3-06.c
  - Pronto quando: as 135 combinações (27 UFs × MEI, Simples, Simples acima do sublimite, Presumido e Real) estão no teste.
- [x] F3-23.a · O teste das 135 combinações (`packages/fiscal/src/sale.test.ts`) — depende: F3-06.d1
- [x] F3-23.b · Mapa de cobertura no painel do super admin: o que cada UF e cada regime já calcula — depende: F3-23.a
- [x] F3-24 · Fechar as 7 UFs pendentes (AL, AP, MA, PI, RS, SE, TO): ler a lei na fonte oficial e promover para confirmado — depende: F3-06.c
  - Feito em 13/10/2026: MA, PI, RS, SE e TO confirmadas. AL (divergente) e AP (sem fonte) ficam com o contador, dúvida D-021.
- [x] F3-25 · Importar as alíquotas por produto das 27 UFs do Portal Nacional da DIFAL, com a data de cada linha e marcação do que está defasado — depende: F3-06.c
  - Feito em 13/10/2026: `icms-products.json` gerado da página oficial guardada, rota `/v1/fiscal/icms-products` e referência na tela Regras de ICMS. Referência, não regra do motor.
- [~] F3-26 · Substituição tributária por UF: CEST adotados e MVA, começando por bebidas, alimentos, limpeza e higiene — depende: F3-25
  - [x] F3-26.a · Base: tabela st-references.json gerada do ato oficial guardado em sources/, consulta por UF, NCM e data, rota /fiscal/st-references e sugestão "Usar" na regra de ICMS; SP alimentícios (Portaria SRE 12/2026, 69 itens)
  - [x] F3-26.b · SP: o que está e o que saiu da ST, por anexo e por item, gerado do texto consolidado da Portaria CAT 68/2019 (higiene saiu em 01/04/2026, limpeza e ração em 01/08/2026, bebidas alcoólicas e medicamentos em 01/01/2026, águas do Anexo III em 01/07/2026); aviso na regra de ICMS — depende: F3-26.a
  - [x] F3-26.e · SP: cerveja, chope e refrigerante continuam na ST; a base é a pauta da Portaria SRE 27/2026 (01/07 a 31/12/2026, lida do texto oficial), e a regra de ICMS explica e avisa que o cálculo por pauta ainda não está no Bipaê — depende: F3-26.b
  - [x] F3-26.f · ST por pauta (valor em reais por marca e embalagem): o motor calcula com o valor da pauta e importa as tabelas da Portaria SRE 27/2026 e alterações; a cada nova portaria de SP, regerar — depende: F3-26.e
    - [x] F3-26.f.a · Tabela `st-pautas.json` gerada do texto oficial: 1.824 linhas (anexo, tabela, item, CEST, marca/embalagem/tamanho e preço final) e o IVA-ST do Capítulo II (indústria e varejista que recebe de UF não signatária), com a vigência do artigo 1º
    - [x] F3-26.f.b · Motor: base da ST pela pauta (valor × quantidade) no lugar de valor × (1 + MVA), `modBCST` 5 sem `pMVAST` na NF-e, válida no XSD; sem pauta, vale a MVA (IVA-ST) da regra
    - [x] F3-26.f.c · Produto escolhe o item da pauta (busca por marca e embalagem, conferido na tabela e no CEST); o rascunho da NF-e usa a pauta quando a UF de destino é a da pauta e ela vale na data, e avisa quando o item saiu da pauta
  - [~] F3-26.c · PR, MG, RJ, RS, SC e BA, uma subtarefa por UF — depende: F3-26.a
    - [x] F3-26.c.PR · Paraná: MVA da Resolução SEFA 571/2019 consolidada (444 itens) e o que saiu da ST pelo Anexo IX do RICMS/PR (eletrônicos e celulares em 01/03/2026, limpeza e papelaria em 01/08/2024, sorvetes em 01/02/2025); monitor semanal confere os dois PDFs
    - [ ] F3-26.c.PR2 · Paraná: MVA única por hipótese, escrita no artigo (autopeças, medicamentos, veículos e porta a porta)
      - Análise de 18/10/2026: não é uma lista de MVA. São regras de base espalhadas nos artigos do Anexo IX: PMC dos medicamentos com redução de 35, 30 ou 16%, coeficiente de 70 ou 50% da MVA conforme a alíquota, e limite de 80% do valor da operação. Como a pauta, servem a quem retém o imposto. Fica para quando houver cliente substituto no PR.
    - [x] F3-26.c.MG · Minas Gerais: MVA da Parte 2 do Anexo XV do RICMS/MG (986 itens, com indústria e atacadista separados), data de cada linha pelas notas de rodapé e itens revogados com a data; monitor semanal
    - [x] F3-26.c.RJ · Rio de Janeiro: Anexo I do Livro II do RICMS/RJ (.doc oficial, 702 linhas; água e refrigerante por embalagem e por quem vende); o "bloqueio" era falta de cabeçalho de navegador; monitor semanal
    - [x] F3-26.c.RS · Rio Grande do Sul: Apêndice II do RICMS/RS, Seções II e III (194 itens com MVA da operação interna, 18 segmentos na lista); monitor semanal
    - [x] F3-26.c.SC · Santa Catarina: Anexo 1-A do RICMS/SC (80 linhas de MVA original em bebidas; 16 seções que saíram da ST, com data e decreto); monitor semanal
    - [x] F3-26.c.BA · Bahia: Anexo 1 do RICMS/BA vigente em 2026 (282 linhas de MVA original, faixas de CEST expandidas); monitor semanal
  - [~] F3-26.d · Demais UFs, uma por vez — depende: F3-26.a
    - [ ] F3-26.d.DF · Distrito Federal: Caderno I do Anexo IV do RICMS/DF; achar o endereço direto do texto compilado no SINJ-DF
      - Busca de 18/10/2026: o RICMS/DF é a norma 33077 do SINJ-DF, mas o arquivo "atualizado" de lá é só a republicação de 1998 (Anexo IV com as MVA de 1997). O texto compilado do Anexo IV não está no SINJ nem no portal da Secretaria de Economia; continua sem fonte oficial que dê para ler.
    - [ ] F3-26.d.CE · Ceará: Anexo IX do RICMS/CE (Decreto 33.327/2019); achar o texto consolidado oficial
      - Busca de 18/10/2026: o portal oficial (sefazlegis.sefaz.ce.gov.br) abre os arquivos pelo id sem login, mas a busca exige captcha; o único PDF achado é o texto original de 2019, sem as alterações. Falta o id do texto consolidado do Anexo IX.
    - [x] F3-26.d.MT · Mato Grosso: Portaria 195/2019-SEFAZ/MT consolidada até a 212/2022 (endereço direto do Lotus Notes, só por HTTP); 21 segmentos com a MVA do Anexo Único (optante pelo crédito outorgado) e a do art. 2º-B (demais), redações antigas e a tabela de antes da renumeração fora; monitor semanal
    - [ ] F3-26.d.MS · Mato Grosso do Sul: Anexo III do RICMS/MS (Lotus Notes, sem endereço direto)
    - [x] F3-26.d.PB · Paraíba: planilhas oficiais do Anexo 5 do RICMS/PB por segmento (SEFAZ-PB, 10/04/2025; 17 planilhas, 542 linhas), com a vigência de cada linha, MVA original e as duas MVAs das autopeças (com e sem índice de fidelidade); pauta fiscal indicada na nota; combustíveis (PMPF) e energia fora; monitor semanal
    - [x] F3-26.d.PI · Piauí: planilha declarada no Portal Nacional da ST do CONFAZ (Convênio ICMS 18/2017, versão 001, efeitos a partir de 08/03/2023), 409 linhas com a MVA das operações internas; a aba "Farinha de trigo", que repete por engano as lâmpadas, fica de fora; monitor semanal
    - [x] F3-26.d.PA · Pará: planilha do Portal Nacional da ST (versão 0006, efeitos a partir de 01/07/2024), 692 linhas, com as MVAs por tipo de remetente e por índice de fidelidade como linhas rotuladas; monitor semanal
    - [x] F3-26.d.SE · Sergipe: planilha do Portal Nacional da ST (versão 0019, efeitos a partir de 01/07/2023), 342 linhas; águas e bebidas frias (preço PFC) e alimentícios (sem a coluna da MVA interna) ficam de fora; monitor semanal
      - AP (versão de 2018) e MS (versão de 2017) também estão no portal, mas são anteriores ao Convênio ICMS 142/2018 e ficaram desatualizadas; não entram.
    - [ ] F3-26.d.AC · Acre e F3-26.d.AM, RN, MA, TO, AP, RR: achar a fonte oficial acessível (portais sem resposta ou sem o texto; AP só tem no Portal Nacional da ST a versão de 2018)
    - [x] F3-26.d.PE · Pernambuco: Anexo 37 do RICMS/PE (Decreto 44.650/2017) consolidado, 13 capítulos com a MVA no artigo e as tabelas dos Anexos 37-A a 37-C (334 CEST, ligados pelo item do Convênio ICMS 142/2018); redação anterior descartada; capítulos de pauta, PMC, MVA por remetente, porta a porta e faturamento direto ficam como "falta configurar"; monitor semanal
    - [x] F3-26.d.RO · Rondônia: Anexo VI do RICMS/RO consolidado até o Decreto 31.963/2026 (403 linhas); monitor semanal pela API do portal
    - [x] F3-26.d.AL · Alagoas: Decreto 90.309/2023 com MVAs (795 linhas; revogados com data, inclusive faixas de itens); monitor semanal pela API do portal
    - [x] F3-26.d.ES · Espírito Santo: Portaria 16-R/2019 atualizada até a 81-R/2026 (352 linhas, redação verde de fora, revogados com data); monitor semanal
    - [x] F3-26.d.GO · Goiás: Apêndice II do Anexo VIII do RCTE/GO (213 linhas, industrial e atacadista separados; autopeças, construção, elétricos e ração fora da ST desde 01/03/2018); monitor semanal
  - O motor já calcula a ST com a MVA da regra da empresa. Falta a tabela oficial por UF: as MVA estão em resoluções esparsas e alteradas (no PR, Resolução SEFA 571/2019 sobre o Anexo IX do RICMS); cada UF exige leitura própria. Feita depois das tarefas de código, uma UF por subtarefa.
- [~] F3-27 · Código de benefício fiscal (cBenef) por UF — depende: F3-25
  - [x] F3-27.a · Base: a regra de ICMS da empresa leva o cBenef (8 ou 10 caracteres ou SEM CBENEF, como no leiaute PL_010f), o motor o separa do cálculo e a NFC-e o põe no item depois do CEST, válida no XSD; chega ao caixa pela sincronização
  - [x] F3-27.b · Tabelas oficiais de cBenef das UFs que exigem o código, geradas do arquivo da SEFAZ, para sugerir e conferir o código pelo CST — depende: F3-27.a
    - [x] F3-27.b.PR · Paraná: Tabela de Códigos de Benefício Fiscal por CST, V27 de 17/07/2026 (502 códigos, CST pela posição no PDF); aviso na regra de ICMS e rota /fiscal/cbenef; monitor semanal
    - [x] F3-27.b.SC · Santa Catarina: Tabela 5.2A (cBenef) de 09/10/2026 (665 códigos, com o tipo do benefício; crédito presumido marcado à parte, porque vai no cCredPresumido); monitor semanal
    - [x] F3-27.b.RS · Rio Grande do Sul: planilha Tabela cBenef x CST de 10/09/2026 (541 códigos, com descrição legível e referência legal); monitor semanal
    - [x] F3-27.b.GO · Goiás: Anexo Único da IN 1.518/2022-GSE consolidada (303 códigos; códigos revogados valem até a data da nota); monitor semanal
    - [x] F3-27.b.ES · Espírito Santo: planilha cBenef ES V6 (247 códigos, vigência em número de série do Excel, tipo do benefício); monitor semanal
    - [x] F3-27.b.SP · São Paulo: Tabela CST x cBenef v20260901 (316 códigos; fim da vigência lido da observação; SEM CBENEF não vale desde 01/07/2026); monitor semanal
    - [x] F3-27.b.RJ · Rio de Janeiro: Tabela de códigos de benefício X CST de 02/10/2026 (653 códigos; mesmo leitor do PR, com o cabeçalho só na primeira página); monitor semanal
    - [x] F3-27.b.DF · Distrito Federal: planilha consolidada do Anexo Único do Ato Declaratório (252 códigos; arquivo de 15/05/2023, o único que a Receita-DF publica); monitor semanal
  - [ ] F3-27.c · Demais UFs: confirmar em fonte oficial se exigem o cBenef e, se exigirem, gerar a tabela do arquivo da SEFAZ (a planilha de regras de validação por UF do portal da NFC-e saiu do ar; nenhuma outra UF publica tabela própria que tenha sido achada) — depende: F3-27.b
    - Busca de 19/10/2026: as regras do cBenef no MOC 7.0 (I05f, N12-84 a N12-98) são facultativas, cada UF decide e publica a própria tabela; o MOC não lista quais UFs adotam. As tabelas oficiais achadas são as das 8 UFs já cobertas (PR, SC, RS, GO, ES, SP, RJ e DF). Nas demais, o código continua possível pela regra de ICMS da empresa.
- [x] F3-28 · Endereços de autorização e de QR Code das 27 UFs (NFC-e e NF-e, produção e homologação) — depende: F3-07
  - Feito para a NFC-e (13/10/2026), extraído das páginas oficiais da SVRS e do ENCAT. Os da NF-e entraram com a F3-08.b (Portal Nacional da NF-e).
- [x] F3-29 · CRT 2 e sublimite do Simples Nacional por UF — depende: F3-06.c
- [x] F3-30 · Regras do MEI na nota (CRT 4, CFOP permitidos) — depende: F3-06.c
- [~] F3-33 · Retaguarda emite NF-e (modelo 55): tela da nota com destinatário, itens, transporte e cobrança, envio pela fila e DANFE em PDF — depende: F3-11, F3-08, F3-13.c
  - [x] F3-33.a · Motor: do rascunho da retaguarda ao XML da NF-e com os impostos (alíquota interestadual, 4% para importado pela origem, partilha do ICMS, CFOP de venda a não contribuinte tirado da tabela oficial), fatura e duplicatas, e a lista do que falta; válido no XSD — depende: F3-08.a
  - [x] F3-33.b · API: rascunho da NF-e, numeração por série da empresa, tarefa na fila que assina e envia (consulta antes de reenviar), XML e DANFE em PDF, testada contra a SEFAZ simulada; auditoria — depende: F3-33.a, F3-11.a, F3-13.c
  - [x] F3-33.c · Tela da NF-e na retaguarda: destinatário pelo cadastro de clientes, itens pelos produtos, transporte, parcelas e pagamento; o que falta, status da SEFAZ, XML e DANFE; E2E — depende: F3-33.b
  - [x] F3-33.e · A NF-e (sempre de saída) baixa o estoque da loja ao emitir, na venda e na devolução de compra; as parcelas da venda viram contas a receber ligadas à nota — depende: F3-33.b
  - [x] F3-33.f · Cancelamento da NF-e autorizada (110111) em até 24 horas, com a justificativa da pessoa; pela fila; quando a SEFAZ registra, o estoque volta (motivo nfe_cancelled) e as parcelas abertas são canceladas; recusa (501) não muda nada; auditoria; tela — depende: F3-33.e, F3-17.a
  - [x] F3-33.g · Carta de correção da NF-e (110110), de 1 a 20 por nota, uma por vez, com o texto fixo das condições de uso do schema oficial (pacote Evento CCe v1.01, validado no XSD); cartas no pacote do contador; tela com a lista — depende: F3-33.f
  - [x] F3-33.j · Consulta do cadastro de contribuintes do ICMS na SEFAZ da UF do destinatário (CadConsultaCadastro4, ConsCad 2.00 do pacote 010d_v1.01): botão "Buscar a inscrição estadual na SEFAZ" na NF-e, que preenche a inscrição, o nome e o endereço; conferida com o certificado real em 20/10/2026 (PR responde; SP e SVRS só para quem emite NF-e, cStat 257; 12 UFs sem o webservice na tabela oficial) — depende: F3-33.b
  - [ ] F3-33.d · Primeira NF-e autorizada na SEFAZ de homologação com o certificado da empresa — depende: F3-33.c · externo: E1
  - [x] F3-33.i · Devolução de compra referenciada item a item (grupo DFeReferenciado, NT 2025.002-RTC v1.52, regra VC02-14, em produção a partir de 03/11/2026): sem refNFe no cabeçalho; motor confere VC02-10/14/30/50, VC03-20 e a rejeição 1194; contrato, API e tela pedem o item da nota do fornecedor — depende: F3-33.b
  - [ ] F3-33.h · NF-e de devolução de venda (entrada do cliente, CFOP 1.202/2.202, finNFe 4) ligada à nota original: estoque volta e a conta a receber é estornada — depende: F3-33.f; resolver antes a dúvida D-037 (referência item a item e imposto por regime, em fonte oficial)
- [x] F3-32 · Partilha do ICMS (DIFAL, grupo ICMSUFDest) na venda interestadual para consumidor final não contribuinte — depende: F3-08.a
- [x] F3-31 · Rotina que baixa de novo as fontes oficiais, compara com o que está guardado e avisa quando uma tabela ou alíquota mudou — depende: F3-25
  - [x] F3-31.b · Conferência de 19/10/2026: o monitor acusava 8 mudanças falsas. Corrigido: cadeia de certificados (primeiro sem os do sistema, que levavam a uma cadeia que não fecha), endereço só HTTP da SEFAZ-MT, download da SEFAZ-RJ pelo curl (o portal bloqueia o Node) e a lista dos manuais do Portal da NF-e gravada como referência. Resultado: nenhuma fonte mudou

## Fase 2 — pendências

- [x] F2-01 · Desconto por item na tela do caixa (o núcleo já suporta)
- [x] F2-02 · Crediário com limite por cliente na venda
  - Pronto quando: o caixa recusa venda acima do limite com mensagem clara, há saldo devedor por cliente e testes.
- [x] F2-03 · Troca de operador no mesmo caixa sem sair da conta
- [x] F2-04 · Ao desativar um caixa, apagar os dados locais depois de enviar as pendências
- [x] F2-05 · Fallback IndexedDB para navegadores sem OPFS
- [x] F2-06 · Balança direto no navegador por WebSerial
- [x] F2-07 · Impressora USB pelo spooler do Windows (modo RAW)
- [x] F2-08 · Conector: atalho no instalador e iniciar junto com o sistema
- [x] F2-09 · Caixa web oferece a atualização entre vendas (hoje só aplica ao sair da tela do caixa)
- [x] F2-10 · E2E dentro do WebView real com `tauri-driver` na CI (Windows e Linux)
- [ ] F2-11 · Atualizador automático ligado nas releases — externo: E4
- [ ] F2-12 · Instalador assinado — externo: E5
- [ ] F2-13 · Teste com hardware real e ajustes — externo: E6

## Plataforma SaaS e PDV Embed — pendências

- [ ] P-01 · Páginas de privacidade e termos, com links no rodapé e no cadastro — externo: E7
- [ ] P-02 · Preços dos planos na landing e no painel — externo: E8
- [x] P-03 · Exportação dos dados do cliente (LGPD) e exclusão definitiva após o cancelamento
  - Pronto quando: o cliente baixa um ZIP com seus dados, a exclusão tem prazo e auditoria, e há testes.
- [~] P-04 · E-mails transacionais: confirmação de conta, recuperar senha, teste terminando, conta suspensa — externo: E11
  - [x] P-04.a · Porta de e-mail: envio pela fila com nova tentativa, SMTP do provedor por SMTP_URL, modelo pt-BR com botão e link por extenso; sem o provedor, o e-mail fica desligado e /health diz isso às telas
  - [x] P-04.b · Recuperar senha: link de uso único que vale 1 hora (só o hash no banco), resposta igual para e-mail sem conta, a senha nova encerra todas as sessões; telas "Esqueci a senha" (só com e-mail ligado) e "Senha nova"; testes e E2E — depende: P-04.a
  - [x] P-04.c · Confirmação do e-mail da conta: link depois do cadastro e aviso na retaguarda até confirmar — depende: P-04.a
  - [x] P-04.d · Avisos por e-mail: teste terminando e conta suspensa, uma vez cada, pela manutenção — depende: P-04.a
  - [ ] P-04.e · Ligar o provedor de e-mail na VPS (SMTP_URL e domínio com SPF e DKIM) e conferir a entrega — depende: P-04.b · externo: E11
- [x] P-05 · PDV Embed: autorização de gerente para desconto acima do limite (contrato v1 compatível)
- [x] P-06 · PDV Embed: publicar o `bipae-pdv.js` em endereço fixo versionado no site
- [ ] P-07 · PDV Embed: integrar na primeira aplicação real e rodar a conformidade — externo: E16

## Integração MercadoFlow

Contrato em `BIPAE-INSTRUCOES-PARA-IA.md` (o lado do MercadoFlow já está pronto). Sem as variáveis `MERCADOFLOW_*`, o Bipaê funciona como hoje.

- [x] MF-01 · Base: configuração, cliente HTTP com cache de token e nova tentativa, outbox em tabela, vínculos por loja e webhook com HMAC e idempotência
- [x] MF-02 · Catálogo nativo no cadastro de produto: bipar o código ou buscar pelo nome preenche tudo (sem imagem até o E12), com cache e NCM/CEST conferidos na tabela oficial — depende: MF-01
- [x] MF-03 · Catálogo: importação em massa revisada e devolução ao catálogo do que as lojas cadastram — depende: MF-02
  - A importação em massa é a entrada de compra pelo XML (F3-19): os itens sem produto consultam o catálogo em lote e o produto novo nasce com o nome, a marca e a caixa do catálogo. Planilha fica para quando houver importação por planilha.
- [x] MF-04 · Tela "MercadoFlow" nas configurações: criar conta, vincular conta existente, cliente ativo e desconto — depende: MF-01
- [x] MF-13 · Desktop abre o link do MercadoFlow no navegador do sistema (plugin opener do Tauri; hoje mostra o link para copiar) — depende: MF-04
- [x] MF-05 · Rede compartilhada no compose da VPS, credenciais e registro do webhook — depende: MF-01
  - Compose e comandos prontos; ligar de fato depende das credenciais (E19). Passo a passo em `docs/deploy.md`.
- [ ] MF-06 · Catálogo: imagens e fotos genéricas guardadas no Bipaê — depende: MF-02 · externo: E12
- [x] MF-07 · Catálogo: cadastro rápido no caixa, com tempo limite de 1,5 s — depende: MF-02
- [x] MF-08 · Vendas: NFC-e autorizada e cancelamento pela outbox, e carga inicial de 90 dias — depende: MF-04, F3-14
  - Feito em 15/10/2026 contra MercadoFlow e SEFAZ simulados: a venda sai da NFC-e autorizada (o XML que a SEFAZ aceitou), o cancelamento só vai depois da venda, LIMITE_DO_PLANO pausa a loja por 6 h com aviso e link para os planos, RECUSADO não se repete. Nota de homologação vai com dryRun=true (o MercadoFlow valida sem gravar); muda sozinho quando a emissão for para produção.
- [x] MF-09 · Confere dentro do Bipaê (notas de entrada, conferência e entrada no estoque) — depende: MF-04, F3-19
  - Feito em 14/10/2026: rotas `/v1/mercadoflow/confere/:storeId/*`, entrada no estoque idempotente (nota + conferência, refeita lança a diferença), pendências com fornecedor e a tela Notas de entrada. O Bipaê registra só o último custo (custo médio fica com a F4-02).
- [x] MF-14 · Aviso "Chegou nota de X para conferir" (evento confere.document.received) com contador no menu Notas de entrada — depende: MF-09
- [x] MF-10.a · Inteligência: card do Tino no painel inicial (decisões por loja, cache de 15 min, abre no MercadoFlow) — depende: MF-04
- [ ] MF-10.b · Inteligência: preço da região na tela de preço e na ficha do produto (cache de 24 h) — depende: MF-10.a · externo: E20
- [x] MF-11 · Inteligência: encartes, preço aprovado e pedido enviado viram pendências — depende: MF-10.a, F4-01, F5-02
  - [x] MF-11.a · Aviso price.approved vira alteração de preço pendente ("Preços aprovados no MercadoFlow"), aplicada com um clique ou automática se a loja ligar a opção; aplica na tabela de preço da loja quando ela tem uma
  - [x] MF-11.b · Encartes (GET /promotions) viram promoções pendentes ou automáticas, aplicadas no caixa na vigência, e o preço promocional volta ao MercadoFlow em /prices — depende: MF-11.a
  - [x] MF-11.c · Aviso order.sent vira pedido de compra "Enviado ao fornecedor", com fornecedor e produtos achados pelo CNPJ e pelo código de barras — depende: MF-11.a
- [x] MF-12 · Envio de produtos, preços, custos e estoque da loja vinculada — depende: MF-04

## Fase 4 — ERP

- [x] F4-01 · Pedidos de compra
- [x] F4-02 · Entrada de mercadoria com conferência por bipagem e custo médio — depende: F4-01
- [x] F4-03 · Formação de preço com margem e tributos — depende: F4-02, F3-04
- [x] F4-04 · Contas a pagar e a receber
- [x] F4-05 · Fluxo de caixa — depende: F4-04
- [x] F4-06 · DRE gerencial — depende: F4-04
- [x] F4-07 · Conciliação bancária por OFX — depende: F4-04
- [x] F4-08 · Conciliação de cartões e Pix — depende: F4-04
- [x] F4-09 · Crediário com controle de inadimplência — depende: F2-02, F4-04
- [x] F4-10 · Relatórios por período, produto, operador, loja, forma de pagamento, margem, ticket médio e curva ABC, exportáveis (CSV, XLSX, PDF)
- [x] F4-11 · Inventário pelo celular
- [x] F4-12 · Transferência entre lojas — depende: F1-05
- [x] F4-13 · Apuração de IBS/CBS (débitos e créditos) — depende: F3-05, F3-19
- [~] F4-14 · Exportação SPED/EFD e pacote de XMLs para o contador — depende: F3-14, F4-13
  - [x] F4-14.a · Pacote do mês para o contador: ZIP com os XML autorizados das NFC-e, dos cancelamentos e das inutilizações, e resumo em CSV
  - [x] F4-14.c · O pacote leva também o XML de cada NFS-e autorizada no mês (pasta NFSe) e a linha dela no resumo, com o valor dos serviços — depende: F4-14.a, F5-13.d
  - [ ] F4-14.b · Arquivo SPED EFD ICMS/IPI do mês (registros das NFC-e), conforme o Guia Prático oficial, validado no PVA — depende: F4-14.a · externo: E21
  - Pesquisa feita em 16/10/2026 (dúvida D-031): o arquivo completo exige entradas, apuração e inventário; espera a decisão do dono.
- [ ] F4-15 · Boletos via PSP — depende: F4-04 · externo: E9
- [ ] F4-16 · Crédito de IBS/CBS pela extinção do débito do fornecedor, quando o split payment estiver em funcionamento (LC 214/2025, arts. 47 e 48; dúvida D-027) — depende: F4-13 · externo: E22

## Fase 5 — Verticais

- [x] F5-01 · Etiquetas de gôndola e de balança
- [x] F5-02 · Promoções avançadas (`packages/promotions`: leve X pague Y, faixa de quantidade, combo)
  - [x] F5-02.a · Motor puro (`packages/promotions`): as três regras, sem acumular promoções no mesmo item, centavos inteiros
  - [x] F5-02.b · API: cadastro com vigência e auditoria, e envio ao caixa junto com o catálogo — depende: F5-02.a
  - [x] F5-02.c · Caixa aplica as promoções sem internet, mostra o desconto e o leva no evento da venda (fora do limite de desconto do operador) — depende: F5-02.b
  - [x] F5-02.d · Tela de promoções na retaguarda, com E2E — depende: F5-02.c
- [x] F5-03 · Atacarejo (preço por quantidade) — depende: F5-02
- [x] F5-04 · Lote e validade com FEFO (farmácia, pet, mercado)
  - [x] F5-04.a · Lotes com validade por loja, entrada manual, baixa da venda pelo lote que vence primeiro (FEFO) com rastreio por venda, devolução e cancelamento voltando ao mesmo lote
  - [x] F5-04.b · Entrada pelo XML de compra lê o lote e a validade (grupo rastro) — depende: F5-04.a
  - [x] F5-04.c · Tela de lotes e de validade (vencendo e vencidos), com E2E — depende: F5-04.a
- [x] F5-05 · Painel de prevenção de perdas — depende: F4-10
  - Feito em 16/10/2026: por período e loja, cancelamentos, devoluções, descontos acima do limite, sangrias e faltas no fechamento por operador, perdas de estoque a custo e lotes vencidos, com alertas de quem fica acima do dobro da média.
- [x] F5-06 · Self-checkout — depende: F3-14
  - Feito em 16/10/2026: modo autoatendimento no próprio caixa, com PIN de atendente guardado como hash no aparelho (funciona sem internet). O cliente bipa e paga com Pix ou cartão; tirar item, confirmar o pagamento e desligar o modo pedem o PIN. Pagamento sem atendente (depende de E9 e E10) e conferência por peso aparecem como "chega em breve".
- [x] F5-07 · Food service: mesas e comandas
  - [x] F5-07.a · Comandas no caixa, sem internet: abrir pela mesa ou pelo número, lançar itens aos poucos, guardar e fechar a conta como venda; cada passo vira evento (tab.opened, tab.updated, tab.closed) e o servidor guarda as comandas para o garçom e a cozinha
  - [x] F5-07.b · Telas das comandas no caixa e na retaguarda (comandas abertas, tempo e valor), divisão da conta por pessoas, com E2E — depende: F5-07.a
- [x] F5-08 · App do garçom (celular) — depende: F5-07
  - Feito em 16/10/2026: tela Garçom para o celular; o pedido vai ao servidor e um caixa da loja o junta à comanda na sincronização seguinte (abre a comanda se a mesa não tiver), uma vez só; o celular acompanha se entrou. O caixa continua sem depender de internet; o celular precisa dela para mandar.
- [x] F5-09 · KDS (tela da cozinha) — depende: F5-07
  - Feito em 16/10/2026: produto marcado "Preparado na cozinha"; cada rodada da comanda manda à cozinha só o que é novo; tela Cozinha com tempo de espera, Pronto e Entregue, atualizada a cada 5 segundos. Comanda cancelada tira da fila o que não ficou pronto.
- [x] F5-10 · Delivery com taxa por bairro — depende: F5-07
  - [x] F5-10.a · Bairros com taxa por loja na retaguarda; no caixa, venda para entrega com bairro, endereço, telefone e CPF, taxa somada ao total; lista de entregas na retaguarda (saiu e entregue)
  - [x] F5-10.b · NFC-e de entrega a domicílio (indPres=4, frete rateado, destinatário com endereço, transportador), validada no schema oficial (dúvida D-032) — depende: F5-10.a
- [x] F5-11 · Ficha técnica com baixa de insumos — depende: F5-07
  - Feito em 16/10/2026 sobre o kit (F1-04): produto marcado "Insumo" (não aparece no caixa), composição com quantidades fracionadas e a unidade, custo da ficha e margem no cadastro do prato; vender, cancelar e devolver mexem no estoque dos insumos.
- [x] F5-12 · Moda: grade e venda condicional — depende: F1-04
  - [x] F5-12.a · Grade em matriz (tamanho × cor) no cadastro do modelo: estoque de cada variação e preço editável na própria grade — depende: F1-04
  - [x] F5-12.b · Condicional: mercadoria sai para o cliente com prazo (60 dias, Ajuste SINIEF 02/18), volta por item, e o que ele ficou vai ao caixa como pedido da comanda; estoque e auditoria — depende: F5-12.a, F5-08
  - [x] F5-12.c · Notas do condicional pela NF-e da retaguarda: remessa para demonstração (CFOP 5.912), retorno (1.913), entrada simbólica (1.949) e venda com referência à remessa (Ajuste SINIEF 02/18; dúvida D-033) — depende: F5-12.b, F3-33
    - [x] F5-12.c.1 · Motor: as quatro notas geradas do texto do Ajuste guardado (natureza, CFOP, textos, chave da remessa), imposto suspenso pelo perfil da demonstração (CST 50 no regime normal), natureza acima de 60 caracteres pedida à empresa (D-035); válidas no XSD; monitor semanal do Ajuste
    - [x] F5-12.c.2 · API: perfil fiscal da venda condicional na empresa; o condicional emite a remessa ao sair e, na volta, o retorno do que voltou e a entrada simbólica com a venda do que o cliente ficou (por NF-e com a chave da remessa, D-033), sem mexer de novo no estoque — depende: F5-12.c.1, F3-33.e
    - [x] F5-12.c.3 · Tela do condicional: as notas de cada condicional, com o que falta, a situação na SEFAZ e o DANFE; E2E — depende: F5-12.c.2
- [~] F5-13 · Serviços: ordem de serviço e NFS-e Nacional — depende: F3-11
  - [x] F5-13.a · Lista nacional de serviços gerada do Anexo B oficial (338 códigos de tributação nacional), com o local de incidência do ISSQN e os grupos exigidos (obra, evento) lidos do Anexo I; busca por código e por palavra
  - [x] F5-13.b · Motor da DPS (leiaute v1.01 em produção): situação no Simples e regime de apuração, regras da alíquota do ISSQN pelo convênio do município (E0617 a E0640), retenção, total aproximado dos tributos por regime, tomador; assinada e válida nos esquemas oficiais; mensagens para a Sefin Nacional (emissão, consulta pela DPS e pela chave, convênio do município) com os endereços da página oficial (dúvida D-036) — depende: F5-13.a
  - [x] F5-13.c · Ordem de serviço: cadastro de serviços (código nacional, NBS, alíquota do ISSQN, preço), OS com cliente, equipamento ou descrição, serviços e peças, situação (aberta, em andamento, pronta, entregue); peças baixam o estoque e o total vira conta a receber; tela e E2E — depende: F5-13.a
  - [x] F5-13.d · NFS-e pela fila: numeração da DPS por série da empresa, consulta do convênio do município, assinatura, envio e consulta pela DPS antes de reenviar; XML; percentuais aproximados na empresa; testada contra a Sefin simulada — depende: F5-13.b, F5-13.c
  - [x] F5-13.e · Tela da NFS-e na OS: emitir, o que falta, situação, XML e DANFSE pelo ADN; E2E — depende: F5-13.d
  - [x] F5-13.g · Cancelamento da NFS-e Nacional (evento 101101) pelo leiaute e as regras do Anexo II oficial: pedido assinado, válido no pedRegEvento_v1.01, pela fila; recusa do município (prazo E0822, valor E0823) mostrada como veio; evento no pacote do contador; tela na OS — depende: F5-13.e
  - [x] F5-13.h · Percentuais da NFS-e na empresa sem erro e com ajuda: só os campos do regime (Simples: pTotTribSN; Presumido e Real: os três; MEI: nenhum, regras E0710, E0712 e E0713 do Anexo I), campo que aceita vírgula ou ponto e recusa o preenchimento automático, mensagem com o nome do campo e calculadora da alíquota efetiva do Simples pelos Anexos I a V da LC 123/2006 (gerados do texto do Planalto) — depende: F5-13.d
  - [x] F5-13.i · DPS no leiaute da NT 009 v1.01 (Anexo VI v1.04.01), que a produção restrita já exige: finNFSe em infDPS, grupos reestruturados e as regras novas; testada contra a Sefin de verdade com o certificado — depende: F5-13.d
    - Feito em 20/10/2026, conferido com o certificado na Sefin: entra o finNFSe (0, nota regular) depois do tpEmit, e a Sefin aceitou a estrutura. O indDest no infDPS (item 2.11) a Sefin ainda recusa e fica de fora até entrar em vigor. Os testes validam pelo esquema da produção restrita de 27/07/2026, com o finNFSe no lugar que a Sefin exige.
    - O convênio do município diz se a prefeitura deixa emitir só com o cadastro da Receita (situacaoEmissaoPadraoContribuintesRFB). Quando não deixa, como em Guarapuava, o Bipaê pede a inscrição municipal antes de enviar (regra E0084).
  - [ ] F5-13.j · Acompanhar o cronograma da NT 009 (indDest e dest no infDPS, vAjusteBC, CST e cClassTrib reposicionados e grupos de IBS/CBS) e adaptar a DPS quando a Sefin passar a exigir; o monitor das fontes avisa quando sair esquema novo da produção restrita — depende: F5-13.i
  - [x] F5-13.k · Alíquota do ISS do serviço buscada na prefeitura pelo Sistema Nacional (ADN Parâmetros Municipais, com o certificado da empresa): botão "Buscar a alíquota na prefeitura" no cadastro do serviço; código com pontos ("17.06.01.000"), conferido em Guarapuava (5%) em 20/10/2026 — depende: F5-13.c
  - [x] F5-13.l · NFS-e em que a empresa aparece (prestadora, tomadora ou intermediária) pelo ADN Contribuinte (`GET /contribuintes/DFe/{NSU}?lote=true`, com o certificado): busca de hora em hora e a pedido, cancelamento do emitente marcado, XML para baixar, seção em Compras; conferida com o certificado real em 20/10/2026 (E2220, sem documentos) — depende: F5-13.d
  - [ ] F5-13.f · Primeira NFS-e autorizada na produção restrita com o certificado da empresa; confirmar os pontos da dúvida D-036 — depende: F5-13.e · externo: E1

## Fase 6 — Integrações e IA

- [x] F6-01 · API pública (OpenAPI) com chaves por cliente e webhooks (ADR-0016)
  - [x] F6-01.a · Chaves de API: criar (mostrada uma vez), listar e revogar na retaguarda; autenticação por chave com escopos, só em rotas marcadas como públicas; auditoria
  - [x] F6-01.b · Contrato OpenAPI 3.1 em /v1/public/openapi.json e rotas públicas de leitura: produtos, estoque, clientes e vendas; teste de conformidade — depende: F6-01.a
  - [x] F6-01.c · Webhooks: URL, eventos e segredo selado; envio pela fila com assinatura HMAC, novas tentativas e histórico na tela — depende: F6-01.a
- [ ] F6-02 · Pix real com conciliação automática (detalhado em F8-08) — depende: F8-08 · externo: E9
- [ ] F6-03 · TEF real (maquininha integrada; detalhado em F8-09 a F8-11) — depende: F8-10 · externo: E10
- [ ] F6-04 · Cobrança automática dos planos e troca de plano pelo cliente — depende: F6-02, P-02
- [ ] F6-05 · iFood — depende: F5-07 · externo: E14
- [ ] F6-06 · Marketplaces — depende: F6-01 · externo: E14
- [~] F6-07 · Assistente de IA com confirmação humana (ADR-0011) — externo: E13
  - [x] F6-07.a · Base: interface própria do provedor (modelos Claude pela API de mensagens, trocável), chave e modelo por variável (`AI_API_KEY`, `AI_MODEL`), liga e desliga por conta com auditoria, limite de uso por dia e medição de cada chamada (tokens) para o custo caber no plano
  - [x] F6-07.b · Sugestão fiscal no cadastro do produto: NCM, CEST e cClassTrib com justificativa e confiança, a partir de candidatos da tabela oficial; o que não existe ou não vale hoje sai com aviso; só grava com aprovação, que registra quem aprovou, a sugestão original, o modelo e o antes e depois — depende: F6-07.a
  - [x] F6-07.c · Perguntas sobre o negócio pelas ferramentas de relatório (vendas, DRE, contas, perdas), com o escopo da conta e sem dado pessoal de cliente; nunca SQL livre — depende: F6-07.a
  - [x] F6-07.d · Tela Assistente (liga e desliga, exemplos, conversa) e "Sugerir com IA" no produto; sem a chave, "Falta configurar" — depende: F6-07.b, F6-07.c
  - [ ] F6-07.e · Ligar a chave na VPS, conferir com o modelo de verdade e medir o custo por conta; aviso do envio ao provedor de IA no termo de uso (P-01) — depende: F6-07.d · externo: E13, E7
- [x] F6-08 · CRM, fidelidade e campanhas com consentimento (LGPD)
  - [x] F6-08.a · CRM: ficha do cliente com o histórico de compras pelo CPF (total, ticket médio, frequência, última compra, mais comprados), segmentos (novos, frequentes, sumidos) e lista de quem aceitou ofertas, exportada com auditoria
  - [x] F6-08.b · Fidelidade: programa de pontos (R$ por ponto e validade), pontos das vendas com CPF, saldo e extrato na ficha; resgate no caixa como desconto, com o saldo sincronizado e sem depender de internet — depende: F6-08.a
  - [x] F6-08.c · Campanhas por e-mail para um segmento, só para quem consentiu, com link de descadastro — depende: F6-08.a · externo: E11

## Fase 7 — Endurecimento

- [x] F7-01 · Teste de carga: venda < 1 s (p95) e busca < 100 ms com 100 mil produtos locais
  - Feito em 16/10/2026: medições no Node e no navegador com 100 mil produtos, nas metas; a gravação do catálogo passou a ser em blocos (ver `docs/desempenho.md`).
- [~] F7-02 · Revisão de segurança OWASP ASVS nível 2 e correções — externo: E15
  - [x] F7-02.a · Revisão interna capítulo a capítulo (`docs/seguranca.md`) e correções: senha comum ou igual ao e-mail ou nome recusada; limite de tentativas por e-mail no login; aviso por e-mail quando a senha ou a verificação em duas etapas mudam; respostas da API sem cache; limite no descadastro de campanha
  - [ ] F7-02.b · Pentest externo, `pnpm audit` na CI, decisão sobre conferir senhas vazadas e limite de tentativas no Redis com mais de uma instância — depende: F7-02.a · externo: E15
- [x] F7-03 · Auditoria de acessibilidade WCAG 2.2 AA e correções
  - Feito em 16/10/2026: axe-core nas telas principais (tema claro, escuro e celular) e teste de teclado na CI; corrigidos o link "Pular para o conteúdo" e a volta do foco ao fechar gavetas e janelas (ver `docs/acessibilidade.md`).
- [x] F7-04 · Central de ajuda (documentação do usuário)
  - Feito em 16/10/2026: tela "Ajuda" dentro do aplicativo (funciona sem internet), com busca e 16 artigos em passos; teste que confere os links para as telas (`packages/erp-ui/src/help/articles.ts`).
  - [x] F7-04.b · Artigos das telas novas (19/10/2026): NF-e e contingência, notas recebidas e manifestação, ordem de serviço e NFS-e, assistente de IA, campanhas por e-mail, senha e segurança da conta, pauta da ST; guia de implantação atualizado com o que depende de configuração
- [x] F7-05 · Guia de implantação para revendas e técnicos
  - Feito em 16/10/2026: `docs/implantacao.md` (levantamento, equipamentos, instalação, configuração, treinamento, checklist, problemas comuns e o que ainda não está disponível).
- [x] F7-06 · Bipaê Desktop para macOS
  - Feito em 16/10/2026: app universal (Intel e Apple Silicon) e .dmg na CI e na release, com download reconhecido pela página. Assinatura e notarização da Apple dependem do E23.
- [x] F7-08 · Retaguarda mais simples para leigos: menu agrupado pelo que a pessoa quer fazer e Início que antecipa pendências
  - Feito em 20/10/2026 (`docs/IMPLEMENTATION_PLAN.md`): 7 grupos em sanfona no lugar de 49 itens soltos, busca "O que você procura?" sem acento e pela palavra do dia a dia, gaveta no celular com "Abrir o caixa" sempre à vista; Início com atalhos de tarefa, "Precisa da sua atenção" (contas vencidas, lotes vencendo, certificado, notas para conferir), "Hoje na loja" e primeiros passos que se marcam sozinhos.
- [ ] F7-07 · Teste de usabilidade com 10 pessoas (meta: 9 de 10 vendem e emitem sem ajuda) — depende: F3-14 · externo: E15

## Fase 8 — Celular, vendedores e meios de pagamento

Pedido do dono em 20/10/2026: um app Android para o caixa e para vendas (vendedor de loja e garçom), comissão por vendedor e meios de pagamento que o próprio cliente integra (ADR-0017 e ADR-0018).

- [x] F8-01 · Vendedor na venda: o caixa escolhe quem vendeu (ou herda do pedido), cada item guarda o vendedor e a venda leva isso no evento; relatório de vendas por vendedor
  - Feito em 20/10/2026: tela Vendedores (nome, código curto sugerido, usuário opcional, ativo), com auditoria; a lista vai ao caixa no retrato de preços; botão Vendedor no caixa (código com ou sem zero, ou nome), sem internet; `seller_id` na venda e em cada item; Relatórios agrupados por vendedor. Vendedor desconhecido nunca recusa a venda.
- [x] F8-02 · Comissão: % por vendedor, % próprio por produto ou categoria, vigência e auditoria; cálculo sobre vendas pagas menos devoluções; tela "Comissões" com período, total por vendedor e exportação — depende: F8-01
  - Feito em 20/10/2026: taxas com vigência em `commission_rates` (histórico, cada venda usa o % do dia dela); produto antes de categoria antes do vendedor; parte à vista conta na venda, crediário quando recebido, devolução desconta (a que só abateu o crediário não), cancelada não conta; arredondamento único por vendedor; categoria opcional no cadastro do produto; tela Comissões com CSV, XLSX e PDF e exceções.
- [x] F8-03 · Pedido do vendedor (pré-venda): o vendedor monta o pedido no celular, o pedido sobe com o vendedor e o caixa o puxa pelo número ou pela lista "Pedidos de vendedores" e recebe; funciona em loja, roupa e restaurante — depende: F8-01
  - Feito em 20/10/2026: o pedido do vendedor usa o mesmo caminho das comandas (o caixa junta sem internet e cobra), então serve a mesa, comanda ou nome do cliente. Tela "Pedidos e comandas" (antes Garçom) mostra "você lança como"; o pedido leva o vendedor ligado ao usuário; cada item guarda o seu vendedor (itens iguais de vendedores diferentes não se juntam) e o caixa mostra quem vendeu. Teste da API do celular à comissão; E2E das comandas atualizado.
- [x] F8-04 · Fila sem internet no aparelho de vendas: pedido de vendedor e de garçom gravados localmente com UUIDv7 e enviados quando a rede voltar, uma vez só — depende: F8-03
  - Feito em 20/10/2026: `OrderDevice` (`packages/pdv-core`) guarda no banco local do aparelho uma cópia dos produtos (busca sem acento e por código) e a fila de pedidos; envia em ordem, para sem rede e marca o recusado com o motivo; o servidor aceita o ID do aparelho uma vez só, inclusive com dois envios simultâneos. A tela mostra "Pronto para vender sem internet" e "Guardados no celular". E2E no celular com a rede desligada.
- [x] F8-05 · Tela "Vendas" para celular: buscar ou bipar pela câmera, montar pedido ou comanda, cliente opcional, mandar ao caixa e acompanhar; quem tem permissão de caixa pode fechar ali mesmo — depende: F8-03
  - Feito em 20/10/2026: port `BarcodeCameraPort` e capacidade "câmera como leitor de código" (Chrome do Android e app; onde não há, a tela explica); botão "Ler com a câmera" no caixa e nos pedidos; permissão `pos.order` e papel de sistema "Vendedor" (lança pedidos, não abre o caixa; a migração dá a permissão a dono, gerente e operador); "Receber neste aparelho" para quem tem caixa; artigo de ajuda.
- [x] F8-06 · Caixa em celular e tablet: layout do PDV de 360 px a 1280 px, sem perder atalhos nem a venda sem internet
  - Feito em 20/10/2026: abaixo de 1024 px a página rola e o total com o Pagar ficam numa barra fixa embaixo; corrigida a lista de itens que ficava sem altura no tablet; cabeçalho quebra sem rolagem lateral; atalhos F2–F12 só do notebook para cima (continuam funcionando). E2E no celular com venda completa, sem rolagem lateral em 360, 390 e 768 px e axe sem violações.
- [ ] F8-07 · App Android (Tauri 2): projeto Android gerado, dependências só de computador fora do Android, app único que abre em Caixa ou Vendas conforme a permissão, AAB na CI; envio à faixa de teste interno da Play Store — depende: F8-05, F8-06 · externo: E24
  - [ ] F8-07.a · Build Android na CI sem assinatura (APK de depuração como artefato)
  - [ ] F8-07.b · Assinatura e envio à Play Store com os secrets do E24
  - [ ] F8-07.c · Periféricos no Android: impressora térmica Bluetooth, câmera como leitor de código e leitor Bluetooth — externo: E25
- [x] F8-08 · Base de pagamentos (ADR-0018): catálogo de integrações, configuração por loja, tela "Meios de pagamento" com auditoria; o caixa usa o meio configurado
  - Feito em 21/10/2026: o caixa deixou de aprovar cartão sozinho fora do simulador. Padrão honesto: cartão na maquininha à parte (confirma no caixa, NSU opcional) e Pix pela chave da loja. Novo: QR Code Pix estático com o valor da venda, gerado no próprio Bipaê pelo BR Code do Banco Central (conferido com o exemplo oficial, CRC 1D3D), sem banco nem PSP. Simulador só se a loja escolher. Catálogo com o que está pronto e o que chega (F8-09 a F8-12). Configuração vai ao caixa no retrato e funciona sem internet. Credenciais de parceiros (colunas seladas) entram com o primeiro adaptador real (F8-09).
- [ ] F8-09 · Pix com QR dinâmico pela API Pix do Banco Central (cobrança imediata, webhook e consulta), com perfis para Efí, Sicoob, Itaú, Banco do Brasil, Inter, Santander e Bradesco; Mercado Pago, PagBank e Asaas pelas APIs próprias — depende: F8-08 · externo: E9
- [ ] F8-10 · Maquininha pela nuvem: Mercado Pago Point e Stone Connect (cobrança enviada ao aparelho e confirmada por webhook) — depende: F8-08 · externo: E26
- [ ] F8-11 · TEF com pinpad no desktop e no Conector: SiTef (CliSiTef) e PayGo; Auttar e Linx depois — depende: F8-08 · externo: E10
- [ ] F8-12 · Maquininhas smart e TEF no Android por plugin Kotlin: PagBank PlugPag, Stone, Cielo LIO, Getnet, m-SiTef e PayGo — depende: F8-07, F8-08 · externo: E26
