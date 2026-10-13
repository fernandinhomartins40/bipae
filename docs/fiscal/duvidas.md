# Dúvidas fiscais para validar com contador

Cada dúvida vira **configuração** no sistema até ser respondida: nada é decidido em silêncio no código. Ao responder, registre data, quem respondeu e a fonte, e atualize o status.

| ID | Status | Tema |
|---|---|---|
| D-001 | 🔴 aberta | IBS/CBS compõem o total da nota em 2026? |
| D-002 | 🔴 aberta | Simples Nacional: preencher IBS/CBS antes de 01/01/2027? |
| D-003 | 🔴 aberta | Quando a rejeição por ausência do grupo IBS/CBS volta? |
| D-004 | 🔴 aberta | Alíquotas de CBS/IBS de 2027–2028 |
| D-005 | 🔴 aberta | Simples Nacional "por fora" em 2027: como o ERP deve tratar |
| D-006 | 🔴 aberta | Data da NFS-e Nacional para o Simples Nacional |
| D-007 | 🟡 parcial | Escopo das NT 2026.007 e 2026.008 |
| D-008 | 🔴 aberta | Arredondamento de IBS/CBS por item × total |
| D-009 | 🔴 aberta | Devolução no PDV com referência por item (VC02-14) |
| D-010 | 🔴 aberta | Faixa de séries de NFC-e permitida para série por terminal |
| D-011 | 🔴 aberta | Datas de homologação e produção da NT 2025.002 v1.52 |
| D-012 | 🔴 aberta | Qual pacote de schemas (XSD) vale para a v1.52 |
| D-013 | 🔴 aberta | Contingência off-line da NFC-e depois da NT 2026.002 |
| D-014 | 🔴 aberta | QR Code versão 3 da NFC-e: obrigatoriedade por UF |
| D-015 | 🔴 aberta | Split payment no grupo de pagamento da NFC-e (NT 2026.006) |
| D-016 | 🔴 aberta | cClassTrib: o dia do fim da vigência ainda vale? |
| D-017 | 🔴 aberta | CFOP para contribuinte exclusivo do IBS/CBS: 84 ou 72 códigos? |
| D-018 | 🔴 aberta | CEST: conferência da tabela extraída e quais mercadorias estão em ST na UF |
| D-019 | 🔴 aberta | Tributos atuais: situações ainda não calculadas e escolhas que viraram configuração |
| D-020 | 🔴 aberta | IBS/CBS/IS: o que ainda não é calculado e o que depende de publicação |
| D-021 | 🟡 parcial | Alíquota geral do ICMS: AL divergente e AP sem fonte oficial |

---

### D-001 — IBS/CBS compõem o total da nota em 2026?

- **Contexto:** o briefing afirma que, em 2026, IBS, CBS e IS **não compõem** o total do item nem da nota. A pesquisa não encontrou fonte que trate especificamente dos campos `vNF` e do total do grupo IBS/CBS nas versões 1.40–1.52 da NT 2025.002.
- **Implementação provisória:** flag por vigência `composicaoTotal.ibsCbs` = `false` para 2026, na tabela de regras (não no código).
- **Pergunta:** confirmar no MOC/anexo de validação vigente se `vNF` exclui IBS/CBS em 2026 e a partir de quando passa a incluir.

### D-002 — Simples Nacional: preencher IBS/CBS antes de 01/01/2027?

- **Contexto:** o Ato Conjunto nº 4/2026 põe o Simples Nacional na 4ª onda (01/01/2027). Um blog citou "Simples Nacional (NF-e produtos): outubro de 2026", sem confirmação.
- **Implementação provisória:** preenchimento configurável por empresa (`preencherIbsCbsAntecipado`), desligado por padrão para CRT 1/2/4.
- **Pergunta:** existe alguma exigência para o Simples antes de 2027? Há vantagem em preencher antes (créditos do adquirente)?

### D-003 — Quando a rejeição por ausência do grupo IBS/CBS volta?

- **Contexto:** a regra UB12-10/rejeição 1115 está como "implementação futura", sem data (Ato Técnico Conjunto nº 1/2026).
- **Implementação provisória:** o Bipaê **sempre** preenche o grupo para CRT 3, como se a rejeição estivesse ativa. Assim não há risco quando ela voltar.
- **Pergunta:** só monitoramento. Há canal oficial de aviso que devemos acompanhar?

### D-004 — Alíquotas de CBS/IBS de 2027–2028

