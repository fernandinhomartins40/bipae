# Análise de produto do frontend — Bipaê (revisor R2-P)

- **Commit analisado:** `728df79` (main, com as alterações locais listadas no inventário). **Data:** 27/10/2026.
- **Método:** leitura estática do código. Nenhuma aplicação foi aberta e nenhum teste foi rodado. **Toda contagem de passos é derivada do código** (telas, botões e campos que o código monta), não de cliques observados.
- **Referências:** `CLAUDE.md`; `PROTOCOLO_UNIVERSAL_PRODUTO_V2 (2).md` (seções 4.3, 4.4, 4.5, 7 e a Camada de Inteligência de Produto, linhas 822–1203); `docs/PRD.md`; `docs/acessibilidade.md`; `docs/pie/INVENTARIO_APLICACAO.md`.
- **Público de referência:** dono e operador de mercadinho, loja ou lanchonete, leigo em tecnologia e em impostos.

## 0. Resumo em 10 linhas

1. A base é boa: o menu já é agrupado "pelo que a pessoa quer fazer" (`packages/erp-ui/src/nav.ts:68-72`), tem busca por palavra do dia a dia (`nav.ts:490-502`), o Início tem atalhos, pendências, "Hoje na loja" e primeiros passos (`pages/home.tsx:66-83`), e o caixa tem atalhos de teclado e valor já preenchido.
2. O problema é **volume e fragmentação**: 51 telas no menu (teste fixa o número em `nav.test.ts:21`), 11 itens só em "Vendas e atendimento" e 10 em "Financeiro" e em "Minha empresa". Um operador de caixa vê 31 itens (30 no desktop).
3. O mesmo objetivo está partido em várias telas: **notas do fornecedor** (Compras × Notas de entrada, que mandam uma para a outra), **configuração fiscal** (Empresas, Perfis fiscais, Regras de ICMS, Serviços), **fiado** (Clientes × Inadimplência), **equipe** (Equipe × Vendedores), **restaurante** (Comandas, Pedidos pelo celular, Cozinha, Delivery).
4. O Início não antecipa três coisas que o sistema já sabe: **falta configurar a nota fiscal** (UF, regime, IE, endereço, certificado ausente), **produto sem estoque** e **lucro de hoje** (o relatório do dia já traz a margem).
5. "Primeiros passos" tem 3 itens (`home.tsx:420-428`), enquanto o artigo de ajuda "Primeiros passos" tem 5, incluindo os dados fiscais e o certificado (`help/articles.ts:43-69`).
6. Rótulos técnicos no menu e nos formulários: "NF-e", "Inutilização de números", "Perfis fiscais", "Regras de ICMS", "Apuração de IBS e CBS", "DRE gerencial", "Conciliação bancária", "Recebíveis", "Integrações (API)", "Auditoria"; nos formulários, "CSOSN", "CST", "cClassTrib", "MVA", "FCP", "cBenef", "Client ID/Secret".
7. Estados vazios: são 49 `EmptyState` nas páginas e só 12 têm um botão de próximo passo.
8. A ajuda tem 26 artigos, e cada um já sabe a tela dele (`screen.to`), mas só a própria página de Ajuda aponta para eles (`pages/help.tsx:47`). Nenhuma tela tem um "Como funciona?".
9. **Proposta:** menu com 7 grupos e cerca de 24 entradas, juntando telas em abas **sem tirar nenhuma rota** (as URLs atuais continuam funcionando).
10. Dez oportunidades do grupo A dá para fazer só no frontend, sem mexer em regra, permissão ou backend. As do grupo B dependem de decisão do dono ou de backend.

---

## 1. Mapa de navegação real

### 1.1 Estrutura fixa (`packages/erp-ui/src/pages/shell.tsx`)

| Posição | Item | Quem vê | Evidência |
|---|---|---|---|
| Topo | Busca "O que você procura?" (filtra o menu; Enter abre o 1º resultado) | todos | `shell.tsx:256-273`, `shell.tsx:114-120` |
| 1 | **Início** (`/`) | todos | `shell.tsx:276-281` |
| 2 | **Abrir o caixa** (`/caixa`, botão verde) | `pos.sell` | `shell.tsx:282-292` |
| Grupos | 7 grupos sanfonados (abaixo); o grupo da tela atual abre sozinho e o aparelho lembra quais ficaram abertos | por item | `shell.tsx:312-352`, `shell.tsx:25-43` |
| Rodapé | **Ajuda** (`/ajuda`) | todos | `shell.tsx:354-361` |
| Rodapé | Trocar de empresa (se tiver mais de uma), nome e **Sair** | todos | `shell.tsx:363-391` |
| Celular | Barra fixa com o menu em gaveta e "Abrir o caixa" | `pos.sell` | `shell.tsx:200-220` |

No Android, quem só tem `pos.sell` ou só `pos.order` cai direto no caixa ou nos pedidos (`pages/mobile-landing.tsx:20-29`, `nav.ts:521-528`).

### 1.2 Grupos e itens (`packages/erp-ui/src/nav.ts:72-472`), na ordem do código

