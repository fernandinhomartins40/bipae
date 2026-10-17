# Changelog

## [F3-26.d.GO Substituição tributária em Goiás] — 17/10/2026

### Adicionado
- **Goiás na regra de ICMS:** 213 linhas com a MVA das operações internas, do Apêndice II do Anexo VIII do RCTE/GO, já com as MVAs do Decreto 10.799/2025. Cerveja e refrigerante trazem a MVA do industrial e a do atacadista.
- **O que saiu da ST em GO:** autopeças, materiais de construção, materiais elétricos e ração, em 01/03/2018.
- **Monitor semanal das fontes:** passou a conferir o Anexo VIII.

## [F3-26.c.BA Substituição tributária na Bahia] — 17/10/2026

### Adicionado
- **Bahia na regra de ICMS:** 282 linhas com a MVA original das operações internas, do Anexo 1 do RICMS/BA vigente em 2026. Inclui bebidas, construção, medicamentos, alimentícios, pneus e veículos.
  - **Origem:** é gerado do PDF oficial da SEFAZ-BA.
  - **Faixas de CEST:** entram inteiras.
- **Monitor semanal das fontes:** passou a conferir o PDF da Bahia.

## [F3-26.c.SC Substituição tributária em Santa Catarina] — 17/10/2026

### Adicionado
- **Santa Catarina na regra de ICMS:** MVA original de bebidas alcoólicas, cerveja, refrigerante e águas, do Anexo 1-A do RICMS/SC. Onde há duas MVAs, a do atacadista e a da indústria, cada uma aparece com o nome.
- **O que saiu da ST em SC:** a tela avisa a data e o decreto. Alimentícios e limpeza saíram em 2018, construção e eletrônicos em 2019, cosméticos e medicamentos em 2021, sorvetes em 2023.
- **Venda porta a porta:** a tela mostra quando o produto continua na ST só por esse sistema de venda.
- **Monitor semanal das fontes:** passou a conferir o Anexo 1-A.

## [F3-26.c.RS Substituição tributária no Rio Grande do Sul] — 17/10/2026

### Adicionado
- **MVA oficial do Rio Grande do Sul na regra de ICMS:** 194 itens do Apêndice II do RICMS/RS, com a MVA da operação interna. Inclui a Seção II, que é a ST só do RS, como carnes, papel para cigarro e telhas.
- **Produtos na ST sem MVA na tabela:** em bebidas, cigarros, combustíveis, medicamentos e bebidas quentes, a tela avisa que o produto está na ST e que a MVA fica em outro artigo.
- **Monitor semanal das fontes:** passou a conferir o RICMS/RS.

### Pendente
- **Rio de Janeiro:** o site de legislação da SEFAZ-RJ bloqueia o acesso pelo endereço de IP, então o RJ continua como "falta configurar".

## [F3-26.c.MG Substituição tributária em Minas Gerais] — 17/10/2026

### Adicionado
- **MVA oficial de Minas Gerais na regra de ICMS:** 986 itens da Parte 2 do Anexo XV do RICMS/MG, gerados das páginas oficiais da SEF/MG guardadas no Bipaê.
  - **Data de cada linha:** sai das notas de rodapé do regulamento.
  - **Mais de uma MVA no mesmo produto:** cada uma vem com o nome, como cerveja da indústria (140%) e do atacadista (70%), ou vinho importado e nacional.
- **Itens que saíram da ST em MG:** a regra avisa, com a data e o decreto.
- **Monitor semanal das fontes:** passou a conferir as páginas do RICMS/MG.

### Corrigido
- **Sugestão de MVA:** dois valores para o mesmo CEST não se confundem mais na lista.

## [F3-26.c.PR Substituição tributária no Paraná] — 17/10/2026

### Adicionado
- **MVA oficial do Paraná na regra de ICMS:** ao digitar o NCM, a tela sugere a MVA original da Resolução SEFA 571/2019, com o CEST e a descrição.
  - **Tamanho:** 444 itens em 26 tabelas (bebidas, alimentícios, cosméticos, construção, ferramentas, materiais elétricos, pneus e outros).
  - **Origem:** a tabela é gerada do texto consolidado guardado no Bipaê, com a redação atual de cada item. A redação antiga e os itens revogados ficam de fora.
  - **Cosméticos e materiais de construção:** usam a tabela nova da Resolução SEFA 1.245/2025, que vale a partir de 01/04/2026.
- **O que saiu da ST no Paraná:** a regra avisa a data e o decreto, lidos do Anexo IX do RICMS/PR. Saíram:
  - eletrônicos e celulares em 01/03/2026 (Decretos 12.828/2026 e 12.924/2026);
  - limpeza, papelaria e artefatos de uso doméstico em 01/08/2024;
  - sorvetes em 01/02/2025.
- **Eletrônicos e celulares:** a resolução ainda traz a MVA, mas o Bipaê para de sugeri-la a partir de 01/03/2026, porque o RICMS manda.
- **Monitor semanal das fontes:** passou a baixar e conferir os dois PDFs da SEFA-PR.
- **Leitura de PDF oficial na geração das tabelas:** feita com o `pdfjs-dist`, sem depender de programa instalado na máquina.

### Alterado
- **Sugestão da regra de ICMS:** passou a dizer "MVA", o termo geral. O aviso de saída da ST ficou neutro para portaria ou decreto.

## [F2-10 Teste do caixa dentro do app desktop de verdade] — 17/10/2026

### Adicionado
- **Venda testada no app desktop real, a cada envio:** a CI abre o Bipaê desktop no WebView do sistema (WebView2 no Windows, WebKitGTK no Linux) e faz uma venda pelo `tauri-driver`. Antes, o teste usava só o navegador.

### Corrigido
- **App desktop no Windows:** a janela principal passou a ser criada no código. Assim o WebView2 aceita a porta de teste sem perder as proteções padrão, e o teste no Windows deixou de falhar.

## [F3-26.e SP: base da ST de cerveja, chope e refrigerante] — 16/10/2026

### Adicionado
- **Cerveja, chope e refrigerante em São Paulo:** a regra de ICMS explica que a base da ST é a pauta fiscal, um valor em reais por marca e embalagem.
  - **Fonte:** Portaria SRE 27/2026, de 01/07 a 31/12/2026. O período é lido do texto oficial.
  - **Quando vale o IVA-ST:** só quando o produto não tem valor na pauta.
  - **Ainda não calculado:** o cálculo da ST por pauta aparece como "chega em breve" (tarefa F3-26.f), em vez de usar um percentual errado.

## [F3-26.b SP: o que está e o que saiu da substituição tributária] — 16/10/2026

### Adicionado
- **Aviso quando o produto saiu da ST:** a regra de ICMS avisa quando o NCM deixou a substituição tributária em São Paulo, com a data e a portaria. Exemplos:
  - produtos de limpeza saíram em 01/08/2026 (Portaria SRE 20/2026);
  - higiene pessoal saiu em 01/04/2026 (Portaria SRE 94/2025);
  - bebidas alcoólicas saíram em 01/01/2026 (Portaria SRE 64/2025).
- **Lista de SP gerada do texto oficial:** vem do texto consolidado da Portaria CAT 68/2019, da SEFAZ-SP, por anexo e por item. Ela também pega os itens que saíram dentro de anexos que continuam valendo, como as águas do Anexo III em 01/07/2026.
- **Produto na ST sem MVA publicada nas portarias que o Bipaê tem:** a tela diz isso, em vez de inventar um valor.

## [F3-26.a Substituição tributária por UF: base e SP alimentícios] — 16/10/2026

### Adicionado
- **MVA oficial na regra de ICMS:** ao digitar o NCM, a tela mostra a MVA (IVA-ST) que a SEFAZ do estado da empresa publicou para aquele produto, com o CEST e a descrição. O botão "Usar" preenche a MVA e a fonte da regra, e a empresa confere o produto e salva.
- **São Paulo, produtos alimentícios:** os 69 itens da Portaria SRE 12/2026, válidos de 01/05/2026 a 31/01/2029. A tabela é gerada do ato oficial guardado no Bipaê; nada é digitado à mão.
- **Estado sem tabela no Bipaê ainda:** a tela avisa em vez de inventar.
- **Monitor semanal das fontes oficiais:** passou a conferir também a página da SEFAZ-SP.

### Corrigido (CI)
- **Teste do app desktop no WebView real:**
  - no Linux, já passa;
  - no Windows, o passo ganhou diagnóstico para descobrir por que o WebView2 não abre a sessão.

## [F7-06 Bipaê Desktop para macOS] — 16/10/2026

### Adicionado
- **Bipaê Desktop no Mac:** aplicativo universal, que roda em Intel e em Apple Silicon, para macOS 11 ou mais novo. O `.dmg` passa a ser gerado na CI e nas versões publicadas.
- **Página de download:** reconhece o Mac e recomenda o instalador certo.
- **Ainda sem assinatura da Apple:** na primeira vez, abra com Control + clique → Abrir. A assinatura e a notarização dependem da conta de desenvolvedor da Apple (novo item E23).

## [F7-05 Guia de implantação] — 16/10/2026

### Adicionado
- **Guia para revendas e técnicos** (`docs/implantacao.md`), com o roteiro para colocar uma loja no ar:
  - o que pedir ao lojista antes da visita;
  - equipamentos compatíveis;
  - instalação do desktop e do navegador com o Conector;
  - configuração fiscal e de periféricos;
  - treinamento de 15 minutos;
  - checklist antes de liberar o caixa;
  - problemas comuns.
- **Sem promessa do que ainda não existe:** o guia deixa claro que a NFC-e sai só em homologação, sem valor fiscal, até a liberação da produção. Também lista o que ainda não está disponível.

## [F7-04 Central de ajuda] — 16/10/2026

### Adicionado
- **Nova tela "Ajuda" no menu:** 16 artigos com o passo a passo do dia a dia. Eles usam os nomes exatos dos botões e funcionam mesmo sem internet. Os assuntos:
  - primeiros passos e equipe;
  - abrir o caixa, atalhos F, sangria e fechamento, cancelamento e devolução;
  - crediário, fidelidade e relacionamento;
  - produtos e grade, compras pelo XML e condicional;
  - NFC-e e arquivos para o contador;
  - financeiro;
  - API e webhooks.
- **Busca que entende o jeito de escrever:** acha sem acento, com várias palavras e com palavras do dia a dia, como "fiado" para crediário.
- **Botão "Ir para..."** em cada artigo, que leva direto à tela.
- **Teste automático:** confere que nenhum artigo aponta para uma tela que não existe.

## [F7-03 Acessibilidade] — 16/10/2026

### Adicionado
- **Auditoria automática de acessibilidade (WCAG 2.2 AA)** a cada envio. Ela passa nas telas principais da retaguarda e do caixa, no tema claro, no tema escuro e no celular. Resultado: nenhuma violação.
- **Link "Pular para o conteúdo":** é o primeiro item do Tab. Quem usa teclado não precisa passar pelo menu inteiro.
- O que foi conferido e o que ainda se confere à mão está em `docs/acessibilidade.md`.

### Corrigido
- **Foco ao fechar gavetas e janelas:** volta para o botão que as abriu. Antes, o foco se perdia na página.
- **Crediário e pontos de fidelidade no caixa:** depois que uma venda subia e antes de chegar o saldo novo do servidor, o limite do crediário e os pontos apareciam inteiros de novo por alguns instantes, e dava para gastar duas vezes. Agora a venda continua sendo descontada até o saldo novo chegar.

## [F7-01 Teste de carga do caixa] — 16/10/2026

### Corrigido
- **Primeira sincronização de um catálogo grande no caixa web:** com 100 mil produtos, a carga não terminava em 9 minutos. Agora termina em cerca de 30 segundos, porque o caixa grava os produtos em blocos.

### Adicionado
- **Testes de carga com 100 mil produtos no banco do caixa**, no Node e no navegador. Os dois rodam na CI e falham se as metas forem passadas:
  - busca por nome: 18 ms no navegador (meta: 100 ms);
  - venda com 20 itens: 90 ms (meta: 1 s).
- Os números e como medir de novo estão em `docs/desempenho.md`.

## [F6-08.b Programa de fidelidade] — 16/10/2026

### Adicionado
- **Programa de pontos na tela "Relacionamento":** a loja escolhe:
  - quanto de compra vale 1 ponto;
  - quanto cada ponto vale no caixa;
  - em quantos meses os pontos vencem;
  - o mínimo para usar.
  Mudar o programa fica na auditoria.
- **Pontos nas compras com CPF ou CNPJ na nota:** a taxa de entrega não conta. Venda cancelada tira os pontos ganhos e devolve os usados, e devolução tira os pontos do valor devolvido.
- **"Usar pontos" no caixa:** com o CPF na venda, o caixa mostra os pontos do cliente e quanto valem, e transforma em desconto com um toque, mesmo sem internet. Esse desconto não conta no limite de desconto do operador.
- **Saldo justo:** os pontos que vencem primeiro são usados primeiro. O caixa desconta os pontos que já usou e que ainda não subiram. Se dois caixas sem internet usarem os mesmos pontos, a venda passa normalmente e a diferença fica na auditoria.
- **Extrato de pontos na ficha do cliente.**

## [F6-08.a CRM: histórico e segmentos] — 16/10/2026

### Adicionado
- **Histórico de compras na ficha do cliente:** junta as compras feitas com o CPF ou CNPJ dele na nota e mostra:
  - número de compras, total (menos devoluções) e ticket médio;
  - cliente desde, última compra e de quantos em quantos dias ele volta;
  - os produtos que ele mais compra.
- **Nova tela "Relacionamento":** os clientes separados em quatro grupos, com a regra de cada um escrita na tela:
  - **novos:** primeira compra nos últimos 30 dias;
  - **frequentes:** 4 ou mais compras em 90 dias;
  - **sumidos:** sem comprar há mais de 60 dias;
  - **ativos:** os demais.
- **Lista para ofertas (CSV):** sai só com quem aceitou receber ofertas e tem e-mail ou telefone. Cada exportação fica na auditoria (LGPD). A nova permissão "Exportar a lista de clientes que aceitaram ofertas" é do dono e do gerente.

## [F6-01.c Webhooks] — 16/10/2026

### Adicionado
- **Webhooks na tela "Integrações (API)":** o Bipaê avisa outro sistema na hora de cada venda, cancelamento, devolução ou mudança de produto (inclusive preço). O aviso traz os dados no mesmo formato da API pública.
- **Assinatura:** cada aviso vai assinado com um segredo que aparece uma vez e pode ser trocado, para o outro sistema conferir que veio do Bipaê.
- **Novas tentativas:** se o endereço não responder, o Bipaê tenta de novo em 1 minuto, 5 minutos, 30 minutos, 2 horas e 12 horas. A tela mostra o que está pendente, o que falhou e o histórico de entregas.
- **"Enviar teste":** manda um aviso de teste para conferir o endereço.
- **Segurança:** só endereços https. Endereços da rede interna são recusados. Criar, alterar e trocar o segredo ficam na auditoria.
- **Fim da F6-01:** com isso, a API pública está completa (chaves, contrato OpenAPI e webhooks).

## [F6-01.b Contrato OpenAPI e leitura pela API pública] — 16/10/2026

### Adicionado
- **Contrato da API em `/v1/public/openapi.json`** (OpenAPI 3.1, em português), aberto para quem for integrar.
- **Rotas públicas de leitura, com a chave da Integração:**
  - lojas;
  - produtos (com preço, códigos de barras e grade);
  - saldo de estoque por loja;
  - clientes (com o consentimento de marketing, LGPD);
  - vendas e devoluções, com itens e pagamentos.
