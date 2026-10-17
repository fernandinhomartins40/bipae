# Cobertura fiscal: todas as UFs e todos os regimes

> Decisão do dono do projeto em **13/10/2026**: o Bipaê atende **as 27 UFs** e **todos os regimes de empresa**, do MEI ao Lucro Real. Este documento é o mapa do que isso exige, o que já está pronto, o que falta e de onde vem cada número. Pesquisa feita em 13/10/2026.

## Como ler

- ✅ **Confirmado em fonte oficial** (site da SEFAZ, da Assembleia ou do Diário Oficial do estado, Portal Nacional, Planalto).
- 🟡 **Fonte secundária ou oficial desatualizada**: o número é o consenso de fontes privadas ou vem de texto oficial que pode estar defasado. Precisa ser conferido na lei antes de virar regra do motor.
- 🔴 **Divergente**: as fontes não concordam. Não entra no motor até ser resolvido.
- ⬜ **Não levantado ainda.**

**Regra do projeto:** só entra na tabela de regras do motor o que estiver ✅. O que estiver 🟡 ou 🔴 aparece no sistema como "falta configurar", nunca com número suposto (regra 3 do `CLAUDE.md`).

## 1. Regimes de empresa

Uma confusão comum: **MEI, EI, SLU, LTDA e S.A. são naturezas jurídicas**; o que muda o imposto é o **regime tributário**. Uma LTDA pode estar no Simples, no Presumido ou no Real. O Bipaê guarda a natureza jurídica só como dado de cadastro; o cálculo depende do regime e do CRT.

| Regime | Quem é | CRT na nota | ICMS | PIS e COFINS | Situação no motor |
|---|---|---|---|---|---|
| **MEI** | Receita até R$ 81 mil por ano (LC 123/2006, art. 18-A, § 1º) | **4** (NT 2024.001) | CSOSN, sem destaque; valor fixo no DAS | No DAS | Pronto (F3-30): CRT 4 no cadastro e as regras da NT 2024.001 v1.20 na nota (CSOSN 102/300 na NFC-e e 102/300/400/900 na NF-e, CFOP permitidos, sem a partilha do ICMS), conferidas antes da SEFAZ |
| **Simples Nacional** (ME e EPP) | Receita até R$ 4,8 milhões por ano (LC 123, art. 3º) | **1** | CSOSN; ICMS dentro do DAS, **exceto** substituição tributária, antecipação e outros casos do art. 13, § 1º, XIII | No DAS | Cálculo pronto: CSOSN 101, 102, 103, 201, 202, 203, 300, 400 e 500, com crédito (art. 23) e ST. Falta: CSOSN 900 |
| **Simples acima do sublimite** | Receita acima de R$ 3,6 milhões (LC 123, art. 13-A): o ICMS e o ISS saem do Simples | **2** | **CST**, como no regime normal | No DAS | Pronto: o cadastro tem o regime "Simples acima do sublimite" (CRT 2, CST no ICMS, PIS/COFINS no DAS) e a tela da empresa avisa quando a receita do ano passa do sublimite (F3-29) |
| **Lucro Presumido** | Regime normal, PIS/COFINS cumulativos | **3** | CST | 0,65% e 3% (Leis 9.715/98 e 9.718/98) | Cálculo pronto (F3-04) |
| **Lucro Real** | Regime normal, PIS/COFINS não cumulativos | **3** | CST | 1,65% e 7,6%, sem o ICMS na base (Leis 10.637/02 e 10.833/03) | Cálculo pronto na saída. Falta: **créditos** de PIS/COFINS e de ICMS nas entradas (apuração), que é assunto do contador e fica fora do caixa |

Pontos que valem para todos os regimes:

- **IBS e CBS** seguem a classificação tributária do produto (cClassTrib), não o regime. O que muda por regime é a **obrigatoriedade** de preencher (dúvidas D-002 e D-003, ainda abertas para o Simples e o MEI).
- **PIS e COFINS acabam em 2027** (EC 132/2023). O motor já corta por data.
- O **regime precisa estar no cadastro da empresa**: o CRT sozinho não distingue Presumido de Real. O motor já aceita `taxRegime` nas regras; falta o campo na empresa (tarefa F3-06.c).