| Grupo (linha) | # | Item → rota | Permissão | Linha |
|---|---|---|---|---|
| **Vendas e atendimento** (73) | 1 | Vendas → `/vendas` | catalog.read | 77-83 |
| | 2 | Vendedores → `/vendedores` | catalog.read | 84-90 |
| | 3 | Comissões → `/comissoes` | finance.read | 91-97 |
| | 4 | Comandas abertas → `/comandas` | pos.sell | 98-104 |
| | 5 | Pedidos pelo celular → `/garcom` | pos.order | 105-111 |
| | 6 | Cozinha → `/cozinha` | pos.sell | 112-118 |
| | 7 | Pedidos de canais → `/canais` | pos.order | 119-125 |
| | 8 | Delivery → `/delivery` | pos.sell | 126-132 |
| | 9 | Condicional → `/condicional` | pos.sell | 133-139 |
| | 10 | Ordens de serviço → `/ordens-de-servico` | pos.sell | 140-146 |
| | 11 | Promoções → `/promocoes` | catalog.read | 147-153 |
| **Produtos e estoque** (156) | 12 | Produtos → `/produtos` | catalog.read | 160-166 |
| | 13 | Serviços → `/servicos` | catalog.read | 167-173 |
| | 14 | Tabelas de preço → `/tabelas-de-preco` | catalog.read | 174-180 |
| | 15 | Etiquetas → `/etiquetas` | catalog.read | 181-187 |
| | 16 | Inventário → `/inventario` | catalog.read | 188-194 |
| | 17 | Lote e validade → `/lotes` | catalog.read | 195-201 |
| | 18 | Transferências → `/transferencias` | catalog.read | 202-208 |
| | 19 | Prevenção de perdas → `/prevencao-de-perdas` | audit.read | 209-215 |
| **Compras e fornecedores** (218) | 20 | Pedidos de compra → `/pedidos-de-compra` | catalog.read | 222-228 |
| | 21 | Compras → `/compras` | catalog.read | 229-235 |
| | 22 | Notas de entrada → `/notas-de-entrada` (com contador de notas novas) | catalog.read | 236-242; contador `shell.tsx:168-170` |
| | 23 | Fornecedores → `/fornecedores` | parties.read | 243-249 |
| **Clientes e fidelidade** (252) | 24 | Clientes → `/clientes` | parties.read | 257-262 |
| | 25 | Relacionamento → `/relacionamento` | parties.read | 263-269 |
| **Financeiro** (272) | 26 | Contas a pagar e receber → `/financeiro` | finance.read | 276-282 |
| | 27 | Boletos → `/boletos` | finance.read | 283-289 |
| | 28 | Fluxo de caixa → `/fluxo-de-caixa` | finance.read | 290-296 |
| | 29 | Meios de pagamento → `/meios-de-pagamento` | **catalog.read** | 297-303 |
| | 30 | Recebíveis de cartão e Pix → `/recebiveis` | finance.read | 304-310 |
| | 31 | Conciliação bancária → `/conciliacao-bancaria` | finance.read | 311-317 |
| | 32 | Inadimplência → `/inadimplencia` | finance.read | 318-324 |
| | 33 | Relatórios → `/relatorios` | finance.read | 325-331 |
| | 34 | DRE gerencial → `/dre` | finance.read | 332-338 |
| | 35 | Assistente → `/assistente` | finance.read | 339-345 |
| **Notas e impostos** (348) | 36 | NF-e → `/nfe` | catalog.read | 352-358 |
| | 37 | Inutilização de números → `/inutilizacao` | catalog.read | 359-365 |
| | 38 | Perfis fiscais → `/perfis-fiscais` | catalog.read | 366-372 |
| | 39 | Regras de ICMS → `/regras-icms` | catalog.read | 373-379 |
| | 40 | Apuração de IBS e CBS → `/apuracao-ibs-cbs` | finance.read | 380-386 |
| | 41 | Arquivos para o contador → `/contador` | finance.read | 387-393 |
| **Minha empresa** (396) | 42 | Empresas e lojas → `/empresas` | admin.terminals | 400-406 |
| | 43 | Caixas → `/caixas` | admin.terminals | 407-413 |
| | 44 | Equipe → `/equipe` | admin.users | 414-420 |
| | 45 | Periféricos → `/perifericos` | pos.sell | 421-427 |
| | 46 | Configurações → `/configuracoes` | todos | 428-434 |
| | 47 | Minha assinatura → `/assinatura` | admin.users | 435-441 |
| | 48 | Auditoria → `/auditoria` | audit.read | 442-448 |
| | 49 | Integrações (API) → `/integracoes` | admin.integrations | 449-455 |
| | 50 | MercadoFlow → `/mercadoflow` | admin.stores | 456-462 |
| | 51 | Baixar o desktop → `/baixar` (some no desktop) | todos | 463-469; filtro `shell.tsx:74-77` |

**Contagem por área (itens de menu):** Vendas 11 · Produtos e estoque 8 · Compras 4 · Clientes 2 · Financeiro 10 · Notas e impostos 6 · Minha empresa 10 = **51**, mais Início, Abrir o caixa e Ajuda (54 entradas). O roteador da casca tem 54 rotas autenticadas dentro do `Shell`, mais `/caixa` (`app.tsx:183-253`). A rota `/inicio` existe (`app.tsx:199`) mas não está no menu: ela é a saída do seletor do Android (`mobile-landing.tsx:61`).

**Quem vê o quê (papéis de `packages/domain/src/permissions.ts:41-61`):**
- **Operador de caixa** (`catalog.read, parties.read, parties.write, pos.sell, pos.order`): pelo filtro de `nav.ts:478-488`, vê **31 itens** (30 no desktop, sem "Baixar o desktop"). Entre eles estão Vendas (histórico da loja inteira), Pedidos de compra, Compras, Notas de entrada, Meios de pagamento, NF-e, Inutilização, Perfis fiscais e Regras de ICMS. As telas protegem a escrita no backend, mas o menu mostra ao operador um ERP inteiro que ele não usa.
- **Vendedor** (`catalog.read, parties.read, pos.order`): vê telas de estoque e fiscais pelo mesmo motivo (`catalog.read`).
- **Contador:** vê Financeiro, Notas e impostos e Auditoria, o que é coerente.

### 1.3 Incoerências de rótulo entre o menu e a tela

| Menu (nav.ts) | Título da tela | Evidência |
|---|---|---|
| Pedidos pelo celular | "Pedidos e comandas" | `nav.ts:107`, `pages/waiter.tsx` (PageHeader) |
| Relatórios | "Relatórios de vendas" | `nav.ts:327`, `pages/reports.tsx:114` |
| Inadimplência | "Inadimplência do crediário" | `nav.ts:320`, `pages/delinquency.tsx:48` |
| Transferências | "Transferências entre lojas" | `nav.ts:205`, `pages/transfers.tsx` |
| Configurações (dentro de "Minha empresa") | "Como o Bipaê aparece para você neste aparelho e a segurança da sua conta" (é da pessoa, não da empresa) | `nav.ts:429-434`, `pages/settings.tsx:45-46` |
| Perfis fiscais: aviso "A emissão de NFC-e chega em breve… A nota fiscal ainda não é emitida" | Enquanto isso, a NF-e é emitida em homologação (`nfe.tsx:223`) e a venda já mostra "Falta configurar para emitir" (`fiscal-document.tsx:116`) | `pages/fiscal-profiles.tsx:50-54`: aviso desatualizado que contradiz a regra "capacidades nunca mentem" |

### 1.4 Jargão: rótulo leigo proposto

O termo oficial continua visível entre parênteses ou na dica do campo, como pede o CLAUDE.md ("Termos fiscais oficiais mantêm o nome do leiaute").