- **Paginação e filtros:** paginação por cursor, e filtros "mudou desde" para produtos e clientes e por período para vendas. Dinheiro sai em centavos e quantidades em milésimos, como no resto do Bipaê.
- **Testes de conformidade:** um teste confere que cada rota do contrato existe, aceita a chave e responde no formato prometido. Outro confere que uma empresa nunca vê os dados de outra.

## [F6-01.a Chaves da API pública] — 16/10/2026

### Adicionado
- **Nova tela "Integrações (API)":** o dono cria chaves para outros sistemas (loja virtual, BI, planilhas) lerem os dados do Bipaê. A chave aparece uma única vez, com botão de copiar. A tela mostra o último uso, e a chave pode ser revogada na hora.
- **Permissões da chave:** por enquanto só leitura (produtos, preços, estoque e vendas; clientes e fornecedores). A chave nunca tem mais poder do que quem a criou e para de funcionar se essa pessoa perder o acesso.
- **Segurança:**
  - o banco guarda só o resumo (SHA-256) da chave;
  - a chave só abre as rotas marcadas como API pública, e qualquer outra responde 403;
  - criar e revogar chaves ficam na auditoria;
  - nova permissão "Criar chaves de API e webhooks", só do dono por padrão.
- **`GET /v1/public/me`:** o parceiro confere de quem é a chave e o que ela pode. As decisões estão no ADR-0016.

## [F5-12.b Venda condicional] — 16/10/2026

### Adicionado
- **Nova tela "Condicional" na retaguarda:** o cliente leva peças para provar em casa, com prazo de volta de até 60 dias, o limite do Ajuste SINIEF 02/18. As peças saem do estoque na hora.
- **Volta do condicional:** a loja informa o que o cliente ficou. Tudo volta ao estoque, e o que ficou vai para o caixa como a comanda "Condicional nº", pelo mesmo caminho dos pedidos do garçom. A venda e a NFC-e saem no caixa, como sempre, mesmo sem internet.
- **Cancelar:** se o cliente devolveu tudo, as peças voltam ao estoque. Abrir, fechar e cancelar ficam na auditoria.
- **Aviso honesto sobre a nota:** a tela explica que a remessa para demonstração (CFOP 5.912) e o retorno (CFOP 1.913) ainda são emitidos fora do Bipaê. A emissão chega com a NF-e da retaguarda (F5-12.c e dúvida D-033).

## [F5-12.a Grade em matriz] — 16/10/2026

### Adicionado
- **Grade em matriz no cadastro do modelo:** as variações aparecem numa tabela, por exemplo com o tamanho nas linhas e a cor nas colunas. Cada cruzamento mostra o estoque somado das lojas e o preço.
- **Preço na própria grade:** dá para trocar o preço de cada variação ali mesmo. A troca pede a permissão de preço e fica na auditoria, como no cadastro.
- **Ordem da grade:** o atributo com mais valores vai nas linhas, e o botão "Trocar linhas e colunas" inverte. Os valores seguem a ordem em que foram digitados (P, M, G).

## [Compra de uso pessoal fora do crédito de IBS/CBS] — 16/10/2026

### Adicionado
- **Marcação "Uso pessoal" na tela Compras (D-027):** a nota de compra de uso ou consumo pessoal (LC 214/2025, art. 57) sai do crédito de IBS e CBS na apuração e aparece em "ficou de fora da conta". Exemplos: veículo, joias ou bens dados a sócios e empregados. Marcar ou desmarcar exige a permissão de configuração fiscal e fica na auditoria.

### Corrigido
- **Texto da apuração de IBS/CBS:** antes dizia que o crédito só vale depois que o fornecedor recolhe. Agora segue o art. 48 da LC 214/2025: enquanto o pagamento dividido (split payment) não estiver em funcionamento, basta o destaque correto na nota autorizada.

### Confirmado (sem mudar o comportamento)
- **Estorno da devolução ao consumidor:** proporcional ao débito da parte devolvida, como prevê o art. 47, § 8º.
- **Alíquota da CBS de 2027 (D-004):** o Senado ainda não fixou. O Bipaê continua sem supor número até a publicação.
- **NFS-e Nacional para o Simples (D-006):** obrigatória desde 01/11/2026, pela Resolução CGSN nº 191/2026.

## [Mais dúvidas fiscais resolvidas em fontes oficiais] — 16/10/2026

### Adicionado
- **DANFE com CNPJ alfanumérico (D-023):** a chave com letras agora sai com código de barras, no modelo híbrido CODE-128C/A da NT Conjunta 2025.001. Antes, o DANFE saía só com a chave por extenso.
- **Rejeição 159 explicada:** "Operação não permitida para contribuinte exclusivo do IBS/CBS" (NT 2026.007, regra I08-191).

### Corrigido
- **Alíquota efetiva do IBS e da CBS com 4 casas (D-008):** com redução de alíquota, o motor arredonda a alíquota efetiva em 4 casas antes de calcular, como manda a NT 2025.002. Assim a conta bate com a que a SEFAZ refaz.

### Confirmado (sem mudar o comportamento)
- **Totais de IBS e CBS (D-008):** a nota soma os valores dos itens, como exigem as rejeições 1076 a 1093.
- **Opção do Simples pelo IBS e CBS no regime regular (D-005):** vale por semestre (janeiro e julho), é feita em setembro ou março e não pode ser desfeita no meio do semestre (LC 123/2006, art. 13, §§ 9º e 10). A tela da empresa agora explica isso.
- **CFOP do contribuinte exclusivo do IBS/CBS (D-017):** vale a planilha oficial, com 72 códigos. A SEFAZ consulta essa planilha, e a versão 2.10 não mudou a lista.

## [Custo de compra, transferência e vigência do cClassTrib] — 16/10/2026

### Corrigido
- **Custo de entrada da compra sem o crédito de tributo (D-024):** o ICMS, o PIS e a COFINS que a empresa recupera como crédito saem do custo do estoque (RIR/2018, art. 301, § 3º, e NBC TG 16, item 11). O que sai depende do regime:
  - MEI e Simples Nacional: nenhum, o custo continua cheio;
  - Simples acima do sublimite e Lucro Presumido: sai o ICMS;
  - Lucro Real: saem o ICMS, o PIS e a COFINS.
  - O IPI e o ICMS-ST continuam no custo.
- **Vigência do cClassTrib (D-016):** o dia do fim da vigência já não vale. Isso aparece na própria tabela oficial: os códigos 220001 a 220003 terminam no mesmo dia em que começam os substitutos, 221002 a 221004. Antes, nesse dia o motor respondia "vigência indefinida".

### Confirmado (sem mudar o comportamento)
- **Transferência entre lojas da mesma empresa (D-026):**
  - não tem ICMS (LC 87/1996, art. 12, § 4º, na redação da LC 204/2023). O crédito é transferido pelo Convênio ICMS 109/2024 e pelo Ajuste SINIEF 33/2024;
  - não tem IBS nem CBS (LC 214/2025, art. 6º, II), mas a nota continua obrigatória.

## [Dúvidas fiscais resolvidas em fontes oficiais] — 16/10/2026

### Corrigido
- **ICMS de Alagoas: 20,5% desde 01/04/2026**, pela Lei 9.776/2025, conferida no site da Assembleia Legislativa. Antes, aparecia como "divergente".
- **ICMS do Amapá: 18%**, pela Lei 400/1997, art. 37, III, "i", no texto consolidado da Assembleia. Antes, aparecia como "pendente".
- Agora **as 27 UFs têm a alíquota geral do ICMS confirmada em fonte oficial**, e o motor calcula todas as 135 combinações de UF e regime.

### Confirmado (sem mudar o comportamento)
- **NFC-e de entrega a domicílio:** é permitida pelo Ajuste SINIEF 19/2016 do CONFAZ (cláusula quarta, VII, "c"). Onde a UF restringe, a própria SEFAZ avisa com a rejeição 785, que agora aparece explicada na tela, junto com as rejeições 753, 786, 787, 788 e 434.
- **DIFAL a consumidor final:** a base é única, pela LC 87/1996, art. 13, X, na redação da LC 190/2022. O Bipaê já calculava assim.
- **NFC-e de Minas Gerais:** usa o ambiente próprio da SEF/MG; os endereços do Bipaê batem com a página oficial.
- **QR Code da NFC-e:** o schema oficial exige o "https://" que o Bipaê acrescenta.

## [F5-11 Ficha técnica] — 16/10/2026

### Adicionado
- **Produto "Insumo da ficha técnica"** (farinha, queijo, molho): entra na composição dos pratos e baixa do estoque com eles, mas não aparece no caixa.
- **Ficha técnica no cadastro do prato:** é a mesma tela do kit, agora com a unidade de cada insumo e quantidades fracionadas (ex.: 0,250 kg de queijo).
- **Custo da composição e margem:** aparecem no cadastro do prato, calculados com o custo de cada insumo. Se faltar o custo de algum insumo, a tela avisa em vez de inventar um número.
- **Estoque dos insumos:** vender o prato baixa cada insumo na quantidade da ficha, e cancelar ou devolver o prato repõe.

## [F5-10 Delivery com taxa por bairro] — 16/10/2026

### Adicionado
- **Nova tela "Delivery"** na retaguarda:
  - os bairros que cada loja atende e a taxa de cada um (mudar a taxa fica na auditoria);
  - as entregas do dia, com endereço e telefone, de "a sair" até "entregue".
- **Botão "Entrega" no caixa:** escolhe o bairro (com a taxa da loja) e preenche quem recebe, o telefone, o CPF e o endereço. A cidade já vem a da loja, e a taxa soma no total da venda. Funciona sem internet.
- **NFC-e de entrega a domicílio**, conforme o MOC 7.0:
  - a nota sai como entrega a domicílio, e a taxa entra como frete, rateada nos itens;
  - vão também o endereço do cliente e a loja como transportadora;
  - foi validada no schema oficial, e a contingência do caixa sai do mesmo jeito.

### Observação
- Quais estados permitem NFC-e de entrega a domicílio está na dúvida D-032, para o contador confirmar.

## [F5-08 Garçom no celular] — 16/10/2026

### Adicionado
- **Nova tela "Garçom"**, feita para o celular. O garçom escolhe a mesa (uma comanda aberta ou uma nova), busca os produtos pelo nome, acerta as quantidades e manda o pedido.
- **O caixa junta o pedido à comanda da mesa** na sincronização seguinte. Se a mesa ainda não tiver comanda, ele abre uma. Os pratos vão para a cozinha como em qualquer rodada.
- Cada pedido entra uma vez só, mesmo que chegue de novo. Se o caixa que pegou o pedido sair do ar, outro caixa da loja pega depois de 2 minutos.
- **O garçom acompanha cada pedido:** esperando o caixa, na comanda ou não entrou (com o motivo).
- O caixa continua funcionando sem internet. Já o celular precisa de internet para mandar o pedido, e avisa quando não conseguiu.

## [F5-09 Tela da cozinha] — 16/10/2026

### Adicionado
- **Produto "Preparado na cozinha"**: nova marcação no cadastro do produto.
- **Nova tela "Cozinha"**: mostra os pratos lançados nas comandas, por mesa, na ordem em que chegaram, com o tempo de espera. Depois de 15 minutos o pedido fica em destaque. A cozinha marca "Pronto" e quem leva à mesa marca "Entregue". A tela atualiza a cada 5 segundos e pode ficar num tablet ou numa TV.
- **A cada rodada da comanda vai à cozinha só o que é novo:** o prato novo, ou a quantidade a mais do mesmo prato.
- **Item tirado da comanda ou comanda cancelada:** o que ainda não ficou pronto sai da fila.

## [F5-07.b Telas das comandas] — 16/10/2026

### Adicionado
- **Botão "Comandas" no caixa**: lista as comandas abertas com o valor e há quanto tempo estão abertas, abre uma nova pela mesa ou pelo número e cancela com motivo (com autorização, para quem não tem a permissão).
- **Com a comanda na tela:** "Guardar na comanda" devolve o caixa livre, e "Dividir por N pessoas" mostra quanto cada um paga, sem perder centavo. Pagar fecha a comanda.
- **Nova tela "Comandas abertas" na retaguarda**: o que está em cada mesa agora, por loja, atualizada a cada 15 segundos.

## [F5-07.a Comandas no caixa e no servidor] — 16/10/2026

### Adicionado
- **Comandas no caixa**, sem depender de internet: abrir pela mesa ou pelo número, lançar os itens aos poucos (cada rodada fica guardada), fechar a conta como venda normal, com NFC-e, ou cancelar com motivo. Não há duas comandas abertas com o mesmo nome.
- Cada passo vira um evento que sincroniza (comanda aberta, atualizada e fechada). O servidor guarda as comandas e a rota `/v1/tabs` lista as abertas, as pagas e as canceladas de cada loja. É a base para o app do garçom e para a tela da cozinha.
- O cancelamento de comanda fica na trilha de auditoria.

### Observação
- As telas das comandas no caixa e na retaguarda vêm na próxima parte (F5-07.b).

## [F5-06 Autoatendimento] — 16/10/2026

### Adicionado
- **Modo autoatendimento no caixa**: o operador toca em "Autoatendimento" e escolhe um PIN de atendente; a tela fica simples para o próprio cliente bipar e pagar.
- **O cliente pode** bipar, pôr o CPF na nota e pagar com Pix ou cartão. Somem desconto, sangria, histórico, troca de operador e cadastro de produto.
- **Com o PIN do atendente:** tirar item, confirmar o pagamento e desligar o modo.
- O PIN fica só no aparelho, como hash com sal, e funciona sem internet. Recarregar a página não sai do modo.

### Observação
- Pagamento sem atendente (Pix com QR dinâmico e maquininha integrada) e conferência por peso aparecem como "chega em breve". Dependem das contas de Pix e TEF (E9 e E10) e de hardware.

## [F5-05 Prevenção de perdas] — 16/10/2026

### Adicionado
- **Nova tela "Prevenção de perdas"**, por período e por loja, para quem tem acesso à auditoria (dono e gerente). Ela mostra:
  - **por operador:** vendas canceladas (com a taxa), devoluções, descontos acima do limite, sangrias e diferença nos fechamentos de caixa;
  - **perdas de estoque** a custo (ajustes e contagens para menos), por produto;
  - **lotes vencidos** que ainda estão no estoque.
- **Alertas em linguagem simples:**
  - operador que cancela ou devolve mais que o dobro da média dos colegas;
  - operador com muitos descontos acima do limite;
  - falta de dinheiro no fechamento a partir de R$ 10;
  - maiores perdas de estoque;
  - lotes vencidos para tirar da venda.

## [F4-14.a Arquivos para o contador] — 16/10/2026

### Adicionado
- **Nova tela "Arquivos para o contador"**: escolha a empresa e o mês e baixe um ZIP com:
  - o XML autorizado de cada NFC-e do mês, inclusive as que depois foram canceladas;
  - o XML de cada cancelamento e de cada inutilização de números;
  - um resumo em planilha (chave, número, série, data, situação, valor e protocolos), que abre no Excel com acentos.
- A exportação fica registrada na trilha de auditoria.

### Observação
- O arquivo do SPED EFD é a próxima parte (F4-14.b).

## [MF-11.c Pedidos enviados pelo MercadoFlow] — 16/10/2026

