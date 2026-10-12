# Versões da legislação e dos leiautes fiscais

> Pesquisa feita em **11/10/2026** (Fase 0). Rever **obrigatoriamente** no início da Fase 3 e a cada nova NT: as notas técnicas da Reforma mudaram mais de dez vezes em pouco mais de um ano.

## ⚠️ Limitação desta pesquisa

O Portal Nacional da NF-e (nfe.fazenda.gov.br) **não pôde ser lido automaticamente** (loop de redirecionamento). As informações abaixo vêm de fontes secundárias (fornecedores de software fiscal, portais contábeis e escritórios de advocacia) que concordam entre si. A coluna **Status** indica o que ainda precisa ser conferido no texto oficial antes de virar regra no motor fiscal.

- ✅ confirmado por várias fontes que concordam
- 🟡 fonte única ou divergência entre fontes, conferir no texto oficial
- ❌ não encontrado

## 1. Base legal

| Norma | Data | Assunto | Status |
|---|---|---|---|
| EC 132/2023 | 20/12/2023 | Reforma Tributária do consumo (IBS, CBS, IS) | ✅ |
| LC 214/2025 | 16/01/2025 | Institui IBS, CBS e IS; split payment (arts. 31–35); NFS-e nacional (art. 62) | ✅ |
| LC 227/2026 | 2026 | Inclui §§3º e 4º no art. 348 da LC 214: prazo de 60 dias para corrigir falhas em obrigações acessórias | 🟡 |
| Decreto 12.955/2026 | 29/04/2026 (DOU 30/04) | Regulamento da CBS | ✅ |
| Resolução CGIBS nº 6/2026 | 30/04/2026 | Regulamento do IBS | ✅ |
| Portaria Conjunta MF/CGIBS nº 7/2026 | 30/04/2026 | Livro I comum aos dois regulamentos | 🟡 |
| Resolução CGIBS nº 16/2026 | 2026 | Competência provisória para editar o cronograma com a RFB | 🟡 |
| Ato Conjunto RFB/CGIBS nº 2/2026 | 2026 | Manual de integração da plataforma pública (split payment) | 🟡 |
| **Ato Conjunto RFB/CGIBS nº 4/2026** | 30/07/2026 (DOU 31/07) | **Cronograma de obrigatoriedade** dos campos IBS/CBS por documento (5 datas, ago/2026 a jan/2027) | ✅ |
| **Ato Técnico Conjunto RFB/CGIBS nº 1/2026** | 31/07/2026 (DOU 03/08) | Aprova a NT 2025.002 v1.51 e **suspende a rejeição** por ausência dos grupos IBS/CBS | ✅ |

## 2. Notas técnicas e leiautes

| Documento | Versão | Data | Conteúdo relevante | Status |
|---|---|---|---|---|
| NT 2025.002-RTC (NF-e/NFC-e) | **v1.52** (mais recente encontrada) | 01/10/2026 | Sem novos campos. Devolução precisa referenciar o documento original por item (`DFeReferenciado`, regra VC02-14, rejeição 321); ajuste da regra VC02-50 (rejeição 1194). Regra UB12-10 (rejeição sem grupo IBS/CBS) continua como **"implementação futura"** | ✅ |
| ↳ cronograma da v1.52 | comunicado RFB | 05/10/2026 | Homologação adiada para **26/10/2026**; produção para **16/11/2026** | 🟡 |
| NT 2025.002-RTC | v1.51 | 04/08/2026 | Notas de débito/crédito, devoluções, monofásico, áreas incentivadas; produção em 05/10/2026; regra 1115 movida para implementação futura | ✅ |
| NT 2025.002-RTC | v1.50 | 2026 | Tributação monofásica de combustíveis | 🟡 |
| NT 2025.002-RTC | v1.40 | 20/05/2026 | Campos adicionais e regras de validação | ✅ |
| NT 2025.002-RTC | v1.33 | 2025/2026 | Retirou a data de início da rejeição 1115 (antes prevista para 05/01/2026) | ✅ |
| Schema NF-e | PL_010 (v1.20b de 30/07/2025 confirmado; a versão do pacote correspondente à v1.52 **não foi confirmada**) | — | XSD com grupos IBS/CBS/IS | 🟡 |
| NT 2026.002 (Portal NF-e) | v1.10 | 04/08/2026 | **Não é sobre IBS/CBS**: vendas presenciais/não presenciais com DANFE Simplificado Tipo 2 (v1.00 de 25/05/2026) | 🟡 |
| NT 2026.002 (NFCom e NF3e) | v1.00 | jun/2026 | Campos RTC obrigatórios em NFCom/NF3e. Mesmo número, outros portais | 🟡 |
| NT 2026.007 v1.10 e NT 2026.008 v1.00 | — | 2026 | Citadas no comunicado de 05/10/2026; conteúdo **não identificado** | ❌ |
| Informe Técnico RT 2025.002 (tabelas cClassTrib, CST IBS/CBS, crédito presumido) | v1.70 citada para 16/10/2026 | — | Tabelas de classificação tributária. Data futura citada em fórum; conferir | 🟡 |
| NFS-e Padrão Nacional | — | — | Versão do leiaute com IBS/CBS **não identificada** | ❌ |