| Hoje | Onde | Proposta leiga |
|---|---|---|
| NF-e | `nav.ts:354` | **Nota fiscal para empresa ou outro estado (NF-e)** |
| Inutilização de números | `nav.ts:361` | **Números de nota pulados** (aba de Notas) |
| Perfis fiscais | `nav.ts:368` | **Como cada produto paga imposto** (subtítulo "Perfis fiscais") |
| Regras de ICMS | `nav.ts:375` | **ICMS por produto (avançado)** |
| Apuração de IBS e CBS | `nav.ts:382` | **Impostos novos do mês (IBS e CBS)** |
| DRE gerencial | `nav.ts:334` | **Lucro do mês (DRE)** |
| Fluxo de caixa | `nav.ts:292` | **Entradas e saídas do dinheiro** |
| Conciliação bancária | `nav.ts:313` | **Conferir o extrato do banco** |
| Recebíveis de cartão e Pix | `nav.ts:306` | **Cartão e Pix a cair na conta** |
| Inadimplência | `nav.ts:320` | **Fiado em atraso** |
| Relacionamento | `nav.ts:265` | **Fidelidade e campanhas** |
| Condicional | `nav.ts:135` | **Condicional (levar para provar)** |
| Periféricos | `nav.ts:423` | **Impressora, balança e gaveta** |
| Auditoria | `nav.ts:444` | **Histórico de alterações** |
| Integrações (API) | `nav.ts:451` | **Ligar com outros sistemas (API)** |
| MercadoFlow | `nav.ts:458` | **MercadoFlow (compras e preços)** |
| Pedidos de canais | `nav.ts:121` | **Pedidos do iFood e da internet** |
| Notas de entrada + Compras | `nav.ts:230-242` | **Notas dos fornecedores** (uma tela só, ver 3.2) |
| Formulário: "CSOSN", "CST do ICMS", "CST do PIS e da COFINS", "cClassTrib (IBS/CBS) — opcional" | `pages/fiscal-profiles.tsx:210-256` | Mantém o rótulo oficial e acrescenta uma dica de uma linha ("código que diz se a venda tem ICMS; quem é do Simples usa este"). O perfil de fábrica "Revenda — Simples Nacional" (`apps/api/src/modules/auth/auth.service.ts:119-124`) já cobre o caso comum. |
| "MVA", "FCP", "cBenef", "Redução da base" | `pages/icms-rules.tsx:230-283` | A tela inteira vai para "Avançado", e cada campo ganha uma dica. |
| "Endereço do token (OAuth)", "Client ID", "Client Secret" | `pages/payments.tsx:282-297` | Mantém (é o que o banco entrega), mas dentro de "Ligar Pix ao banco (avançado)", com a frase "seu banco fornece estes dados". |
| "Código ${cStat}: ${xMotivo}" | `pages/fiscal-document.tsx:125`, `:169` | Mostrar primeiro uma frase em português ("A SEFAZ recusou a nota: …") e deixar o código num detalhe. |

---

## 2. Jornadas principais (passos derivados do código)

Convenção: **ação** = clique, tecla ou envio; **campo obrigatório** = sem ele não salva.

### J1. Do primeiro acesso à primeira venda
- **Objetivo real:** "quero vender hoje".
- **Hoje (5 telas, cerca de 13 ações, 6 campos):**
  1. `/criar-conta`: Seu nome, Nome do negócio, E-mail, Senha (obrigatórios) e CNPJ ou CPF (opcional) → "Criar conta" (`pages/auth.tsx:132-171`). O servidor já cria a empresa, a "Loja principal", as unidades e o perfil fiscal "Revenda — Simples Nacional" (`auth.service.ts:96-124`). **Não cria o caixa.**
  2. Início → card "Cadastrar produto" (`home.tsx:121-127`) → a gaveta abre (`products.tsx:54`) → Nome e Preço → "Salvar" (`products.tsx:401-421`, `:603`).
  3. "Abrir o caixa" (`shell.tsx:282-291`) → tela **"Qual caixa é este aparelho?"**, que explica "série de NFC-e" (`pdv-ui/src/pos-app.tsx:137-157`) → "Criar e usar este caixa".
  4. "Abrir caixa" com o "Dinheiro na gaveta para troco" (opcional) (`pos-app.tsx:192-209`).
  5. Bipar ou digitar → F10 → a forma já vem em dinheiro, com o valor preenchido pelo restante (`dialogs.tsx:572-581`) → "Adicionar dinheiro" → "Finalizar venda" (`dialogs.tsx:1124-1132`).
- **Existe só por causa da implementação:** a escolha do "caixa" na primeira vez (para quem tem uma loja só, a resposta é sempre "Caixa 1"); os dois cliques "Adicionar" e "Finalizar" quando um único pagamento cobre o total.
- **O sistema já sabe e pede de novo:** o nome do negócio (já no cadastro) e a loja única (`stores[0]`, `pos-app.tsx:127`).
- **Em 3 passos:** (1) criar a conta; (2) cadastrar o 1º produto, ou pular; (3) vender. O caixa se cria sozinho com "Caixa 1" quando não há nenhum e a pessoa pode criar (OP-04). O checklist de primeiros passos guia o resto (OP-01).

### J2. Cadastrar produto (com dados fiscais)
- **Objetivo:** "quero que o produto apareça no caixa com o preço certo e a nota saia certa".
- **Hoje:** 1 gaveta com 6 seções e cerca de 17 controles (`products.tsx:398-608`): O básico (Nome, Foto, Preço\*, Custo), Atacado e margem, Códigos e categoria (Código de barras, Categoria, SKU, Unidade), Impostos (NCM, CEST, ST/pauta, perfil fiscal), Como é vendido (peso, lote, cozinha, insumo, kit, ativo). Os obrigatórios são só Nome e Preço: **3 ações** (abrir, preencher, salvar). Isso está bom.
- **Fricções:**
  - O perfil fiscal começa em **"Sem perfil"** (`products.tsx:265`, `:553-560`), mesmo quando a conta tem um único perfil criado no cadastro (`auth.service.ts:119-124`).
  - A sugestão fiscal por IA só aparece **depois** de salvar (`products.tsx:540`, `product &&`): salvar, reabrir e pedir.
  - O formulário inteiro é aberto de uma vez. Para o leigo, as seções "Impostos" e "Como o produto é vendido" assustam.
- **Já aproveita:** o catálogo preenche os dados (`products.tsx:386-392`) e há ajuda para NCM e CEST.
- **Em 3 passos:** já cabe. A melhoria é recolher as seções avançadas (OP-08) e tratar o perfil padrão (OP-B03).