### Adicionado
- **Pedido enviado ao fornecedor pelo MercadoFlow vira pedido de compra no Bipaê**, já como "Enviado ao fornecedor", com o número do pedido do MercadoFlow nas observações. O fornecedor é achado pelo CNPJ e os produtos pelo código de barras.
- **Quando falta cadastro**, o pedido espera na tela do MercadoFlow, dizendo exatamente o que cadastrar. Depois de cadastrar, "Criar pedido" resolve. Nada é cadastrado sozinho.
- Aviso repetido não cria pedido duplicado.

## [MF-11.b Encartes do MercadoFlow no caixa] — 16/10/2026

### Adicionado
- **O Bipaê busca de hora em hora os encartes publicados no MercadoFlow** de cada loja vinculada. Cada encarte vira uma pendência na tela do MercadoFlow, com a vigência e quantos produtos já estão cadastrados no Bipaê. Também dá para clicar em "Buscar encartes agora".
- **Aplicar** cria uma promoção por produto, com o preço do encarte, valendo só naquela loja e só na vigência. Produto sem cadastro fica de fora. O preço promocional volta ao MercadoFlow com o início e o fim da promoção.
- **Opção por loja "Aplicar sozinho os encartes do MercadoFlow"**.
- **Promoção de uma loja só:** a promoção pode valer numa loja só e não chega ao caixa das outras lojas. A tela de promoções mostra em qual loja cada uma vale.

## [MF-11.a Preços aprovados no MercadoFlow] — 16/10/2026

### Adicionado
- **Preço aprovado no MercadoFlow vira uma pendência no Bipaê**, na tela do MercadoFlow, com o preço atual, o aprovado e quem aprovou.
- **Aplicar** muda o preço pelo mesmo caminho da tela de produtos, com auditoria e envio ao caixa. Se a loja usa uma tabela de preço, o preço entra na tabela dela.
- **Descartar** tira da lista.
- Produto ainda não cadastrado aparece com o motivo e pode ser aplicado depois do cadastro.
- **Opção por loja "Aplicar sozinho os preços aprovados no MercadoFlow"**, registrada na auditoria.

## [MF-08 Vendas do caixa no MercadoFlow] — 15/10/2026

### Adicionado
- **Cada NFC-e autorizada vai para o MercadoFlow** pela fila de envio, na mesma hora em que a SEFAZ autoriza, com os dados exatos da nota (itens, códigos de barras, balança em kg, descontos e impostos).
- **Venda cancelada:** o cancelamento vai ao MercadoFlow sempre depois da venda, mesmo se a venda tiver ficado presa na fila.
- **Limite do plano do MercadoFlow:** as vendas da loja pausam por 6 horas e a tela do MercadoFlow avisa, com o botão "Ver planos".
- **Carga inicial:** ao vincular a loja, vão as vendas dos últimos 90 dias, da mais antiga para a mais nova.
- A tela do MercadoFlow mostra quando as vendas foram enviadas pela última vez.

### Observação
- Enquanto a emissão for só em homologação, as vendas vão como validação (o MercadoFlow confere e não grava).

## [F3-17 Cancelamento da NFC-e e inutilização de números] — 15/10/2026

### Adicionado
- **Venda cancelada no caixa cancela a NFC-e na SEFAZ**, em segundo plano, sem segurar o caixa:
  - nota autorizada: vai o pedido de cancelamento, com a justificativa "Venda cancelada no caixa: <motivo>";
  - nota que ainda não tinha saído: não é mais emitida e o número fica para a inutilização;
  - se a resposta da autorização tinha se perdido, o Bipaê consulta a nota pela chave antes, para cancelar a nota certa;
  - nota que o caixa emitiu em contingência é transmitida e depois cancelada;
  - com a SEFAZ fora do ar, a rotina de manutenção tenta de novo a cada 5 minutos.
- **Fora do prazo** (rejeição 501), a nota continua valendo e a tela explica o que fazer (registrar a devolução).
- **Nova tela "Inutilização de números":** mostra, por série, os números da NFC-e que ficaram sem nota (devoluções, vendas canceladas antes da nota) e pede a inutilização na SEFAZ. Recusa números que têm nota e registra o pedido na trilha de auditoria.
- **Na venda, a seção da nota mostra o cancelamento:** registrado (com protocolo), na fila, com falha temporária ou recusado (com causa e o que fazer).
- **Rejeições explicadas:** mais 9 códigos de cancelamento e inutilização, com o texto oficial do Anexo I do MOC 7.0.

### Observação
- Tudo testado contra a SEFAZ simulada. A primeira conversa com a SEFAZ de homologação de verdade depende do certificado A1.

## [F3-17.a Cancelamento e inutilização no motor fiscal] — 15/10/2026

### Adicionado
- **Motor fiscal monta e assina os pedidos de:**
  - cancelamento da nota (evento 110111, até 24 horas depois da autorização);
  - cancelamento por substituição da NFC-e (evento 110112, até 168 horas), quando a venda já foi acobertada pela nota de contingência;
  - inutilização de números que ficaram sem nota.
- **Leitura das respostas da SEFAZ** (evento registrado, recusado ou fora do prazo; inutilização homologada).
- **Fontes:** os schemas oficiais dos eventos de cancelamento (NT 2018.004) entraram nas fontes do projeto; os testes validam cada pedido contra eles.

### Corrigido
- A assinatura de eventos não encontrava o elemento assinado por causa de uma expressão regular mal escrita.

## [F3-18 Rejeições da SEFAZ explicadas] — 15/10/2026

### Adicionado
- **Nota recusada ou denegada mostra, além do código e do motivo oficial:**
  - **"O que aconteceu"**, em linguagem simples;
  - **"O que fazer"**, dizendo onde corrigir no Bipaê (Empresas e lojas, cadastro do produto, certificado);
  - se depende de alguém corrigir, se o Bipaê tenta de novo sozinho ou se é caso de falar com o suporte.
- **Cobertura:** 49 códigos mais comuns no varejo, com o texto oficial do Anexo I do MOC 7.0. Os demais mostram o motivo da SEFAZ com a orientação geral.
- **Fonte:** o Anexo I do MOC 7.0 (Leiaute e Regras de Validação) passou a fazer parte das fontes oficiais guardadas no projeto, com data e hash.

## [F3-15 Contingência off-line da NFC-e] — 15/10/2026

### Adicionado
- **O caixa sem internet emite a NFC-e em contingência off-line** quando há certificado A1 instalado no aparelho:
  - monta a nota com os dados do emitente que recebeu na última sincronização;
  - assina com o certificado do aparelho;
  - imprime o DANFE "EMITIDA EM CONTINGÊNCIA" e a via do estabelecimento, como manda o manual oficial.
- **A nota vai junto com a venda.** Quando a internet volta, o servidor transmite à SEFAZ exatamente o XML que o caixa assinou, sem mudar a chave.
- **Na reimpressão, enquanto a nota não sobe**, sai o DANFE de contingência guardado no caixa.
- **A retaguarda mostra "Emitida em contingência off-line"**, com o prazo de 24 horas.
- **A venda nunca trava por causa da nota.** Sem certificado no aparelho, ou se algo falhar, a venda segue e o servidor emite em contingência quando ela chegar.
- **Teste de ponta a ponta com a rede desligada:** vende sem internet, emite em contingência e a nota aparece na retaguarda ao reconectar.

## [F3-15.b1 Contingência da NFC-e no servidor] — 15/10/2026

### Adicionado
- **Venda que chega ao servidor mais de 4 minutos depois de feita é emitida em contingência off-line** (`tpEmis=9`), com a data de entrada em contingência e a justificativa. A emissão normal tem 5 minutos de tolerância (NT 2026.002); assim a venda feita sem internet não é recusada por atraso.
- **NFC-e que o caixa assinou em contingência é transmitida exatamente como veio**, sem mudar a chave, como manda o manual de contingência.
- **O caixa recebe no retrato fiscal os dados do emitente** (CNPJ, IE, endereço, município), a série do caixa e a origem da mercadoria de cada perfil. É o que ele vai precisar para montar a nota sozinho, sem internet (F3-15.b2).
- **A situação da nota mostra se ela foi emitida em contingência.**
- **Sem certificado no servidor, a lista de "falta configurar" continua completa**, com o certificado junto das outras pendências.

## [F3-15.a NFC-e em contingência no motor] — 15/10/2026

### Adicionado
- **O motor fiscal monta a NFC-e em contingência off-line** (`tpEmis=9`), como pedem o Manual de Contingência Off-line v2.0, o Anexo IV do MOC 7.0 e o Manual do DANFE NFC-e e QR Code v6.0:
  - a chave de acesso com o tipo de emissão 9;
  - a data e hora de entrada em contingência (`dhCont`) e a justificativa (`xJust`, de 15 a 256 caracteres);
  - o QR Code versão 3 de contingência, com o dia da emissão, o valor da nota, o destinatário e a assinatura RSA-SHA1 desses dados com o mesmo certificado da nota.
- A mesma venda gera sempre a mesma chave, porque a transmissão depois precisa manter a chave original.
- XML validado no schema oficial. Um teste confere a assinatura do QR Code com a chave pública.

## [Dúvidas fiscais pesquisadas em fonte oficial] — 15/10/2026

### Corrigido (com base nos documentos oficiais do Portal da NF-e)
- **Simples e MEI não preenchem o IBS/CBS em 2026** (NT 2025.002 v1.52; LC 214/2025, art. 348). Antes o motor pedia o cClassTrib também deles, e a NFC-e do Simples ficava parada em "falta configurar". A regra está na tabela fiscal, com a fonte.
- **NFC-e paga com cartão leva o grupo de cartões** (tpIntegra 2, com o código de autorização quando houver), como pede a regra YA04-10 da NT 2023.004 (rejeição 391).
- **Em homologação, o destinatário identificado sai com o nome oficial** "NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL" (regra 598 do MOC 7.0).
- **Pix sai sempre como estático (código 20).** Pela definição oficial da tabela de meios de pagamento, o código 17 é só para QR Code dinâmico, que o caixa ainda não gera. A opção saiu da tela da empresa.
- **Lote da nota de compra:** quando a soma dos lotes bate com a quantidade tributável, o Bipaê converte pela relação entre a quantidade comercial e a tributável (D-028).

### Documentação
- **`docs/fiscal/duvidas.md`:** nova seção "Pesquisa em fontes oficiais" com a fonte exata de cada resposta. Resolvidas: D-001, D-002, D-003, D-007, D-010, D-011, D-013, D-015, D-029 e D-030. Parciais: D-009 e D-028.
- **D-013 definiu a contingência off-line (F3-15):** a NFC-e normal deve ser emitida em até 5 minutos; venda feita sem internet vai em contingência off-line (`tpEmis=9`) e é transmitida em até 24 horas.

## [F3-14 NFC-e na venda] — 15/10/2026

### Adicionado
- **Detalhe da venda na retaguarda:** novo quadro "Nota fiscal (NFC-e)" com:
  - a situação: na fila, autorizada, recusada (com o motivo da SEFAZ), falha temporária ou falta configurar (com a lista);
  - número, série, chave de acesso e protocolo;
  - os botões "Baixar XML", "Ver cupom" e "Tentar de novo".
- **Reimpressão no caixa:** com a NFC-e autorizada, sai o cupom fiscal (DANFE da NFC-e com QR Code), lido do XML que a SEFAZ autorizou. Sem internet ou sem nota autorizada, sai o comprovante simples e o caixa diz o porquê.
- **Cadastro da empresa:** novo bloco "Dados para a nota fiscal", com inscrição estadual, endereço, município buscado na tabela do IBGE, CEP, telefone e o tipo de Pix e de vale da nota.

### Observação
- Tudo é emitido só em homologação. Sem o certificado A1 (E1), a nota fica em "falta configurar: certificado". Com ele, falta só a primeira conversa real com a SEFAZ (F3-11.b).

## [F3-14.b Emissão da NFC-e no servidor] — 15/10/2026

### Adicionado
- **Cada venda sincronizada ganha a sua NFC-e**, emitida em segundo plano no servidor. Por enquanto só em homologação; a primeira emissão real depende do certificado A1 (F3-11.b).
  - O servidor monta a nota, assina com o certificado A1 da empresa e envia à SEFAZ.
  - O XML autorizado fica guardado para baixar.
- **Nunca autoriza a mesma venda duas vezes:**
  - se a resposta da SEFAZ se perder, a nova tentativa consulta a nota pela chave antes de reenviar;
  - a mesma venda gera sempre a mesma chave.
- **Situação da nota por venda:**
  - autorizada, recusada (com o código e o motivo da SEFAZ) ou com falha temporária;
  - "falta configurar", com a lista do que resolver: inscrição estadual, endereço, certificado, NCM, perfil fiscal.
  - Nota que falta configurar não é emitida depois sozinha.
- **Nova tentativa:**
  - a pedido de quem cuida da loja;
  - automática: a cada 5 minutos, as notas paradas por falha temporária nas últimas 24 horas voltam para a fila.
- **Cadastro da empresa:** inscrição estadual, endereço com o município da tabela do IBGE (conferido com a UF), telefone e a escolha do código do Pix e do vale (D-029).
- Tudo testado contra a SEFAZ simulada: autorização, resposta perdida, recusa e SEFAZ fora do ar.

## [F3-14.a Venda vira NFC-e] — 15/10/2026

### Adicionado
- **O motor fiscal monta a NFC-e a partir da venda do caixa** (`buildSaleNfce`):
  - empresa emitente, série e número do caixa;
  - impostos completos de cada item;
  - formas de pagamento com o código oficial (tPag) e troco;
  - CPF ou CNPJ do cliente na nota.
- **XML validado contra o schema oficial.** A mesma venda gera sempre a mesma chave de acesso, para uma nova tentativa nunca criar outra nota.
- **O que impede a emissão vira lista de pendências**, com a mensagem para quem resolve. Por exemplo: falta a inscrição estadual, o produto não tem NCM, o perfil fiscal não tem cClassTrib.
- **Tabela oficial de municípios do IBGE** (5.571 municípios, com o código usado na nota), guardada nas fontes oficiais com data e hash.
- Dúvidas novas para o contador: D-029 (código do Pix e do vale) e D-030 (texto do primeiro item em homologação).

## [F5-04 Lote e validade] — 15/10/2026

### Adicionado
- **Tela "Lote e validade"** (menu próprio):
  - **vencendo e vencidos**, em até 7, 15, 30, 60 ou 90 dias, com os dias que faltam ou que já passaram;
  - **lotes de cada produto**, com loja, validade e saldo;
  - **informar lote**: mercadoria nova ou só identificação do estoque que já existe;
  - **descarte** com motivo (o vencido já vem com "Vencido");
  - **recall**: "Quem levou este lote", com o número da venda, a data e o CPF/CNPJ quando houver.
- **Cadastro do produto:** nova opção "Controla lote e validade".
- Com as etapas anteriores (F5-04.a e F5-04.b), a venda sai sempre do lote que vence primeiro e a compra pelo XML já traz os lotes do fornecedor.

## [F5-04.b Lotes na compra pelo XML] — 15/10/2026

### Adicionado
- **A compra pelo XML da NF-e dá entrada nos lotes que o fornecedor informou** (grupo `rastro`: número, quantidade, fabricação e validade), para os produtos que controlam lote.
  - A quantidade do lote é convertida para a unidade de estoque com o mesmo fator da entrada (ex.: caixa com 12).
  - Se o número de lote já existir com outra validade, a compra não trava: o lote entra separado, com a validade no nome.
  - A unidade do `qLote` não está definida no leiaute: ficou registrada como dúvida D-028.

