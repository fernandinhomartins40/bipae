# Dúvidas fiscais para validar com contador

Cada dúvida vira **configuração** no sistema até ser respondida: nada é decidido em silêncio no código. Ao responder, registre data, quem respondeu e a fonte, e atualize o status.

| ID | Status | Tema |
|---|---|---|
| D-001 | ✅ resolvida | IBS/CBS compõem o total da nota em 2026? |
| D-002 | ✅ resolvida | Simples Nacional: preencher IBS/CBS antes de 01/01/2027? |
| D-003 | ✅ resolvida | Quando a rejeição por ausência do grupo IBS/CBS volta? |
| D-004 | 🟡 aguarda publicação | Alíquotas de CBS/IBS de 2027–2028 |
| D-005 | ✅ resolvida | Simples Nacional "por fora" em 2027: como o ERP deve tratar |
| D-006 | ✅ resolvida | Data da NFS-e Nacional para o Simples Nacional |
| D-007 | ✅ resolvida | Escopo das NT 2026.007 e 2026.008 |
| D-008 | ✅ resolvida | Arredondamento de IBS/CBS por item × total |
| D-009 | 🟡 parcial | Devolução no PDV com referência por item (VC02-14) |
| D-010 | ✅ resolvida | Faixa de séries de NFC-e permitida para série por terminal |
| D-011 | ✅ resolvida | Datas de homologação e produção da NT 2025.002 v1.52 |
| D-012 | ✅ resolvida | Qual pacote de schemas (XSD) vale para a v1.52 |
| D-013 | ✅ resolvida | Contingência off-line da NFC-e depois da NT 2026.002 |
| D-014 | ✅ resolvida | QR Code versão 3 da NFC-e: obrigatoriedade por UF |
| D-015 | ✅ resolvida | Split payment no grupo de pagamento da NFC-e (NT 2026.006) |
| D-016 | ✅ resolvida | cClassTrib: o dia do fim da vigência ainda vale? |
| D-017 | ✅ resolvida | CFOP para contribuinte exclusivo do IBS/CBS: 84 ou 72 códigos? |
| D-018 | 🟡 parcial | CEST: conferência da tabela extraída e quais mercadorias estão em ST na UF |
| D-019 | 🔴 aberta | Tributos atuais: situações ainda não calculadas e escolhas que viraram configuração |
| D-020 | 🔴 aberta | IBS/CBS/IS: o que ainda não é calculado e o que depende de publicação |
| D-022 | ✅ resolvida | NFC-e em MG: ambiente próprio ou SVRS? |
| D-021 | ✅ resolvida | Alíquota geral do ICMS: AL divergente e AP sem fonte oficial |
| D-023 | ✅ resolvida | Código de barras do DANFE com o CNPJ alfanumérico |
| D-024 | ✅ resolvida | Custo de aquisição na compra: com ou sem os créditos |
| D-025 | ✅ resolvida | DIFAL a não contribuinte: base única ou base dupla por UF |
| D-026 | ✅ resolvida | NF-e na transferência entre lojas |
| D-027 | ✅ resolvida | Apuração do IBS e da CBS: quando o crédito entra (contador) |
| D-028 | 🟡 parcial | Unidade do qLote na NF-e de compra |
| D-029 | ✅ resolvida | Pix e vale do caixa: qual código tPag |
| D-030 | ✅ resolvida | Descrição do primeiro item da NFC-e em homologação |
| D-031 | 🟡 aguarda o dono | SPED EFD ICMS/IPI: gerar no Bipaê ou deixar com o contador (E21) |
| D-032 | ✅ resolvida | NFC-e de entrega a domicílio (delivery) |
| D-033 | ✅ resolvida | Venda condicional: notas da remessa, da volta e da venda |
| D-034 | 🟡 parcial | Código de benefício fiscal (cBenef) por UF |
| D-035 | 🟡 configurável | Natureza da operação da entrada simbólica do condicional passa de 60 caracteres |
| D-036 | 🟡 a confirmar com o certificado | NFS-e Nacional: mensagem JSON da Sefin, assinatura, convênio do município e grupo do IBS/CBS |
| D-037 | 🟡 parcial | NF-e de devolução de venda (entrada do cliente): a referência item a item está confirmada (NT 2025.002 v1.52); falta o imposto por regime |

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
- **Atualização de 16/10/2026 (fontes oficiais):** a alíquota **continua sem número oficial**, e o motivo é de calendário, não de pesquisa.
  - **Rito (LC 214/2025, art. 349):** o Executivo propõe, o Tribunal de Contas da União calcula e o Senado Federal fixa por resolução, no ano anterior ao da vigência. Segundo o portal do TCU (notícia de 31/03/2026), a Receita Federal entregaria a proposta de 2027 até 14/09/2026. A resolução do Senado ainda não saiu.
  - **Se o Senado atrasar (art. 349, § 2º):** valem as alíquotas calculadas pelo TCU até a fixação. A alíquota fixada depois só vale a partir do segundo mês seguinte ao da fixação.
  - **Em 2027 e 2028 (art. 347):** a CBS é a alíquota de referência menos 0,1 ponto percentual. Nas reduções de alíquota, o desconto é proporcional. O IBS fica em 0,05% estadual + 0,05% municipal (art. 344), já na tabela.
  - **Regra no Bipaê (mantida):** sem número oficial, o cálculo de 2027 para com mensagem clara e não supõe valor. Quando a resolução do Senado (ou o cálculo do TCU, se o Senado atrasar) for publicada, basta acrescentar a linha na tabela de alíquotas (`packages/fiscal/src/tables/data`), já com o desconto de 0,1 ponto do art. 347.

### D-005 — Simples Nacional "por fora" em 2027

- **Contexto:** a partir de 2027 a empresa do Simples pode optar por recolher IBS/CBS fora do DAS.
- **Implementação provisória:** atributo por empresa e por período (`opcaoIbsCbsForaSimples`) que altera CST/cClassTrib e a apuração.
- **Pergunta:** periodicidade da opção (semestral?), efeitos no documento e na apuração.
- **Resolvida em 16/10/2026 (fonte oficial: LC 214/2025, art. 517, que altera a LC 123/2006, art. 13, §§ 9º a 11, na redação da LC 227/2026, no site do Planalto):**
  - **Periodicidade:** semestral. A opção vale para os semestres que começam em janeiro e em julho. É feita em **setembro** (para o semestre de janeiro) ou em **março** (para o de julho), na forma regulamentada pelo CGSN. Não pode ser desfeita dentro do semestre. Quem abre a empresa pode optar desde o início da atividade (§ 11).
  - **Efeito na apuração:** com a opção, o IBS e a CBS saem do DAS e seguem o regime regular. A apuração é mensal (LC 214, art. 43) e consolida todos os estabelecimentos (art. 42).
  - **Efeito no crédito de quem compra:** o comprador no regime regular credita o IBS e a CBS destacados e extintos (art. 47, § 2º, I), inclusive na compra de optante do Simples (art. 47, § 3º). Sem a opção, o crédito fica limitado ao valor cobrado no regime único, pela alíquota informada no documento (LC 123, art. 23, §§ 1º e 2º).
  - **Regra no Bipaê:** a opção continua sendo um campo da empresa (`companies.ibs_cbs_regular`), com mudança registrada na auditoria e usada na apuração (F4). A tela explica o prazo e o semestre. Validar se a data de mudança cai em setembro ou março não vira bloqueio: quem confirma a opção é o portal do Simples Nacional, não o Bipaê.
  - **Pendente de publicação:** a resolução do CGSN com o procedimento da opção. O leiaute do documento do optante no regime regular a partir de 2027 segue as NTs da reforma (D-020).

### D-006 — Data da NFS-e Nacional para o Simples Nacional

- **Contexto:** fontes divergem entre 01/09/2026 (Resolução CGSN nº 189/2026) e 01/11/2026 (Resolução CGSN nº 191/2026).
- **Implementação provisória:** NFS-e só na Fase 5 (Serviços); data configurável.
- **Resolvida em 16/10/2026 (fonte oficial: notícia da Receita Federal de 14/08/2026, "Simples Nacional: NFS-e Nacional será obrigatória para ME e EPP a partir de 1º de novembro de 2026", em gov.br/receitafederal):**
  - **Vale 01/11/2026.** A Resolução CGSN nº 191, de 04/08/2026, altera a Resolução CGSN nº 140/2018 e "revogou expressamente a Resolução CGSN nº 189, de 2026", que previa 01/09/2026.
  - **Quem:** microempresa e empresa de pequeno porte do Simples que prestam serviço sujeito à NFS-e.
  - **Como:** pelo Emissor Nacional, "seja pela aplicação web, seja por integração via API".
  - **CBS e IBS:** as regras de CBS e IBS dos optantes só produzem efeitos em 01/01/2027.
  - **Regra no Bipaê:** a NFS-e (F5-13) é emitida pela API do Emissor Nacional (Sefin Nacional), a mesma para todos os regimes. Para empresa do Simples com serviço, a NFS-e nacional é o caminho padrão desde 01/11/2026, sem integração com emissor municipal.

### D-007 — Escopo das NT 2026.007 e 2026.008

- **Contexto:** citadas no comunicado da RFB de 05/10/2026 junto com a v1.52; conteúdo não identificado.
- **Pergunta:** afetam NF-e/NFC-e de varejo?

### D-008 — Arredondamento de IBS/CBS por item × total