### J3. Vender no caixa e receber
- **Dinheiro:** bipar → F10 → nota rápida ou "Adicionar dinheiro" → "Finalizar venda" = **4 ações** (`register.tsx:837`, `dialogs.tsx:840-862`, `:1124-1132`).
- **Pix:** F10 → tecla ou cartão "Pix" → "Adicionar pix" → QR na tela (`dialogs.tsx:463-489`) → no modo `manual` ou `static_qr`, confirmar quando cair (`dialogs.tsx:454-460`) → "Finalizar" = **5 a 6 ações**.
- **Cartão sem integração:** "Cobre na maquininha e confirme aqui" (`dialogs.tsx:886`) → **5 ações**.
- **Implementação exposta:** "Adicionar X" seguido de "Finalizar venda". Quando um só pagamento cobre o total, o segundo clique só confirma o óbvio. Não encontrei no código foco automático em "Finalizar" quando `done` fica verdadeiro (`dialogs.tsx:775`). O atalho F10 existe (`dialogs.tsx:1129`).
- **Em 3 passos:** bipar → F10 → Enter no valor, que já está preenchido, e Enter de novo para finalizar, com o foco movido sozinho (OP-07). A venda continua sendo confirmada pela pessoa.

### J4. Abrir e fechar o caixa
- **Abrir:** 1 campo opcional + "Abrir caixa" = **2 ações** (`pos-app.tsx:196-209`). Está bom.
- **Fechar:** F9 (`register.tsx:1333`) → "Fechar caixa" → **5 campos sempre** (Dinheiro, Pix, Débito, Crédito, Vale) (`dialogs.tsx:1265-1273`) → "Confirmar fechamento" → resultado = **4 ações e até 5 campos**.
- **O sistema já sabe:** o Pix por API ou parceiro, que se confirmou sozinho (`dialogs.tsx:456-457`), e as formas que não tiveram movimento. Pedir contagem de Pix integrado é trabalho sem função. Mudar isso mexe no fechamento cego (regra de conferência), por isso é **OP-B04**.

### J5. Entrada de mercadoria / nota de compra
- **Objetivo:** "chegou mercadoria, quero o estoque e o custo certos".
- **Hoje há 3 caminhos em 2 telas:**
  - `/compras` → "Importar XML" → arquivo → gaveta de revisão: loja, e para cada item produto, fator e, se for produto novo, nome, unidade e preço → confirmar (`pages/purchases.tsx:105-128`, `:420-540`).
  - Em `/compras`, "Notas emitidas para a sua empresa" → "Buscar notas agora" pelo certificado (`pages/received-notes.tsx:85-98`).
  - `/notas-de-entrada` (Confere / MercadoFlow) (`pages/confere.tsx:122-146`). Quando o Confere não está ativo, a tela manda de volta para Compras: "Sem o MercadoFlow… em Compras, use 'Buscar notas agora'" (`confere.tsx:158-172`).
- **Problemas:**
  - Duas telas para o mesmo objetivo, que apontam uma para a outra.
  - O seletor de produto na revisão carrega só **200 produtos** (`purchases.tsx:335`, `/products?limit=200`). Num mercadinho com 2.000 itens, o produto certo pode nem aparecer no select.
  - O vínculo automático por código de barras ou pela compra anterior do fornecedor já existe (`purchases.tsx:488-494`), o que é bom.
- **Em 3 passos:** (1) "Notas dos fornecedores" mostra as notas que chegaram, seja pelo certificado ou pelo Confere, mais o botão "Tenho o XML"; (2) revisar só os itens sem vínculo; (3) dar entrada. Ver OP-02 e OP-06.

### J6. Contas a pagar e a receber
- **Lançar conta:** `/financeiro` → "Nova conta" → Tipo, Descrição, Categoria, Documento, Valor\*, Primeiro vencimento, Parcelas → salvar (`pages/finance.tsx:291-352`) = **3 ações e 7 campos**. Está razoável.
- **Receber fiado em atraso:** `/inadimplencia` lista quem deve, mas diz "O recebimento é feito na ficha do cliente" (`delinquency.tsx:49`) e **a linha não tem link nem ação** (`delinquency.tsx:85-140`). Caminho: ir a Clientes → buscar o nome → abrir → "Receber (R$)" → "Receber" (`parties.tsx:382-412`) = **cerca de 6 ações em 2 telas**, redigitando o nome que já estava na tela. Ver OP-05.
- **Boletos, conciliação, recebíveis e fluxo** estão em 4 telas irmãs (`nav.ts:283-317`). Ver 3.2.

### J7. "Quanto vendi e quanto lucrei hoje?"
- **Hoje:** o card "Hoje na loja" mostra Vendas, Faturamento e Ticket médio (`home.tsx:354-401`). O **lucro não aparece**, embora o relatório usado (`/reports/sales?group=day`) já devolva `marginCents` e `marginBp` por linha (`packages/domain/src/contracts.ts:1344-1359`, usado em `reports.tsx:197` e `:242-249`). Para ver o lucro, é preciso ir a Relatórios (margem por período) ou à DRE (mês).
- **Em 1 passo:** abrir o Início. Ver OP-03.

### J8. Emitir e consultar nota fiscal
- **NFC-e:** sai da própria venda. Para consultar: Vendas → abrir a venda → bloco da nota (`sale-detail.tsx:116-160`, `fiscal-document.tsx:116-203`) = **2 ações**. Os erros aparecem como "Código {cStat}: {xMotivo}" (`fiscal-document.tsx:125`).
- **NF-e:** `/nfe` → nova → 4 seções (A nota, Destinatário, Itens, Transporte e pagamento; `nfe.tsx:979-1300`) → conferência "Falta resolver antes de emitir" ou "Pronta para emitir" (`nfe.tsx:611-630`) → emitir. Dar entrada numa nota longa é legítimo. Prever o que falta antes de começar (empresa e certificado) evita a frustração no fim.
- **Inutilização** é uma tela separada (`inutilization.tsx:85-110`), mas ela mesma já lista os "Números sem nota". Vira aba de Notas.

### J9. Cadastrar cliente e fiado
- **Cliente:** Clientes → Novo → Nome, Telefone, E-mail, Observações; "No caixa": Tabela de preço e **Limite do crediário** (`parties.tsx:255-324`) → salvar = 3 ações.
- **Vender fiado:** no caixa, F6 (CPF/CNPJ, `dialogs.tsx:351-370`) → F10 → "Crediário". Sem cliente, a dica diz "informe o CPF ou CNPJ do cliente (F6)" (`dialogs.tsx:504-510`). Está bom.
- **Receber o fiado:** ver J6. A ficha e a lista de atraso deveriam ser a mesma tela (OP-05).

