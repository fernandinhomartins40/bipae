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
| D-007 | 🔴 aberta | Escopo das NT 2026.007 e 2026.008 |
| D-008 | 🔴 aberta | Arredondamento de IBS/CBS por item × total |
| D-009 | 🔴 aberta | Devolução no PDV com referência por item (VC02-14) |
| D-010 | 🔴 aberta | Faixa de séries de NFC-e permitida para série por terminal |

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