- **Contexto:** a pesquisa não confirmou as alíquotas de referência publicadas para 2027.
- **Atualização de 13/10/2026 (F3-03):** confirmado em fonte oficial que **ainda não há número**. A Tabela de Alíquotas da CBS do Portal da NF-e (IT 2026.002 v1.00) traz "aguarda legislação" para 2027, e a LC 214/2025 (arts. 347 e 349) manda fixar a alíquota por resolução do Senado. O IBS de 2027–2028 está na lei (art. 344): 0,05% estadual + 0,05% municipal, já na tabela do motor.
- **Implementação provisória:** tabela de alíquotas com vigência; 2027 fica sem valor e bloqueia emissão com mensagem clara até ser preenchida.
- **Pergunta:** fonte oficial das alíquotas de referência de 2027.

### D-005 — Simples Nacional "por fora" em 2027

- **Contexto:** a partir de 2027 a empresa do Simples pode optar por recolher IBS/CBS fora do DAS.
- **Implementação provisória:** atributo por empresa e por período (`opcaoIbsCbsForaSimples`) que altera CST/cClassTrib e a apuração.
- **Pergunta:** periodicidade da opção (semestral?), efeitos no documento e na apuração.

### D-006 — Data da NFS-e Nacional para o Simples Nacional

- **Contexto:** fontes divergem entre 01/09/2026 (Resolução CGSN nº 189/2026) e 01/11/2026 (Resolução CGSN nº 191/2026).
- **Implementação provisória:** NFS-e só na Fase 5 (Serviços); data configurável.

### D-007 — Escopo das NT 2026.007 e 2026.008

- **Contexto:** citadas no comunicado da RFB de 05/10/2026 junto com a v1.52; conteúdo não identificado.
- **Pergunta:** afetam NF-e/NFC-e de varejo?

### D-008 — Arredondamento de IBS/CBS por item × total

- **Contexto:** o arredondamento por item e a soma no total podem gerar diferença de centavos.
- **Implementação provisória:** calcular por item com 2 casas (meia para cima), total = soma dos itens; regra de arredondamento parametrizada.
- **Pergunta:** confirmar com as regras de validação de totais da NT vigente.

### D-009 — Devolução no PDV com referência por item (VC02-14)

- **Contexto:** a v1.52 exige referência ao documento original **por item** na NF-e de devolução (produção prevista para 16/11/2026).
- **Implementação provisória:** a troca/devolução no PDV sempre guarda o vínculo item a item com a venda original (já previsto no modelo de dados).
- **Pergunta:** devolução de consumidor final sem identificação (NFC-e sem CPF) segue qual fluxo de nota de entrada?

### D-010 — Faixa de séries de NFC-e permitida para série por terminal

- **Contexto:** o Adendo 01 exige série exclusiva por terminal (web ou desktop). Fontes secundárias indicam séries 000–889 de uso livre, 890–899 reservadas para nota avulsa, e que a exigência de série exclusiva 890–989 para contingência foi revogada (Ajuste SINIEF 26/19).
- **Implementação provisória:** alocação automática na faixa configurável `1..889`, nunca reutilizando série; contingência usa a mesma série do terminal.
- **Pergunta:** confirmar no MOC da NFC-e vigente e na legislação da UF prioritária.

### D-007 — atualização de 13/10/2026

- **O que a fonte oficial (portal SVRS) diz:** a NT 2026.007 v1.10 trata de emissão por contribuinte sem inscrição estadual e de validações na LCC-RFB e no CCC; a NT 2026.008 v1.00 cria campos para o Valor Líquido do Produto.
- **Falta responder:** se algum desses campos é obrigatório para o varejo (NFC-e) e a partir de quando. Ler os PDFs na tarefa F3-07.

### D-011 — Datas de homologação e produção da NT 2025.002 v1.52

- **Contexto:** a v1.52 está publicada (01/10/2026, portal SVRS). As datas de homologação (26/10/2026) e produção (16/11/2026) só aparecem em fontes secundárias, e o portal avisa que as datas podem mudar.
- **Implementação provisória:** as regras da v1.52 (VC02-14 e VC02-50) entram na tabela de regras com vigência configurável, não fixa no código.
- **Pergunta:** quais são as datas oficiais de homologação e produção?

### D-012 — Qual pacote de schemas (XSD) vale para a v1.52

- **Contexto:** o último pacote completo de schemas listado no portal SVRS é o 010b v1.30, de 07/10/2025. Depois dele só aparece o schema de um evento (v1.40). As versões v1.40 a v1.52 anunciaram "novos campos", mas não há pacote de leiaute mais novo na lista.
- **Implementação provisória:** gerar e validar o XML contra o pacote 010b v1.30, com a versão do pacote registrada como dado (não fixa no código).
- **Pergunta:** existe pacote de leiaute posterior ao 010b v1.30? Conferir a página de schemas antes de começar a F3-07.