### J10. Convidar funcionário
- **Hoje:** Equipe tem **dois botões para o mesmo objetivo**, "Convidar por link" e "Adicionar pessoa" (`pages/admin.tsx:206-211`).
  - "Adicionar pessoa" pede que o dono **digite a senha do funcionário** (`admin.tsx:343-350`).
  - "Convidar por link": papel (padrão "Operador de caixa", `invites.tsx:195`), e-mail opcional, lojas → criar → copiar link → mandar por fora (`invites.tsx:228-240`).
- **Fragmentação:** "Vendedores" (`/vendedores`, código do vendedor no caixa) é outra tela, em outro grupo (Vendas), apesar de ser pessoa da equipe.
- **Em 3 passos:** (1) "Chamar alguém para a equipe"; (2) escolher o que a pessoa faz (Caixa, Vendedor, Gerente, Contador); (3) "Enviar pelo WhatsApp" ou copiar. O botão do WhatsApp é um link `https://wa.me/?text=` com o convite: frontend puro, sem dado novo (OP-09). Unificar os dois botões é decisão do dono (OP-B05).

---

## 3. Juntar e eliminar páginas: nova arquitetura de informação

### 3.1 Tela inicial (Início): o que já antecipa e o que falta

| Antecipa hoje | Evidência |
|---|---|
| Atalhos "O que você quer fazer?" (Vender, Lançar pedido, Cadastrar produto, Entrada de mercadoria, Pagar ou receber) | `home.tsx:103-185` |
| Contas a pagar vencidas e da semana, a receber em atraso | `home.tsx:228-256` |
| Lotes vencidos e vencendo | `home.tsx:257-277` |
| Certificado digital vencido ou vencendo | `home.tsx:278-290` |
| Notas novas de fornecedor (Confere) | `home.tsx:291-300` |
| Vendas, faturamento e ticket de hoje | `home.tsx:354-401` |
| Primeiros passos (conta, produto, venda de teste) | `home.tsx:404-454` |
| O que funciona neste aparelho | `home.tsx:456-500` |

| **Falta** (o sistema já tem o dado) | Fonte do dado |
|---|---|
| **Falta configurar para a nota sair:** UF, regime, CNPJ, IE, endereço; **certificado ausente** (o card só olha certificados que existem e não são válidos, `home.tsx:278-279`) | `/companies` (campos em `companies.tsx:30-63`; a regra "Falta configurar" já existe em `companies.tsx:143-150`); `/fiscal/certificates` |
| **Lucro bruto de hoje** | `marginCents` em `SalesReportRow` (`contracts.ts:1351-1355`) |
| **Produtos sem estoque ou com estoque negativo** | `/stock` (já usado em `products.tsx:66-70`) |
| Primeiros passos completos: os 5 do artigo `primeiros-passos` (`help/articles.ts:57-63`) contra os 3 do card | — |
| Fiado em atraso aponta para `/inadimplencia`, que não deixa receber (ver J6) | `home.tsx:244` |

### 3.2 Fragmentações encontradas

| Objetivo | Telas hoje | Evidência |
|---|---|---|
| Notas do fornecedor e entrada de mercadoria | Compras, Notas de entrada (e "Notas emitidas para a sua empresa" dentro de Compras) | `nav.ts:229-242`; `purchases.tsx` importa `received-notes` e `received-services`; `confere.tsx:158-172` manda para Compras |
| Configurar a parte fiscal | Empresas e lojas (regime, IE, NFC-e, NFS-e, certificado), Perfis fiscais, Regras de ICMS, Serviços (código e ISS) | `companies.tsx:450-760`; `nav.ts:366-379`; `pages/services.tsx` |
| Notas emitidas | NF-e, Inutilização, Vendas (NFC-e dentro da venda) | `nav.ts:352-365`; `sale-detail.tsx` |
| Fiado | Clientes (limite e recebimento), Inadimplência (lista), Relacionamento (segmentos) | `parties.tsx:307`, `:382-412`; `delinquency.tsx:49` |
| Equipe | Equipe, Vendedores, Comissões | `nav.ts:84-97`, `:414-420` |
| Restaurante e balcão | Comandas abertas, Pedidos pelo celular, Cozinha, Delivery | `nav.ts:98-132` |
| Dinheiro que entra | Contas, Boletos, Recebíveis, Conciliação, Fluxo de caixa | `nav.ts:276-317` |
| Resultado do negócio | Relatórios, DRE, Comissões, Fluxo de caixa, Assistente | `nav.ts:91-97`, `:290-345` |
| Caixas e aparelhos | Caixas, Periféricos, Baixar o desktop | `nav.ts:407-427`, `:463-469` |
| Configuração pessoal × da empresa | "Configurações" (aparência e 2 fatores) fica dentro de "Minha empresa" | `settings.tsx:45-46` |

### 3.3 Novo menu proposto (7 grupos; nada é removido, as rotas atuais continuam)

Regra de implementação: cada **página-mãe** é um componente de abas (`<AreaTabs>`) que mostra links para as rotas irmãs e renderiza a página atual. **As URLs antigas continuam iguais**: os links profundos, o Início, a Ajuda e os E2E seguem funcionando. Só o menu e o cabeçalho mudam. O rótulo antigo vira `keywords` do item novo, para a busca continuar achando "inadimplência", "DRE" e "conciliação".

```
[fixos]  Início · Vender (Abrir o caixa) · busca "O que você procura?"

1. Vendas
   ├─ Vendas e notas ............ /vendas | aba "Notas para empresa (NF-e)" /nfe | aba "Números pulados" /inutilizacao
   ├─ Mesas, pedidos e cozinha ... /comandas | /garcom | /cozinha | /delivery         (abas)
   ├─ Pedidos do iFood e internet  /canais
   ├─ Condicional ................ /condicional
   ├─ Ordens de serviço .......... /ordens-de-servico
   └─ Promoções .................. /promocoes
2. Produtos e estoque
   ├─ Produtos ................... /produtos | /servicos | /tabelas-de-preco | /etiquetas   (abas)
   └─ Estoque .................... /inventario | /lotes | /transferencias | /prevencao-de-perdas (abas)
3. Compras
   ├─ Notas dos fornecedores ..... /notas-de-entrada + /compras (uma página, ver OP-02)
   ├─ Pedidos de compra .......... /pedidos-de-compra
   └─ Fornecedores ............... /fornecedores
4. Clientes
   ├─ Clientes e fiado ........... /clientes | aba "Fiado em atraso" /inadimplencia
   └─ Fidelidade e campanhas ..... /relacionamento
5. Dinheiro
   ├─ Contas a pagar e receber ... /financeiro | /boletos | /conciliacao-bancaria ("Conferir extrato")  (abas)
   ├─ Cartão e Pix a cair ........ /recebiveis
   ├─ Resultados ................. /relatorios | /fluxo-de-caixa | /dre ("Lucro do mês") | /comissoes  (abas)
   └─ Assistente ................. /assistente
6. Impostos e contador
   ├─ Arquivos para o contador ... /contador
   ├─ Impostos do mês (IBS/CBS) .. /apuracao-ibs-cbs
   └─ Como cada produto paga imposto  /perfis-fiscais | aba "ICMS por produto (avançado)" /regras-icms
7. Configurações
   ├─ Minha empresa e notas ...... /empresas (dados, certificado, NFC-e, NFS-e)
   ├─ Equipe ..................... /equipe | aba "Vendedores" /vendedores
   ├─ Caixas e aparelhos ......... /caixas | /perifericos ("Impressora, balança e gaveta") | /baixar
   ├─ Formas de pagamento ........ /meios-de-pagamento
   ├─ Minha assinatura ........... /assinatura
   └─ Avançado ................... /auditoria ("Histórico de alterações") | /integracoes | /mercadoflow

[rodapé]  Ajuda · Minha conta e aparência (/configuracoes, sai de "Minha empresa") · Sair
```