## [F5-04.a Lote e validade] — 15/10/2026

### Adicionado
- **Lotes com validade por loja** (API `/v1/stock/lots`), para produtos marcados com "controla lote e validade".
  - O lote é informado como **mercadoria nova** (soma no estoque) ou **só para identificar** o estoque que já existe.
  - O mesmo lote não pode ter duas validades.
- **A venda baixa pelo lote que vence primeiro (FEFO)**, sozinha, quando o caixa sincroniza:
  - primeiro os lotes dentro da validade; os vencidos só saem se não houver outro;
  - **devolução e cancelamento voltam aos mesmos lotes** de onde a venda tirou.
- **Recall:** para cada lote, a lista das vendas que levaram unidades dele, com a quantidade e o CPF/CNPJ quando houver.
- **Vencendo e vencidos:** lista dos lotes que vencem em até N dias, com os dias que faltam.
- **Descarte** (vencido, avariado): sai do lote e do estoque, com o motivo na auditoria.

## [F5-03 Atacarejo] — 15/10/2026

### Adicionado
- **Preço de atacado no cadastro do produto**: "a partir de N unidades, cada uma sai por R$ X".
  - O preço de atacado precisa ser menor que o de varejo.
  - Para produto vendido por unidade, a quantidade precisa ser inteira.
  - Mudar o atacado é mudança de preço: pede a mesma permissão e entra na auditoria com o antes e o depois.
- **O caixa cobra o preço de atacado sozinho**, mesmo sem internet, quando a quantidade chega ao mínimo. O resumo mostra "Atacado: nome do produto".
- **A etiqueta de gôndola mostra o preço de atacado.**

### Corrigido
- No cadastro de produto, os códigos de barras separados por espaço não eram separados ao trazer os dados do catálogo.

## [F5-02 Promoções avançadas] — 15/10/2026

### Adicionado
- **Tela de Promoções** na retaguarda (menu próprio):
  - cria e edita leve X pague Y, preço por quantidade (com várias faixas) e combo;
  - vigência com início e fim opcional, e liga e desliga;
  - a lista mostra a regra e a situação: valendo, agendada, encerrada ou desligada.
- Com as etapas anteriores (F5-02.a a F5-02.c), a promoção cadastrada chega ao caixa na sincronização e vale mesmo sem internet. Um teste de ponta a ponta prova o caminho todo.

## [F5-02.c Promoções no caixa] — 15/10/2026

### Adicionado
- **O caixa aplica as promoções sozinho, mesmo sem internet**, com as que chegaram na última sincronização e a data do próprio caixa.
- **Na tela:** cada item mostra "Promoção: -R$ …", e o resumo traz a lista das promoções aplicadas.
- **O desconto de promoção não conta no limite de desconto do operador:** não pede gerente.
- **A venda grava o desconto em cada item e leva a lista das promoções no evento**, para os relatórios.
- **Desconto na venda dado antes da promoção nunca deixa o total negativo.**

## [F5-02.b Cadastro de promoções] — 15/10/2026

### Adicionado
- **Cadastro de promoções pela API** (`/v1/promotions`):
  - nome, início, fim opcional, ligada ou desligada, e a regra (leve X pague Y, faixa de quantidade ou combo);
  - toda criação e alteração vai para a auditoria;
  - não há exclusão: a promoção é desligada e fica no histórico.
- **Validação com mensagens claras.** Por exemplo:
  - "Quem leva precisa pagar menos do que leva";
  - o combo precisa de pelo menos dois produtos;
  - o fim precisa ser depois do início;
  - produto pesado só entra em faixa de quantidade.
- **As promoções ligadas vão ao caixa no retrato de preços.** Quando algo muda, o caixa recebe a lista nova na sincronização.

## [F5-02.a Motor de promoções] — 15/10/2026

### Adicionado
- **Novo pacote `@bipae/promotions`**, o motor das promoções do caixa. Funciona sem internet e calcula tudo em centavos inteiros. Três regras:
  - **leve X pague Y**, contando produtos do mesmo grupo juntos; a unidade mais barata sai de graça;
  - **faixa de quantidade**: a partir de N unidades (ou quilos), cada uma sai por um preço menor;
  - **combo**: um conjunto de produtos por um preço fechado, com o desconto repartido entre os itens.
- **Promoções não acumulam:** cada unidade entra em uma só, na ordem combo, leve-pague e faixa.
  - Item com desconto manual do operador fica fora.
  - Promoção que não baixaria o preço não é aplicada.
- O cadastro, o caixa e a tela chegam nas próximas etapas (F5-02.b a F5-02.d).

## [F5-01 Etiquetas de gôndola e de balança] — 15/10/2026

### Adicionado
- **Etiquetas** (menu próprio), em PDF para imprimir em folha A4 adesiva (3 × 8):
  - **gôndola:** nome, preço (o da tabela de preço da loja, quando ela tem uma) e código de barras EAN-13 ou EAN-8;
  - **balança:** para produtos vendidos por peso, com peso, preço do quilo, total e o código "2…" com o total, que o caixa já lê como etiqueta de balança.
- As barras seguem a especificação pública da GS1, e um teste confere que o caixa lê de volta o que a etiqueta imprime.

## [F4-13 Apuração de IBS e CBS] — 15/10/2026

### Adicionado
- **Apuração de IBS e CBS** (menu próprio), por empresa e mês. É uma conta gerencial para acompanhar e conversar com o contador.
  - **Débitos e créditos:** IBS e CBS destacados nas vendas, menos as devoluções, contra os créditos destacados nas notas de compra autorizadas.
  - **IBS e CBS separados:** crédito de um não paga o outro.
  - **Ficou de fora:** lista os itens vendidos sem cálculo e as compras sem IBS/CBS.
- **Regras com fonte oficial na tabela fiscal** (LC 214/2025):
  - quem apura pelo regime regular (art. 41);
  - como o crédito é apropriado (art. 47);
  - a fase de teste de 2026, com dispensa de recolhimento para quem cumpre as obrigações acessórias (art. 348).
- **Cadastro da empresa:** nova opção "Apura o IBS e a CBS pelo regime regular", para quem é do Simples ou MEI e fez essa escolha.
- Pontos em aberto registrados na dúvida fiscal D-027.

## [F4-12 Transferência entre lojas] — 15/10/2026

### Adicionado
- **Transferências entre lojas** (menu próprio):
  - ao enviar, o estoque sai da loja de origem e a mercadoria fica "em trânsito";
  - a loja de destino confirma o que chegou de fato; a diferença fica registrada na auditoria;
  - cancelar antes do recebimento devolve tudo à origem, com o motivo.
- Entre lojas de empresas (CNPJs) diferentes, a transferência avisa que precisa de NF-e de transferência. A emissão pelo Bipaê chega em breve (dúvida fiscal D-026).

## [F4-11 Inventário pelo celular] — 15/10/2026

### Adicionado
- **Inventário** (menu próprio, feito para a tela do celular):
  - uma contagem aberta por loja;
  - cada bipe soma ao que já foi contado, ou a pessoa digita o total da prateleira (inclusive zero);
  - aceita código de barras ou código interno;
  - mostra, produto a produto, o saldo do sistema e a diferença.
- **Fechar o inventário** ajusta o estoque dos produtos contados para o que foi contado. O que não foi contado não muda, e o fechamento fica na trilha de auditoria.

## [F4-10 Relatórios de vendas] — 15/10/2026

### Adicionado
- **Relatórios de vendas** por período, agrupados por produto, operador, loja, forma de pagamento ou dia:
  - quantidade, número de vendas, receita, margem (pelo custo do cadastro) e ticket médio;
  - curva ABC dos produtos.
- **Exportação em CSV** (pronto para o Excel em português), **XLSX e PDF**.

## [F4-09 Crediário com controle de inadimplência] — 15/10/2026

### Adicionado
- **Cada venda no crediário vira conta a receber** do cliente, com vencimento em 30 dias:
  - cancelar a venda cancela a conta;
  - devolver abate da conta;
  - o pagamento no crediário baixa as parcelas da mais antiga para a mais nova (pagamento parcial reduz a parcela).
- **Tela de inadimplência** com quem está em atraso, quanto e há quantos dias.
- **Bloqueio no caixa, mesmo sem internet**: com parcela vencida há mais de 5 dias, o cliente não compra mais no crediário até pagar.

## [F4-08 Recebíveis de cartão e Pix] — 14/10/2026

### Adicionado
- **Recebíveis de cartão e Pix** (menu próprio):
  - a loja cadastra a taxa e o prazo de cada forma (débito, crédito, Pix e vale); sem cadastro, valem prazos usuais com taxa zero e o aviso "falta configurar";
  - as vendas viram recebimentos previstos por data, com bruto, taxa e líquido;
  - cada previsto é conferido com o extrato importado (mesmo valor líquido, na data ou no dia seguinte).

## [F4-07 Conciliação bancária por OFX] — 14/10/2026

### Adicionado
- **Conciliação bancária** (menu próprio):
  - importa o extrato OFX do banco, nos formatos antigo e novo, com os acentos do Windows-1252; importar de novo não duplica;
  - para cada lançamento, sugere a conta a pagar ou a receber de mesmo valor e sentido, com vencimento até 10 dias de distância;
  - "Conciliar" dá baixa na conta com a data e o valor do banco, e fica na auditoria;
  - tarifas e o que não tem conta podem ser ignorados.

## [F4-06 DRE gerencial] — 14/10/2026

### Adicionado
- **DRE gerencial** mês a mês (menu próprio):
  - receita bruta, devoluções e impostos sobre a venda (os que o caixa calculou; IBS e CBS a partir de 2027), chegando à receita líquida;
  - custo da mercadoria vendida, pelo custo atual do cadastro, e o lucro bruto;
  - despesas por categoria (contas a pagar do mês, sem a compra de mercadoria) e o resultado.
- Avisa quantos itens vendidos ficaram sem custo.

## [F4-05 Fluxo de caixa] — 14/10/2026

### Adicionado
- **Fluxo de caixa** (menu próprio), por dia ou por mês:
  - vendas recebidas, com o crediário de fora até o cliente pagar e menos as devoluções pagas;
  - contas recebidas e pagas;
  - resultado e saldo acumulado;
  - o previsto das contas em aberto pelo vencimento.

## [F4-04 Contas a pagar e a receber] — 14/10/2026

### Adicionado
- **Contas a pagar e receber** (menu próprio):
  - lançar a conta com fornecedor ou cliente, categoria, documento e parcelas mensais;
  - acompanhar o que está em aberto, o que vence em 7 dias e o que está vencido;
  - dar baixa com data, valor efetivo (juros ou desconto) e forma;
  - cancelar com motivo.
- Permissões novas: "Ver contas a pagar e a receber" (dono, gerente e contador) e "Lançar e dar baixa" (dono e gerente, sensível). O operador de caixa não vê. Baixas, cancelamentos e mudança de valor ficam na auditoria.

## [F4-03 Formação de preço] — 14/10/2026

### Adicionado
- **Formar preço no cadastro do produto**: a partir do custo, com margem, impostos da venda e despesas em % do preço (divisor de markup), mostra o preço sugerido e quanto vai para cada parte. "Usar este preço" leva o valor para o campo.
- Os impostos vêm do motor fiscal para o regime da empresa e o perfil do produto (ICMS, FCP, PIS e COFINS; IBS e CBS a partir de 2027). No Simples Nacional, a pessoa informa a alíquota efetiva do DAS.

## [F4-02 Entrada de mercadoria do pedido] — 14/10/2026

### Adicionado
- **Receber o pedido de compra conferindo por bipagem**: cada bipe soma uma unidade, dá para digitar a quantidade, e a diferença contra o pedido aparece em destaque. Código que não é do pedido é avisado.
- **Ao confirmar**:
  - o que chegou entra no estoque da loja;
  - o custo do produto vira o custo médio ponderado (estoque atual e custo atual com o recebido e o custo do pedido);
  - o pedido fica recebido;
  - faltas e sobras vão para a auditoria.
- O custo novo também vai às lojas vinculadas ao MercadoFlow.

## [F4-01 Pedidos de compra] — 14/10/2026

### Adicionado
- **Pedidos de compra** (menu Pedidos de compra):
  - montar o pedido com fornecedor, loja que recebe, entrega prevista, produtos, quantidades e custo (sugerido pelo cadastro);
  - salvar como rascunho e enviar ao fornecedor;
  - imprimir;
  - cancelar com motivo.
- Numeração em sequência por empresa. O total de cada linha segue a mesma regra de arredondamento do caixa. Só o rascunho é editável. Envio e cancelamento ficam na auditoria.

## [P-06 PDV Embed no site] — 14/10/2026

### Adicionado
- **O componente do PDV Embed publicado em endereço fixo**:
  - `www.bipae.com.br/pdv/1.0.0/bipae-pdv.js` (versão exata, cache de um ano);
  - `www.bipae.com.br/pdv/1/bipae-pdv.js` (a mais nova do contrato 1, cache curto);
  - `pdv/versions.json` com o hash de integridade (SRI).
- Libera CORS para outros sites, e o deploy confere o endereço a cada publicação.

## [P-05 PDV Embed: autorização do gerente] — 14/10/2026

### Adicionado
- **Desconto acima do limite com a senha do gerente no PDV Embed**: quando a aplicação liga `authorizeManager` e um `secret`, o caixa pede o login e a senha do gerente. A rota nova `POST /authorize` devolve um código assinado que vale 5 minutos, só para aquela loja e aquele desconto, e a venda o leva em `discountAuthorization`.
- Compatível com o contrato v1: tudo é opcional (`settings.managerAuthorization`); quem não liga continua igual. Implementado no Node e no PHP de referência, no componente e no teste de conformidade (`--manager login:senha`).

## [P-03 Dados do cliente (LGPD)] — 14/10/2026

### Adicionado
- **Baixar meus dados**: em Minha assinatura, o dono baixa um ZIP com todas as tabelas da conta (um JSON por tabela), sem senhas, segredos nem certificados. Funciona também com a conta cancelada e fica na auditoria.
- **Exclusão definitiva com prazo**: a conta cancelada é apagada de vez 90 dias depois do cancelamento (configurável em ACCOUNT_PURGE_DAYS), por uma rotina diária. Reativar antes do prazo cancela a exclusão. A tela mostra a data e lembra de guardar as notas fiscais por 5 anos.
- A exclusão apaga os dados da empresa e as pessoas que ficaram sem nenhuma empresa; a linha do cliente fica anonimizada e a exclusão vai para a auditoria da plataforma. A trilha de auditoria continua imutável fora desse caso.

## [F2-08 Conector no instalador e ao ligar o computador] — 14/10/2026

### Adicionado
- **Atalho "Bipaê Conector" no menu Iniciar**, criado pelo instalador do Windows: abre o app direto na bandeja, como Conector.
- **Iniciar o Bipaê Conector junto com o computador**: opção no cartão do Conector, em Periféricos do Bipaê Desktop.

## [F2-09 Atualização entre vendas] — 14/10/2026

### Adicionado
- **O caixa oferece a versão nova entre uma venda e outra**: com o carrinho vazio aparece "Nova versão do Bipaê pronta" e o botão "Atualizar agora". Com item no carrinho o aviso some; o atualizador continua recusando instalar no meio de uma venda. Vale para o caixa no navegador e no desktop.

## [F2-07 Impressora USB pelo Windows] — 14/10/2026