## 3. Cronograma de obrigatoriedade dos campos IBS/CBS (Ato Conjunto nº 4/2026)

| Data | Documentos | Quem |
|---|---|---|
| **03/08/2026** | NF-e (55), NFC-e (65), CT-e, CT-e OS, MDF-e, GTV-e, NF3e, BP-e, DC-e, NFS-e Via | Regime regular (CRT 3: Lucro Presumido/Real) |
| **01/10/2026** | NFS-e geral, NFCom, DeRE 1ª fase | Regime regular |
| **15/11/2026** | DeRE 2ª fase | — |
| **01/12/2026** | BP-e semiurbano/aéreo, NF-e ABI, NFAg, NFGas, NFS-e de plataformas e subitens específicos, NF-e de não contribuinte do ICMS | Regime regular |
| **01/01/2027** | Todos os DF-e de **optantes do Simples Nacional**; Duimp; NF-e de importação; **NF-e monofásica de combustíveis**; DeRE 3ª fase | Simples Nacional e casos especiais |

**Obrigação × rejeição:** a obrigação de preencher continua valendo nessas datas. Só a **rejeição automática** pela SEFAZ está suspensa, **sem nova data**, para NF-e, NFC-e, CT-e, CT-e OS, GTV-e, BP-e, NF3e e NFCom. A NFS-e não está na lista de suspensão. A rejeição pode voltar com pouco aviso.

**Penalidades:** pelo regulamento, multas por não destacar IBS/CBS só a partir do 1º dia do 4º mês após a publicação (≈ 01/08/2026), e a LC 227/2026 dá 60 dias para corrigir antes da multa (🟡).

## 4. Transição (valores de referência para as tabelas do motor)

| Período | CBS | IBS | ICMS/ISS | PIS/Cofins | IS | Status |
|---|---|---|---|---|---|---|
| 2026 | 0,9% (teste, compensável) | 0,1% (teste) | integral | integral | — | ✅ |
| 2027–2028 | alíquota plena (a definir por resolução) | 0,1% (teste; CBS reduzida em 0,1 p.p.) | integral | **extintos** | começa | 🟡 alíquotas exatas a confirmar |
| 2029 | plena | cresce | −10% | — | sim | ✅ (proporções da EC 132) |
| 2030 | plena | cresce | −20% | — | sim | ✅ |
| 2031 | plena | cresce | −30% | — | sim | ✅ |
| 2032 | plena | cresce | −40% | — | sim | ✅ |
| 2033 | plena | plena | **extintos** | — | sim | ✅ |

As alíquotas efetivas por ente (UF/município) ficam em tabela com vigência. Nada é fixo no código (ADR-0006).

## 5. Outros documentos e pagamentos