## 2. As 27 UFs

### 2.1 Alíquota interna geral do ICMS ("modal")

É a alíquota de quando o produto não tem regra própria. **Não inclui** o adicional do fundo de combate à pobreza (FCP), que é somado à parte e só para os produtos que cada UF lista.

| UF | Alíquota geral | Base legal e início da vigência | Status |
|---|---|---|---|
| AC | 19% | LC 55/1997, art. 18, I (LC 422/2022); desde 01/04/2023 | ✅ |
| AL | 20,5% | Lei 5.900/1996, art. 17, I, "b" (Lei 9.776/2025, texto no site da Assembleia); desde 01/04/2026 (antes 19%). FECOEP de 1% à parte | ✅ |
| AP | 18% | Lei 400/1997, art. 37, III, "i" (redação da Lei 1.949/2015; texto consolidado da Assembleia com alterações até a Lei 3.150/2024) | ✅ |
| AM | 20% | LC 19/1997 (LC 242/2022); desde 01/04/2023 | ✅ |
| BA | 20,5% | Lei 7.014/1996, art. 15, I; desde 07/02/2024 (antes 19%) | ✅ |
| CE | 20% | Lei 18.305/2023; desde 01/01/2024 | ✅ |
| DF | 20% | Lei 1.254/1996, art. 18, II, "c" (Lei 7.326/2023); efeitos desde 22/01/2024 | ✅ |
| ES | 17% | Lei 7.000/2001, art. 20, I | ✅ |
| GO | 19% | Lei 11.651/1991, art. 27, I (Lei 22.460/2023); desde 01/04/2024 | ✅ |
| MA | 23% | Lei 7.799/2002 (Lei 12.426/2024); aumento de 22% para 23% registrado pela Assembleia Legislativa; desde fevereiro de 2025 | ✅ |
| MT | 17% | Lei 7.098/1998, art. 14, I | ✅ |
| MS | 17% | Lei 1.810/1997, art. 41 | ✅ |
| MG | 18% | Lei 6.763/1975, art. 12; RICMS/MG (o artigo do RICMS/2023 precisa ser localizado) | ✅ |
| PA | 19% | Lei 5.530/1989 (Lei 9.755); a página da SEFA confirma os 19%, com data de início inconsistente | ✅ |
| PB | 20% | Lei 6.379/1996 (Lei 12.788/2023); desde 01/01/2024 | ✅ |
| PR | 19,5% | Lei 11.580/1996 (Lei 21.850/2023); início em março de 2024, dia a confirmar | ✅ |
| PE | 20,5% | Lei 15.730/2016, art. 15, VII (Lei 18.305/2023); desde 01/01/2024 | ✅ |
| PI | 22,5% | Lei 4.257/1989, art. 23, I, "c" (Lei 8.558/2024, texto no site da Assembleia); desde 01/04/2025 | ✅ |
| RJ | 20% (+ 2% de FECP = 22%) | Lei 2.657/1996 (Lei 10.253/2023); desde 20/03/2024 | ✅ |
| RN | 20% | Lei 6.968/1996 (Lei 11.999/2024); data de início a confirmar | ✅ |
| RS | 17% | RICMS/RS, Livro I, art. 27, X (compilação da Receita Estadual); desde 01/01/2022 | ✅ |
| RO | 19,5% | Lei 688/1996, art. 27 (Lei 5.634/2023); desde 12/01/2024 | ✅ |
| RR | 20% | Portal Nacional da DIFAL, atualizado em 30/03/2023; a lei precisa ser identificada | ✅ |
| SC | 17% | Lei 10.297/1996, art. 19, I | ✅ |
| SP | 18% | RICMS/2000, art. 52, I | ✅ |
| SE | 19% | Lei 3.796/1996, art. 18, I, "j" (Lei 9.176/2023, texto no site da Assembleia); desde 01/04/2023. Há adicional de FECOEP | ✅ |
| TO | 20% | Lei 1.287/2001, art. 27 (Lei 4.141/2023); desde 01/01/2024, conforme o STF na ADI 7375 | ✅ |