**Resultado:** de 51 itens em 7 grupos para **24 itens em 7 grupos**. Nenhum grupo passa de 6 itens. As 51 rotas continuam acessíveis por abas e pela busca.

**Permissões:** cada aba aparece só se `useCan(permissão do item)` deixar, com a mesma permissão de hoje (`nav.ts`). Um item-mãe aparece se ao menos uma aba for visível. Nada muda no backend.

---

## 4. Consistência de produto

| Tema | Achado | Evidência |
|---|---|---|
| Componentes | O design system é único (`@bipae/ui`: Field, MoneyField, TaxIdField, FormSection, PageHeader, StatGrid, FilterChips, SearchBox, Alert, EmptyState, DataTable com `card`, Drawer, Sheet, Modal). Não há sistema paralelo. | `packages/ui/src/components.tsx` |
| Formulários | O padrão Drawer + FormSection + "Salvar" fixo no pé é bom (`products.tsx:600-609`), mas não é geral: a "Nova conta" usa `onClick` sem `<form>` (`finance.tsx:291-352`), e a Equipe tem botões soltos sem pé fixo (`admin.tsx:370-379`). | — |
| Botão primário | A cor verde cheia fica reservada para "Abrir o caixa" (comentário em `shell.tsx:48`). A Equipe mostra dois botões de mesmo peso para o mesmo objetivo (`admin.tsx:206-211`). | — |
| Estados vazios | São 49 `EmptyState` em `pages/`, e só 12 têm `action`. Sem próximo passo, por exemplo: Perfis fiscais (`fiscal-profiles.tsx:59`), Recebíveis (`settlements.tsx:132`), Perdas (`losses.tsx:126`), Pendências do fornecedor (`confere.tsx:788`), Relatórios (`reports.tsx:179`), Fluxo (`cash-flow.tsx:113`). Bons exemplos: Produtos (`products.tsx:132-140`) e Vendas (`sales.tsx:126-139`). | contagem por `grep` |
| Diálogos nativos | `alert()` e `confirm()` do navegador em telas do cliente: `admin.tsx:78`, `admin.tsx:258`, `inventory.tsx:288`. Quebram o tom e a acessibilidade. | — |
| Mensagens técnicas | "Código {cStat}: {xMotivo}" (`fiscal-document.tsx:125`, `:169`). | — |
| Busca global | Existe, mas **só procura telas** (`nav.ts:491-502`), não produtos, clientes ou vendas. Não tem atalho de teclado (nenhum `ctrlKey`/`metaKey` em `erp-ui/src/pages`). O caixa tem atalhos completos (F3, F4, F6, F8, F9, F10, F11; `register.tsx:1279-1340`). | — |
| Ajuda contextual | Há 26 artigos com `screen.to` (`help/articles.ts`), mas nenhuma tela linka para o seu artigo (só `help.tsx:47`). | — |
| Mobile | A gaveta do menu, o "Abrir o caixa" fixo e o caixa compacto abaixo de 1024px (`pdv-ui/src/app-screen.ts:7`) estão bem resolvidos. Tabelas: 57 `DataTable`, só 18 com `card` para tela estreita. As outras dependem de rolagem lateral, o que contraria o "sem rolagem horizontal" do celular. | contagem por `grep` |
| Capacidades | O aviso desatualizado em Perfis fiscais (ver 1.3) contradiz "capacidades nunca mentem". | `fiscal-profiles.tsx:50-54` |
| Painel super admin | `/admin/*` (`admin/admin-app.tsx`) é para a equipe Bipaê, não para o leigo. Ficou fora do escopo, exceto pelos `alert()` em `admin-pages.tsx:638`, `:1064`, `:1081`. | — |

---

## 5. Oportunidades

Cada linha passou pelo "Teste da oportunidade": problema real, usuário, situação atual com evidência, viabilidade com os dados que já existem, e risco. Não incluí ideia sem evidência no código.

### 5.A Implementáveis agora, só no frontend (sem mudar regra, permissão nem backend)

