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
- [ ] E18 · Token ou cartão A3 de teste (com a leitora) para a assinatura pelo desktop

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
- [x] F3-12 · Numeração `nNF` a partir de `terminalSeq` na série do caixa — depende: F3-07
- [x] F3-13 · QR Code e DANFE da NFC-e (80 mm) e DANFE da NF-e (PDF) — depende: F3-07
- [x] F3-13.a · QR Code versão 3 (sem CSC) e grupo infNFeSupl no XML, validado contra o schema — depende: F3-28
- [x] F3-13.b · DANFE da NFC-e em 80 mm (impressora térmica e tela), com QR Code — depende: F3-13.a
  - `buildDanfeNfce` (pdv-core) nas divisões do manual 5.1; QR Code por GS ( k na térmica e em SVG na tela e no navegador (`receiptToHtml`). Ligar ao caixa e à reimpressão fica na F3-14.
- [x] F3-13.c · DANFE da NF-e em PDF — depende: F3-08
  - Pacote `@bipae/danfe`: lê o XML autorizado (nfeProc), monta o A4 retrato do Anexo II do MOC 7.0 com os quadros da NT 2026.010 e gera o PDF (pdf-lib). Chave com letras sai sem código de barras (D-023).
  - Seguir a NT 2025.001 (QR Code versão 3), a NT 2026.003 (DANFE Simplificado Tipo 2) e a NT 2026.010 (DANFE com tributos da Reforma); dúvida D-014.
- [ ] F3-14 · Caixa emite NFC-e na venda (CPF na nota, fila, reimpressão) — depende: F3-11, F3-12, F3-13
  - Imprimir com `buildDanfeNfce`: térmica por ESC/POS, navegador por `receiptToHtml` (job `html`). Nomes das formas de pagamento vindos da tabela tPag.
- [ ] F3-15 · Contingência offline da NFC-e (emite sem rede e transmite no prazo) — depende: F3-14
  - Pronto quando: um E2E com rede desligada emite em contingência e transmite ao reconectar.
  - Antes de começar: ler a NT 2026.002 v1.10a (contingência com DANFE Simplificado Tipo 2) e resolver a dúvida D-013.
- [ ] F3-16 · SVC para NF-e — depende: F3-11, F3-08
- [ ] F3-17 · Eventos: cancelamento, carta de correção e inutilização — depende: F3-11
- [ ] F3-18 · Rejeições da SEFAZ traduzidas, com causa e solução — depende: F3-11
- [x] F3-19 · Importação de XML de compra (cria produtos e fornecedores e dá entrada no estoque) — depende: F3-03
- [x] F3-19.a · Motor: leitura do XML do fornecedor (itens, valores, tributos), custo de aquisição e fator de conversão, sem ponto flutuante — depende: F3-03
- [x] F3-19.b · API: prévia e entrada (assinatura conferida, nota da empresa certa, uma vez só, fornecedor e produtos criados, código do fornecedor lembrado, estoque e custo), com auditoria — depende: F3-19.a
- [x] F3-19.c · Tela "Compras" na retaguarda, com E2E — depende: F3-19.b
  - Custo sem abater créditos até o contador decidir (dúvida D-024).
- [ ] F3-20 · Distribuição DF-e e manifestação do destinatário — depende: F3-11, F3-19
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
- [ ] F3-25 · Importar as alíquotas por produto das 27 UFs do Portal Nacional da DIFAL, com a data de cada linha e marcação do que está defasado — depende: F3-06.c
- [ ] F3-26 · Substituição tributária por UF: CEST adotados e MVA, começando por bebidas, alimentos, limpeza e higiene — depende: F3-25
- [ ] F3-27 · Código de benefício fiscal (cBenef) por UF — depende: F3-25
- [x] F3-28 · Endereços de autorização e de QR Code das 27 UFs (NFC-e e NF-e, produção e homologação) — depende: F3-07
  - Feito para a NFC-e (13/10/2026), extraído das páginas oficiais da SVRS e do ENCAT. Os da NF-e entraram com a F3-08.b (Portal Nacional da NF-e).
- [ ] F3-29 · CRT 2 e sublimite do Simples Nacional por UF — depende: F3-06.c
- [ ] F3-30 · Regras do MEI na nota (CRT 4, CFOP permitidos) — depende: F3-06.c
- [ ] F3-33 · Retaguarda emite NF-e (modelo 55): tela da nota com destinatário, itens, transporte e cobrança, envio pela fila e DANFE em PDF — depende: F3-11, F3-08, F3-13.c
- [ ] F3-32 · Partilha do ICMS (DIFAL, grupo ICMSUFDest) na venda interestadual para consumidor final não contribuinte — depende: F3-08.a
- [ ] F3-31 · Rotina que baixa de novo as fontes oficiais, compara com o que está guardado e avisa quando uma tabela ou alíquota mudou — depende: F3-25

## Fase 2 — pendências

- [ ] F2-01 · Desconto por item na tela do caixa (o núcleo já suporta)
- [ ] F2-02 · Crediário com limite por cliente na venda
  - Pronto quando: o caixa recusa venda acima do limite com mensagem clara, há saldo devedor por cliente e testes.
- [ ] F2-03 · Troca de operador no mesmo caixa sem sair da conta
- [ ] F2-04 · Ao desativar um caixa, apagar os dados locais depois de enviar as pendências
- [ ] F2-05 · Fallback IndexedDB para navegadores sem OPFS
- [ ] F2-06 · Balança direto no navegador por WebSerial
- [ ] F2-07 · Impressora USB pelo spooler do Windows (modo RAW)
- [ ] F2-08 · Conector: atalho no instalador e iniciar junto com o sistema
- [ ] F2-09 · Caixa web oferece a atualização entre vendas (hoje só aplica ao sair da tela do caixa)
- [ ] F2-10 · E2E dentro do WebView real com `tauri-driver` na CI (Windows e Linux)
- [ ] F2-11 · Atualizador automático ligado nas releases — externo: E4
- [ ] F2-12 · Instalador assinado — externo: E5
- [ ] F2-13 · Teste com hardware real e ajustes — externo: E6

## Plataforma SaaS e PDV Embed — pendências

- [ ] P-01 · Páginas de privacidade e termos, com links no rodapé e no cadastro — externo: E7
- [ ] P-02 · Preços dos planos na landing e no painel — externo: E8
- [ ] P-03 · Exportação dos dados do cliente (LGPD) e exclusão definitiva após o cancelamento
  - Pronto quando: o cliente baixa um ZIP com seus dados, a exclusão tem prazo e auditoria, e há testes.
- [ ] P-04 · E-mails transacionais: confirmação de conta, recuperar senha, teste terminando, conta suspensa — externo: E11
- [ ] P-05 · PDV Embed: autorização de gerente para desconto acima do limite (contrato v1 compatível)
- [ ] P-06 · PDV Embed: publicar o `bipae-pdv.js` em endereço fixo versionado no site
- [ ] P-07 · PDV Embed: integrar na primeira aplicação real e rodar a conformidade — externo: E16

## Fase 4 — ERP

- [ ] F4-01 · Pedidos de compra
- [ ] F4-02 · Entrada de mercadoria com conferência por bipagem e custo médio — depende: F4-01
- [ ] F4-03 · Formação de preço com margem e tributos — depende: F4-02, F3-04
- [ ] F4-04 · Contas a pagar e a receber
- [ ] F4-05 · Fluxo de caixa — depende: F4-04
- [ ] F4-06 · DRE gerencial — depende: F4-04
- [ ] F4-07 · Conciliação bancária por OFX — depende: F4-04
- [ ] F4-08 · Conciliação de cartões e Pix — depende: F4-04
- [ ] F4-09 · Crediário com controle de inadimplência — depende: F2-02, F4-04
- [ ] F4-10 · Relatórios por período, produto, operador, loja, forma de pagamento, margem, ticket médio e curva ABC, exportáveis (CSV, XLSX, PDF)
- [ ] F4-11 · Inventário pelo celular
- [ ] F4-12 · Transferência entre lojas — depende: F1-05
- [ ] F4-13 · Apuração de IBS/CBS (débitos e créditos) — depende: F3-05, F3-19
- [ ] F4-14 · Exportação SPED/EFD e pacote de XMLs para o contador — depende: F3-14, F4-13
- [ ] F4-15 · Boletos via PSP — depende: F4-04 · externo: E9

## Fase 5 — Verticais

- [ ] F5-01 · Etiquetas de gôndola e de balança
- [ ] F5-02 · Promoções avançadas (`packages/promotions`: leve X pague Y, faixa de quantidade, combo)
- [ ] F5-03 · Atacarejo (preço por quantidade) — depende: F5-02
- [ ] F5-04 · Lote e validade com FEFO (farmácia, pet, mercado)
- [ ] F5-05 · Painel de prevenção de perdas — depende: F4-10
- [ ] F5-06 · Self-checkout — depende: F3-14
- [ ] F5-07 · Food service: mesas e comandas
- [ ] F5-08 · App do garçom (celular) — depende: F5-07
- [ ] F5-09 · KDS (tela da cozinha) — depende: F5-07
- [ ] F5-10 · Delivery com taxa por bairro — depende: F5-07
- [ ] F5-11 · Ficha técnica com baixa de insumos — depende: F5-07
- [ ] F5-12 · Moda: grade e venda condicional — depende: F1-04
- [ ] F5-13 · Serviços: ordem de serviço e NFS-e Nacional — depende: F3-11

## Fase 6 — Integrações e IA

- [ ] F6-01 · API pública (OpenAPI) com chaves por cliente e webhooks
- [ ] F6-02 · Pix real com conciliação automática — externo: E9
- [ ] F6-03 · TEF real (maquininha integrada) — externo: E10
- [ ] F6-04 · Cobrança automática dos planos e troca de plano pelo cliente — depende: F6-02, P-02
- [ ] F6-05 · iFood — depende: F5-07 · externo: E14
- [ ] F6-06 · Marketplaces — depende: F6-01 · externo: E14
- [ ] F6-07 · Assistente de IA com confirmação humana (ADR-0011) — externo: E13
- [ ] F6-08 · CRM, fidelidade e campanhas com consentimento (LGPD)

## Fase 7 — Endurecimento

- [ ] F7-01 · Teste de carga: venda < 1 s (p95) e busca < 100 ms com 100 mil produtos locais
- [ ] F7-02 · Revisão de segurança OWASP ASVS nível 2 e correções — externo: E15
- [ ] F7-03 · Auditoria de acessibilidade WCAG 2.2 AA e correções
- [ ] F7-04 · Central de ajuda (documentação do usuário)
- [ ] F7-05 · Guia de implantação para revendas e técnicos
- [ ] F7-06 · Bipaê Desktop para macOS
- [ ] F7-07 · Teste de usabilidade com 10 pessoas (meta: 9 de 10 vendem e emitem sem ajuda) — depende: F3-14 · externo: E15