### Adicionado
- **Impressora térmica USB instalada no Windows**: em Periféricos do Bipaê Desktop, a conexão "Impressora do Windows (USB)" lista as impressoras instaladas. O cupom vai pelo spooler do Windows em modo RAW, com os mesmos comandos ESC/POS da rede e da porta serial (gaveta inclusive).
- Nos outros sistemas a opção não aparece; se a configuração vier de um Windows, a mensagem explica.

## [F2-06 Balança direto no navegador] — 14/10/2026

### Adicionado
- **Balança pela Web Serial, sem o Bipaê Conector**: no Chrome e no Edge do computador, em Configurações → Periféricos, escolha a velocidade e a porta da balança uma vez. O caixa passa a ler o peso direto, com o mesmo protocolo (Toledo e Filizola) do desktop.
- Com o Conector pareado, a balança continua indo por ele.

## [F2-05 Caixa em navegador sem OPFS] — 14/10/2026

### Adicionado
- **Navegadores sem OPFS também guardam o caixa no aparelho**: o banco local roda em memória e uma cópia vai para o IndexedDB ao fim de cada gravação, antes de a venda ser confirmada. Ao reabrir, a cópia é carregada. Antes, nesses navegadores, as vendas sem internet podiam se perder ao fechar a página.

## [F2-04 Caixa desativado apaga os dados do aparelho] — 14/10/2026

### Adicionado
- **Caixa desativado na retaguarda**: na próxima vez que o aparelho abrir o caixa, ele envia as vendas e os registros que faltam, apaga os dados locais (vendas, catálogo, clientes, preços) e volta a pedir um caixa.
- Sem internet e com pendências, nada é apagado: a tela avisa quantos registros faltam e oferece "Enviar agora".

## [F2-03 Troca de operador no caixa] — 14/10/2026

### Adicionado
- **Trocar operador sem fechar o caixa**: o botão no topo da tela pede o e-mail e a senha de quem vai operar (precisa de internet para conferir). A sessão e a gaveta continuam; as vendas seguintes saem no nome de quem entrou, com as permissões dela.
- A troca vai para a auditoria (pos.operator_changed), com quem saiu e quem entrou.

### Corrigido
- Senha errada na autorização do gerente não derruba mais a sessão de quem está logado no caixa.

## [F2-02 Crediário com limite por cliente] — 14/10/2026

### Adicionado
- **Limite do crediário no cadastro do cliente** (precisa do CPF ou CNPJ). Só quem tem a permissão nova "Definir limite e receber no crediário" muda o limite; Dono e Gerente já a recebem. A mudança fica na auditoria.
- **Crediário no caixa, mesmo sem internet**: com o CPF na nota (F6), a forma "Crediário" (tecla R) mostra o disponível e não deixa passar do limite, contando as vendas que ainda não subiram.
- **Extrato do crediário** na ficha do cliente: compras, cancelamentos, devoluções e pagamentos. O botão "Registrar pagamento" baixa o saldo e fica na auditoria.

## [F2-01 Desconto por item no caixa] — 14/10/2026

### Adicionado
- **Desconto em um item só**: com o item escolhido na lista, o F4 (ou o botão Desconto) pergunta se o desconto vai "Neste item" ou "Na venda toda", em porcentagem ou em reais. A linha mostra o desconto do item.
- Acima do limite, continua pedindo a autorização do gerente, contando todos os descontos da venda.

## [F3-31 Conferência das fontes oficiais] — 14/10/2026

### Adicionado
- **Rotina que confere as fontes fiscais oficiais toda segunda-feira** (GitHub Actions):
  - baixa de novo a página do CEST, a do Portal Nacional da DIFAL, o NCM do Siscomex e os endereços da SEFAZ;
  - compara linha a linha com o que gerou as tabelas do Bipaê;
  - confere as listas do Portal da NF-e (planilhas, esquemas e notas técnicas).
- Quando algo muda, abre um aviso no GitHub com o relatório em português e o passo a passo para atualizar. Nada é atualizado sozinho.
- Para rodar à mão: `node packages/fiscal/scripts/check-sources.mjs`.

## [F3-30 Regras do MEI na nota] — 14/10/2026

### Adicionado
- **Nota do MEI (CRT 4) pelas regras oficiais** da NT 2024.001 v1.20, guardada nas fontes do motor fiscal:
  - NFC-e: CSOSN 102 ou 300 e CFOP 5102;
  - NF-e: CSOSN 102, 300, 400 ou 900, com a lista de CFOP permitidos para o 102, para o 900 e para a devolução;
  - sem a partilha do ICMS na venda para outro estado.
- O Bipaê confere antes de enviar à SEFAZ (evita as rejeições 337 e 782). No caixa, o produto do MEI com perfil fiscal fora dessas regras aparece como "falta configurar", com a explicação.

## [F3-29 Sublimite do Simples e CRT 2] — 14/10/2026

### Adicionado
- **Limites do MEI e do Simples Nacional com fonte oficial**: limite do MEI (R$ 81 mil), teto do Simples (R$ 4,8 milhões) e sublimite do ICMS e do ISS de 2026 (R$ 3,6 milhões nas 27 UFs, Portaria CGSN nº 54/2025). Ano sem portaria conferida aparece como "confira com o contador".
- **Aviso na tela Empresas e lojas** quando a receita do ano registrada no Bipaê chega a 90% de um limite ou passa dele. Acima do sublimite, o aviso orienta mudar para "Simples Nacional acima do sublimite" (CRT 2) com o contador.

## [F3-32 Partilha do ICMS (DIFAL)] — 14/10/2026

### Adicionado
- **Partilha do ICMS na venda para consumidor final de outro estado** (EC 87/2015): o motor fiscal calcula o valor que vai para a UF de destino (`calculateDifal`), com a alíquota interestadual certa (4%, 7% ou 12%) e a alíquota interna confirmada do destino.
- A NF-e leva o grupo `ICMSUFDest` em cada item e os totais da partilha, validados contra o leiaute oficial. Antes, esse tipo de venda era recusado.
- Base única por padrão e base dupla disponível; qual UF usa qual ficou na dúvida D-025 para o contador. O FCP do destino só entra com regra do produto, com aviso quando ficou de fora.

## [MF-13 Desktop abre o link do MercadoFlow] — 14/10/2026

### Adicionado
- **Bipaê Desktop abre o MercadoFlow no navegador do computador**: vincular a loja, ver as decisões do Tino e os demais links seguros (https) abrem direto. Se o navegador não abrir, o link continua na tela para copiar.

## [MF-14 Aviso de nota para conferir] — 14/10/2026

### Adicionado
- **"Chegou nota de Distribuidora X (R$ 1.834,50) para conferir"**: quando o MercadoFlow avisa que uma nota chegou no Confere, o Bipaê guarda o aviso (um por nota, mesmo se o aviso vier repetido).
- **Contador no menu Notas de entrada** com as notas novas das lojas que a pessoa enxerga. Ele zera quando a tela de notas da loja abre.
- Com o Bipaê aberto, cada nota nova também aparece como notificação do sistema.

## [MF-10.a Card do Tino] — 14/10/2026

### Adicionado
- **Card do Tino no painel inicial**: para dono e gerente, cada loja vinculada mostra quantas decisões o MercadoFlow sugere, o valor em jogo, os tipos (comprar, precificar…) e as primeiras decisões. Cada uma abre no MercadoFlow, onde a decisão é tomada.
- As decisões ficam guardadas por 15 minutos. Se o MercadoFlow não responder, o card avisa e o resto do painel segue normal.

## [MF-12 Cadastro, preço, custo e estoque no MercadoFlow] — 14/10/2026

### Adicionado
- **Lojas vinculadas mandam ao MercadoFlow**, sempre pela fila, só o que a loja autorizou:
  - o cadastro dos produtos com código de barras;
  - o preço (o da tabela de preço da loja, quando há);
  - o custo (cadastro e compra pelo XML);
  - os fornecedores;
  - o estoque em unidades de venda, uma vez por dia.
- **Carga inicial ao vincular** a loja: fornecedores, produtos, preços, custos e estoque, nesta ordem. Repetir um envio não duplica nada (chave de idempotência).

## [MF-09 Confere no Bipaê] — 14/10/2026

### Adicionado
- **Compras → Notas de entrada (Confere):** aceite dos termos, certificado A1 (enviado direto ao MercadoFlow; o Bipaê não guarda o arquivo nem a senha) com aviso de vencimento, saldo de leituras e compra por Pix, ler a nota pela chave bipando o DANFE, importar o XML e buscar as notas na SEFAZ.
- **Conferência pela tela:** cega ou aberta, bipando o produto ou a caixa (a caixa soma 1; a unidade avisa quando a nota está em caixa), divergências por item (avaria, validade, produto trocado), salva a cada item e resumo antes de concluir, com os itens que subiram mais de 5%.
- **Entrada no estoque** já em unidades e com o custo da nota: o produto é achado pelo código de barras, pelo código da caixa ou pelo código do fornecedor (aprendido na primeira vez). Produtos que a loja ainda não tem são associados na hora. A mesma conferência nunca entra duas vezes; a conferência refeita lança só a diferença. Conferência concluída em outro aparelho entra sozinha pelo aviso do MercadoFlow.
- **Pendências com fornecedor:** faltas, sobras, avarias, validade e produto trocado, para cobrar crédito ou devolução.

### Pendente
- MF-14: aviso de nota recebida com contador no menu.

## [MF-07 Cadastro rápido no caixa] — 14/10/2026

### Adicionado
- **Código desconhecido no caixa:** quem tem permissão de cadastrar produtos e está com internet vê o cadastro rápido, com o nome já preenchido pelo catálogo (consulta de no máximo 1,5 s). Informa o preço, salva e o produto entra direto na venda.
- Sem permissão, sem internet ou sem resposta do catálogo, o caixa segue como antes (avisa que o código não foi encontrado). O caixa nunca espera o catálogo.

## [MF-05 MercadoFlow na VPS] — 14/10/2026

### Adicionado
- A API do Bipaê passa a estar também na rede do MercadoFlow na VPS (nome `bipae-api`), sem porta nova no host, com as variáveis `MERCADOFLOW_*` vazias: a integração continua desligada até as credenciais irem para o `.env`.
- Comandos `mercadoflow-status` e `mercadoflow-webhook` na `admin-cli`, e o passo a passo para ligar em `docs/deploy.md`.

### Pendente
- E19: credenciais do parceiro Bipaê no MercadoFlow.

## [MF-04 Contas MercadoFlow e desconto] — 14/10/2026

### Adicionado
- **Tela "MercadoFlow"** (menu, para quem gerencia empresas e lojas): por loja, "Criar minha conta MercadoFlow" ou "Já tenho conta MercadoFlow", a situação do vínculo, as permissões, o desconto de cliente Bipaê, a fila de envio e os erros.
- **Criar a conta** usa o CNPJ e o nome da empresa e o nome e o e-mail do dono, com o aceite obrigatório. O Bipaê nunca define nem vê a senha: o MercadoFlow manda o link por e-mail. Se o CNPJ já tem conta, a tela segue direto para o vínculo.
- **Vincular conta existente:** o link abre no navegador (no desktop, aparece para copiar). O vínculo fica ativo pelo aviso do MercadoFlow ou pela consulta a cada 30 segundos; expirado ou recusado aparece com o motivo.
- **Cliente ativo e desconto:** o Bipaê avisa o MercadoFlow quando a assinatura muda (troca de plano, suspensão, reativação) e uma vez por dia.
- Criar a conta e iniciar o vínculo ficam na auditoria.

### Pendente
- MF-13: o desktop abrir o link no navegador do sistema.

## [MF-03 Catálogo em lote e devolução ao catálogo] — 14/10/2026

### Adicionado
- **Compra pelo XML com o catálogo:** os itens sem produto associado são consultados no catálogo em lote. A tela mostra "No catálogo" com o nome padronizado, e o produto novo já nasce com esse nome (editável), a marca, o fabricante e o código da caixa.
- **Os produtos cadastrados ajudam a melhorar o catálogo:** produto criado ou alterado com código de barras válido vai para a fila e é enviado em lotes a cada 5 minutos, só com dados cadastrais (nunca preço nem custo). Mudar só o preço não gera envio, e item recusado pelo catálogo não é reenviado.

## [MF-02 Catálogo no cadastro de produto] — 14/10/2026

### Adicionado
- **"Buscar no catálogo" no cadastro de produto:** bipar o código de barras ou digitar o nome traz nome, marca, fabricante, departamento, unidade, conteúdo, NCM e CEST sugeridos e os códigos de caixa. O usuário confere, informa o preço e salva: nada é cadastrado sozinho.
- **NCM e CEST do catálogo só são sugeridos quando existem na tabela oficial vigente.**
- O produto passa a guardar os dados de catálogo e as embalagens de compra (caixa ou fardo com a quantidade).
- Cache do catálogo (30 dias para achado, 1 dia para não achado, 10 minutos para busca por nome), consulta em lote de até 200 códigos e modo rápido de 1,5 s para o caixa.
- Vale para toda loja, com ou sem conta no MercadoFlow. Com a integração desligada ou o MercadoFlow fora do ar, o cadastro segue manual.

### Pendente
- Imagens do catálogo (MF-06) dependem de onde guardar arquivos (item E12).

## [MF-01 Base da integração MercadoFlow] — 13/10/2026

### Adicionado
- **Base da integração com o MercadoFlow** (ADR-0015), desligada enquanto as credenciais não forem configuradas: sem elas, nada muda no Bipaê.
- Cliente da API de parceiro com token em memória (renovado antes de vencer), nova tentativa com espera crescente e tempo limite por chamada.
- **Fila de envio em tabela (outbox):** o caixa nunca espera o MercadoFlow; com ele fora do ar, o envio fica guardado e é repetido depois. Recusa por dado errado não entra em laço.
- **Webhook** com assinatura conferida (HMAC do corpo) e entrega repetida ignorada. Já trata o vínculo aprovado e o vínculo encerrado.
- Tabelas do vínculo por loja, das embalagens de compra (caixa e fardo) e do cache do catálogo.

## [F3-25 Alíquotas por produto] — 13/10/2026

### Adicionado
- **Alíquotas de ICMS por mercadoria das 27 UFs**, importadas do Portal Nacional da DIFAL (860 linhas), com NCM quando o portal informa, FCP, base legal e a data de cada linha.
- **Marcação de defasado:** quando a alíquota geral do portal não bate com a lei vigente da UF, as linhas antigas daquela UF aparecem como "Defasada". Hoje isso acontece em 11 UFs.
- Na tela **Regras de ICMS**, a referência do portal para a UF da empresa, com busca. Serve de ponto de partida para o contador: só vira regra o que a empresa cadastrar.

## [F3-21.a Certificado no aparelho] — 13/10/2026

### Adicionado
- **Certificado A1 instalado no próprio aparelho** (navegador e desktop), em Periféricos: base para emitir a nota mesmo sem internet (contingência, F3-15).
- A chave privada fica guardada como **não exportável**: nem o Bipaê consegue lê-la de volta, só usá-la para assinar. O arquivo .pfx e a senha não ficam salvos. Certificado vencido não é instalado e para de assinar quando vence.
- A assinatura da nota aceita um assinador externo (o certificado do aparelho e, depois, o token A3) e gera exatamente a mesma assinatura.

### Pendente
- A3 por token ou cartão (F3-21.b) depende de um token de teste (item E18).

## [F3-19 Compras pelo XML] — 13/10/2026