| ID | TIPO | SITUAÇÃO ATUAL | OPORTUNIDADE | ESFORÇO ELIMINADO | BENEFÍCIO | SOLUÇÃO | PRIORIDADE | RISCO | TESTE |
|---|---|---|---|---|---|---|---|---|---|
| OP-01 | ANTECIPAR | O card Primeiros passos tem 3 itens (`home.tsx:420-428`); o artigo pede 5, com dados fiscais e certificado (`help/articles.ts:57-63`); a falta de certificado não aparece em lugar nenhum do Início (`home.tsx:278`) | Checklist com: dados da empresa (UF, regime, CNPJ), dados da nota (IE, endereço), certificado, 1º produto, caixa e venda de teste, formas de pagamento | Procurar no menu o que falta; descobrir só na hora da nota | O dono sabe o que falta e vai direto | Em `FirstStepsCard`, somar `useQuery('/companies')` (já usado em `companies.tsx:81`) e `useCertificates()` (`pages/certificate.tsx`), reaproveitando a regra de `companies.tsx:143-150` e mandando para `/empresas` | Alta | Baixo (só leitura; esconder por `useCan`) | Vitest em `erp-ui.test.tsx`: conta sem UF mostra "Falta configurar a empresa"; tudo pronto esconde o card |
| OP-02 | JUNTAR | Duas telas para notas do fornecedor que apontam uma para a outra (`confere.tsx:158-172`; `purchases.tsx:105-128` + `received-notes.tsx:85-98`) | Uma página "Notas dos fornecedores": abas "Chegaram" (Confere ou certificado, o que estiver ativo), "Importar XML", "Pendências" | Ir e voltar entre 2 telas; entender o que é "Confere" | Um lugar só para "chegou mercadoria" | `AreaTabs` sobre as duas rotas existentes; o item de menu único fica com o contador (`shell.tsx:168-170`); as duas rotas continuam | Alta | Médio (E2E `confere.spec.ts` e de compras clicam no menu; manter os rótulos como keywords e as rotas) | E2E: das duas URLs se chega às duas abas; `nav.test.ts` atualizado |
| OP-03 | ANTECIPAR | "Hoje na loja" sem lucro (`home.tsx:377-390`), embora `rows[].marginCents` venha na mesma resposta (`contracts.ts:1351-1355`) | Mostrar "Lucro bruto de hoje (estimado pelo custo do cadastro)"; se faltar custo, "Cadastre o custo dos produtos para ver o lucro" com link | Abrir Relatórios e escolher datas | Responde a pergunta nº 1 do dono | Em `TodayCard`, somar `r.rows` (`group=day`); se houver `marginCents === null`, mostrar a dica; mesma nota de `reports.tsx:259` | Alta | Baixo (é o mesmo cálculo da tela de Relatórios; o texto deixa claro que é estimativa) | Vitest com relatório falso: com e sem custo |
| OP-04 | ELIMINAR | Primeira abertura do caixa pergunta "Qual caixa é este aparelho?" e fala em "série de NFC-e" (`pos-app.tsx:137-157`), mesmo sem caixa nenhum | Com 0 caixas e `admin.terminals`: um botão grande "Usar este aparelho como Caixa 1", e o formulário de nome fica em "Outro nome" | Ler e decidir algo técnico na 1ª venda | Primeira venda com um clique a menos e sem jargão | Só em `TerminalPicker`: mesma chamada `backend.createTerminal` (`pos-app.tsx:127`), nome padrão "Caixa 1" | Alta | Baixo (mesma API, mesma checagem de limite no servidor) | `pos-app.test.tsx`: sem caixas, um clique cria e entra |
| OP-05 | JUNTAR | Inadimplência diz "o recebimento é feito na ficha do cliente" e não tem link (`delinquency.tsx:49`, `:85-140`); o Início manda para essa tela (`home.tsx:244`) | Cada linha ganha "Receber", que abre a ficha do cliente já na seção Crediário; vira aba de Clientes | Buscar de novo o nome em Clientes (cerca de 3 ações) | Cobrar e receber no mesmo lugar | `parties.tsx` aceita `?abrir=<id>` (mesmo padrão de `products.tsx:54` com `?novo=1`); link em `delinquency.tsx` | Alta | Baixo (a permissão `parties.credit` continua no componente de recebimento) | E2E/Vitest: clicar em Receber abre a ficha certa |
| OP-06 | ELIMINAR | A revisão do XML só lista 200 produtos (`purchases.tsx:335`) | Trocar o `SelectField` por uma busca de produto (nome ou código) | Item sem vínculo ou criado em duplicidade | Estoque e custo certos em lojas grandes | Combobox com `/products?q=` (a busca já existe em `products.tsx`); mantém a sugestão (`purchases.tsx:488-494`) | Alta | Baixo | Vitest: produto fora dos 200 primeiros é achado |
| OP-07 | ELIMINAR | Pagamento único exige "Adicionar" e depois "Finalizar venda" (`dialogs.tsx:840-862`, `:1124-1132`); não achei foco automático em "Finalizar" quando `done` (`dialogs.tsx:775`) | Quando o total é coberto, o foco vai para "Finalizar venda", e Enter conclui | Pegar o mouse ou lembrar do F10 | Venda em dinheiro com Enter, Enter | `useEffect` com `done` → `finishRef.focus()` em `PaymentDialog` | Média | Baixo (a confirmação continua explícita; só muda o foco) | `payment-dialog.test.tsx`: após adicionar, o foco está em Finalizar |
| OP-08 | JUNTAR/ELIMINAR | Menu com 51 itens e rótulos técnicos (seção 1) | Novo menu de 7 grupos e cerca de 24 itens, com abas e rótulos leigos (seção 3.3); "Configurações" pessoal vai para o rodapé | Ler 51 itens; adivinhar o grupo | Achar em 1 olhada; menos medo do sistema | `nav.ts` (itens, `keywords` com os nomes antigos), novo `AreaTabs` em `packages/ui` ou `erp-ui`, `shell.tsx` (rodapé), cada página-mãe envolve a rota | Alta | Médio (E2E que clicam por nome do menu; `nav.test.ts:21` fixa 51) | `nav.test.ts` novo (cada rota antiga acessível por item ou aba; busca acha os nomes antigos); E2E afetados |
| OP-09 | AUTOMATIZAR | O convite gera um link que o dono copia e cola em outro app (`invites.tsx:228-240`) | Botão "Enviar pelo WhatsApp" (`https://wa.me/?text=` + mensagem + link) ao lado de "Copiar" | Copiar, abrir o WhatsApp, colar | Convite em 1 toque, no celular | Só em `InviteDrawer`; não envia nada pelo servidor nem guarda dado novo | Média | Baixo (o link já é entregue à pessoa; quem escolhe o contato é o dono) | Vitest: o `href` contém o link codificado |
| OP-10 | ANTECIPAR | 26 artigos de ajuda com `screen.to`, sem link a partir das telas (`help.tsx:47` é o único) | "Como funciona?" no cabeçalho de cada tela que tem artigo | Abrir Ajuda e procurar | Ajuda no momento da dúvida | Em `Shell`, achar o artigo cujo `screen.to` bate com `location.pathname` e mostrar o link acima do `<Outlet/>` | Média | Baixo | Vitest: `/compras` mostra o link para `compras-pelo-xml` |
| OP-11 | ANTECIPAR | Estoque zerado ou negativo não aparece no Início; `/stock` já existe (`products.tsx:66-70`) | Linha "N produtos sem estoque" em "Precisa da sua atenção", com link para Produtos filtrado | Descobrir no caixa que acabou | Repor antes de faltar | `AttentionCard` com `useQuery(['stock'])`, contando `quantityMilli <= 0` dos produtos ativos | Média | Baixo (sem conceito de "mínimo": só zerado ou negativo) | Vitest |
| OP-12 | CRIAR (correção) | Estados vazios sem próximo passo (37 de 49) e aviso desatualizado em Perfis fiscais (`fiscal-profiles.tsx:50-54`) | Toda `EmptyState` com uma ação ou frase "o que fazer"; alinhar o aviso fiscal com a capacidade real | Ficar parado diante de tela vazia | Orienta o leigo | Editar cada `EmptyState` listado na seção 4; trocar o texto do alerta | Média | Baixo (no aviso fiscal, confirmar o estado real da NFC-e com o dono antes de mudar o texto) | Vitest de render |
| OP-13 | ELIMINAR | `alert()`/`confirm()` nativos (`admin.tsx:78`, `:258`, `inventory.tsx:288`) e "Código {cStat}" cru (`fiscal-document.tsx:125`) | `Modal` de confirmação e `Alert` do design system; frase pt-BR antes do código | — | Tom consistente e acessível | Trocar pelos componentes de `@bipae/ui` | Baixa | Baixo | Vitest e a11y |