### D-013 — Contingência off-line da NFC-e depois da NT 2026.002

- **Contexto:** a NT 2026.002 v1.10a (25/08/2026) regulamenta a contingência off-line da NFC-e e da NF-e com DANFE Simplificado Tipo 2 (tpEmis 9). O plano do Bipaê previa a contingência off-line tradicional da NFC-e.
- **Implementação provisória:** nenhuma ainda. O caixa já vende sem internet e guarda a venda; falta decidir o formato fiscal da contingência.
- **Pergunta:** a contingência off-line da NFC-e mudou (prazo de transmissão, impressão, tpEmis)? Quais UFs aceitam? Ler a NT antes da F3-15.

### D-014 — QR Code versão 3 da NFC-e: obrigatoriedade por UF

- **Contexto:** a NT 2025.001 v1.01 (26/06/2025) define o QR Code versão 3 da NFC-e.
- **Implementação provisória:** a versão do QR Code fica como configuração por UF.
- **Pergunta:** a versão 3 já é obrigatória? Em quais UFs e desde quando? A versão 2 ainda é aceita?

### D-015 — Split payment no grupo de pagamento da NFC-e (NT 2026.006)

- **Contexto:** a NT 2026.006 RTC v1.00 (25/08/2026) e o IT 2026.001 v1.01 tratam da vinculação do pagamento à nota para o split payment, com tabela própria de meios de pagamento.
- **Implementação provisória:** nada a ativar no caixa: o split payment começa facultativo e B2B em 2027 (ver `versoes.md`, seção 5).
- **Pergunta:** algum campo novo do grupo de pagamento já é exigido na NFC-e em 2026?

### D-016 — cClassTrib: o dia do fim da vigência ainda vale?

- **Contexto:** a tabela oficial (IT 2025.002 v1.70) traz as colunas `dIniVig` e `dFimVig`, sem dizer se o fim é o último dia válido ou o primeiro inválido. Três códigos (220001, 220002 e 220003, do regime de incorporação imobiliária e parcelamento do solo) estão com **início e fim em 01/01/2026**.
- **Implementação provisória:** no dia exato do fim, o motor responde "vigência indefinida" e não escolhe o código sozinho. Esses três códigos não se aplicam a venda de mercadoria no varejo.
- **Pergunta:** o `dFimVig` é inclusivo? Os três códigos estão extintos ou nunca entraram em vigor?

### D-017 — CFOP para contribuinte exclusivo do IBS/CBS: 84 ou 72 códigos?

- **Contexto:** o texto do IT 2023.002 v2.00 diz que 84 CFOPs são permitidos ao contribuinte exclusivo do IBS/CBS (`indExcIBSCBS` = 1). A planilha da v2.10 (04/09/2026) marca 72. O PDF da v2.10 ainda não foi lido.
- **Implementação provisória:** vale a planilha mais recente, que é o que o motor carrega. A coluna é só informativa até a entrada em produção e não afeta o varejo comum (contribuinte do ICMS).
- **Pergunta:** a v2.10 reduziu a lista de propósito?

### D-018 — CEST: conferência da tabela extraída e quais mercadorias estão em ST na UF

- **Contexto:** a tabela de CEST (1.043 códigos) foi extraída do texto consolidado do Convênio ICMS 142/18 no site do CONFAZ, porque não existe arquivo oficial estruturado. A lista é nacional e diz o que **pode** estar em substituição tributária; quem decide o que **está** é cada UF, por legislação própria, que não está no sistema.
- **Implementação provisória:** o sistema valida o código e sugere CEST pelo NCM, sem decidir sozinho se há ST. A data de início de cada item é a que o convênio informa; quando ele não informa item a item, fica 01/01/2019. O Anexo XXVII (escala industrial não relevante) não foi importado.
- **Pergunta:** o contador pode conferir uma amostra dos CEST do ramo da loja? De onde virá a lista de mercadorias em ST da UF (item E2, UF de homologação)?

### D-019 — Tributos atuais: situações ainda não calculadas e escolhas que viraram configuração

- **Contexto:** o cálculo de ICMS, PIS, COFINS e IPI (F3-04) cobre o que o varejo usa no dia a dia. O restante não é calculado "mais ou menos": o sistema avisa que a situação ainda não está disponível.
- **Ainda não calculado:**
  - ICMS com CST 30 (isenta com ST), CST 90 e CSOSN 900 (outras), que dependem de combinação livre de campos;
  - ICMS monofásico de combustíveis (CST 02, 15, 53 e 61);
  - FCP da substituição tributária (FCP-ST) e ICMS desonerado;
  - valores de ICMS retido anteriormente (CST 60 e CSOSN 500), que vêm da nota de compra;
  - diferencial de alíquotas (DIFAL) para consumidor final de outra UF.