### Adicionado
- **Tela "Compras":** importe o XML da nota do fornecedor e veja, antes de gravar, o fornecedor (novo ou já cadastrado), cada item e o produto da loja associado a ele.
- Na confirmação, o Bipaê **cadastra o fornecedor e os produtos que faltam, dá entrada no estoque e atualiza o custo**. Uma caixa com 12 unidades pode entrar como 12 unidades (fator de conversão).
- Associação automática: pelo código de barras e, a partir da segunda compra, pelo código do produto no fornecedor (com o mesmo fator).
- **Segurança:** a assinatura digital da nota é conferida (XML alterado é recusado), a nota precisa ser para uma empresa sua e cada nota entra uma vez só. Avisos para nota sem protocolo da SEFAZ, de homologação ou com certificado fora da ICP-Brasil. A entrada vai para a auditoria.
- Os tributos de cada item ficam guardados com a nota, para a apuração do IBS/CBS (F4-13).
- Dúvida D-024: custo com ou sem os créditos de impostos.

## [F3-11.a Conversa com a SEFAZ] — 13/10/2026

### Adicionado
- **Cliente dos webservices da SEFAZ (homologação):** status do serviço, envio de notas assinadas (síncrono com uma nota), consulta do recibo e consulta pela chave, para NF-e e NFC-e, nas 27 UFs, com os endereços oficiais.
- Mensagens conferidas contra os schemas oficiais dos serviços (pacote 9q do Portal da NF-e). O XML autorizado (nfeProc, nota mais protocolo) passa no schema `procNFe`.
- **Conexão segura:** HTTPS com o certificado A1 da empresa (autenticação mútua) e a cadeia oficial da ICP-Brasil (arquivo do ITI, guardado com hash). Um teste prova que servidor com certificado desconhecido é recusado.
- Retornos explicados em português: SEFAZ fora do ar, falha SOAP com o motivo, resposta sem mensagem.
- Botão **"Testar conexão com a SEFAZ"** na empresa com certificado: mostra o código e a mensagem que a SEFAZ devolveu.
- O leitor de XML passou para o motor fiscal (`@bipae/fiscal`), usado pelo DANFE e pelos retornos da SEFAZ.

### Pendente
- A primeira conversa com a SEFAZ real depende do certificado de homologação (item E1): tarefa F3-11.b.

## [F3-13.c DANFE da NF-e] — 13/10/2026

### Adicionado
- **DANFE da NF-e em PDF (A4 retrato)**, no novo pacote `@bipae/danfe`, gerado sempre a partir do XML da nota, como manda o manual: canhoto, emitente, quadro "DANFE", código de barras CODE-128C da chave, protocolo, destinatário, fatura, cálculo do imposto, transportador, produtos e dados adicionais, nas posições do Anexo II do MOC 7.0.
- **Já no leiaute da NT 2026.010** (produção em 01/12/2026): código do regime tributário no emitente, quadro "Total do IBS/CBS/IS" e, em cada item, cClassTrib, base, alíquotas (a efetiva quando há redução) e valores do IBS e da CBS.
- Nota grande continua em folhas adicionais com o cabeçalho completo e "FOLHA n/total"; informações complementares longas continuam na folha seguinte. Homologação sai com "SEM VALOR FISCAL"; nota sem protocolo só como prévia marcada.
- Dúvida D-023: simbologia do código de barras quando a chave tiver letras (CNPJ alfanumérico).

## [F3-08.b Endereços da NF-e] — 13/10/2026

### Adicionado
- **Endereços oficiais da NF-e das 27 UFs**, em produção e homologação: quem autoriza (10 UFs com ambiente próprio, MA pela SEFAZ Virtual do Ambiente Nacional, as demais pela SEFAZ Virtual do RS), quem atende em contingência (SVC-AN ou SVC-RS) e os serviços de cada um, mais os do Ambiente Nacional.
- Extraídos da "Relação de Serviços Web" do Portal Nacional da NF-e, guardada com data e hash. Um teste confere que cada endereço aparece na página oficial do seu ambiente e que homologação nunca aponta para produção.
- A página oficial mostra o PI em contingências diferentes (SVC-AN em produção, SVC-RS em homologação): o Bipaê segue a página de cada ambiente.

## [F3-08.a XML da NF-e] — 13/10/2026

### Adicionado
- **XML da NF-e (modelo 55)**, validado contra o schema oficial: destinatário com endereço e indicador da inscrição estadual, natureza da operação, finalidade (normal, complementar, ajuste, devolução com a nota referenciada), presença do comprador, transporte com transportadora e volumes, fatura e duplicatas, pedido do cliente no item, informações ao fisco e ao contribuinte.
- **IPI na nota** (tributado e não tributado), com o código de enquadramento vindo da regra.
- **ICMS com substituição tributária, redução e diferimento** na NF-e e na NFC-e: CST 10, 51 e 70, CSOSN 201 e 202, FCP com base. O total da nota soma ST, IPI, frete, seguro e outras despesas, pela fórmula do manual.
- Conferências antes da SEFAZ, com mensagem clara: CFOP de entrada em nota de saída, CFOP interno para destinatário de outro estado, inscrição estadual faltando, parcelas que não fecham com a fatura, "sem pagamento" com valor.

### Pendente
- Venda interestadual para consumidor final não contribuinte (partilha do ICMS, DIFAL) avisa que ainda não é emitida: tarefa F3-32.

## [F3-13.b DANFE da NFC-e] — 13/10/2026

### Adicionado
- **DANFE da NFC-e em 80 mm** com as nove divisões do manual oficial (versão 5.1): cabeçalho, itens, totais e pagamentos, consulta pela chave em 11 blocos, consumidor (CPF, CNPJ, estrangeiro ou "não identificado"), número, série e protocolo no horário local, avisos de homologação e de contingência (duas vezes, sem protocolo, com a via do estabelecimento), mensagens e a carga tributária da Lei 12.741. Também na versão resumida, sem itens.
- **QR Code na impressora térmica** pelos comandos próprios dela, com pelo menos 22 mm de conteúdo, como pede o manual. Na tela e na impressão pelo navegador, o QR Code sai em SVG; um teste lê o código de volta, como a câmera do celular.
- A impressão pelo navegador aceita cupom em HTML (necessário para o QR Code).

## [F3-13.a QR Code da NFC-e] — 13/10/2026

### Adicionado
- **QR Code versão 3 da NFC-e** (NT 2025.001): na emissão normal leva só a chave, a versão e o ambiente, com a URL oficial da UF. **Não precisa mais de CSC.**
- O XML da NFC-e passa a trazer o grupo `infNFeSupl` (QR Code e URL de consulta pela chave), validado contra o schema oficial.
- O item externo E1 deixou de pedir o CSC: só o certificado A1 de homologação continua necessário.

## [F3-28 Endereços da NFC-e das 27 UFs] — 13/10/2026

### Adicionado
- **Endereços oficiais da NFC-e de cada UF:** quem autoriza (8 UFs com ambiente próprio, as demais pela SEFAZ Virtual do RS), os seis webservices de homologação e produção, a URL do QR Code e a de consulta pela chave.
- **Extraídos das páginas oficiais** da SEFAZ Virtual do RS e do Portal Nacional da NFC-e (ENCAT), guardadas com data e hash. Quando a página lista o endereço antigo e o novo, vale o vigente.
- Um teste confere que **cada endereço aparece literalmente na página oficial**: nenhum foi digitado ou inventado.
- Dúvida D-022: a SVRS e o ENCAT divergem sobre o autorizador da NFC-e em MG.

## [F3-12 Numeração da NFC-e] — 13/10/2026

### Adicionado
- **Numeração da NFC-e:** a série é a do caixa (única na empresa) e o número da nota é o número da venda no caixa, para dois caixas nunca repetirem número, mesmo sem internet. Os buracos (devolução, venda que não virou nota) serão inutilizados na F3-17.

### Corrigido
- **Aparelho novo ligado a um caixa que já vendeu recomeçava a numeração em 1.** As vendas novas colidiam com números já gravados no servidor. Agora o servidor informa o último número recebido e o aparelho continua dali (nunca volta para trás).

## [F3-10 Certificado digital A1] — 13/10/2026

### Adicionado
- **Envio do certificado A1 da empresa** no cartão da empresa (Empresas e lojas): escolhe o arquivo .pfx, digita a senha e pronto.
- O servidor confere o certificado e explica o problema: senha errada, arquivo que não é certificado, certificado vencido ou ainda não válido, CNPJ de outra empresa (filial da mesma raiz pode usar o da matriz).
- **Arquivo e senha guardados cifrados** (AES-256-GCM); a API nunca devolve nenhum dos dois, e a trilha de auditoria registra só o titular e a validade. A equipe Bipaê (painel da plataforma) não tem acesso à tabela.
- **Aviso de vencimento:** faltando 30 dias ou menos, o cartão da empresa avisa em destaque; vencido, pede o novo.
- O servidor já usa o certificado para assinar notas, e o teste confere a assinatura com o certificado guardado.

### Banco de dados
- Migração `0010`: tabela de certificados por empresa, com isolamento por cliente (RLS).

## [F3-09 Assinatura da nota] — 13/10/2026

### Adicionado
- **Assinatura XML da NF-e/NFC-e** no padrão da SEFAZ (XMLDSig envelopado, C14N, SHA-1 e RSA-SHA1, com o certificado no KeyInfo), usando só a criptografia padrão: a mesma função serve o servidor e o caixa desktop.
- **Conferida de duas formas nos testes:** por uma biblioteca independente (xml-crypto), que refaz a canonicalização e verifica a assinatura, e pelo schema oficial. Qualquer alteração depois de assinar invalida a assinatura.
- O XML passa a sair já na forma canônica (aspas no texto não são mais trocadas por entidades), para o documento assinado ser idêntico ao gerado.

## [F3-07 XML da NFC-e] — 13/10/2026

### Adicionado
- **Gerador do XML da NFC-e** (modelo 65, leiaute 4.00 com os grupos da Reforma: IBS, CBS e totais), a partir da venda e dos impostos já calculados pelo motor. Chave de acesso com dígito verificador.
- **Validação automática contra os schemas oficiais**: os testes validam cada XML gerado contra o pacote **PL_010f v1.04** do Portal Nacional, e conferem que o validador reprova XML errado.
- **Tabela oficial de meios de pagamento (tPag)** importada do Portal Nacional, com data e hash.
- Só homologação (tpAmb = 2): o gerador nem tem opção de produção.

### Alterado
- O motor passou a usar o pacote de schemas **PL_010f** (31/08/2026), o vigente no Portal Nacional, no lugar do PL_010b. Isso resolve a dúvida D-012.

### Ainda não
- A nota ainda não é assinada (F3-09) nem enviada (F3-10); o QR Code entra na F3-13.

## [F3-24 Mais cinco UFs confirmadas] — 13/10/2026

### Alterado
- **Alíquota geral do ICMS confirmada em fonte oficial para MA (23%), PI (22,5%), RS (17%), SE (19%) e TO (20%).** Empresas dessas UFs no regime normal passam a ter o ICMS calculado sem precisar cadastrar regra.
- Agora são **25 de 27 UFs** confirmadas e **129 de 135** combinações UF × regime calculando por completo.
- Continuam pendentes **AL** (a lei diz 19%, o portal nacional mostra 20,5%) e **AP** (sem fonte oficial atual). Empresas dessas UFs informam a alíquota em Regras de ICMS, com o contador (dúvida D-021).

## [F3-23.b Cobertura fiscal no painel] — 13/10/2026

### Adicionado
- **Painel do super admin, "Cobertura fiscal":** tabela das 27 UFs × 5 regimes mostrando onde o Bipaê já calcula todos os impostos de uma venda comum e o que falta em cada combinação (passe o mouse para ver o motivo). Hoje: 114 de 135.
- Fecha a F3-23 (teste e mapa de cobertura).

## [F3-06.e Regras de ICMS da empresa] — 13/10/2026

### Adicionado
- **Nova tela "Regras de ICMS":** a empresa (normalmente com o contador) cadastra o que a alíquota geral da UF não cobre, por NCM e com vigência: alíquota própria do produto, redução da base, FCP e substituição tributária (MVA e alíquota).
- Vale a regra **mais específica** para o NCM (8 dígitos vence 4, que vence 2). Duas regras para os mesmos NCM no mesmo período são recusadas no cadastro, com a explicação.
- **O caixa recebe as regras na sincronização e usa no cálculo de cada venda**, mesmo sem internet. O servidor usa as mesmas regras na conferência.
- Toda criação, alteração e exclusão de regra vai para a trilha de auditoria (alteração fiscal é ação sensível).

### Banco de dados
- Migração `0009`: tabela de regras de ICMS por empresa, com isolamento por cliente (RLS).

Com isso a **F3-06 está concluída**: cadastro fiscal conferido nas tabelas oficiais, regime e UF da empresa, regras próprias e impostos calculados em cada venda.

## [F3-06.d4 Impostos da venda na retaguarda] — 13/10/2026

### Adicionado
- **Detalhe da venda:** em Vendas, clicar numa venda abre os itens, o pagamento e os **impostos que o caixa calculou**, item a item (CFOP, ICMS, ICMS-ST, FCP, PIS, COFINS, IBS e CBS) e somados.
- **O que falta configurar aparece ali mesmo**, em português: produto sem perfil fiscal, UF sem alíquota confirmada e assim por diante.
- Quando o cadastro mudou depois da venda e a conta do servidor não bate com a do caixa, a tela avisa e mostra o que o caixa calculou.
- Teste de ponta a ponta do caminho inteiro: configurar a empresa, vender sem internet e ver os impostos na retaguarda.

### Alterado
- A tela de perfis fiscais deixou de dizer que o Bipaê não calcula impostos: agora calcula, para conferência. O que ainda não existe é a emissão da nota.

Com isso a **F3-06.d está concluída**. Os valores são para conferência com o contador; o ICMS usa a alíquota geral da UF até as regras por produto entrarem (F3-06.e e F3-25).

## [F3-06.d3 Impostos calculados na venda] — 13/10/2026

### Adicionado
- **O caixa calcula os impostos de cada item ao fechar a venda, mesmo sem internet.** Usa a UF e o regime da empresa e o perfil fiscal do produto, já guardados no aparelho. O desconto da venda entra na conta, rateado entre os itens.
- **O resumo dos impostos vai junto com a venda** (CRT, CFOP, ICMS, ICMS-ST, FCP, PIS, COFINS, IBS e CBS, e o que ficou por configurar) e fica gravado no servidor, item a item.
- **O servidor refaz a conta e registra se bateu.** Quando não bate (por exemplo, o regime mudou e o caixa ainda não tinha sincronizado), a venda entra do mesmo jeito e fica marcada para o suporte.

### Garantias
- **Imposto nunca impede venda.** Empresa que não configurou UF e regime vende como sempre, sem resumo de impostos. Se os dados fiscais do aparelho estiverem com problema, a venda acontece e segue sem o resumo.
- Caixas ainda na versão anterior continuam enviando vendas normalmente.

### Banco de dados
- Migração `0008`: coluna de impostos nos itens da venda e o sinal de conferência na venda.

### Ainda não aparece na tela
- Os valores já são calculados e gravados, mas a retaguarda ainda não os mostra: é a parte d4.

## [F3-06.d2 Dados fiscais no caixa] — 13/10/2026