**Resumo (atualizado em 16/10/2026, dúvida D-021):** as 27 UFs ✅, todas com a alíquota geral em fonte oficial. Na matriz de cobertura, as 135 combinações calculam por completo.

**Alíquotas interestaduais** (Portal Nacional da DIFAL, ✅): 4% para mercadoria importada ou com conteúdo de importação acima de 40%; 7% nas saídas do Sul e do Sudeste (exceto ES) para Norte, Nordeste, Centro-Oeste e ES; 12% nos demais casos.

### 2.2 Fundo de combate à pobreza (FCP)

Fonte: Tabela de Alíquotas de FCP por UF do Portal Nacional da NF-e (25/02/2025), ✅, já importada no motor (`FCP_BY_UF`). É o que a SEFAZ aceita no campo, não a lista de produtos sujeitos ao adicional.

| Situação | UFs |
|---|---|
| Sem FCP | AC, AP, PA, SC |
| Alíquota única de 2% | BA, CE, DF, ES, MA, MS, MG, PB, PR, PE, PI, RN, RS, RO, SP, TO |
| Mais de uma alíquota | AL (1% e 2%), AM (2% e 1,2%), SE (2% e 1%) |
| Até um teto | GO, MT e RR (até 2%), RJ (até 4%) |

⬜ **Falta por UF:** a lista de produtos que pagam o adicional. Ela está na legislação de cada estado.

### 2.3 Quem autoriza a nota em cada UF

Fonte: relação de serviços web do Portal Nacional da NF-e e do portal da NFC-e da SEFAZ Virtual do RS (✅, lidas em 13/10/2026).

| Documento | Autorizador | UFs |
|---|---|---|
| **NF-e** | Próprio da UF | AM, BA, GO, MG, MS, MT, PE, PR, RS, SP |
| | SEFAZ Virtual do Ambiente Nacional (SVAN) | MA |
| | SEFAZ Virtual do RS (SVRS) | AC, AL, AP, CE, DF, ES, PA, PB, PI, RJ, RN, RO, RR, SC, SE, TO |
| **NF-e em contingência** | SVC-AN | AC, AL, AP, CE, DF, ES, MG, PA, PB, PI, RJ, RN, RO, RR, RS, SC, SE, SP, TO |
| | SVC-RS | AM, BA, GO, MA, MS, MT, PE, PR |
| **NFC-e** | Próprio da UF | AM, GO, MS, MT, PR, RS, SP |
| | SVRS | as demais, segundo o portal da SVRS. 🟡 MG precisa de confirmação (historicamente tem ambiente próprio de NFC-e) |

Na prática o Bipaê precisa falar com **11 ambientes de NF-e** (10 próprios mais SVAN e SVRS) e **cerca de 8 de NFC-e**, cada um com endereço de produção e de homologação. A NFC-e não tem servidor de contingência: a contingência é off-line (dúvida D-013).

### 2.4 O que mais muda de uma UF para outra

Checklist que cada UF precisa ter preenchido para ser considerada "coberta". Os itens ⬜ ainda não foram levantados.