- **Virou configuração da regra, sem valor suposto no código:**
  - se o IPI entra na base do ICMS próprio (`includeIpiInBase`);
  - se o ICMS sai da base do PIS e da COFINS (`excludeIcms`). A Lei 14.592/2023 trata disso no regime não cumulativo; no cumulativo vale a decisão do STF (Tema 69), que precisa ser confirmada;
  - o arredondamento de cada tributo.
- **Faltam as alíquotas reais:** ICMS interno e interestadual, MVA e reduções da UF de homologação (item externo E2). Os testes usam 18% e MVA de 40% só como exemplo.
- **Perguntas:** o ICMS sai da base do PIS/COFINS também no cumulativo? No ICMS-ST do Simples Nacional, o abatimento usa a alíquota interna cheia? Quais das situações "ainda não calculadas" o contador considera necessárias para a primeira loja?

### D-020 — IBS/CBS/IS: o que ainda não é calculado e o que depende de publicação

- **Contexto:** o cálculo de IBS e CBS (F3-05) cobre a tributação integral (CST 000), a alíquota reduzida (CST 200) e as situações sem tributo (isenção, imunidade, documento específico). É o que a tabela oficial permite na NFC-e para o varejo comum.
- **Ainda não calculado** (o sistema avisa, não aproxima): alíquotas uniformes e fixas (CST 010, 011, 220, 221), redução de base (222), diferimento (510, 515), suspensão (550), monofásica (620), transferência de crédito e ajustes (800, 810, 811), exclusão de base (830), crédito presumido e compras governamentais.
- **Depende de publicação oficial; hoje o cálculo fica bloqueado com mensagem clara:**
  - alíquota da CBS de 2027 em diante (D-004);
  - alíquotas de referência do IBS de 2029 em diante, por resolução do Senado, e as alíquotas próprias de cada UF e município;
  - alíquotas do Imposto Seletivo, que virão em lei ordinária. O motor calcula IS por percentual e por unidade, mas não traz nenhum número.
- **Em tabela, com fonte:** o que sai da base (ICMS, ISS, PIS e COFINS de 2026 a 2032), o que entra (IS a partir de 2027) e a redução do ICMS/ISS de 2029 a 2032.
- **Perguntas:**
  - O ICMS-ST do item também sai da base do IBS/CBS, ou só o ICMS próprio?
  - O Imposto Seletivo será destacado à parte do preço (como o IPI) ou embutido? O motor assume que é à parte e o soma à base.
  - A redução do ICMS de 2029 a 2032 será aplicada pelo sistema sobre a alíquota da legislação, ou cada UF publicará a alíquota já reduzida? Hoje a proporção fica só em tabela, sem alterar o cálculo do ICMS.
  - Continuam valendo D-001 (total da nota), D-002 e D-003 (obrigatoriedade por regime) e D-008 (arredondamento), que são configuração do documento e entram na F3-06 e na F3-07.

### D-021 — Alíquota geral do ICMS: 7 UFs sem confirmação oficial (AL divergente)

- **Contexto:** o Bipaê vai cobrir as 27 UFs (decisão de 13/10/2026). A alíquota geral de 20 delas foi confirmada em site oficial do estado. Faltam sete, listadas em `cobertura-ufs-regimes.md`, seção 2.1.
- **Alagoas (divergente):** o Portal Nacional da DIFAL mostra "20,5%" no campo e "19% a partir de 01/04/2023" na observação, mais 1% de FECOEP. Fontes privadas de 2026 citam 20% e 20,5%.
- **Só em fonte secundária ou em texto oficial possivelmente defasado:** AP (18%), MA (23%), PI (22,5%), RS (17%), SE (19%) e TO (20%).
- **Implementação provisória:** essas sete UFs ficam como "falta configurar" no motor. Uma empresa dessas UFs consegue usar o caixa, mas o cálculo do ICMS pede a alíquota ao contador até a confirmação.
- **Pergunta:** o contador confirma as sete alíquotas e as leis? O adicional de FECOEP de AL e de SE se soma à alíquota geral em todos os produtos ou só nos listados?
- **Atualização de 13/10/2026 (F3-24):** MA (23%), PI (22,5%), RS (17%), SE (19%) e TO (20%) confirmadas em fonte oficial (Assembleias, Receita Estadual do RS e decisão do STF na ADI 7375). Continuam abertas: **AL**, onde a Lei 8.779/2022 diz 19% e o Portal Nacional da DIFAL mostra 20,5% (pode haver lei posterior), e **AP**, sem fonte oficial atual localizada.