- **Contexto:** o arredondamento por item e a soma no total podem gerar diferença de centavos.
- **Implementação provisória:** calcular por item com 2 casas (meia para cima), total = soma dos itens; regra de arredondamento parametrizada.
- **Pergunta:** confirmar com as regras de validação de totais da NT vigente.
- **Resolvida em 16/10/2026 (fonte oficial: NT 2025.002-RTC v1.40, publicada pelo Comitê Gestor do IBS em https://www.cgibs.gov.br e no Portal da NF-e):**
  - **No item:** a SEFAZ refaz a conta `vIBSUF = vBC × pIBSUF / 100` (e o mesmo para `vIBSMun` e `vCBS`) e "aceita uma tolerância de 0,01 a mais ou a menos". A nota não fixa o modo de arredondamento do valor. Com 2 casas e meia para cima, o Bipaê fica sempre dentro da tolerância.
  - **Alíquota com redução:** a NT manda calcular a `pAliqEfet` "com 4 casas decimais, com arredondamento na última casa decimal". O motor passou a arredondar a alíquota efetiva em 4 casas antes de multiplicar pela base. Antes ele usava a alíquota sem arredondar e só a arredondava no XML.
  - **Nos totais:** o grupo `IBSCBSTot` tem de ser **a soma exata dos itens**, sem tolerância. São as rejeições 1076 a 1093, por exemplo "Total de CBS difere da soma dos itens". O Bipaê já somava os itens, nunca recalculava sobre o total.
  - **Regra no Bipaê:** cálculo por item com 2 casas (meia para cima, configurável), alíquota efetiva com 4 casas e total igual à soma dos itens. Um teste confere todas as classificações com redução contra a conta da SEFAZ.

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
- **Resolvida em 16/10/2026 (fontes oficiais):** a NT 2025.001 v1.01 diz que todas as UFs aceitam a versão 3 desde 01/09/2025, opcional para emitente com CNPJ; o Bipaê usa a versão 3. Sobre as URLs sem protocolo na tabela do ENCAT: o schema oficial do campo `qrCode` (leiaute 4.00, pacote PL_010f, `leiauteNFe_v4.00.xsd`) só aceita texto que começa com `http://` ou `https://` (padrão `((HTTPS?|https?)://.*\?p=...)`). Acrescentar `https://` é, portanto, exigência do próprio schema. O `urlChave` não tem padrão de protocolo (só 21 a 85 caracteres).

### D-015 — Split payment no grupo de pagamento da NFC-e (NT 2026.006)

- **Contexto:** a NT 2026.006 RTC v1.00 (25/08/2026) e o IT 2026.001 v1.01 tratam da vinculação do pagamento à nota para o split payment, com tabela própria de meios de pagamento.
- **Implementação provisória:** nada a ativar no caixa: o split payment começa facultativo e B2B em 2027 (ver `versoes.md`, seção 5).
- **Pergunta:** algum campo novo do grupo de pagamento já é exigido na NFC-e em 2026?

### D-016 — cClassTrib: o dia do fim da vigência ainda vale?

- **Contexto:** a tabela oficial (IT 2025.002 v1.70) traz as colunas `dIniVig` e `dFimVig`, sem dizer se o fim é o último dia válido ou o primeiro inválido. Três códigos (220001, 220002 e 220003, do regime de incorporação imobiliária e parcelamento do solo) estão com **início e fim em 01/01/2026**.
- **Implementação anterior:** no dia exato do fim, o motor respondia "vigência indefinida" e não escolhe o código sozinho. Esses três códigos não se aplicam a venda de mercadoria no varejo.
- **Pergunta:** o `dFimVig` é inclusivo? Os três códigos estão extintos ou nunca entraram em vigor?
- **Resolvida em 16/10/2026 (fonte oficial):** a própria tabela oficial de cClassTrib responde. Os códigos 220001, 220002 e 220003 têm início e fim em 01/01/2026 e foram substituídos pelos **221002, 221003 e 221004**, com a mesma descrição e vigentes **desde 01/01/2026**. Se o fim fosse inclusivo, os dois códigos valeriam juntos nesse dia. O Informe Técnico 2025.002 v1.60, no histórico de alterações, chama a mudança de "exclusão do cClassTrib do CST 220 (inclusão de fim de vigência)".
  - **Regra no Bipaê:** o `dFimVig` é o primeiro dia em que o código não vale mais. Início igual ao fim quer dizer código excluído, que nunca vale. O motor deixou de responder "vigência indefinida" (`classTribStatus` em `packages/fiscal/src/tables/class-trib.ts`).

### D-017 — CFOP para contribuinte exclusivo do IBS/CBS: 84 ou 72 códigos?

- **Contexto:** o texto do IT 2023.002 v2.00 diz que 84 CFOPs são permitidos ao contribuinte exclusivo do IBS/CBS (`indExcIBSCBS` = 1). A planilha da v2.10 (04/09/2026) marca 72. O PDF da v2.10 ainda não foi lido.
- **Implementação provisória:** vale a planilha mais recente, que é o que o motor carrega. A coluna é só informativa até a entrada em produção e não afeta o varejo comum (contribuinte do ICMS).
- **Pergunta:** a v2.10 reduziu a lista de propósito?
- **Resolvida em 16/10/2026 (fontes oficiais):**
  - **O PDF da v2.10** foi lido. Ele só inclui as colunas Título e Descrição e diz textualmente que "não altera as demais colunas nem os indicadores já publicados". A v2.10, portanto, não mudou a lista de propósito.
  - **A planilha oficial da v2.10**, guardada em `packages/fiscal/sources`, foi contada de novo direto no arquivo, sem passar pelo gerador: há **72 CFOPs com `indExcIBSCBS` = 1** em 619 linhas, nenhum com fim de vigência. O número "84 códigos" aparece só no texto do PDF da v2.00. A planilha da v2.00 não está disponível fora do portal para comparar.
  - **Vale a planilha:** a regra de validação I08-191 da NT 2026.007 v1.00 (rejeição 159, "Operação não permitida para contribuinte exclusivo do IBS/CBS", exclusiva da SVRS) manda "consultar tabela de CFOP permitidos ... publicada no Portal Nacional da NF-e". Quem rejeita é a planilha, não o número do texto. Exceções da regra: devolução (`finNFe` = 4) e nota de crédito tipo 03.
  - **Regra no Bipaê:** a tabela gerada da planilha oficial continua sendo a fonte. A rejeição 159 foi incluída nas rejeições explicadas. Se uma versão nova da planilha mudar a coluna, basta trocar o arquivo e regerar. A regra só vale para quem emite NF-e sem inscrição estadual, o que não é o caso do varejo comum.

### D-018 — CEST: conferência da tabela extraída e quais mercadorias estão em ST na UF

- **Contexto:** a tabela de CEST (1.043 códigos) foi extraída do texto consolidado do Convênio ICMS 142/18 no site do CONFAZ, porque não existe arquivo oficial estruturado. A lista é nacional e diz o que **pode** estar em substituição tributária; quem decide o que **está** é cada UF, por legislação própria, que não está no sistema.
- **Implementação provisória:** o sistema valida o código e sugere CEST pelo NCM, sem decidir sozinho se há ST. A data de início de cada item é a que o convênio informa; quando ele não informa item a item, fica 01/01/2019. O Anexo XXVII (escala industrial não relevante) não foi importado.
- **Pergunta:** o contador pode conferir uma amostra dos CEST do ramo da loja? De onde virá a lista de mercadorias em ST da UF (item E2, UF de homologação)?
- **Atualização de 16/10/2026 (F3-26.a, fonte oficial):** a lista da UF vem do ato publicado pela própria SEFAZ, guardado em `packages/fiscal/sources` e lido por um gerador (nada digitado à mão).
  - **SP, produtos alimentícios:** Portaria SRE 12/2026, Anexo Único, com 69 itens com CEST, NCM e IVA-ST, válidos de 01/05/2026 a 31/01/2029. Todos os CEST conferem com o Convênio ICMS 142/18.
  - **Como o Bipaê usa:** a regra de ICMS da empresa mostra a MVA oficial pelo NCM, e o botão "Usar" preenche a MVA e a fonte. A empresa confere a descrição do CEST (limites de embalagem e exceções) e confirma.
  - **O motor não decide sozinho se há ST:** só calcula com a regra que a empresa salvou.
  - **Em aberto:** os outros segmentos de SP (bebidas, higiene e limpeza, que mudaram em 2026) e as demais UFs, nas tarefas F3-26.b a F3-26.d.
- **Atualização de 16/10/2026 (F3-26.b, fonte oficial):** o que está e o que saiu da ST em SP vem do texto consolidado da Portaria CAT 68/2019, guardado e lido por gerador, por anexo e por item:
  - **saíram da ST em 01/01/2026 (Portaria SRE 64/2025):** medicamentos, bebidas alcoólicas, lâmpadas e artefatos de uso doméstico;
  - **saíram em 01/04/2026 (Portaria SRE 94/2025):** perfumaria e higiene pessoal;
  - **saíram em 01/07/2026 (Portaria SRE 9/2026):** papelaria e as águas do Anexo III;
  - **saíram em 01/08/2026 (Portaria SRE 20/2026):** produtos de limpeza e ração;
  - **saíram em 01/10/2026 (Portaria SRE 34/2026):** pneus, tintas, autopeças, ferramentas e materiais elétricos;
  - **continuam na ST:** fumo, cimento, cerveja, chope e refrigerante (Anexo III), veículos, alimentícios (com 39 itens já fora), construção e eletrônicos (em parte).
  - **Conferência:** nenhum CEST com IVA-ST na Portaria SRE 12/2026 aparece como fora da ST. As duas portarias concordam.
  - **Regra no Bipaê:** a regra de ICMS avisa quando o NCM saiu da ST, com a data e a portaria.
  - **Ainda falta (F3-26.e):** a base de cálculo de cerveja, chope e refrigerante depois que a Portaria SRE 9/2026 revogou os valores da Portaria SRE 89/2025.
- **Atualização de 17/10/2026 (F3-26.c, Paraná, fonte oficial):** duas fontes da SEFA-PR, guardadas em `packages/fiscal/sources` e lidas por gerador:
  - **MVA:** texto consolidado da Resolução SEFA 571/2019 (versão de 20/12/2025, com a Resolução SEFA 1.245/2025). São 444 itens com CEST, NCM e MVA original, em 26 tabelas. Vale a redação atual de cada item; a "redação original" que o texto consolidado repete fica de fora, e itens e seções revogados também. Cosméticos e materiais de construção usam a tabela nova, que vale a partir de 01/04/2026.
  - **O que está e o que saiu da ST:** Anexo IX do RICMS/PR (Decreto 7.871/2017), texto consolidado de 13/10/2026. Guardamos as páginas 2818 a 3318 do PDF oficial, sem alteração, e o hash do PDF inteiro fica no manifesto. Saíram da ST:
    - artefatos de uso doméstico, papelaria e materiais de limpeza em 01/08/2024 (Decreto 6.048/2024);
    - sorvetes em 01/02/2025 (Decreto 8.404/2024);
    - eletrônicos, eletroeletrônicos e eletrodomésticos em 01/03/2026 (Decreto 12.828/2026);
    - celulares e cartões inteligentes em 01/03/2026 (Decreto 12.924/2026).
  - **A resolução ainda traz a MVA de eletrônicos e celulares:** o Bipaê para de sugerir essas MVAs a partir de 01/03/2026, porque o RICMS manda.
  - **Conferência:** a numeração das seções é a mesma nas duas fontes, e o gerador confere o nome de cada seção. Os itens revogados no RICMS (sucos, carnes temperadas) também foram revogados na resolução.
  - **CEST que o Convênio ICMS 142/18 já tirou:** três CEST de água mineral (03.001.00, 03.002.00 e 03.004.00) continuam na resolução. Ficam, porque o NCM é o que identifica o produto.
  - **Ainda sem tabela por item:** autopeças, medicamentos, veículos, combustíveis e venda porta a porta, que têm MVA única por hipótese, escrita no texto do artigo. A tela não sugere MVA para esses casos.
- **Atualização de 17/10/2026 (F3-26.c.MG, Minas Gerais, fonte oficial):** Parte 2 do Anexo XV do RICMS/MG, na versão "sem dispositivos" do site da SEF/MG, que traz só o texto em vigor. São as páginas 6 a 11 e as notas de rodapé 2 a 4, guardadas em `packages/fiscal/sources` e lidas por gerador:
  - **Itens:** 986 itens com MVA, em 24 capítulos. A data de efeito de cada linha sai da nota de rodapé (por exemplo, "Efeitos a partir de 1º/12/2022 - Dec. nº 48.534").
  - **Duas ou três MVAs no mesmo CEST:** a da indústria e a do atacadista ou distribuidor (cerveja 140% e 70%), ou importado e nacional (vinho 115,32%, 50,61% e 72,25%). Viram linhas separadas, cada uma com o nome na descrição.
  - **Revogados:** 17 itens. O CEST sai do número do item, porque a numeração da Parte 2 é a do Convênio ICMS 142/18, e o gerador confere isso em todos os itens que continuam. A data vem da nota.
  - **Coluna "exceções":** as UFs onde o protocolo não vale para o item entram na descrição.
  - **Fora da sugestão:** combustíveis (remetem ao Capítulo XIV) e energia elétrica, que não têm MVA na tabela.
  - **Erro no texto oficial:** o item 24/2.1 traz o NCM "33204.17.00". O token malformado fica de fora e o item vale pelos outros NCM (2821 e 3206).
- **Atualização de 17/10/2026 (F3-26.c.RS, Rio Grande do Sul, fonte oficial):** Apêndice II do RICMS/RS (Decreto 37.699/1997), no texto em vigor do site de legislação da Receita Estadual, guardado em `packages/fiscal/sources` e lido por gerador:
  - **Seção II:** ST só do RS, sem acordo com outras UFs (carnes, papel para cigarro e telhas). São 9 itens.
  - **Seção III:** ST de acordos com outras UFs, em 14 segmentos. A MVA usada é a da operação interna; a tabela também traz as MVAs para entradas com 12% e 4%, citadas na nota.
  - **Sem MVA na tabela:** bebidas (art. 92, III, do Livro III), cigarros, combustíveis, medicamentos e bebidas quentes. A tela diz que o produto está na ST e que a MVA não está nos atos que o Bipaê tem.
  - **Em aberto:** os segmentos revogados não trazem CEST, então ainda não aparecem como "saiu da ST".
- **Atualização de 17/10/2026 (F3-26.c.SC, Santa Catarina, fonte oficial):** Anexo 1-A do RICMS/SC (art. 15 do Anexo 3: as mercadorias em ST são as do Anexo 1-A), na página da SEF/SC que traz a redação atual e a passada. Está guardado em `packages/fiscal/sources` e é lido por gerador:
  - **Continuam na ST:** bebidas alcoólicas (Seção III-A), cervejas, refrigerantes e águas, cigarros, cimento, combustíveis, energia elétrica, pneus, veículos e venda porta a porta.
  - **MVA:** só bebidas alcoólicas e cervejas/refrigerantes têm MVA na tabela, com 80 linhas. A sugestão usa a MVA original; as colunas "ajustadas" (12%, 4% e diferimento parcial do TTD) ficam de fora. Cerveja e refrigerante têm duas MVAs, a do atacadista e a da indústria.
  - **Saíram da ST, com data e decreto:**
    - limpeza, papéis e plásticos e alimentícios em 01/04/2018 (Decreto 1.541/2018);
    - ferramentas, lâmpadas, construção, elétricos, papelaria, eletrônicos e tintas em 01/05/2019 (Decreto 104/2019);
    - rações em 01/03/2020;
    - autopeças em 01/04/2020;
    - medicamentos, cosméticos e a Seção III de bebidas em 01/01/2021 (Decreto 982/2020);
    - sorvetes em 01/04/2023 (Decreto 74/2023).
  - **CEST que saíram:** vêm da redação passada de cada seção revogada.
  - **Venda porta a porta (Seção XXVI):** perfumes e cosméticos vendidos assim continuam na ST, e a tela mostra isso.
- **Atualização de 17/10/2026 (F3-26.c.BA, Bahia, fonte oficial):** PDF do Anexo 1 do RICMS/BA (Decreto 13.780/2012), na redação vigente em 2026, publicado pela DITRI da SEFAZ-BA. Está guardado em `packages/fiscal/sources` e é lido por gerador:
  - **Itens:** 282 linhas com CEST, NCM e a MVA original das operações internas, em 13 segmentos.
  - **Faixas de CEST** ("17.044.00 a 17.044.27") entram inteiras, pelos CEST do Convênio ICMS 142/18.
  - **Notas e redação anterior** (entre aspas) ficam de fora. A sugestão vale de 01/01 a 31/12/2026, porque a SEFAZ-BA publica um arquivo por ano.
  - **Fora da sugestão:**
    - autopeças, porque o item remete ao Anexo II do Convênio ICMS 142/18 inteiro;
    - combustíveis, que não têm MVA na tabela.
- **Atualização de 17/10/2026 (F3-26.d.GO, Goiás, fonte oficial):** Apêndice II do Anexo VIII do RCTE/GO (Decreto 4.852/1997), na página da Secretaria da Economia, que traz cada redação antiga antes da nova. Está guardado em `packages/fiscal/sources` e é lido por gerador:
  - **Regra de leitura:** vale a última ocorrência de cada inciso, de cada alínea e de cada subitem; subitens marcados como revogados saem.
  - **Itens:** 213 linhas com a MVA das operações internas, em 16 grupos.
  - **Cerveja e refrigerante:** têm a MVA do industrial e a do atacadista, cada uma com o nome.
  - **Já vale o Decreto 10.799/2025:** por exemplo, pneus de automóvel com 42%.
  - **Saíram da ST em 01/03/2018 (Decreto 9.108):** autopeças, ração pet, materiais de construção e materiais elétricos.
  - **Venda porta a porta (marketing direto):** o mesmo NCM pode continuar na ST por esse sistema, e a tela mostra isso.
  - **Conferência:** se mais de 10% dos CEST em vigor ficarem fora do Convênio ICMS 142/18, a geração para.
- **Atualização de 17/10/2026 (F3-26.d.AL, Alagoas, fonte oficial):** Decreto 90.309/2023, na versão "com MVAs ajustadas" que a SEFAZ-AL publica no portal GCS, atualizada até 01/05/2026. O PDF vem da API do próprio portal, em base64, e fica guardado em `packages/fiscal/sources`:
  - **Itens:** 795 linhas com a MVA-ST original, em 22 anexos (um por segmento).
  - **CEST quebrado no PDF** ("04.00" + "1.00", "17.031.0" + "0"): a leitura junta os pedaços até formar o código.
  - **Revogados:** itens com a nota "*Item ... revogado pelo Decreto ... Efeitos a partir de ..." (inclusive faixas, "Itens 49.2 a 53.2") viram "saiu da ST", com a data. Exemplo: salgadinhos de trigo em 01/09/2025 (Decreto 103.496/2025).
  - **Fonte descartada:** a lista "Mercadorias sujeitas à ST" do mesmo portal é de 25/07/2018 e não foi usada.
- **Atualização de 17/10/2026 (F3-26.d.RO, Rondônia, fonte oficial):** Anexo VI do RICMS/RO (Decreto 22.721/2018), consolidado até o Decreto 31.963/2026. Vem da API do portal de legislação da SEFIN-RO e é guardado como a resposta original, em JSON:
  - **Itens:** 403 linhas com a MVA original, em 17 segmentos.
  - **Nomes dos segmentos:** os da Parte 1 do anexo; onde a tabela quebra de página, usa-se o nome do Convênio ICMS 142/18.
  - **Linhas revogadas:** não trazem o CEST ("24.0 – REVOGADO PELO DEC. 31963/26 – efeitos a partir de 1º/09/2026"), por isso ficam de fora, sem deduzir o código.
- **Distrito Federal e Ceará (F3-26.d.DF e F3-26.d.CE): fonte oficial ainda não localizada.**
  - **DF:** a lista é o Caderno I do Anexo IV do RICMS/DF (Decreto 18.955/1997). O texto compilado fica no SINJ-DF, que só abre por uma busca sem endereço direto para a norma.
  - **CE:** a lista é o Anexo IX do RICMS/CE (Decreto 33.327/2019). O site da SEFAZ-CE não tem a legislação consolidada, e o antigo portal de legislação não responde.
  - **MT:** a lista é o Apêndice do Anexo X do RICMS/MT, e as MVAs estão na Portaria 195/2019. Ficam no sistema Lotus Notes da SEFAZ-MT (app1.sefaz.mt.gov.br), sem endereço direto conhecido.
  - **MS:** a lista é o Anexo III do RICMS/MS (Decreto 9.203/1998), também em Lotus Notes (aacpdappls.net.ms.gov.br). Parte dos produtos usa preço médio (PMPF) em vez de MVA.
  - **PB:** a lista é o Anexo 05 do RICMS/PB (Decreto 18.930/1997). O portal da SEFAZ-PB lista os decretos novos, mas não oferece o RICMS consolidado na navegação.
  - **PI:** a lista é o Anexo X do RICMS/PI (Decreto 21.866/2023), com mudanças em 2026 (Decretos 24.458 e 24.615). O portal é uma aplicação em JavaScript, sem o texto consolidado acessível.
  - **AC:** a página de legislação da SEFAZ-AC não traz o regulamento nem as listas de ST.
  - **AM, PA, SE, RN, MA, TO, AP e RR:** o portal de legislação não respondeu, recusou o acesso ou devolveu página de erro no teste de 17/10/2026.
  - **Próximo passo:** achar o endereço direto do texto compilado e só então montar, sem usar cópias de terceiros.
- **Pernambuco (F3-26.d.PE): em transição, fica para depois.**
  - **Hoje:** a lista de ST está no Decreto 42.563/2015 (texto consolidado da SEFAZ-PE, de 09/09/2026). Vários anexos foram revogados entre 2023 e 2025: cerveja e refrigerante, cigarros, cimento, tintas, construção, pneus e outros.
  - **A partir de 01/01/2027:** o Decreto 61.284/2026 revoga o Decreto 42.563 e leva para o RICMS/PE (Decreto 44.650/2017) as regras de medicamentos e da cesta básica.
  - **Por que esperar:** ler os anexos revogados como "saiu da ST" pode ser falso, se eles migraram para outro texto. O RICMS consolidado no site da SEFAZ-PE é de 18/06/2025 e ainda não traz a mudança.
  - **Próximo passo:** montar PE quando a SEFAZ-PE publicar o RICMS consolidado com o Decreto 61.284/2026, ou conferir decreto a decreto o destino de cada anexo revogado.
- **Atualização de 17/10/2026 (F3-26.d.ES, Espírito Santo, fonte oficial):** Portaria SEFAZ 16-R/2019 no texto atualizado da Legislação On-Line da SEFAZ-ES, até a Portaria 81-R/2026. A lista da página "Mercadorias sujeitas a ST" é de 24/04/2024 e está defasada, por isso não foi usada. O texto está guardado em `packages/fiscal/sources` e é lido por gerador:
  - **Itens:** 352 linhas com a MVA original, em 22 seções. Já inclui os produtos de cereais e os salgadinhos da Portaria 30-R/2026.
  - **Redação anterior:** a página a pinta de verde, e essas linhas ficam de fora. Trechos que começam com "Redação Original, efeitos até ..." também ficam de fora, mesmo sem cor.
  - **Revogados:** itens revogados (verdes, logo depois da nota "revogado pela Portaria ..., efeitos a partir de ...") viram "saiu da ST", com a data.
- **Atualização de 17/10/2026 (F3-26.c.RJ, Rio de Janeiro, fonte oficial):** Anexo I do Livro II do RICMS/RJ (Decreto 27.427/2000), no arquivo .doc que a SEFAZ-RJ publica, na redação do Decreto 47.864/2021. Está guardado em `packages/fiscal/sources` e é lido por gerador com o `word-extractor`, sem depender de programa instalado:
  - **Itens:** 702 linhas com a MVA original, em 25 segmentos.
  - **Água mineral e refrigerante:** a MVA muda pela embalagem e por quem vende (industrial ou importador, ou atacadista e distribuidor). Cada combinação vira uma linha com o nome.
  - **Bebidas:** a base é o PMPF da SEFAZ-RJ; a MVA só vale quando não há PMPF nem preço sugerido.
  - **Fora da sugestão:** autopeças, medicamentos e bebidas alcoólicas, cuja MVA está no texto ou numa tabela por NCM sem CEST.
  - **Acesso ao site:** o site da SEFAZ-RJ mostra uma página de "bloqueio por endereço de IP" quando o pedido não tem os cabeçalhos de um navegador comum. Não era bloqueio do endereço. Com os cabeçalhos, abre de qualquer lugar, e o monitor semanal já os envia.
  - **Atenção:** o .doc é de 13/12/2021. Alterações posteriores do Anexo I que a SEFAZ-RJ publicar só como nota no Livro II não entram até ela atualizar o arquivo, e o monitor avisa quando o arquivo mudar.

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
- **Resolvida em 16/10/2026 (fontes oficiais):**
  - **AL: 20,5% desde 01/04/2026.** A Lei 9.776, de 22/12/2025 (texto original no site da Assembleia Legislativa: https://sapl.al.al.leg.br/media/sapl/public/normajuridica/2025/3699/lei_no_9.776_de_22_de_dezembro_de_2025.pdf), dá nova redação ao art. 17, I, "b", da Lei 5.900/1996: "20,5% (vinte vírgula cinco por cento), nos demais casos". O art. 3º manda valer no primeiro dia do quarto mês após a publicação. Antes, era 19% (Lei 8.779/2022). O FECOEP de 1% continua à parte.
  - **AP: 18%.** O texto consolidado da Lei 400/1997 (Código Tributário do Amapá) na Assembleia Legislativa (http://www.al.ap.gov.br/ver_texto_consolidado.php?iddocumento=10488), com alterações até a Lei 3.150, de 20/12/2024, mantém o art. 37, III, "i": "18% (dezoito por cento) para as demais mercadorias e serviços" (redação da Lei 1.949/2015).
  - **Resultado:** as 27 UFs têm a alíquota geral em fonte oficial, e a matriz de cobertura calcula as 135 combinações.
- **D-012 resolvida em 13/10/2026 (F3-07):** a lista oficial de Esquemas XML do Portal Nacional da NF-e tem como pacote mais recente o **PL_010f v1.04** (NT 2025.002 v1.50 e NT 2026.007 v1.00, publicado em 31/08/2026). Não há pacote próprio da v1.52, que mudou regras e não o leiaute. O Bipaê passou a usar o PL_010f (guardado em `packages/fiscal/sources`).

### D-022 — NFC-e em MG: ambiente próprio ou SVRS?

- **Contexto:** a relação de serviços web da NFC-e no portal da SEFAZ Virtual do RS lista os autorizadores AM, GO, MS, MT, PR, RS, SP e SVRS, sem MG. A página de webservices do Portal Nacional da NFC-e (ENCAT) lista um ambiente próprio de MG (hnfce.fazenda.mg.gov.br).
- **Implementação provisória:** MG usa o ambiente próprio listado pelo ENCAT. Se a primeira autorização em homologação falhar, o caminho é tentar a SVRS.
- **Pergunta:** qual é o autorizador vigente da NFC-e em MG?
- **Resolvida em 16/10/2026 (fonte oficial):**
  - a página de webservices da NFC-e da SEF/MG (https://portalsped.fazenda.mg.gov.br/spedmg/nfce/web-services/) publica um ambiente próprio, sem SVRS;
  - homologação em `https://hnfce.fazenda.mg.gov.br/nfce/services/<Serviço>4` e produção em `https://nfce.fazenda.mg.gov.br/nfce/services/<Serviço>4`, para autorização, retorno, consulta, status, evento e inutilização;
  - os seis endereços de homologação da tabela do Bipaê batem exatamente com a página oficial.
- **D-014, atualização de 13/10/2026 (F3-13.a):** a NT 2025.001 v1.01 (texto oficial) diz que todas as UF disponibilizam o QR Code versão 3 desde 01/09/2025 e que a adoção pela empresa com CNPJ é opcional. O Bipaê usa a versão 3: na emissão normal o QR Code leva só chave, versão e ambiente, **sem CSC**. Ainda em aberto: algumas URLs da tabela oficial do ENCAT vêm sem o protocolo (AM, MA e as de consulta pela chave); o Bipaê acrescenta https://, o que precisa ser confirmado na primeira autorização em homologação.


### D-023 — Código de barras do DANFE com o CNPJ alfanumérico

- **Contexto:** o Anexo II do MOC 7.0 manda imprimir a chave de acesso em CODE-128C, que só codifica dígitos. Com o CNPJ alfanumérico (NT DFe Conjunta 2025), a chave passa a ter letras.
- **Implementação provisória (F3-13.c):** quando a chave tem letras, o DANFE sai sem o código de barras, com a chave impressa por extenso. Nenhuma simbologia foi inventada.
- **Pergunta:** qual simbologia (CODE-128B ou outra) o manual adotará para a chave com letras, e a partir de quando?
- **Resolvida em 16/10/2026 (fonte oficial: NT Conjunta 2025.001 v1.00, "CNPJ Alfanumérico", de 25/04/2025, seção 6 "Padrão do Código de Barras dos Documentos Auxiliares"):**
  - **Simbologia:** modelo **híbrido**. O código começa no CODE-128C (Start C, código 105) e passa ao **CODE-128A** (código 101) quando aparece letra, voltando ao C (código 99) nos grupos de dígitos. O dígito verificador continua módulo 103. Vale para DANFE, DACTE, DABPE e os demais documentos auxiliares.
  - **Orientações da NT seguidas à risca:** dígito ímpar antes de uma letra vai no conjunto A; no conjunto A, um grupo de quatro ou mais dígitos volta ao C (e, como no exemplo da NT, também os dígitos que fecham a chave) e, se for ímpar, o primeiro dígito fica no A. O exemplo da própria NT, "5225AB83" (105, 52, 25, 101, 33, 34, 99, 83, DV 30, 106), é teste automático.
  - **Tamanho:** largura mínima de 11,5 cm e altura mínima de 0,8 cm.
  - **Prazos:** homologação em 06/04/2026 e produção em 06/07/2026.
  - **Regra no Bipaê:** o DANFE imprime o código híbrido sempre que a chave tem letras (`code128KeyModules` em `packages/danfe/src/code128.ts`). Chave só com dígitos continua igual ao CODE-128C puro.

### D-024 — Custo de aquisição na entrada da compra: com ou sem os créditos?

- **Contexto:** a entrada pelo XML de compra (F3-19) grava o custo de cada produto. Empresas do regime normal recuperam o ICMS destacado, o PIS e a COFINS (e, a partir de 2027, o IBS e a CBS), o que muda o custo contábil.
- **Implementação provisória:** custo = valor dos produtos − desconto + frete + seguro + outras despesas + ICMS-ST + IPI, dividido pelas unidades de estoque, **sem abater nenhum crédito**. Os tributos de cada item ficam guardados com a nota, para a apuração (F4-13) e para recalcular o custo quando a regra for definida.
- **Pergunta (contador, E3):** o custo do produto deve abater os créditos recuperáveis conforme o regime (Simples não abate; Presumido e Real abatem ICMS, e o Real abate PIS/COFINS)? O IPI entra no custo de quem não é contribuinte do IPI?
- **Resolvida em 16/10/2026 (fontes oficiais):**
  - **Lei tributária:** o RIR/2018 (Decreto 9.580/2018, site do Planalto), art. 301, diz no § 1º que o custo "compreenderá os de transporte e seguro até o estabelecimento do contribuinte e os tributos devidos na aquisição" e no § 3º que "os impostos recuperáveis por meio de créditos na escrita fiscal não integram o custo de aquisição".
  - **Norma contábil:** a NBC TG 16 do Conselho Federal de Contabilidade, item 11, diz que o custo de aquisição inclui os tributos, "exceto os recuperáveis perante o fisco".
  - **Por regime:**
    - MEI e Simples não aproveitam crédito (LC 123/2006, art. 23);
    - o Simples acima do sublimite recupera o ICMS, que sai do Simples (art. 13-A);
    - o Presumido recupera o ICMS (PIS/COFINS cumulativos, Lei 9.718/1998, sem crédito);
    - o Real recupera ICMS, PIS e COFINS (não cumulativos, Leis 10.637/2002 e 10.833/2003, art. 3º).
  - **IPI e ICMS-ST:** o varejista não os recupera, e eles ficam no custo.
- **Implementação:**
  - a tabela versionada `purchase-cost-credits.json` traz, por regime, os tributos recuperáveis e a fonte;
  - a entrada da compra abate do custo o ICMS, o PIS e a COFINS da nota conforme o regime da empresa;
  - teste na API com empresa do Lucro Real;
  - o IBS e a CBS entram na tabela em 2027, quando houver crédito deles.

### D-025 — Partilha do ICMS (DIFAL) a não contribuinte: base única ou base dupla?

- **Contexto:** na venda interestadual a consumidor final não contribuinte (EC 87/2015), a diferença entre a alíquota interna do destino e a interestadual vai toda para a UF de destino desde 2019 (pICMSInterPart = 100, como diz o próprio leiaute da NF-e). A forma de calcular a base varia: algumas UFs aplicam a base única (DIFAL = valor × diferença de alíquotas) e outras a base dupla, refazendo a base "por dentro" com a alíquota interna do destino.
- **Implementação provisória (F3-32):** o motor calcula as duas formas (`calculateDifal`, `baseMode`), com **base única como padrão**. A alíquota interna do destino é a geral confirmada da UF, ou a do produto quando a empresa informa. O FCP do destino **só entra com regra do produto**, porque a lei de cada UF lista os produtos sujeitos a ele; sem regra, o resultado traz um aviso.
- **Pergunta (contador, E3):** quais UFs exigem a base dupla para não contribuinte, e o FCP entra no divisor "por dentro"? Com a resposta, a forma vira tabela por UF com data de vigência.
- **Resolvida em 16/10/2026 (fonte oficial, lei nacional):**
  - texto da LC 87/1996, com a redação da LC 190/2022, no site do Planalto (https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp87.htm);
  - a saída para consumidor final **não contribuinte** de outra UF é o fato gerador do art. 12, XVI;
  - a base desse caso é a do art. 13, **X**: "o valor da operação ou o preço do serviço, para o cálculo do imposto devido ao Estado de origem e ao de destino". Uma base só, a **base única**;
  - a base dupla do art. 13, IX, "a" e "b" (valor no Estado de origem e no de destino) vale só para os incisos XIII e XV: o **contribuinte** que compra para uso, consumo ou ativo;
  - o § 1º do art. 13 manda o próprio imposto integrar a base também no inciso X (por dentro, como já está no valor da operação).
- **Consequência no Bipaê:**
  - a base única, que já é o padrão do motor, segue a lei complementar nacional;
  - a opção de base dupla fica no motor só para a venda a contribuinte (uso e consumo), que é NF-e e chega com a F3-33;
  - lei estadual que exija a base dupla para não contribuinte vai contra a LC 87 e não vira regra automática;
  - o FCP do destino continua entrando só com a regra do produto, sobre a mesma base.

### D-026 — NF-e na transferência entre lojas

- **Contexto:** a transferência entre lojas (F4-12) move o estoque entre lojas do mesmo cliente. Quando as lojas são de empresas (CNPJs) diferentes, a mercadoria circula entre estabelecimentos e precisa de NF-e de transferência (CFOP 5152/6152). Depois da ADC 49 do STF e da LC 204/2023, a transferência entre estabelecimentos do mesmo titular não tem incidência de ICMS, mas a nota continua obrigatória, e a transferência do crédito do ICMS tem regras próprias.
- **Implementação provisória:** o Bipaê move o estoque e marca a transferência entre CNPJs diferentes com "precisa de NF-e de transferência", sem emitir nem calcular nada. Lojas da mesma empresa (mesmo CNPJ) não geram nota. A emissão fica para quando o fluxo de NF-e de saída (F3-14) estiver pronto e as regras abaixo, confirmadas.
- **Pergunta (contador, E3):** na transferência entre estabelecimentos do mesmo titular, a empresa transfere o crédito do ICMS (destacando o imposto) ou não, e como isso fica por UF? Qual é o tratamento do IBS e da CBS nessas transferências a partir de 2027?
- **Resolvida em 16/10/2026 (fontes oficiais):**
  - **ICMS, regra nacional:**
    - a LC 87/1996, art. 12, § 4º, com a redação da LC 204/2023 (site do Planalto), diz: "Não se considera ocorrido o fato gerador do imposto na saída de mercadoria de estabelecimento para outro de mesma titularidade, mantendo-se o crédito";
    - na transferência entre UFs, o crédito é assegurado pela UF de destino, limitado à alíquota interestadual;
    - pelo § 5º, a empresa pode optar por equiparar a transferência a operação tributada.
  - **ICMS entre UFs, CONFAZ:**
    - o Convênio ICMS 109/2024 (efeitos desde 01/11/2024) dá à empresa o direito de transferir o crédito, sem obrigá-la, sobre o valor médio de entrada ou o custo, nas alíquotas interestaduais;
    - a opção de tributar (cláusula sexta) é anual, irretratável no ano e vale para todos os estabelecimentos.
  - **NF-e entre UFs, pelo Ajuste SINIEF 33/2024:**
    - natureza "Transferência de Mercadoria - Estabelecimentos mesmo titular" e CFOP do grupo 6.150 (6151/6152);
    - **CST 90**, com `vBC` e `pICMS` zerados e `vICMS` igual ao crédito transferido, quando houver;
    - em `infAdFisco`, "Procedimento autorizado conforme Convênio ICMS nº 109/24".
  - **Dentro da mesma UF:**
    - também não há fato gerador (o mesmo § 4º);
    - o Convênio 109/24 e o Ajuste 33/24 só tratam da remessa entre UFs, então a nota interna (CFOP 5151/5152, sem destaque) segue a legislação de cada UF.
  - **IBS e CBS a partir de 2027:** a LC 214/2025 (site do Planalto), art. 6º, II, diz que eles **não incidem** na "transferência de bens entre estabelecimentos pertencentes ao mesmo contribuinte, observada a obrigatoriedade de emissão de documento fiscal eletrônico" (art. 60, § 2º, II).
- **No Bipaê:**
  - a transferência entre CNPJs diferentes continua marcada "precisa de NF-e de transferência";
  - a emissão entra com a NF-e da retaguarda (F3-33), seguindo as regras acima;
  - entre UFs sem a opção de tributar, CST 90 com o crédito em `vICMS`;
  - com a opção de tributar, operação normal com alíquota interestadual;
  - IBS e CBS sem incidência.

### D-027 — Apuração do IBS e da CBS: quando o crédito entra e o que fica de fora

- **Contexto:** pela LC 214/2025, art. 47, o crédito do IBS e da CBS só pode ser apropriado quando o débito do fornecedor for extinto (pagamento, split payment etc.), com documento fiscal eletrônico idôneo, separado por tributo, e não vale para uso ou consumo pessoal (art. 57).
- **Implementação provisória (F4-13):** a apuração do Bipaê é **gerencial**:
  - soma o IBS e a CBS destacados nas notas de compra **autorizadas**, no mês de emissão da nota, sem conferir se o fornecedor já recolheu e sem excluir uso e consumo pessoal;
  - a devolução de venda estorna o débito na proporção do valor devolvido de cada linha, com arredondamento meio para cima;
  - em 2026, mostra a dispensa de recolhimento de quem cumpre as obrigações acessórias (art. 348, § 1º).
  - Nada disso é enviado a nenhum órgão.
- **Pergunta (contador, E3):**
  - Em que mês o crédito deve entrar: na emissão da nota, na entrada da mercadoria ou na extinção do débito informada pelo Comitê Gestor e pela Receita?
  - Como a empresa marca as compras de uso e consumo pessoal?
  - O estorno da devolução deve vir do documento de devolução, em vez da proporção?
- **Resolvida em 16/10/2026 (fonte oficial: LC 214/2025, com a redação da LC 227/2026, no site do Planalto):**
  - **Quando o crédito entra:** a regra geral (art. 47, caput) liga o crédito à extinção do débito do fornecedor. O **art. 48**, porém, dispensa esse requisito "exclusivamente, se não houver sido implementada" nem o recolhimento na liquidação financeira (split payment, arts. 31 e 32) nem o recolhimento pelo adquirente (art. 36). Nesse caso, o crédito fica "condicionado ao destaque dos valores corretos do IBS e da CBS no documento fiscal eletrônico". Enquanto o split payment não funcionar, vale o valor destacado na nota autorizada, como o Bipaê já faz. Quando entrar em funcionamento, o crédito passa a depender da extinção informada pelo Comitê Gestor e pela Receita (nova tarefa quando houver leiaute).
  - **O que não dá crédito:**
    - uso ou consumo pessoal (art. 57): joias, obras de arte, bebidas alcoólicas, tabaco, armas, bens recreativos, esportivos e estéticos, além de bens dados de graça ou abaixo do valor de mercado a sócios, administradores, empregados e parentes, como imóvel residencial e veículo. Pelo § 3º, não é uso pessoal o que é comercializado: a cerveja comprada para revenda dá crédito;
    - operações imunes, isentas, com alíquota zero, diferimento ou suspensão (art. 49), que já chegam sem IBS e CBS destacados.
  - **Como marcar:** a nota de compra ganhou a marcação **"Uso pessoal"** na tela Compras (permissão de configuração fiscal, registrada na auditoria). A nota marcada sai do crédito na apuração e aparece em "ficou de fora da conta".
  - **Devolução:** na devolução por adquirente que não é contribuinte do regime regular (o consumidor do caixa), o fornecedor "poderá apropriar créditos ou estornar débitos com base nos valores dos débitos incidentes na operação devolvida" (art. 47, § 8º). O estorno proporcional ao valor devolvido de cada linha da venda original é exatamente o débito da parte devolvida, então fica como está. Na devolução por contribuinte do regime regular, o procedimento ainda depende de regulamento (art. 47, § 12).

### D-028 — Unidade da quantidade do lote (`qLote`) na NF-e de compra

- **Contexto:** o grupo `rastro` do item (leiaute 4.00, PL_010f) traz `nLote`, `qLote`, `dFab` e `dVal`. O XSD descreve o `qLote` como "Quantidade de produto no lote", sem dizer se é na unidade comercial (`uCom`) ou na tributável (`uTrib`).
- **Implementação provisória (F5-04.b):**
  - o Bipaê lê o `qLote` na unidade comercial do item e converte para a unidade de estoque com o mesmo fator usado na entrada (ex.: caixa com 12);
  - se o mesmo número de lote já existir com outra validade, a compra não trava: o lote entra separado, com a validade no nome.
- **Pergunta (contador ou fornecedor):** qual unidade os emissores usam no `qLote`? Se for a tributável, a conversão passa a usar a relação entre `qCom` e `qTrib` do item.

### D-029 — Pix e vale do caixa: qual código tPag

- **Contexto:** a tabela oficial de meios de pagamento separa:
  - Pix **dinâmico** (17) de Pix **estático** (20), desde 01/07/2024;
  - vale **alimentação** (10), **refeição** (11), **presente** (12) e **combustível** (13).

  O caixa do Bipaê tem um só "Pix" e um só "vale".
- **Implementação provisória (F3-14.a):**
  - Pix vai como **20 (estático)**, porque o caixa ainda não gera cobrança Pix por um PSP (E9);
  - vale vai como **10 (alimentação)**;
  - a empresa pode escolher outro código, mas só entre as opções da tabela (`pdv-payment-tpag.json`).
- **Pergunta (contador, E3):** quando o Pix é pago por QR Code com valor gerado na hora pelo caixa (sem PSP), ele é estático ou dinâmico? O vale deve ser separado por tipo no caixa?

### D-030 — Descrição do primeiro item da NFC-e em homologação

- **Contexto:** em homologação, a SEFAZ recusa a NFC-e quando a descrição do primeiro item não é "NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL" (rejeição 373). O texto da regra não está nos arquivos oficiais guardados em `packages/fiscal/sources`.
- **Implementação provisória (F3-14.a):** como o Bipaê só emite em homologação (regra 4), a NFC-e montada da venda sempre leva esse texto no primeiro item; os outros itens mantêm a descrição do produto.
- **Pergunta:** confirmar na primeira emissão real (F3-11.b, com o certificado) e guardar o Manual de Orientação do Contribuinte vigente em `sources`.

### D-032 — NFC-e de entrega a domicílio (delivery): quais UFs permitem e como vai a taxa

- **Fonte:** MOC 7.0, Anexo I (já em `packages/fiscal/sources`).
- **O que diz o MOC:**
  - campo B25a `indPres=4` é a "NFC-e em operação com entrega a domicílio";
  - rejeição 753: NFC-e só leva frete quando é entrega a domicílio;
  - rejeições 787 e 788: com `indPres=4`, a nota exige a identificação do destinatário (CPF ou CNPJ) e o endereço;
  - rejeição 786: exige também os dados do transportador (`transporta`);
  - rejeição 434: `indPres=4` exige o indicador de intermediador (`indIntermed`);
  - rejeição 785: "NFC-e com entrega a domicílio não permitida pela UF". Cada UF decide.
- **Implementação (F5-10.b):** a taxa de entrega vai como frete (`vFrete`, rateado nos itens), com `modFrete=0` (contratação por conta do remetente), o próprio emitente como transportador (entrega própria) e `indIntermed=0` (venda direta, sem plataforma).
- **Resolvida em 16/10/2026, pelas fontes oficiais (o dono não tem contador):**
  1. **A regra nacional permite.** O Ajuste SINIEF 19/2016 (CONFAZ), cláusula quarta, inciso VII, alínea "c", prevê a NFC-e com o destinatário identificado nas entregas a domicílio, "hipótese em que deverá constar a informação do respectivo endereço". Desde 03/08/2026, pelo Ajuste SINIEF 09/2026, a alínea vale para todas as operações não presenciais. Texto consultado em https://www.confaz.fazenda.gov.br/legislacao/ajustes/2016/AJ_019_16.
  2. **Restrição por UF:**
     - o ajuste deixa o uso da NFC-e "a critério das unidades federadas" (cláusula primeira) e não proíbe a entrega;
     - onde a UF restringe, quem avisa é a própria SEFAZ, com a rejeição 785. Não há lista nacional publicada;
     - o Bipaê explica a 785 na tela e indica a NF-e modelo 55 como caminho, que chega com a F3-33.
  3. **Transportador:** a regra 786 do MOC exige o grupo `transporta` em toda NFC-e de entrega. Na entrega própria vai a loja; o motoboy terceirizado com CNPJ ou CPF pode ser informado no lugar quando a loja cadastrar (melhoria futura, sem mudança de regra).
  4. **Aplicativo (iFood):** pela NT 2020.006 do Portal Nacional da NF-e, a venda feita em plataforma de terceiros usa `indIntermed=1` e o grupo `infIntermed` (CNPJ da plataforma). Entra com a integração do iFood (F6-05); a venda direta da loja segue com `indIntermed=0`.
  5. As rejeições 753, 785, 786, 787, 788 e 434 entraram na tabela de rejeições explicadas, com o texto oficial do Anexo I do MOC 7.0.

### D-031 — SPED EFD ICMS/IPI: gerar no Bipaê ou deixar com o contador

- **Fonte:** Guia Prático da EFD ICMS/IPI versão 3.2.2 (atualização de 11/02/2026), baixado do Portal SPED (sped.rfb.gov.br, item 8112) em 16/10/2026.
- **Quem entrega:** a obrigatoriedade está na lei de cada estado. O Protocolo ICMS 03/2011 dispensa o Simples Nacional. Pelo Protocolo ICMS 49/2015, continuam obrigadas as empresas do Simples dos estados que as obrigaram até o 1º trimestre de 2014. Presumido e Real entregam.
- **NFC-e no arquivo:** Exceção 9 do registro C100. A NFC-e entra só nos registros C100 e C190 (e C195/C197 quando houver ajuste estadual), sem C170. Não vão os campos COD_PART, ICMS-ST, IPI, PIS e COFINS. A NFC-e não é escriturada nas entradas.
- **O arquivo completo exige:**
  - bloco 0 (cadastros);
  - as notas de entrada com itens (C100/C170);
  - a apuração do ICMS (bloco E, E110);
  - o inventário (bloco H, em fevereiro);
  - o bloco K, conforme o caso;
  - assinatura com certificado;
  - validação no programa oficial (PVA).
- **Situação no Bipaê:** o pacote do mês para o contador (F4-14.a) já entrega todos os XML. Na prática, o escritório costuma gerar a EFD no sistema dele a partir desses XML.
- **Pergunta ao dono:** gerar a EFD completa no Bipaê agora (tarefa grande, F4-14.b) ou deixar para depois, com o contador gerando a partir do pacote? E, se gerar: só para Presumido e Real, ou também para o Simples nos estados que obrigam (a lista de estados exige ler a lei de cada um)?


---

## Pesquisa em fontes oficiais — 15/10/2026

Documentos baixados do Portal Nacional da NF-e (www.nfe.fazenda.gov.br) nesta data:
- MOC 7.0 e o Anexo I (Leiaute e Regras de Validação);
- NT 2016.002 v1.61, NT 2023.004 v1.20, NT 2025.002 v1.52;
- NT 2026.002 v1.11, NT 2026.006 v1.00, NT 2026.007 v1.10, NT 2026.008 v1.00;
- Informe Técnico 2024.002 v1.11;
- Tabela de Meios de Pagamento, já guardada em `packages/fiscal/sources`.

- **D-001 — resolvida.**
  - **Fonte:** NT 2025.002 v1.52, regra VB01-20 (vItem): "Exceção 1: Em 2025 e 2026 não somar vIBS, vCBS, vIS, vTotIBSMonoItem, vTotCBSMonoItem".
  - **O que vale:** o total novo `vNFTot` (W60) é a soma dos vItem. Em 2026, o IBS e a CBS **não compõem** o total, como já faz a flag por vigência.
  - **A partir de 2027:** a NT 2026.008 (homologação em 01/02/2027, produção em 01/03/2027) manda somar o IBS e a CBS no `vProd`, com os campos novos de valor líquido. Isso entra como regra nova antes de 2027.
- **D-002 — resolvida.**
  - **Fonte:** NT 2025.002 v1.52, cronograma. "As orientações para CRT=1-Simples Nacional, CRT=2-Simples Nacional-Excesso de Sublimite, CRT=4-MEI e Tributação Monofásica serão publicadas em NT futura, tendo em vista que a tributação do IBS/CBS/IS para estes contribuintes ocorre somente a partir de 2027, conforme disposto no Art. 348 da LC 214/25."
  - **Consequência:** em 2026, o Simples e o MEI **não** preenchem o IBS/CBS. Corrigido no motor (o cálculo exigia o cClassTrib também deles).
- **D-003 — resolvida.**
  - **Fonte:** NT 2025.002 v1.52, cronograma.
  - **Regime normal (CRT 3):** a partir de 03/08/2026 o preenchimento do IBS/CBS é obrigatório e as regras de validação são aplicadas, valendo desde 01/01/2026.
- **D-007 — resolvida.**
  - A NT 2026.007 trata da emissão por contribuinte exclusivo do IBS/CBS (sem inscrição estadual). Não se aplica ao varejo com IE.
  - A NT 2026.008 (valor líquido do produto) vale a partir de 2027 (homologação em 01/02/2027, produção em 01/03/2027).
- **D-009 — parcial.**
  - **Fonte:** NT 2025.002 v1.52, regra VC02-14.
  - **Regra:** na NF-e de devolução (finNFe=4, modelo 55), a referência é feita **só** no grupo `DFeReferenciado`, item a item, e o `refNFe` fica proibido. Em produção desde 03/11/2026 (data alterada na v1.52).
  - **Continua para o contador:** o fluxo da devolução de consumidor sem identificação.
- **D-010 — resolvida.**
  - **Fonte:** Anexo I do MOC 7.0, campo B07 e regra B28-30 (rejeição 244).
  - **Faixas:** emitente com CNPJ pelo aplicativo do contribuinte usa as séries 000 a 889; 890 a 919 são do fisco (avulsa); 920 a 969, de emitente CPF.
  - **No Bipaê:** a faixa 1..889 está certa.
- **D-011 — resolvida.**
  - **Fonte:** NT 2025.002 v1.52, cronograma.
  - **Datas:** correção da VC02-50 em homologação até 05/10/2026 e em produção até 03/11/2026; a VC02-14 entra em produção em 03/11/2026.
- **D-013 — resolvida.**
  - **Fonte:** NT 2026.002 v1.11, regra B10-10 e Observação 1, com base nos Ajustes SINIEF 32/25 e 13/26.
  - **Emissão normal:** a NFC-e normal deve ser emitida em tempo real, com tolerância de 5 minutos; passado isso vem a rejeição 704.
  - **Contingência off-line (`tpEmis=9`):** na transmissão em até 24 horas a SEFAZ autoriza normalmente; depois, a critério da UF, autoriza "fora de prazo" (cStat 150).
  - **Consequência:** a venda feita sem internet e emitida depois precisa ir em contingência off-line (F3-15).
- **D-015 — resolvida.** Fonte: NT 2026.006 v1.00. "A implantação do split payment está prevista para ocorrer a partir de 2027." Nada muda em 2026.
- **D-028 — parcial.**
  - **Fontes:** Anexo I do MOC 7.0 (campo I82) e NT 2016.002 v1.61. Os dois só descrevem o `qLote` como "Quantidade de produto no Lote", formato 8v3, e não há regra de validação ligando o `qLote` ao `qCom` ou ao `qTrib`.
  - **Decisão pelos dados da própria nota:** se a soma dos `qLote` bate com o `qTrib` (e não com o `qCom`), o Bipaê converte pela relação qCom/qTrib; senão, usa a unidade comercial.
- **D-029 — resolvida.**
  - **Fonte:** Tabela de Meios de Pagamento oficial, coluna "Observações". Código 17: "PIX realizado com a geração do Qr-Code de forma dinâmica ou URL dinâmica". Código 20: "Pix realizado com QR code estático, ou chave Pix, ou informações de agência e conta".
  - **Pix:** como o caixa ainda não gera QR Code dinâmico (depende de PSP, E9), o Pix sai sempre como 20; a opção "dinâmico" saiu da tela.
  - **Vale:** é escolha da loja entre os quatro códigos oficiais.
  - **Achado:** a regra YA04-10 da NT 2023.004 (rejeição 391, padrão nacional e opcional por UF) exige o grupo de cartões (`card`) quando o tPag é 03, 04 ou 17. Corrigido: cartão vai com `tpIntegra=2` (não integrado).
- **D-030 — resolvida.**
  - **Fonte:** Anexo I do MOC 7.0, regra I04-10 (NT 2015.002), rejeição 373. O texto é exatamente "NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL".
  - **Achado:** a regra 598 (modelos 55 e 65) também exige, em homologação, o nome do destinatário "NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL". Corrigido.

### D-033 — Venda condicional: notas da remessa, da volta e da venda

- **Contexto (F5-12.b):** a loja de moda deixa o cliente levar peças para provar em casa. O Bipaê controla a saída, a volta e o estoque, e manda ao caixa o que o cliente ficou.
- **Fonte oficial (Ajuste SINIEF 02/18, no site do CONFAZ):**
  - **Saída para o cliente provar ("demonstração", cláusulas segunda, quarta e quinta):** o ICMS fica suspenso, inclusive quando o destino é consumidor final, desde que a mercadoria volte em até **60 dias**. A saída exige Nota Fiscal "sem destaque do valor do imposto", com natureza "Remessa para Demonstração", **CFOP 5.912** (ou 6.912) e os textos "Mercadoria remetida para demonstração" e "Imposto suspenso nos termos do Ajuste SINIEF 02/18".
  - **Volta do consumidor (cláusula sexta):** a loja emite a nota de entrada "Retorno de mercadoria remetida para Demonstração", **CFOP 1.913** (ou 2.913), com a chave da remessa.
  - **Venda do que o cliente ficou (cláusula oitava):** a loja emite a nota de entrada simbólica (**CFOP 1.949**, com a chave da remessa) e a nota de venda com destaque do imposto, os dados do comprador, o CFOP de venda, a chave da remessa e o texto "Transmissão da Propriedade de mercadoria remetida para Demonstração".
  - **Prazo vencido (cláusula quinta, § 1º):** a loja emite nota com o imposto, com os dados do adquirente e a chave da original.
- **Implementação provisória:**
  - prazo de volta limitado a 60 dias;
  - estoque que sai na entrega e volta no retorno;
  - o que o cliente ficou vai ao caixa como comanda e é vendido com NFC-e;
  - a tela avisa que as notas de remessa e de retorno ainda são emitidas fora do Bipaê.
  - As notas do Ajuste (5.912, 1.913, 1.949 e a venda referenciada) dependem da NF-e da retaguarda (tarefa F5-12.c, que depende da F3-33).
- **Atualização de 17/10/2026 (F5-12.c, motor):** o Bipaê monta as quatro notas a partir do texto do Ajuste guardado em `packages/fiscal/sources` (natureza, CFOP, textos obrigatórios e chave da remessa, lidos das cláusulas quinta, sexta e oitava):
  - **Imposto suspenso:** remessa, retorno e entrada simbólica vão sem destaque. No regime normal, o perfil precisa do CST 50 (suspensão, Tabela B do CST).
  - **O que o Ajuste não diz:** o CSOSN do Simples (400 ou 900), o CST do PIS/COFINS e o cClassTrib dessas notas não estão no Ajuste, e não foi achada resposta oficial. Por isso vêm de um perfil fiscal que a empresa escolhe para a venda condicional; sem ele, a nota fica em "falta resolver".
  - **Outro estado:** a nota para cliente de outro estado (CFOP 6.912) ainda não é emitida. A partilha também fica suspensa (cláusula quarta, § 1º), e isso pede regra própria.
- **Resposta (17/10/2026, MOC 7.0, Anexo I, guardado em `packages/fiscal/sources`):** a regra **BA01-10** diz que a NFC-e não pode referenciar outros documentos (obrigatória, rejeição 708). Como a cláusula oitava, II, "c", pede a chave da remessa na venda, a venda do que o cliente ficou sai por **NF-e** quando a remessa saiu por NF-e.
- **Implementação de 17/10/2026 (F5-12.c.2):** as notas saem pelo Bipaê só quando a empresa escolhe o perfil fiscal da venda condicional. Sem ele, continua o fluxo antigo, com o aviso para emitir no emissor de sempre.
  - **Saída:** a remessa sai com as peças.
  - **Volta:** o retorno do que voltou e a entrada simbólica saem sozinhos quando completos.
  - **Venda:** a venda do que ficou vira rascunho de NF-e com a chave da remessa, para a pessoa escolher a forma de pagamento, no lugar da comanda.
  - **Estoque:** remessa, retorno e entrada simbólica não mexem no estoque, porque o condicional já mexe; a venda baixa ao ser emitida.
- **Pergunta original (respondida acima):** quando a remessa foi feita por NF-e, a venda do que ficou pode sair em NFC-e, ou tem de ser NF-e para referenciar a chave da remessa, como pede a cláusula oitava, II, "c"? Quando a F5-12.c chegar, a venda do condicional passa a ser feita por NF-e com a referência, a menos que uma fonte oficial permita a NFC-e.

### D-034 — Código de benefício fiscal (cBenef) por UF

- **Contexto:** o leiaute da NF-e e da NFC-e (PL_010f) tem o campo cBenef no item, com 8 ou 10 caracteres ou "SEM CBENEF". Algumas UFs exigem o código quando a situação tributária traz benefício (isenção, redução de base, diferimento), e recusam a nota sem ele (rejeição 930). Cada UF publica a própria tabela de códigos.
- **Implementação de 17/10/2026 (F3-27.a):**
  - **Cadastro:** a regra de ICMS da empresa leva o código. Quem cadastra é a empresa, com o contador.
  - **Nota:** o Bipaê põe o código em cada item do NCM da regra, logo depois do CEST, e o XML é conferido no XSD oficial.
  - **O que o sistema não faz:** não decide sozinho qual código usar nem se a UF exige.
- **Atualização de 17/10/2026 (F3-27.b, Paraná):** "Tabela de Códigos de Benefício Fiscal por CST" do Portal SPED da SEFA-PR, versão 27, de 17/07/2026. Está guardada em `packages/fiscal/sources` e é lida por gerador:
  - **Códigos:** 502, dos quais 27 já encerrados.
  - **Leitura dos CST:** a tabela marca "SIM" sob a coluna de cada CST, e a leitura usa a posição de cada pedaço de texto no PDF.
  - **Na regra de ICMS:** ao digitar o código, a tela mostra o que ele significa, para quais CST vale e se está encerrado ou fora da tabela.
  - **Obrigatoriedade no PR:** o preenchimento é obrigatório desde 01/02/2019 (NPF 53/2018).
- **Atualização de 17/10/2026 (F3-27.b, Santa Catarina):** Tabela 5.2A (cBenef) da SEF/SC, gerada em 09/10/2026, lida pela posição de cada pedaço no PDF:
  - **Códigos:** 665, com o tipo de cada benefício (isenção, redução de base, diferimento, suspensão, não incidência e crédito presumido), os CST e a vigência.
  - **Crédito presumido:** os 112 códigos de crédito presumido não têm CST, porque vão no campo cCredPresumido da nota, e não no cBenef. A tela avisa isso.
- **Atualização de 17/10/2026 (F3-27.b, Rio Grande do Sul):** planilha "Tabela cBenef x CST" da Central de Conteúdo da Receita Estadual, de 10/09/2026:
  - **Códigos:** 541, com a descrição legível e a referência legal.
  - **Datas:** vêm sem o zero do dia ("1102016" = 01/10/2016) e são convertidas pelo gerador.
  - **Orientação da Receita-RS:** no CST 00 o cBenef não deve ser preenchido.
- **Atualização de 17/10/2026 (F3-27.b, Goiás):** Anexo Único da Instrução Normativa 1.518/2022-GSE, no texto consolidado do portal de legislação (05/01/2026):
  - **Códigos:** 303, com o dispositivo legal.
  - **Redação antiga:** vem antes da nota "Redação com vigência de ... a ...", e vale a última. Um código "REVOGADO" vale até a data da nota.
  - **Obrigatoriedade em GO:** desde 01/07/2023 (IN 1.518/2022). Simples Nacional e MEI ficam fora da obrigação.
- **Atualização de 17/10/2026 (F3-27.b, Espírito Santo):** planilha "cBenef ES V6" da SEFAZ-ES (Tabela cBenef x CST dos benefícios vigentes):
  - **Códigos:** 247, com a capitulação legal e o tipo do benefício.
  - **Datas:** vêm como número de série do Excel e são convertidas pelo gerador.
  - **Obrigatoriedade no ES:** desde 01/07/2024 (Decreto 5.630-R/2024), na NF-e, no NF3-e e no CT-e.
- **Atualização de 17/10/2026 (F3-27.b, São Paulo):** planilha "Tabela CST x cBenef" do portal da NF-e da SEFAZ-SP, versão 20260901:
  - **Obrigatoriedade em SP:** o §15 do art. 212-O do RICMS exige o código em operações com isenção, não incidência, redução de base, regime especial sobre a receita bruta, suspensão ou diferimento.
  - **Códigos:** 316, com o dispositivo legal.
  - **Vigência:** a planilha não tem coluna de datas. O fim vem da observação: "Vigorou até ..." (5 códigos encerrados em 30/04/2026) e o "SEM CBENEF", que não é aceito a partir de 01/07/2026.
  - **CST 00 com crédito outorgado:** não leva o cBenef (Portaria CAT 147/09).
- **Atualização de 17/10/2026 (F3-27.b, Rio de Janeiro):** "Tabela de códigos de benefício X CST" do portal do DF-e da SEFAZ-RJ (atualizada em 02/10/2026; Anexo XVIII da Parte II da Resolução SEFAZ 720/14):
  - **Códigos:** 653. Os 176 de suspensão, ampliação de prazo e inexigibilidade de estorno não marcam CST.
  - **Orientações da SEFAZ-RJ:**
    - não informar o literal SEM CBENEF;
    - nota sem o campo é aceita, mas, se preenchido, só valem códigos da tabela e habilitados para o CST;
    - a validação não dispensa a obrigação de preencher quando a legislação exige.
- **Atualização de 17/10/2026 (F3-27.b, Distrito Federal):** planilha consolidada "TABELA_CBenef_X_CST" da Receita-DF (Anexo Único do Ato Declaratório de cBenef):
  - **Data do arquivo:** a página da Receita-DF cita o Ato Declaratório 02/2025, mas o único arquivo oferecido é a planilha consolidada de 15/05/2023. O Bipaê usa esse arquivo e mostra a data dele; o monitor semanal avisa quando a planilha mudar.
  - **Códigos:** 252, com o tipo do benefício, a descrição e a base legal. Doze terminaram em 31/05/2023 e só valem até essa data.
  - **Sem CST:** 8 códigos não marcam CST na planilha (a tela mostra o código, mas não confere o CST).
- **Em aberto (F3-27.b, demais UFs):** as tabelas das outras UFs que exigem o código.

### D-035 — Natureza da operação da entrada simbólica do condicional passa de 60 caracteres

- **Contexto (F5-12.c):** o Ajuste SINIEF 02/18, cláusula oitava, I, "a", manda usar a natureza "Entrada Simbólica em Retorno de Mercadoria remetida para Demonstração", com 69 caracteres. O campo natOp do leiaute da NF-e aceita no máximo 60, e o XSD oficial recusa o texto inteiro.
- **Pesquisa (17/10/2026):** não foi achada abreviação oficial (CONFAZ, Portal da NF-e ou SEFAZ). O Decreto 46.178/2018 de PE repete o texto inteiro.
- **Implementação:** o Bipaê não abrevia sozinho.
  - Sem a forma abreviada, a nota fica em "falta resolver" e explica o motivo.
  - A forma abreviada é escrita pela empresa na natureza da nota.
  - O texto completo do Ajuste vai nas informações complementares ("Natureza da operação: ...").
- **Pergunta em aberto:** a SEFAZ aceita a natureza abreviada com o texto completo nas informações complementares? Confirmar na primeira emissão em homologação (F3-33.d).

### D-036 — NFS-e Nacional: o que só se confirma com o certificado

- **Contexto (F5-13):** a NFS-e Nacional é obrigatória para ME e EPP do Simples desde 01/11/2026 (D-006). O Bipaê monta a DPS pelo leiaute v1.01 em produção e pelas regras do Anexo I, guardados em `packages/fiscal/sources`, e conversa com a Sefin Nacional pelos endereços da página oficial "APIs - Prod. Restrita e Produção".
- **Conferido com o certificado A1 real na produção restrita (20/10/2026):**
  - Especificações oficiais lidas com o certificado: "API NFS-e - Sefin Nacional" (versão do aplicativo SefinNacional_1.6.0) e "API NFS-e - ADN Parâmetros Municipais". A Sefin responde tanto em `/API/SefinNacional` quanto em `/SefinNacional`.
  - O convênio do município fica no ADN: `GET {parametrização}/{município}/convenio`. A resposta traz `parametrosConvenio.aderenteAmbienteNacional` (1, 0 ou -1); Guarapuava (PR) respondeu 1. O caminho antigo na Sefin dava 404.
  - O XML enviado precisa da declaração `<?xml version="1.0" encoding="UTF-8"?>` (rejeição E1229).
  - A produção restrita já valida a DPS pelo leiaute da NT 009 v1.01 (Anexo VI v1.04.01): ela recusou o `cLocEmi` logo depois do `tpEmit`, pedindo `cMotivoEmisTI` ou `finNFSe`, o que o esquema publicado de julho/2026 ainda não traz. A tarefa F5-13.i adapta a DPS a esse leiaute.
  - Regra E0084: o município da nota precisa bater com o cadastro CNPJ, se a prefeitura deixa emitir por ele (`situacaoEmissaoPadraoContribuintesRFB` = 1), ou com o cadastro do município (CNC NFS-e), com CNPJ e inscrição municipal. Guarapuava respondeu 0: exige a inscrição municipal.
  - A consulta oficial da alíquota do ISS existe: `GET {parametrização}/{município}/{código do serviço com 9 dígitos}/{competência}/aliquota`.
- **Confirmado em fonte oficial:**
  - **Leiaute e regras:** esquemas v1.01 de 09/02/2026 e Anexo I.
  - **Área de dados:** compactada e em base64 (regras E1225 e E1226).
  - **Endereços das APIs:** página oficial do gov.br/nfse.
  - **Grupo do IBS/CBS:** só obrigatório para o Simples a partir de 2027 (nota do Anexo I) e facultativo para os demais no leiaute em produção (regra E0850). O leiaute da NT 009 v1.01 (01/10/2026) entra conforme o cronograma que a Receita vai publicar.
  - **Leiaute do grupo `DFeReferenciado` (19/10/2026):** o XSD oficial `leiauteNFe_v4.00.xsd` do PL_010f v1.04 (já em `packages/fiscal/sources`) traz o grupo dentro de cada item (`det`), opcional, com `chaveAcesso` do documento referenciado e `nItem` opcional (1 a 990), o número do item na nota original.
  - **Referência item a item obrigatória (19/10/2026):** a NT 2025.002-RTC v1.52 (Portal Nacional da NF-e, 01/10/2026, em `packages/fiscal/sources`) traz a regra VC02-14. Toda NF-e de devolução (finNFe 4) referencia, em cada item, a nota e o item devolvidos pelo grupo `DFeReferenciado`; fica proibido o `refNFe` no cabeçalho, sob pena da rejeição 321. Em produção vale a partir de 03/11/2026. Regras do grupo:
    - VC02-10: não pode haver referência no cabeçalho e no item ao mesmo tempo;
    - VC02-30: o mesmo item não pode ser referenciado duas vezes;
    - VC02-40: a regra de uma só nota referenciada não vale na devolução;
    - VC02-50: todas as notas referenciadas precisam ser do mesmo emitente;
    - rejeição 1194: quando a nota devolvida é de saída, o emitente dela é o destinatário da devolução;
    - VC03-20: o `nItem` é obrigatório.
  - **Feito (F3-33.i):** a devolução de compra do Bipaê já segue essa regra.
- **Ainda sem fonte oficial:** o Swagger da Sefin só abre com certificado, então estes pontos seguem o uso corrente e ficam isolados no código para trocar fácil:
  - **Nomes no JSON:** `dpsXmlGZipB64`, `chaveAcesso`, `nfseXmlGZipB64`, `erros`; no cancelamento (F5-13.g), `pedidoRegistroEventoXmlGZipB64` e `eventoXmlGZipB64`. O leiaute do pedido e as regras do cancelamento vêm do Anexo II oficial (19/10/2026): Id "PRE" + chave + código do evento; prazo e valor-limite são parâmetros do município (E0822, E0823).
  - **Resposta do convênio municipal:** o formato de `/parametros_municipais/{município}/convenio`.
  - **Assinatura:** RSA-SHA1, a mesma da NF-e. O leiaute diz só "padrão XML Digital Signature".
  - **DANFSE:** o caminho `{ADN DANFSE}/{chave}`, que devolve o PDF (NT 008).
- **Validação local:** os padrões dos esquemas trazem `^` e `$`. No XML Schema eles são literais; o validador da Sefin os trata como âncoras, e o teste do Bipaê valida do mesmo jeito.
- **Próximo passo:** conferir tudo na primeira emissão em produção restrita, com o certificado da empresa (F5-13.f, item E1).

### D-037 — NF-e de devolução de venda: referência e imposto

- **Contexto (F3-33.h):** quando o cliente devolve o que comprou por NF-e, a loja emite uma NF-e de entrada (tpNF 0, finNFe 4) com CFOP 1.202 (dentro do estado) ou 2.202 (de fora). Hoje a retaguarda do Bipaê só emite NF-e de saída; a devolução de compra ao fornecedor já existe.
- **Confirmado em fonte oficial:**
  - **CFOP:** com finNFe 4, o CFOP precisa ser de devolução (rejeição 327).
  - **Simples Nacional:** para o MEI (CRT 4), o 1.202 cobre qualquer devolução, exceto 1.503 a 1.506 (NT 2024.001).
  - **Documento referenciado:** a regra 321 do MOC pede a referência ao documento devolvido, mas dispensa os CFOP 1.201, 1.202, 1.410, 1.411, 5.921 e 6.921 (NT 2013.005).
- **Ainda sem fonte oficial:**
  - **Imposto da devolução por regime:** CST ou CSOSN, destaque e crédito do ICMS; IBS e CBS na devolução (estorno do débito da venda, LC 214/2025).
- **Por enquanto:** a devolução do cliente continua fora do Bipaê; a tela não oferece o que não está construído.
- **Próximo passo:** achar as regras de imposto da devolução de venda por regime no MOC 7.0 e na regulamentação do IBS e da CBS (nota de crédito); com elas, construir a F3-33.h.