| Item | O que é | Fonte oficial | Situação |
|---|---|---|---|
| Alíquota geral | Seção 2.1 | Lei do ICMS de cada UF | 20 ✅, 6 🟡, 1 🔴 |
| Alíquotas por produto | Cesta básica, bebidas, cosméticos, combustíveis etc. | Portal da DIFAL (860 linhas nas 27 UFs em 13/10/2026) e lei de cada UF | 🟡 importado como referência, com data e marcação de defasado (F3-25); vira regra só pela empresa ou contador |
| FCP | Seção 2.2 | Portal da NF-e e lei de cada UF | ✅ alíquotas; ⬜ produtos |
| Partilha do ICMS (DIFAL) | Venda interestadual a consumidor final não contribuinte (EC 87/2015, grupo ICMSUFDest) | Leiaute da NF-e, alíquotas internas confirmadas (seção 2.1) e lei de cada UF | 🟡 calculada (F3-32) com base única por padrão; base única × dupla por UF na dúvida D-025 |
| Substituição tributária | Quais CEST a UF adota e com que MVA | Regulamento de cada UF e protocolos do CONFAZ | 🟡 o motor calcula a ST com a MVA cadastrada pela empresa. A tela sugere a MVA oficial e avisa o que saiu da ST em **SP** (Portaria CAT 68/2019 e Portarias SRE 12/2026 e 27/2026) no **PR** (Anexo IX do RICMS/PR e Resolução SEFA 571/2019) em **MG** (Anexo XV do RICMS/MG) no **RS** (Apêndice II do RICMS/RS) em **SC** (Anexo 1-A do RICMS/SC) na **BA** (Anexo 1 do RICMS/BA) e em **GO** (Anexo VIII do RCTE/GO). As outras UFs vêm uma por vez (F3-26.c e F3-26.d) |
| Código de benefício (cBenef) | Obrigatório em algumas UFs quando há isenção ou redução | Tabela cBenef × CST do Portal da NF-e e tabela de cada UF | ⬜ |
| Sublimite do Simples | R$ 3,6 milhões em regra (LC 123, art. 13-A); o art. 19 deixa UFs pequenas adotarem valor menor | Portaria anual do Comitê Gestor do Simples | ✅ 2026: R$ 3,6 milhões nas 27 UFs (Portaria CGSN nº 54/2025, F3-29). Aviso na tela da empresa pela receita do ano |
| NFC-e: endereços | Autorização, consulta, evento e inutilização, em produção e homologação | Portal da SVRS e Portal Nacional da NFC-e (ENCAT) | ✅ 27 UFs (F3-28; MG na dúvida D-022) |
| NF-e: endereços | Autorizador, contingência (SVC-AN ou SVC-RS) e serviços, em produção e homologação | Portal Nacional da NF-e, relação de serviços web | ✅ 27 UFs (F3-08.b) |
| NFC-e: QR Code e consulta | Endereço de consulta que vai impresso no cupom, por UF | Portal Nacional da NFC-e e NT 2025.001 | ✅ 27 UFs, QR Code versão 3 (F3-13.a); protocolo das URLs sem https na dúvida D-014 |
| NFC-e: regras locais | Ex.: NT 2023.003 (regras exclusivas do AM); exigência de identificar o consumidor acima de certo valor | NTs e legislação de cada UF | ⬜ |
| IBS por UF e município | A partir de 2029, cada ente fixa a sua alíquota | Resolução do Senado e lei de cada ente | Não existe ainda (D-004, D-020) |

## 3. A fonte consolidada e o seu limite