| Tema | Situação em out/2026 | Status | Impacto no Bipaê |
|---|---|---|---|
| SAT-CF-e (SP) | Encerrado: emissão vedada a partir de 01/01/2026 (Portaria SRE nº 79/2024); NFC-e obrigatória | ✅ | **Não haverá adaptador SAT.** Só leitura de XML CF-e histórico na importação |
| MFE/CF-e (CE) | Encerrado em 01/01/2026 (Decreto 36.417/2025); NFC-e obrigatória | ✅ | **Não haverá adaptador MFE.** |
| NFS-e Padrão Nacional | Municípios obrigados desde 01/01/2026 (LC 214, art. 62). Simples Nacional: 01/11/2026 pela Resolução CGSN nº 191/2026 (substituiu a nº 189, que dava 01/09) | 🟡 | NFS-e via API única do ADN; emissores municipais só como exceção |
| Split payment | 2027, etapa 1: **facultativo, B2B**, para Pix, boleto, TED e TEF. Etapa 2 (obrigatória, com cartões e B2C) em data a definir por ato conjunto | 🟡 | Arquitetura de pagamentos preparada (ADR-0009); nada a ativar no B2C do PDV antes da etapa 2 |
| Pix Automático | Em operação desde 16/06/2025 | ✅ | Uso no crediário/assinaturas via PSP |
| Pix por Aproximação | Em operação; limite por transação passou a ser definido por cada instituição (revogação do art. 16-A da IN BCB 512/2024) | 🟡 | Suporte via PSP/maquininha |

## 6. Fontes consultadas

- [Retributaria – NT 2025.002 v1.52](https://retributaria.com/nt-2025-002-v1-52-nfe-ibs-cbs/)
- [ERP Works – IBS e CBS na NF-e: caiu a rejeição, não a obrigação](https://erpworks.com.br/conteudos/nfe-ibs-cbs-obrigatoriedade-agosto-2026-rejeicoes/)
- [Contmatic – 4 ondas de obrigatoriedade](https://simplifique.contmatic.com.br/blogs/obrigatoriedade-ibs-cbs-documentos-fiscais-4-ondas-2026)
- [Sovos – NF-e e NFC-e com IBS e CBS](https://sovos.com/pt-br/blog/tributos/nf-e-e-nfc-e-com-ibs-e-cbs-na-reforma-tributaria/)
- [Nota Gateway – NT 2025.002 v1.40](https://notagateway.com.br/blog/nt-2025-002-rtc-chega-a-versao-1-40-com-novos-campos-e-regras-para-nf-e-e-nfc-e-na-reforma-tributaria/)
- [TOTVS – NT 2025.002 v1.40](https://www.totvs.com/blog/fiscal-clientes/reforma-tributaria-nt-2025-002-v1-40-para-nf-e-nfc-e-traz-novos-ajustes-e-reforca-exigencia-do-ibs-cbs/)
- [Pedroso Advogados – NT v1.33](https://www.pedrosoadvogados.com.br/reforma-tributaria-nota-tecnica-2025-002-rtc-versao-1-33-e-aplicacao-do-ibs-cbs-em-2026)
- [Tecnospeed – NT 2026.002 NFCom](https://blog.tecnospeed.com.br/nt-2026-002-reforma-tributaria-nfcom/)
- [Senior – NF3e NT 2026.002](https://documentacao.senior.com.br/exigenciaslegais/noticias/federal/2026/2026-06-10-nf3-e-nota-tecnica-no-2026-002-v-1-00-reforma-tributaria-aperfeicoamento-de-leiaute/)
- [Forvis Mazars – Decreto 12.955/2026](https://saladenegocios-br.forvismazars.com/2026/05/06/decreto-n-12-955-regulamentacao-cbs-em-vigor/)
- [Coimbra, Chaves & Batista – Regulamentos CBS e IBS](https://coimbrachaves.com.br/regulamentos-da-cbs-e-do-ibs-sao-publicados/)
- [TaxUp – Split payment](https://taxup.com.br/en/solutions/tax-reform/split-payment/) · [Taxcel – Split payment](https://taxcel.com.br/split-payment-reforma-tributaria)
- [CRCSP – Fim do SAT](https://online.crcsp.org.br/portal/noticias/noticia.asp?c=9146) · [NFE.io – Fim do SAT](https://nfe.io/blog/reforma-tributaria/fim-do-sat-sp-migracao-nfce/)
- [Contábeis – Ceará encerra MFE](https://www.contabeis.com.br/noticias/73536/ceara-encerra-mfe-e-cf-e-migracao-para-nfc-e-comeca-em-2026/)
- [Conta Azul – NFS-e Nacional, prazo de novembro/2026](https://contaazul.com/blog/nfse-padrao-nacional/)
- [Tecnospeed – Pix Automático e por Aproximação](https://blog.tecnospeed.com.br/?p=23867)
- Portal oficial (conferir manualmente): <https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=04BIflQt1aY%3D>