### Adicionado
- **O caixa passa a receber os dados fiscais na sincronização:** a UF e o regime da empresa e os perfis fiscais dos produtos. Eles ficam guardados no aparelho, para o cálculo funcionar sem internet, e só são reenviados quando mudam.
- **CST do PIS e da COFINS no perfil fiscal**, para empresas do Lucro Presumido e do Lucro Real. A tela mostra o significado do código e o servidor recusa código que não existe.

### Banco local do caixa
- Migração local 4: tabela de perfis fiscais. Aplica sozinha na próxima abertura do caixa.

### Ainda não ligado
- O caixa já tem os dados, mas ainda não calcula os impostos ao fechar a venda: isso é a parte d3.

## [F3-06.d1 Impostos do item de venda] — 13/10/2026

### Adicionado
- **O motor já responde "quanto de imposto tem neste item?"** a partir do que o lojista cadastrou: UF e regime da empresa, perfil fiscal do produto e valor. Sai o CRT, o CFOP e, para ICMS, PIS, COFINS e IBS/CBS, o valor com a explicação da conta.
- **Quando falta algo, o motor diz o quê**, em português: "Informe a UF e o regime tributário da empresa", "O produto não tem perfil fiscal", "A alíquota geral de ICMS de AL ainda não foi confirmada. Peça a alíquota ao contador".
- **Simplificações ficam à vista:** quando o ICMS usa a alíquota geral da UF, o resultado avisa que produto com alíquota própria precisa de regra específica.
- **Teste de cobertura das 27 UFs × 5 regimes** (135 combinações): hoje 114 calculam por completo e 21 esperam a alíquota de uma das 7 UFs pendentes. Se uma UF ou um regime ficar sem resposta, o teste falha.

### Ainda não ligado
- É a função do motor, com testes. O caixa ainda não a chama: isso vem nas partes d2 a d4.

## [F3-06.c Regime tributário e UF da empresa] — 13/10/2026

### Adicionado
- **Regime tributário no cadastro da empresa:** MEI, Simples Nacional, Simples acima do sublimite, Lucro Presumido ou Lucro Real. A tela explica cada um e mostra o que ele muda na nota (CRT e se o ICMS usa CSOSN ou CST).
- **Alíquota geral do ICMS das 27 UFs no motor fiscal.** As 20 confirmadas em fonte oficial têm número e lei; as 7 pendentes (AL, AP, MA, PI, RS, SE, TO) aparecem como "ainda não confirmada", sem valor suposto.
- **Alíquotas interestaduais** (4%, 7% e 12%) para qualquer par de UFs.
- Ao escolher a UF da empresa, a tela mostra a alíquota geral e a lei, ou avisa que ainda falta confirmar.
- Empresa sem UF ou sem regime mostra "Falta configurar" no cartão.

### Banco de dados
- Migração `0007`: coluna `tax_regime` na empresa (opcional).

## [Plano de cobertura: 27 UFs e todos os regimes] — 13/10/2026

### Documentado
- **`docs/fiscal/cobertura-ufs-regimes.md`**: o mapa do que é preciso para atender as 27 UFs e todos os regimes, do MEI ao Lucro Real, com a fonte de cada número.
  - Alíquota geral do ICMS das 27 UFs: 20 confirmadas em site oficial do estado, 6 só em fonte secundária e 1 divergente (Alagoas).
  - FCP por UF, autorizador da NF-e e da NFC-e de cada UF e o servidor de contingência.
  - Os cinco regimes (MEI, Simples, Simples acima do sublimite, Presumido e Real), com o que o motor já calcula em cada um.
  - O que ainda muda por UF e não foi levantado: alíquotas por produto, substituição tributária, código de benefício, endereços de QR Code.
- **Plano no backlog:** nove tarefas novas (F3-23 a F3-31). A principal é um teste que falha se alguma UF ou algum regime ficar sem regra, para a cobertura não depender de memória.
- O item externo E2 (UF prioritária) foi fechado: são todas.
- Dúvida D-021 com as sete UFs que faltam confirmar.

## [F3-06.b Telas com as tabelas fiscais] — 13/10/2026

### Adicionado
- **Busca de NCM pelo nome da mercadoria** no cadastro de produto: digite "arroz polido" ou "cerveja" e escolha na lista. Quem digita o código vê na hora o que ele é, ou o aviso de que não existe.
- **Sugestão de CEST** pelo NCM escolhido, com o lembrete de que só se preenche quando o produto está em substituição tributária no estado.
- **Perfil fiscal explicado:** cada campo (CFOP, CSOSN, CST, cClassTrib) mostra o significado do código digitado e oferece as opções oficiais; código fora da tabela é avisado antes de salvar.

## [F3-06.a Cadastro conferido nas tabelas oficiais] — 13/10/2026

### Adicionado
- **O cadastro passa a conferir os códigos fiscais nas tabelas oficiais.** NCM e CEST do produto e, no perfil fiscal, origem, CFOP, CSOSN, CST do ICMS e cClassTrib: código que não existe ou não está em vigor é recusado com a explicação ("O CFOP 6102 não é de venda dentro do estado. Os CFOP de venda dentro do estado começam com 5.").
- Produto antigo com NCM que deixou de existir continua podendo ser alterado (preço, nome); a conferência só vale para o código que mudou.
- **Rotas de consulta** para as telas: busca de NCM por palavra ou código (`GET /v1/fiscal/ncm?q=`), sugestão de CEST pelo NCM (`GET /v1/fiscal/cest?ncm=`) e as listas do perfil fiscal (`GET /v1/fiscal/options`).

### Corrigido
- O seed de demonstração usava o NCM 3402.20.00 (sabão em pó e detergente), extinto em 2022. Agora usa o 3402.50.00. Quem já tem esses dois produtos de demonstração segue vendendo normalmente; o código antigo só precisa ser trocado ao editar o NCM.

## [Correção da limpeza periódica] — 13/10/2026

### Corrigido
- **A limpeza de logins antigos não era agendada em produção.** O identificador da tarefa repetida tinha dois-pontos, que o BullMQ recusa. A API subia normalmente e só avisava no log. A rotina passa a usar o agendador próprio do BullMQ, que também não duplica o agendamento quando a API reinicia.
- A primeira tentativa de correção foi barrada pelo teste com Redis de verdade antes do deploy, sem afetar o site: era só trocar o identificador, e a tarefa continuava sem disparar.
- Novo teste de tarefa repetida, rodando também contra o Redis de verdade, e o teste do pacote compilado passa a reprovar se o agendamento falhar.

## [F3-05 IBS, CBS e Imposto Seletivo] — 13/10/2026

### Adicionado
- **Cálculo de IBS e CBS** a partir da classificação tributária oficial (cClassTrib): tributação integral, alíquota reduzida (inclusive a zero, como na cesta básica) e situações sem tributo. O IBS sai separado em parte estadual e parte municipal, como a nota exige.
- **Base de cálculo por período, em tabela com a fonte:** ICMS, ISS, PIS e COFINS fora da base de 2026 a 2032; Imposto Seletivo dentro a partir de 2027.
- **Transição em tabela:** ICMS e ISS a 9/10, 8/10, 7/10 e 6/10 de 2029 a 2032, e extintos em 2033.
- **Imposto Seletivo** por percentual, por unidade ou os dois, sem nenhuma alíquota embutida.
- Casos de teste por período: 2026, 2027–2028, cada ano de 2029 a 2032 e 2033.

### Como o motor trata o que ainda não foi publicado
- **Sem alíquota, sem cálculo.** Para 2027 a CBS ainda "aguarda legislação": o motor para com a mensagem "A alíquota da CBS para 2027 ainda não está na tabela do Bipaê", em vez de supor um número. O mesmo vale para o IBS de 2029 em diante.
- Os testes dos anos futuros usam alíquotas **de exemplo**, marcadas como tal, só para provar que a regra troca na data certa.
- Situações de IBS/CBS ainda não calculadas e perguntas em aberto estão na dúvida D-020.

## [F3-04 Tributos atuais] — 13/10/2026

### Adicionado
- **Cálculo de ICMS** no regime normal (CST 00, 10, 20, 40, 41, 50, 51, 60 e 70) e no Simples Nacional (CSOSN 101, 102, 103, 201, 202, 203, 300, 400 e 500), com redução de base, diferimento, FCP, crédito do Simples e **substituição tributária por MVA**.
- **PIS e COFINS** por alíquota, por unidade de produto e nas situações sem destaque, com a opção de tirar o ICMS da base.
- **IPI** por alíquota.
- `calculateCurrentTaxes` escolhe a regra de cada tributo em vigor na data e calcula na ordem certa (IPI, ICMS, PIS/COFINS). Casos de teste para **Simples Nacional, Lucro Presumido e Lucro Real**.
- **Cada valor vem com a explicação da conta**, passo a passo, começando pela regra usada e a norma que a justifica.
- Alíquotas gerais de PIS e COFINS (cumulativo e não cumulativo) na tabela de referência, conferidas nas leis, com fim em 2027.
- As regras passam a poder depender do regime de apuração (Simples, Presumido ou Real), além do CRT.

### Limites assumidos
- Situação que o motor ainda não calcula (CST 30 e 90, CSOSN 900, combustíveis monofásicos, FCP-ST, DIFAL) gera aviso claro, nunca conta aproximada. Lista na dúvida D-019.
- **Ainda sem alíquotas reais de ICMS e MVA**: dependem da UF de homologação (item E2). Os testes usam valores de exemplo.

## [F3-03.d Tabela de CEST] — 13/10/2026

### Adicionado
- **CEST do Convênio ICMS 142/18**, extraído do texto consolidado do CONFAZ (já com o Convênio ICMS 107/26): 25 segmentos e 1.043 códigos vigentes, com os NCM/SH de cada um.
- `findCest` devolve a redação em vigor na data. Dois códigos mudam de texto em 01/11/2026 e já estão com as duas redações, cada uma na sua vigência.
- `cestsForNcm` sugere os CEST de um NCM, do mais específico para o mais genérico, para o cadastro de produto.
- O importador para diante de qualquer texto do convênio que não reconheça, em vez de adivinhar.

### Documentado
- Dúvida D-018: a lista de CEST é nacional; o que está de fato em substituição tributária depende da UF e ainda não está no sistema.
- Com isso a **F3-03 está concluída**: NCM, CEST, CFOP, CST/CSOSN, cClassTrib e alíquotas de referência, todos gerados de fonte oficial.

## [F3-03.c Situações tributárias e origem] — 13/10/2026

### Adicionado
- **CST do ICMS, CSOSN, CST de PIS, COFINS e IPI e origem da mercadoria**, com os códigos tirados do schema oficial da NF-e (pacote PL_010b v1.30), que é o que a SEFAZ usa para validar.
- Cada código já diz **em que grupo do XML ele entra** (CST 40, 41 e 50 no `ICMS40`; CSOSN 102, 103, 300 e 400 no `ICMSSN102`). É a base para montar a nota na F3-07.
- Descrições em português correto, com a norma de origem, e um teste que impede descrição sem código ou código sem descrição.

## [F3-03.b Tabela de NCM] — 13/10/2026

### Adicionado
- **NCM vigente do Portal Único Siscomex** (13/10/2026): 10.516 códigos de 8 dígitos, mais capítulos, posições e subposições. O arquivo original fica guardado compactado, com hash.
- `findNcm` aceita o código com ou sem pontos e só devolve NCM completo que exista na tabela.
- `ncmPath` monta o caminho do capítulo até o código, porque a descrição sozinha quase sempre é "Outros".
- `searchNcm` busca pelo começo do código ou por palavras, sem acento, em qualquer nível ("arroz polido" acha 1006.30.21). É a base da busca de NCM no cadastro de produto.
- Módulo à parte (`@bipae/fiscal/tables/ncm`), para a tabela grande não pesar em quem não precisa dela.

## [F3-03.a Tabelas oficiais: CFOP, cClassTrib e alíquotas de referência] — 13/10/2026

### Adicionado
- **Tabelas fiscais geradas dos arquivos oficiais**, nunca digitadas: as planilhas do Portal Nacional da NF-e ficam em `packages/fiscal/sources`, com data e hash, e `pnpm --filter @bipae/fiscal tables` gera os dados. Um teste falha se alguém trocar a planilha sem regerar.
  - **CFOP** (IT 2023.002 v2.10): 619 códigos, com vigência e indicadores de devolução, retorno e remessa.
  - **CST e cClassTrib do IBS e da CBS** (IT 2025.002 v1.70): 18 CSTs e 173 classificações, com a redução de alíquota de cada uma.
  - **Alíquotas de referência** com vigência e artigo da lei: CBS de 0,9% e IBS de 0,1% em 2026; IBS de 0,05% estadual + 0,05% municipal em 2027–2028 (LC 214/2025).
  - **FCP por UF**: alíquota fixa ou teto das 27 UFs.
- Uso: `import { findCfop, findClassTrib, referenceRates } from '@bipae/fiscal/tables'`.
- O lint passa a barrar qualquer leitura de arquivo, rede ou processo dentro do motor fiscal.

### Documentado
- A CBS de 2027 **não tem alíquota publicada** (o portal diz "aguarda legislação"): fica sem número na tabela, e a dúvida D-004 continua aberta.
- Dúvidas novas: D-016 (fim da vigência do cClassTrib) e D-017 (lista de CFOP do contribuinte exclusivo do IBS/CBS).
- O Portal Nacional da NF-e agora é lido direto; a tabela de CFOP vigente é a v2.10.

## [F3-02 Motor fiscal: base] — 13/10/2026

### Adicionado
- **`packages/fiscal`**, o motor fiscal puro (sem banco e sem rede), com 100% de cobertura de testes:
  - contas com decimal de precisão arbitrária, dinheiro em centavos e arredondamento explícito (ADR-0008);
  - **regras como dados**, cada uma com vigência, escopo e a norma que a justifica (ADR-0006);
  - escolha da regra em vigor na data do fato gerador, ficando com a mais específica; empate entre regras é erro, nunca escolha silenciosa;
  - conferência da tabela de regras (id repetido, vigência inválida, regra sem fonte, regras que se cruzam);
  - cálculo de base × alíquota com redução de base e **explicação passo a passo** de cada valor.
- Ainda sem alíquotas oficiais: as tabelas entram na F3-03.

## [Correção da fila e do deploy] — 13/10/2026

O deploy da F1-07 deixou o site fora do ar por alguns minutos: a API não subia e a volta automática para a versão anterior não rodou. A versão anterior foi restaurada à mão.

### Corrigido
- **A API não subia com o Redis ligado.** O BullMQ 6 não traz o driver `ioredis`, e no pacote de produção não consegue carregá-lo sozinho. Agora o driver é dependência da API e o cliente é criado por ela.
- **Fila com problema não derruba mais a API.** Redis fora do ar vira aviso no log, e a fila reconecta sozinha.
- **O deploy agora volta mesmo para a versão anterior** quando a nova não fica saudável. Antes, o script parava no primeiro erro, sem chegar a esse passo.

### Adicionado
- **Teste do pacote compilado** (`scripts/smoke-api.mjs`): sobe a API do jeito que roda em produção, com Redis de verdade e com o Redis fora do ar. Roda no CI e antes de todo deploy.
- O teste que antecede o deploy passou a usar um Redis de verdade. Era a falta dele que deixava o erro passar.

## [F1-07 Fila de tarefas] — 13/10/2026