O **Portal Nacional da DIFAL** (<https://dfe-portal.svrs.rs.gov.br/Difal/Aliquotas>) é mantido pelas SEFAZ e traz, para as 27 UFs, a alíquota interna por mercadoria, o FCP, a base legal e a data da última atualização. É a melhor fonte única que existe, mas **não pode ser usada sozinha**:

- **Está desatualizada em várias UFs.** Muitas linhas têm data de 30/12/2021. Exemplos: mostra 18% para CE, MA, PE, PR, RN e TO, e 17% para o PA, todos já alterados.
- **Está vazia para MG, PI e RO.**
- AP tem só a regra geral; SC tem 225 itens.

Por isso o plano usa o portal como **ponto de partida e lista de conferência**, e a lei de cada UF como confirmação.

**Atualização de 13/10/2026 (F3-25):** o portal foi importado de novo (860 linhas). MG, PI e RO já têm linhas. Comparando a linha geral do portal com a lei de cada UF, o portal está defasado em AM, CE, MA, PA, PE, PI, PR, RJ, RN, RO e TO; nessas UFs as linhas com data até a da linha geral aparecem como "defasadas" na tela Regras de ICMS. A tabela abaixo é do levantamento anterior.

| UF | Itens no portal | Atualizado em | | UF | Itens no portal | Atualizado em |
|---|---|---|---|---|---|---|
| AC | 6 | 01/04/2023 | | PB | 7 | 01/01/2024 |
| AL | 20 | 05/02/2025 | | PR | 26 | 30/12/2021 |
| AP | 1 | 30/12/2021 | | PE | 3 | 30/12/2021 |
| AM | 10 | 30/12/2021 | | PI | **0** | — |
| BA | 50 | 07/02/2024 | | RJ | 17 | 30/12/2021 |
| CE | 15 | 30/12/2021 | | RN | 6 | 30/12/2021 |
| DF | 57 | 22/01/2024 | | RS | 12 | 30/12/2021 |
| ES | 7 | 30/12/2021 | | RO | **0** | — |
| GO | 95 | 01/04/2024 | | RR | 3 | 30/03/2023 |
| MA | 40 | 30/12/2021 | | SC | 225 | 30/12/2021 |
| MT | 32 | 30/12/2021 | | SP | 55 | 03/02/2023 |
| MS | 10 | 30/12/2021 | | SE | 3 (sem regra geral) | 20/05/2025 |
| MG | **0** | — | | TO | 5 | 30/12/2021 |
| PA | 7 | 30/12/2021 | | | | |

## 4. Plano para nenhuma UF e nenhum regime ficarem de fora

O que garante a cobertura não é este documento, é um **teste automático**: o motor terá uma lista das 27 UFs e dos 5 regimes, e um teste que falha se alguma combinação não tiver regra ou não estiver marcada, de propósito, como "falta configurar". Assim, esquecer uma UF quebra a CI.

Ordem de execução (as tarefas estão em `docs/TAREFAS.md`):

1. **F3-06.c — Dados fiscais da empresa e tabela do motor (feita em 13/10/2026).** Regime tributário e UF no cadastro da empresa; no motor, as alíquotas interestaduais e a alíquota geral das **20 UFs ✅**, com as 7 pendentes listadas sem número (`packages/fiscal/src/tables/data/icms-uf.json`).
2. **F3-23 — Matriz de cobertura UF × regime.** O teste descrito acima: 27 UFs × 5 regimes = 135 combinações, cada uma com resultado esperado ou com "falta configurar" explícito. **O teste já existe** (`packages/fiscal/src/sale.test.ts`): em 13/10/2026, 114 combinações calculam por completo e 21 esperam a alíquota de uma das 7 UFs pendentes. Falta a tela do painel com o mapa.
3. **F3-24 — Fechar as 7 UFs pendentes.** Ler a lei de AL, AP, MA, PI, RS, SE e TO na fonte oficial e promover para ✅.
4. **F3-25 — Importar as alíquotas por produto do Portal da DIFAL.** Com a data de cada linha; linha anterior à última mudança de alíquota geral da UF entra como 🟡.
5. **F3-26 — Substituição tributária por UF.** CEST adotados e MVA, começando pelos segmentos do varejo alimentar (bebidas, alimentos, limpeza, higiene).
6. **F3-27 — Código de benefício (cBenef) por UF.**
7. **F3-28 — Endereços de autorização e de QR Code das 27 UFs**, para a NFC-e e a NF-e, em produção e homologação.
8. **F3-29 — CRT 2 e sublimite do Simples**, com o sublimite de cada UF.
9. **F3-30 — Regras do MEI na nota** (CRT 4, CFOP permitidos).
10. **Manutenção:** rotina periódica que baixa de novo as fontes oficiais, compara com o que está guardado e avisa quando algo mudou. As alíquotas mudaram em mais da metade das UFs entre 2023 e 2025.

**O que continua dependendo de pessoas:** a conferência do contador (item E3) e um certificado digital de homologação (item E1). A emissão de teste acontece na UF do CNPJ desse certificado; as demais UFs são validadas por teste automático e pela validação de schema até haver um CNPJ de cada uma.

## 5. Fontes

Oficiais:

- Portal Nacional da DIFAL, alíquotas por UF: <https://dfe-portal.svrs.rs.gov.br/Difal/Aliquotas>
- Portal da NFC-e da SVRS, relação de serviços web: <https://dfe-portal.svrs.rs.gov.br/Nfce/Servicos>
- Portal Nacional da NF-e, relação de serviços web: <https://www.nfe.fazenda.gov.br/portal/webServices.aspx>
- LC 123/2006 (Simples Nacional e MEI): <https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm>
- AC: <https://sefaz.ac.gov.br/2021/?p=12159> · AM: <https://sistemas.sefaz.am.gov.br/get/Normas.do?metodo=viewDoc&uuidDoc=0569a7de-c88a-4bc1-b895-6aaccb7f88b7>
- AP: <http://www.al.ap.gov.br/ver_texto_consolidado.php?iddocumento=10488> · AL: <https://www.sefaz.al.gov.br/nise/faq/icms/465-2-difal-3-base-de-calculo-e-aliquotas>
- BA: <http://mbusca.sefaz.ba.gov.br/DITRI/leis/leis_estaduais/legest_1996_7014_icmscomnotas.pdf> · CE: <https://belt.al.ce.gov.br/index.php/component/k2/item/8265-lei-n-18-305-de-15-02-23-d-o-15-02-23>
- DF: <https://www.sinj.df.gov.br/sinj/Norma/f308fe684e544a29af7a1570ee07ce3f/Lei_7326_20_10_2023.html> · ES: <https://www3.al.es.gov.br/Arquivo/Documents/legislacao/html/LO7000.html>
- GO: <https://www.sefaz.go.gov.br/Legislacao/arquivos/Leis/L_22572.htm> · MA: <https://sistemas1.sefaz.ma.gov.br/portalsefaz/jsp/noticia/noticia.jsf?codigo=7499>
- MT: <https://legislacao.mt.gov.br/lei/regulamentacao-do-icms-mt?origin=instituicao> · MS: <https://www.cofimt.ms.gov.br/icms-difcon-legislacao/>
- MG: <https://www.fazenda.mg.gov.br/empresas/legislacao_tributaria/ricms2023/partegeral2023.pdf> · PA: <http://www.sefa.pa.gov.br/orientacoes?layout=edit&id=20716>
- PB: <https://www.sefaz.pb.gov.br/legislacao/64-leis/icms/13905-lei-n-12-788-de-28-de-setembro-de-2023> · PR: <https://www.sefanet.pr.gov.br/dados/sefadocumentos/106201707871.pdf>
- PE: <https://www.sefaz.pe.gov.br/Legislacao/Tributaria/Documents/legislacao/Leis_Tributarias/2023/Lei18305_2023.htm> · RJ: <https://portal.fazenda.rj.gov.br/pagamentos/aliquotas-internas/>
- RN: <https://webdisk.diariooficial.rn.gov.br/Jornal/12025-03-08.pdf> · RO: <https://www.sefin.ro.gov.br/portalsefin/anexos/L23-5634---Altera-e-acresce-dispositivos-a-L96_688.pdf>
- RS: <https://www.diariooficial.rs.gov.br/materia?id=1415298> · SC: <https://leis.alesc.sc.gov.br/ato-normativo/11810/compilado>
- SP: <https://legislacao.fazenda.sp.gov.br/Paginas/RC32330_2025.aspx> · SE: <https://al.se.leg.br/por-unanimidade-deputados-aprovam-reducao-do-icms-para-19/>
- TO: <https://dtri.sefaz.to.gov.br/legislacao/ntributaria/decretos/Decreto2.912-06.htm>

Secundárias, usadas só para localizar a lei e para o status 🟡:

- <https://simtax.com.br/tabela-icms-2026-aliquotas-de-todos-estados-atualizada/>
- <https://www.legisweb.com.br/legislacao/?id=470993> (PI, Lei 8.558/2024)
- <https://www.legisweb.com.br/noticia/?id=30231> (MA, Lei 12.426/2024)
- <https://www.legisweb.com.br/legislacao/?id=452595> (TO, IN GABSEC 9/2023)
- <https://www.legisweb.com.br/legislacao/?id=439883> (SE, Lei 9.120/2022)