**Ordem recomendada do grupo A:**
1. OP-04, OP-07 e OP-06: arquivos pequenos e isolados no caixa e nas compras.
2. OP-03, OP-11 e OP-01: tudo no `home.tsx`.
3. OP-05: `delinquency.tsx` + `parties.tsx`.
4. OP-10 e OP-09: `shell.tsx` e `invites.tsx`.
5. OP-12 e OP-13: textos.
6. Por último, OP-02 e OP-08 (menu e abas), que mexem nos E2E. Antes deles, mapear os seletores dos specs que clicam no menu (`apps/web/e2e/*.spec.ts`).

**Arquivos exatos:**
- `packages/erp-ui/src/nav.ts`, `nav.test.ts`, `pages/shell.tsx`, `pages/home.tsx`
- `pages/delinquency.tsx`, `pages/parties.tsx`, `pages/purchases.tsx`, `pages/confere.tsx`
- `pages/invites.tsx`, `pages/admin.tsx`, `pages/inventory.tsx`, `pages/fiscal-profiles.tsx`, `pages/fiscal-document.tsx`
- `packages/pdv-ui/src/pos-app.tsx`, `packages/pdv-ui/src/dialogs.tsx`
- Novo componente de abas: em `packages/ui/src/components.tsx` (preferível, para não criar padrão paralelo) ou em `packages/erp-ui/src/`
- Os E2E afetados em `apps/web/e2e/`

### 5.B Exigem decisão do dono ou backend

| ID | TIPO | SITUAÇÃO ATUAL | OPORTUNIDADE | POR QUE É B | PRIORIDADE |
|---|---|---|---|---|---|
| OP-B01 | ELIMINAR | Operador de caixa vê 31 itens de menu (seção 1.2), incluindo telas fiscais e de compras, por causa de `catalog.read` | Menu "foco no papel": quem não tem `catalog.write`/`finance.read` vê só Caixa, Pedidos, Clientes e Ajuda | Muda o que cada papel enxerga; o dono precisa decidir o que o operador pode consultar | Alta |
| OP-B02 | ELIMINAR | Todos veem Comandas, Cozinha, Delivery, Condicional e OS (`nav.ts:98-146`); não existe "ramo do negócio" no domínio (sem `segment`/`businessType` em `packages/domain`) | Perguntar o ramo no cadastro (mercadinho, loja, lanchonete, oficina) e mostrar só o que serve, com "Ligar mais funções" em Configurações | Campo novo no tenant (migração e API) e decisão de produto | Alta |
| OP-B03 | AUTOMATIZAR | Produto novo nasce "Sem perfil" (`products.tsx:265`), mesmo com 1 perfil criado no cadastro (`auth.service.ts:119-124`); a sugestão fiscal por IA só funciona depois de salvar (`products.tsx:540`) | Pré-selecionar o perfil padrão visível; sugerir NCM e perfil já na criação | Decisão fiscal (regra 3 do CLAUDE.md: nada de suposição silenciosa); a sugestão exige endpoint sem `productId` | Alta |
| OP-B04 | ELIMINAR | Fechamento pede sempre 5 formas, inclusive Pix confirmado pelo banco e formas sem movimento (`dialogs.tsx:1265-1273`) | Pedir só o que a pessoa contou de fato (dinheiro, cartão sem integração) e conferir o resto sozinho | Mexe na regra do fechamento cego e na auditoria | Média |
| OP-B05 | JUNTAR | "Adicionar pessoa" faz o dono digitar a senha do funcionário (`admin.tsx:343-350`), em paralelo com "Convidar por link" | Deixar só o convite (link ou WhatsApp) como caminho padrão, com "Adicionar pessoa" em "Avançado" | Mudança de fluxo de acesso (segurança); o dono decide | Média |
| OP-B06 | AUTOMATIZAR | Cadastro da empresa sem consulta de CNPJ nem de CEP (nenhuma ocorrência de viacep/brasilapi/receitaws) | Preencher razão social, endereço e CNAE pelo CNPJ e o endereço pelo CEP | Serviço externo (custo, disponibilidade, LGPD) | Média |
| OP-B07 | CRIAR | Não existe estoque mínimo no domínio (nenhum campo `minStock`) | "Avise quando tiver menos de N" no produto, alimentando o Início e o pedido de compra | Migração, API e regra de reposição | Média |
| OP-B08 | JUNTAR | Busca só de telas (`nav.ts:491-502`) | Busca global (Ctrl+K) que também acha produto, cliente e venda | Exige endpoint de busca unificada ou várias consultas; desenho de permissão por tipo | Baixa |
| OP-B09 | ANTECIPAR | Sem visão consolidada de "a nota está pronta para sair": a conferência só existe por nota (`nfe.tsx:611-630`) | Endpoint de prontidão fiscal por empresa (dados, certificado, CSC, série, perfis) para o Início e para Empresas | Backend (o motor e as regras ficam no servidor); a parte que dá para fazer no frontend está na OP-01 | Média |
| OP-B10 | JUNTAR | Configuração fiscal espalhada em 4 telas (seção 3.2) | Assistente "Deixar a nota fiscal pronta" em 3 passos (empresa, certificado, como os produtos pagam imposto) | Depende de OP-B09 e de revisão fiscal das perguntas (registrar dúvidas em `docs/fiscal/duvidas.md`) | Média |

---

## 6. Limites desta análise

- Análise só estática. A contagem de passos sai do código; não houve uso real nem teste com usuários.
- Não li `apps/site` (landing) a fundo, nem o painel `/admin/*`, que é da equipe Bipaê.
- Não verifiquei, rodando o caixa, se o foco já vai sozinho para "Finalizar venda" (OP-07). É a primeira coisa a conferir antes de implementar.
- Não li os outros relatórios `docs/pie/BANCA_*.md`, por independência da revisão.