### Adicionado
- **Fila de tarefas em segundo plano**, com nova tentativa automática: em memória no desenvolvimento, BullMQ + Redis em produção. É a base para o envio de notas à SEFAZ na Fase 3.
- Primeira tarefa: limpeza, a cada 6 horas, dos registros de login vencidos ou encerrados há mais de 30 dias.
- **Redis** na VPS: contêiner próprio do Bipaê, sem porta no host, com 96 MB de memória. A CI testa a fila contra um Redis de verdade.

## [F1-06 Convite por link] — 13/10/2026

### Adicionado
- **Convidar por link** em Equipe:
  - escolha o papel, o e-mail (opcional) e as lojas;
  - o link vale 7 dias e só pode ser usado uma vez;
  - os convites pendentes podem ser cancelados.
- **Página do convite**: a pessoa cria a conta ou entra com a que já tem (senha e, se usar, o código da verificação em duas etapas) e cai direto na empresa.

### Mudou
- **Quem já tem conta no Bipaê** (ex.: o contador de várias empresas) não entra mais direto pela tela Adicionar pessoa. Agora precisa aceitar um convite.

### Corrigido
- **Caixa:** num computador lento, um atalho (F4, F10...) apertado logo depois de bipar se perdia. Agora ele espera a bipagem terminar.

## [F1-05 Permissões por loja] — 13/10/2026

### Adicionado
- Em **Equipe**, cada pessoa pode ter **todas as lojas** ou **só algumas**.
- Quem é restrito só vê e usa as suas lojas e os caixas delas. Vendas e estoque de outras lojas não aparecem para essa pessoa, e ela não consegue sincronizar nem enviar vendas por um caixa de outra loja.

## [F1-04 Variações e kits] — 13/10/2026

### Adicionado
- **Kits** (ex.: cesta básica):
  - a composição é montada no cadastro do produto;
  - vender o kit baixa o estoque de cada componente, e o cancelamento e a devolução devolvem;
  - um kit não pode conter outro kit.
- **Grade de variações**:
  - os atributos (ex.: Tamanho P, M, G e Cor Azul, Preto) geram uma variação por combinação, com preço e estoque próprios;
  - gerar de novo só cria as combinações que faltam.
- **No caixa**, aparecem as variações e não o modelo; o kit entra como um item só, pelo preço do kit.

## [F1-03 Tabelas de preço] — 13/10/2026

### Adicionado
- Tela **Tabelas de preço**: busca de produtos, preço especial por item e o preço normal ao lado.
- **Tabela da loja** em Empresas e lojas, que agora permite editar a loja, e **tabela do cliente** no cadastro de clientes.
- **No caixa, inclusive sem internet**, o preço segue esta ordem: tabela do cliente (pelo CPF/CNPJ na venda) → tabela da loja → preço do cadastro.
  - Ao informar o CPF, o carrinho é recalculado.
  - A tela mostra qual tabela está valendo.
  - Os preços chegam ao caixa na sincronização, só quando algo muda.

### Mudou
- Comentários no código, nomes de testes e mensagens de commit passam a ser escritos em português.

## [F1-02 Perfis fiscais] — 13/10/2026

### Adicionado
- Tela **Perfis fiscais**:
  - lista, criação e edição;
  - campos: origem da mercadoria, CFOP dentro e fora do estado, CSOSN (Simples) ou CST (Presumido/Real) e cClassTrib (IBS/CBS);
  - aviso claro de que o cálculo dos impostos chega com a NFC-e.
- Campo **Perfil fiscal** no cadastro do produto.

### Corrigido
- **Bipaê Desktop:** salvar uma edição (produto, empresa, perfil...) dava "Sem conexão com o servidor". A API só liberava GET e POST para chamadas de outro endereço; agora libera também PUT, PATCH e DELETE, com teste.

## [F1-01 Verificação em duas etapas] — 13/10/2026

### Adicionado
- **Verificação em duas etapas** opcional para os usuários dos clientes, recomendada para donos e gerentes:
  - ativa em Configurações, com código QR e app autenticador;
  - o login passa a pedir o código de 6 dígitos;
  - desativar exige um código válido;
  - a semente fica cifrada no banco;
  - o suporte Bipaê, entrando como o cliente, não consegue mudá-la;
  - ativar e desativar ficam na auditoria.
- Painel super admin: **"Zerar verificação em duas etapas"** em Pessoas, para quem perdeu o celular. A ação encerra as sessões abertas e fica na auditoria da plataforma.

## [Nova landing page] — 12/10/2026

### Mudou
- **Landing page redesenhada** (www.bipae.com.br):
  - segue as referências aprovadas, com as **logos oficiais**: verde com o chapéu amarelo e a versão branca;
  - fonte Plus Jakarta Sans servida pelo próprio site;
  - seções: herói com a tela do caixa, 3 passos, recursos, "A internet caiu. A fila, não.", Online e Desktop, "O que vem por aí", planos, dúvidas e chamada final;
  - menu de celular.

### Corrigido
- **PDV Embed:** com leitor rápido e rede lenta, um código lido enquanto o anterior ainda era buscado podia se perder. Agora cada leitura entra numa fila e nenhuma se perde. Há teste novo que simula a rede lenta.

## [Bipaê PDV Embed 1.0] — 12/10/2026

### Adicionado
- **Bipaê PDV Embed** (`kits/pdv-embed`, ADR-0014): o caixa da Bipaê como uma tag HTML (`<bipae-pdv>`) para colocar no painel de qualquer aplicação web, em qualquer linguagem.
  - **O caixa:**
    - abertura de caixa;
    - bipagem, busca e `3*código`;
    - produtos por peso;
    - desconto com limite;
    - vários pagamentos com troco;
    - CPF/CNPJ na nota;
    - sangria, suprimento e fechamento cego;
    - cancelamento e reimpressão;
    - atalhos F2/F4/F9, temas claro/escuro e cores personalizáveis.
  - **Componente:** um único arquivo de 18 KB (gzip), com estilos isolados e eventos para a aplicação reagir a cada venda.
  - **Backend:**
    - contrato aberto de 9 rotas (OpenAPI);
    - implementações prontas em **Node** e **PHP** (Laravel, WordPress, PHP puro);
    - tabelas para PostgreSQL, MySQL e SQLite;
    - produtos lidos da tabela da própria aplicação, por uma view.
  - **Teste de conformidade** que valida qualquer backend. Junto vai um prompt pronto para pedir a uma IA a implementação em outras linguagens.
  - **CI:** testa as duas implementações e o componente num navegador real.

### Mudou
- `@bipae/pdv-core/pure`: entrada só com as regras puras do caixa.
- As formas de pagamento do `@bipae/domain` estão num arquivo próprio, sem zod.
- O app web aplica versões novas sozinho fora da tela do caixa. Na tela do caixa, espera o operador sair dela. Antes, páginas novas, como `/app/download`, voltavam para o início até limpar o cache.

## [Download do Bipaê Desktop] — 12/10/2026

### Adicionado
- Página **Baixar o Bipaê Desktop**:
  - pública em https://www.bipae.com.br/app/download, com links na landing;
  - item "Baixar o desktop" no menu da retaguarda e link na tela de Periféricos.
- Mostra a versão mais recente com o instalador certo para o sistema do visitante, as outras opções (MSI, .deb, AppImage), o passo a passo de instalação e o aviso do SmartScreen. Sem versão publicada, diz isso com clareza.
- API `GET /v1/downloads/desktop`, que lê a última Release estável do GitHub, com cache.
- O workflow **Release desktop** agora publica uma Release pública com instaladores de nome fixo a cada tag `vX.Y.Z`.

## [Plataforma SaaS e painel super admin] — 12/10/2026

### Adicionado
- **Multi-clientes e multi-empresas** (ADR-0013):
  - cada cliente (conta) pode ter várias empresas (CNPJs), cada empresa várias lojas, cada loja vários caixas;
  - nova tela **Empresas e lojas**;
  - quem participa de mais de um cliente troca pelo seletor no menu.
- **Planos e limites**:
  - planos Grátis, Essencial, Profissional e Rede, com limites de empresas, lojas, caixas, usuários e produtos;
  - limite aplicado na API com mensagem clara;
  - exceções negociadas por cliente;
  - nova tela **Minha assinatura**, com uso do plano e histórico da conta.
- **Ciclo de vida da conta**:
  - estados ativo, em teste (com data de fim), suspenso e cancelado;
  - conta bloqueada vê uma tela explicando o motivo, mas os caixas **continuam enviando as vendas feitas offline**.
- **Painel super admin** em `/app/admin`, para a equipe Bipaê:
  - **visão geral**: clientes ativos, receita mensal estimada, uso na semana, caixas ativos, novos clientes e faturamento por dia, clientes por plano, testes terminando;
  - **clientes**: busca e filtros; ficha com uso do plano, movimento, empresas, caixas, equipe, histórico e auditoria; ações de mudar plano ou teste, limites especiais, suspender, reativar, cancelar, anotar e encerrar sessões;
  - **pessoas**: busca em todos os clientes;
  - **planos, avisos** (faixa na retaguarda dos clientes) e **equipe Bipaê** (papéis Administrador, Suporte e Consulta);
  - **auditoria da plataforma** encadeada por hash, com verificação de integridade;
  - **sistema**: versões, banco e migrações.
- **Segurança do painel**:
  - login próprio, separado do login dos clientes;
  - verificação em duas etapas (app autenticador) obrigatória;
  - papel de banco exclusivo, que os clientes não enxergam;
  - rota sem permissão declarada só libera o Administrador.
- **Acesso de suporte**:
  - "entrar como o cliente" por 30 minutos, somente leitura por padrão, com motivo obrigatório;
  - faixa visível na tela do cliente;
  - registro nas duas auditorias.
- `admin-cli` para promover o primeiro super admin na VPS.

### Mudou
- Produção ganhou `SECRETS_KEY` (gerada no próximo deploy), usada para cifrar as sementes do 2FA.

## [Fase 2 — PDV offline-first] — 12/10/2026

### Adicionado
- **Caixa (PDV)** igual no navegador e no app desktop:
  - bipagem com multiplicador (`3*código`), busca sem acento, pesáveis com leitura de balança e etiquetas de balança (prefixo 2);
  - desconto com limite (acima de 10%, autorização de gerente com as credenciais dele, registrada na auditoria);
  - vários pagamentos na mesma venda com troco; Pix e cartão por **simulador**;
  - CPF/CNPJ na nota, orçamentos, sangria, suprimento, **fechamento cego**;
  - cancelamento, devolução por item sem sobra de centavo, reimpressão de comprovante (não fiscal);
  - atalhos F2–F12 e operação por toque, som de bip.
- **Offline-first**: banco local SQLite em todos os caixas (WASM + OPFS no navegador, nativo no desktop), venda e evento gravados na mesma transação, sincronização a cada 30 s e ao reconectar.
- **Servidor**:
  - eventos idempotentes (`/v1/sync/events`) com rejeição explicada em pt-BR;
  - catálogo incremental (`/v1/sync/pull`);
  - vendas, caixa e estoque como livro de movimentações;
  - contagem e ajuste de estoque; autorização de gerente.
- **Retaguarda**: tela de Vendas (faturamento, ticket médio), coluna e contagem de estoque, tela de Periféricos.
- **Periféricos** (desktop): impressora ESC/POS por rede ou serial, gaveta pela impressora, balança Toledo/Filizola.
- **Bipaê Conector**:
  - o app desktop serve impressora, balança e gaveta ao caixa do navegador, com pareamento por código, tokens revogáveis, checagem de origem e lista fechada de comandos;
  - modo bandeja (`--connector`);
  - simulador para desenvolvimento e testes.
- **Atualização automática** do desktop: assinada, canais estável/beta, nunca durante uma venda; workflow de release com assinatura de código opcional.
- **Testes**: 161 automatizados rodando nesta máquina (152 unitários e de integração + 9 E2E), mais 9 testes Rust que só rodam na CI:
  - dois caixas (web e desktop) vendendo offline ao mesmo tempo com estoque e numeração exatos;
  - atualização com vendas pendentes sem perda;
  - Conector com impressora e balança simuladas;
  - E2E de venda online e offline, fechamento cego e autorização nos dois frontends;
  - testes Rust para banco local, periféricos e Conector.

### Corrigido (achado pelos testes)
- Produto marcado como "vendido por peso" ficava com unidade UN.
- Caixa recém-vinculado não tinha catálogo no primeiro bip.
- Montagem dupla do React (modo de desenvolvimento) travava o banco do navegador.
- Bipar e apertar uma tecla de atalho logo em seguida usava o carrinho antigo.

### Limitações conhecidas
- O código Rust (banco nativo, periféricos, Conector, bandeja, atualizador) **não foi compilado nem testado em hardware** nesta máquina; depende da primeira execução da CI.
- O E2E dentro do WebView real (tauri-driver) ainda não existe; a suíte roda o frontend desktop no Chromium.
- Detalhes em `docs/TAREFAS.md`.

## [Fase 1 — Fundação] — 12/10/2026

### Adicionado
- **Monorepo** pnpm + Turborepo, TypeScript estrito, ESLint com regras de fronteira do ADR-0012 (pacotes não importam Tauri nem cascas).
- **`packages/domain`**: dinheiro em centavos, CPF e CNPJ (inclusive o CNPJ alfanumérico de julho/2026), GTIN, UUIDv7, catálogo de permissões e papéis, série de NFC-e por caixa, política de versão mínima de cliente, contratos Zod com mensagens em pt-BR.
- **`packages/platform`**: os oito ports do ADR-0012, matriz de capacidades web × desktop com explicações em pt-BR, estado "chega em breve" e simuladores.
- **API** (NestJS + Fastify):
  - PostgreSQL com Row-Level Security forçada em todas as tabelas de negócio; PGlite para desenvolver e testar sem Docker.
  - Cadastro sem configuração obrigatória; login; refresh token rotativo com detecção de reuso; troca de empresa (contador com vários clientes); limite de tentativas de login.
  - Papéis e permissões, recarregados a cada requisição.
  - Trilha de auditoria encadeada por hash e imutável no banco.
  - Cadastros: produtos (códigos de barras, variações, kits, pesáveis), unidades, perfis fiscais (só dados), tabelas de preço, clientes (com consentimento LGPD separado), fornecedores, empresas, lojas e caixas com série de NFC-e exclusiva.
  - API `/v1` com versão mínima de cliente (HTTP 426), que nunca bloqueia o envio de vendas.
  - Seed de demonstração.
- **Telas** (`packages/ui` e `packages/erp-ui`): entrar, criar conta, início com primeiros passos e capacidades da plataforma, produtos, clientes, fornecedores, caixas, equipe, auditoria e configurações (tema, alto contraste, fonte grande, som de bip).
- **Cascas** `apps/web` (PWA) e `apps/desktop` (Tauri 2), finas, sobre as mesmas telas.
- **Testes**: 98 unitários e de integração, e E2E Playwright com a mesma suíte nas duas cascas.
- **CI**: lint, typecheck, testes, API contra PostgreSQL 16 real, E2E e build dos instaladores desktop (Windows e Linux).
- **Docker Compose** com PostgreSQL, API e web, já com os dados de demonstração.

### Limitações conhecidas
- O `docker compose` e a compilação do app Tauri não puderam ser executados na máquina de desenvolvimento (sem WSL e sem Rust); ficam validados pela CI.
- Ver pendências em `docs/TAREFAS.md`.

## [Fase 0] — 11/10/2026

### Adicionado
- Briefing (`docs/PROMPT.md`), PRD, ADRs, benchmark de mercado em sala limpa, registro de versões fiscais e dúvidas fiscais.
- Adendo 01 (web + desktop): análise de impacto e ADR-0012.
