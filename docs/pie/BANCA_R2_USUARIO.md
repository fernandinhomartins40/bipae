# Banca PIE — R2: Usuário adversarial / Produto e UX

- **Revisor:** R2 (usuário adversarial, produto e UX)
- **Projeto:** Bipaê — commit `728df79` (árvore de trabalho com alterações locais não versionadas em `pos.tsx`, `crm.service.ts` e outros; nenhum arquivo citado abaixo como evidência está entre os alterados, exceto onde indicado)
- **Ambiente:** Windows 11, leitura do código-fonte. **Nada foi executado.**
- **Data:** 27/10/2026
- **Público considerado:** donos e operadores de caixa de pequenos comércios, leigos em tecnologia.

## 1. Escopo

Telas de entrar, criar conta e recuperar senha; caixa (PDV: `packages/pdv-ui`, `packages/pdv-core`); produtos e contagem de estoque; financeiro (contas a pagar e receber); conferência de mercadoria; kit/ficha técnica; fidelidade (CRM); NF-e (rascunho); regras de ICMS; painel super admin (planos); componentes comuns (`packages/ui`); cliente HTTP e tratamento de erros (`packages/erp-ui/src/api-client.ts`, `forms.ts`, `apps/api/src/common/errors.ts`); validações (`packages/domain`).

## 2. O que foi inspecionado

| Área | Arquivos lidos |
|---|---|
| Componentes de formulário | `packages/ui/src/components.tsx` (Button, Field, MoneyField, TaxIdField, Drawer, Modal, DataTable) |
| Dinheiro | `packages/domain/src/money.ts` (`parseBRL`, `formatBRL`) |
| Formulários e erros | `packages/erp-ui/src/forms.ts`, `api-client.ts`, `app.tsx` (sessão), `apps/api/src/common/errors.ts` |
| Login e senha | `packages/erp-ui/src/pages/auth.tsx`, `packages/domain/src/contracts.ts` (signup/login) |
| Caixa | `packages/pdv-ui/src/register.tsx` (atalhos, bipagem, carrinho), `dialogs.tsx` (quantidade, desconto, pagamento, sangria/suprimento, fechamento) |
| Produtos/estoque | `packages/erp-ui/src/pages/products.tsx`, `inventory.tsx`, `purchase-orders.tsx` (`parseQuantity`), `product-kit.tsx` |
| Financeiro | `packages/erp-ui/src/pages/finance.tsx` |
| Conferência | `packages/erp-ui/src/pages/confere.tsx` |
| NF-e, ICMS, CIAP | `nfe.tsx` (descarte), `icms-rules.tsx` (exclusão), `accountant.tsx` |
| Admin | `packages/erp-ui/src/admin/admin-pages.tsx` (formulário de plano) |
| Acessibilidade | `docs/acessibilidade.md`, `apps/web/index.html`, `packages/ui/src/theme.css`, `shell.tsx` |
| Buscas transversais | `parseFloat`/`Number(` em `.tsx`; `api.delete(` sem confirmação; `beforeunload`; mensagens de erro fora do pt-BR; validações Zod sem mensagem |

## 3. Limitações (declaradas)

1. **Análise estática apenas.** Por regra desta banca, não subi a aplicação nem rodei testes (outro revisor usa as portas e a suíte). Nenhuma mensagem abaixo foi "observada na tela": todas são citadas **como estão no código**, com arquivo:linha.
2. Onde o comportamento depende do navegador (ex.: Enter num formulário não dispara `blur`), apoio a conclusão na semântica padrão do HTML e marco o estado de acordo.
3. Não medi contraste nem testei leitor de tela; para acessibilidade confio no relatório `docs/acessibilidade.md` (axe na CI) e só aponto o que o código mostra.
4. Severidade: **Alta** = perda de dinheiro, de dados ou venda errada sem o usuário perceber; **Média** = erro visível, retrabalho ou dado errado que o usuário pode notar; **Baixa** = fricção ou inconsistência.
5. Estados: **CONFIRMADO** (o código comprova o comportamento, sem execução), **FORTE INDÍCIO** (depende de condição de tempo ou de ambiente), **HIPÓTESE** (precisa validação).

## 4. Pontos fortes encontrados (para não reprovar à toa)

- `Button` desliga e mostra `aria-busy` com `loading` (`packages/ui/src/components.tsx:58-59`); a maioria das gavetas usa.
- Falha de rede vira mensagem amigável: `OFFLINE_MESSAGE` = "Sem conexão com o servidor. Verifique a internet; o que você digitou não foi perdido." (`api-client.ts:28-29`); 500 vira "Algo deu errado do nosso lado..." (`errors.ts:114`).
- Mensagens lançadas pelo código estão em pt-BR (busca por `throw new Error(` em inglês não achou nenhuma).
- `parseBRL` é estrito, em centavos inteiros, e recusa formatos ambíguos (`money.ts:35-63`); `MoneyField` recusa negativos.
- Pagamento do caixa bloqueia fechar a janela e o duplo clique em "Finalizar venda" enquanto grava (`dialogs.tsx:759-773`, `795`, `1125-1131`).
- Fechamento cego do caixa; atalhos de teclado esperam a bipagem pendente (`register.tsx:877-890`).
- Acessibilidade com axe na CI, `lang="pt-BR"`, foco visível (`theme.css:213-215`), link "Pular para o conteúdo" (`shell.tsx:182`), foco devolvido ao fechar gaveta.

## 5. Achados

### Tabela-resumo

| ID | Título | Categoria | Severidade | Estado | Arquivo:linha |
|---|---|---|---|---|---|
| R2-01 | Valor digitado num campo de dinheiro some se a pessoa apertar Enter (ou se o texto for inválido) | Validação / perda de dado | Alta | CONFIRMADO | `packages/ui/src/components.tsx:180-207`; `products.tsx:314-319,415-428` |
| R2-02 | Caixa perde a venda inteira ao recarregar (F5 com janela aberta, Ctrl+R, fechar aba) | Offline-first / perda de dado | Alta | CONFIRMADO | `register.tsx:189-192,810`; sem `beforeunload` no projeto |
| R2-03 | Fechar o pagamento com Pix/cartão da maquininha pendente não cancela a cobrança | Pagamento / dinheiro | Alta | CONFIRMADO (código) / efeito financeiro FORTE INDÍCIO | `dialogs.tsx:564-570,595-646,795,1113-1123` |
| R2-04 | "Salvar contagem" com campo vazio zera o estoque; "1.234" vira 1,234 | Validação / dado errado | Alta | CONFIRMADO | `products.tsx:626-647` |
| R2-05 | Plano do painel admin: "49.90" vira R$ 4.990,00; "R$ 49,90" vira sem preço; limite com texto vira ilimitado | Dinheiro na UI (float) / receita | Alta | CONFIRMADO | `admin/admin-pages.tsx:1186-1191` |
| R2-06 | Mensagens de validação do Zod em inglês chegam ao usuário | Mensagens / idioma | Média | CONFIRMADO | `apps/api/src/common/errors.ts:32-41`; `domain/src/contracts.ts:1182`; `platform.ts:169` |
| R2-07 | Erro do servidor preso a um campo que a tela não mostra: o formulário falha em silêncio | Feedback de erro | Média | CONFIRMADO (mecanismo) | `packages/erp-ui/src/forms.ts:26-30` |
| R2-08 | Financeiro: "Valor pago" vazio dá baixa com R$ 0,00; texto inválido dá baixa com o valor antigo | Validação / dinheiro | Média | CONFIRMADO | `finance.tsx:371,428,443-453`; `contracts.ts:1192` |
| R2-09 | Conferência de mercadoria: impossível digitar quantidade com vírgula; cada tecla grava na API | Entrada numérica / rede | Média | CONFIRMADO | `confere.tsx:697-705,565-576` |
| R2-10 | Ficha técnica/kit: impossível digitar "0,250" de forma natural; quantidade em ponto flutuante | Entrada numérica | Média | CONFIRMADO | `product-kit.tsx:116-129` |
| R2-11 | Sangria/suprimento e fechamento de caixa sem trava de duplo envio; fechamento aceita tudo em branco sem confirmar | Duplo clique / caixa | Média | FORTE INDÍCIO (duplo) / CONFIRMADO (em branco) | `dialogs.tsx:1171-1215,1249,1276` |
| R2-12 | Ações destrutivas de um clique (descartar rascunho de NF-e, excluir regra de ICMS) | Prevenção de erro | Média | CONFIRMADO | `nfe.tsx:1421-1431`; `icms-rules.tsx:191-196,323` |
| R2-13 | Sessão que expira de vez derruba a tela e perde o que estava sendo digitado | Sessão / perda de rascunho | Baixa | FORTE INDÍCIO | `erp-ui/src/app.tsx:104-107`; `api-client.ts:233-235` |
| R2-14 | "Esqueci a senha" some sem explicação quando o e-mail do servidor está desligado | Capacidade escondida | Baixa | CONFIRMADO | `auth.tsx:194-204` |
| R2-15 | Quantidades: "1.000" é lido como 1 (ponto como decimal) em todo o sistema | Convenção pt-BR | Baixa | CONFIRMADO | `purchase-orders.tsx:43-48`; `dialogs.tsx:208` |
| R2-16 | Grupos de opção (forma de pagamento, tipo de desconto) com `role="radio"` sem navegação por setas; linha de tabela clicável sem papel de botão e sem Espaço | Acessibilidade | Baixa | CONFIRMADO | `dialogs.tsx:303-329,801-814`; `components.tsx:713-728` |

### Detalhamento

#### R2-01 — Valor digitado num campo de dinheiro some com Enter ou com texto inválido
- **Categoria:** validação / perda de dado. **Severidade: Alta** — o dono altera um preço, aperta Enter e o produto é salvo com o **preço antigo**, e a gaveta fecha como se tivesse dado certo; o caixa passa a vender pelo valor errado.
- **Estado:** CONFIRMADO pelo código (o envio implícito por Enter não dispara `blur`: comportamento padrão do navegador). Não executado.
- **Onde:** `MoneyField` só converte e repassa o valor no `onBlur` (`packages/ui/src/components.tsx:193-207`); o `onChange` só guarda texto (`:192`). O formulário de produto usa `form.submit` com os valores do estado pai (`products.tsx:314-319`, campos em `:415-428`), e o botão é `type="submit"` (`:606`).
- **Reprodução:** (a) Produtos → editar produto de R$ 10,00 → apagar o preço, digitar `12,00` → Enter. (b) Novo produto → digitar o preço → Enter. (c) Editar → no "Custo" digitar `1O,00` (letra O) → clicar Salvar.
- **Esperado × real (pelo código):** (a) esperado salvar R$ 12,00; real: `priceCents` ainda vale 1000, salva R$ 10,00 e chama `onClose()` (`:374`). (b) esperado salvar; real: `priceCents === null` dispara "Informe o preço de venda" (`:318`) embora o campo esteja preenchido. (c) o campo mostra "Valor inválido. Use o formato 1.234,56" (`components.tsx:201`), mas o pai continua com o custo antigo e o salvamento segue e fecha a gaveta.
- **Impacto:** preço e custo errados no caixa e nos relatórios de margem; o mesmo componente está em 25 telas (financeiro, NF-e, compras, promoções, tabelas de preço, variações, OS).
- **Correção proposta:** no `MoneyField`, chamar `onChange(parseBRL(text))` a cada digitação (com `null` quando inválido) e deixar o `blur` só para formatar e mostrar o erro; expor um estado "inválido" para o pai, ou fazer `form.submit` recusar envio enquanto houver campo de dinheiro inválido.
- **Teste de aceite:** teste de componente: digitar `12,00` no "Preço de venda" e disparar `submit` no formulário sem `tab` → o `PUT /products/:id` leva `priceCents: 1200`. Texto inválido + Salvar → nenhuma requisição e a mensagem do campo aparece.

#### R2-02 — O caixa perde a venda inteira ao recarregar a página
- **Categoria:** offline-first / perda de dado. **Severidade: Alta** — numa compra de mercado com 40 itens, um F5 ou um toque errado obriga a bipar tudo de novo, com fila esperando; vai contra a regra "o caixa nunca depende de rede" no espírito (o caixa não deveria depender de a aba continuar viva).
- **Estado:** CONFIRMADO pelo código.
- **Onde:** o carrinho vive só na memória do React (`register.tsx:189-192`). O atalho F5 ("salvar orçamento", `:825-832`) só tem `preventDefault` quando nenhuma janela está aberta: com janela aberta o tratador sai antes (`:810`), e o F5 volta a ser "recarregar" do navegador. Não há `beforeunload` em nenhum arquivo de `apps/` ou `packages/` (busca feita).
- **Reprodução:** caixa web → bipar itens → abrir o desconto (F4) ou a quantidade (F3) → apertar F5. Ou: bipar itens → Ctrl+R / fechar a aba / "voltar" do celular.
- **Esperado × real:** esperado recuperar a venda em andamento ou, no mínimo, perguntar antes de sair; real: a página recarrega sem aviso e o carrinho volta vazio (`EMPTY_CART`).
- **Impacto:** retrabalho no pico, risco de cobrar diferente na segunda bipagem; descontos autorizados por gerente se perdem.
- **Correção proposta:** (1) gravar o carrinho em andamento no banco local (`pdv-core`, mesma transação das projeções ou num registro `current_cart`) a cada mudança e oferecer "Retomar a venda de 12 itens?" ao abrir o caixa; (2) `beforeunload` quando houver itens; (3) `preventDefault` de F5/F11/F12 sempre que o caixa estiver em foco, mesmo com janela aberta.
- **Teste de aceite:** E2E: bipar 3 itens, abrir F4, `page.reload()` → o caixa mostra os 3 itens (ou a oferta de retomar). Teste unitário: F5 com janela aberta chama `preventDefault`.

#### R2-03 — Fechar o pagamento com cobrança pendente na maquininha ou no Pix não cancela a cobrança
- **Categoria:** pagamento / dinheiro. **Severidade: Alta** — o cliente pode pagar na maquininha (Point) ou no QR depois que o operador fechou a janela ou trocou para dinheiro; a cobrança fica sem venda ligada.
- **Estado:** CONFIRMADO que o código permite e não cancela; o efeito (cliente pagar depois) é FORTE INDÍCIO, depende do comportamento da Point/PSP.
- **Onde:** a janela só bloqueia o fechamento com `busy` (`dialogs.tsx:795`), e `busy` volta a `false` logo depois de criar a cobrança (`:672-681`, `:719-730`). O efeito de saída só desfaz TEF (`:564-570`); não há cancelamento de `cardCharge`/`charge`. "Refazer pagamentos" também só desfaz TEF (`:1113-1123`). Com a cobrança pendente, o operador pode lançar dinheiro no valor restante e finalizar.
- **Reprodução:** loja com "Point" ou Pix por API → Pagamento → Crédito → enviar à maquininha → apertar Esc (ou lançar Dinheiro e Finalizar).
- **Esperado × real:** esperado cancelar a cobrança (ou impedir fechar/finalizar enquanto pendente, com "Cancelar na maquininha" primeiro); real: a janela fecha, o acompanhamento (`setInterval`) para e a cobrança segue aberta no aparelho.
- **Impacto:** cobrança em dobro ou dinheiro recebido sem venda nem nota.
- **Correção proposta:** no desmontar e em "Refazer pagamentos", chamar `cardApi.cancel`/`pixApi.cancel` das cobranças pendentes; desabilitar "Finalizar venda" e o fechamento enquanto `cardCharge?.status === 'pending'` ou `charge?.status === 'pending'`, com mensagem "Cancele a cobrança na maquininha antes de sair".
- **Teste de aceite:** teste em `payment-dialog.test.tsx`: criar cobrança Point simulada, desmontar a janela → `cancel` chamado uma vez; com cobrança pendente, "Finalizar venda" desabilitado.

#### R2-04 — "Salvar contagem" com o campo vazio zera o estoque
- **Categoria:** validação. **Severidade: Alta** — um toque em "Salvar contagem" sem digitar nada põe o saldo do produto em zero (o modo `count` substitui o saldo).
- **Estado:** CONFIRMADO: `Number('')` é `0`, finito e ≥ 0, e passa na checagem.
- **Onde:** `products.tsx:630-641` (`Number(text.replace(',', '.'))`, `mode: 'count'`). Também: "1.234" vira 1,234 unidade; o botão não tem `loading` (`:659`); usa sempre a primeira loja (`store!.id`, `:634-636`), o que em empresa com várias lojas conta na loja errada (HIPÓTESE quanto ao uso real).
- **Reprodução:** Produtos → abrir um produto com saldo 50 → "Contagem de estoque" → clicar "Salvar contagem" com o campo vazio.
- **Esperado × real:** esperado "Informe a quantidade contada"; real: envia `quantityMilli: 0` e mostra "Estoque atualizado." (`:643`).
- **Impacto:** saldo zerado, ruptura falsa, perda registrada sem ter havido.
- **Correção proposta:** usar `parseQuantity` (como `inventory.tsx:263` já faz), exigir texto não vazio, aceitar `0` só quando digitado, pedir a loja quando houver mais de uma e usar `loading`.
- **Teste de aceite:** clicar "Salvar contagem" vazio → nenhuma chamada a `/stock/adjustments` e mensagem de campo obrigatório.

#### R2-05 — Formulário de plano no painel admin usa ponto flutuante e engole erros
- **Categoria:** dinheiro na UI / receita. **Severidade: Alta** — o preço do plano é o que o cliente paga; um erro de digitação do super admin muda a cobrança de todos os assinantes do plano.
- **Estado:** CONFIRMADO.
- **Onde:** `admin/admin-pages.tsx:1186-1191`: `Math.round(Number(v.price.replace(/\./g, '').replace(',', '.')) * 100)` e `Number(v.limits[r])`.
- **Reprodução / esperado × real:**
  - `49.90` → os pontos são removidos → `4990` → **R$ 4.990,00** (esperado R$ 49,90 ou recusa).
  - `R$ 49,90` → `Number('R$ 49.90')` = `NaN` → `JSON.stringify` manda `null` → plano **sem preço** (o schema aceita `null`, `domain/src/platform.ts:171`).
  - Limite `10 lojas` → `NaN` → `null` → **ilimitado**.
- **Impacto:** cobrança errada, plano grátis ou sem limite por engano.
- **Correção proposta:** usar `parseBRL` (ou `MoneyField`) no preço; para limites, aceitar só dígitos e a palavra "ilimitado", e recusar o resto com mensagem.
- **Teste de aceite:** teste de unidade da conversão: `49.90` → 4990 centavos; `R$ 49,90` → 4990; `10 lojas` → erro de campo, sem requisição.

#### R2-06 — Mensagens do Zod em inglês chegam ao usuário
- **Categoria:** mensagens / idioma. **Severidade: Média** — o público não lê inglês (regra do projeto); a mensagem aparece no topo do formulário ou embaixo do campo.
- **Estado:** CONFIRMADO: o projeto usa Zod 4.6.6 sem `z.config(...)`/locale pt (busca sem resultado), e `fromZod` repassa `i.message` (`apps/api/src/common/errors.ts:38-41`). Em `packages/domain/src` há cerca de 365 regras `.min/.max/.length/.int/.positive/.uuid/.email` sem mensagem contra 99 com mensagem (contagem por busca, inclui regras não digitáveis pelo usuário).
- **Exemplos concretos:** Financeiro → "Nova conta" → Parcelas `99`: `installments: z.number().int().min(1).max(60)` (`contracts.ts:1182`) sem mensagem; a tela mostra `e.message` (`finance.tsx:285`). Painel → plano com nome de 1 letra: `name: z.string().trim().min(2).max(40)` (`platform.ts:169`). O texto exato vem do Zod (padrão do inglês, algo como "Too big: expected number to be <=60"); não o observei em execução.
- **Correção proposta:** configurar o locale pt do Zod uma vez em `@bipae/domain` (`z.config(z.locales.pt())`), carregado pela API e pela UI; manter mensagens próprias nos campos de formulário.
- **Teste de aceite:** teste em `apps/api`: `parse(financialEntryInput, {..., installments: 99})` → mensagem sem palavras em inglês (regex `/[A-Za-z]+ (expected|must|Too)/` não casa).

#### R2-07 — Erro preso a um campo que a tela não mostra faz o formulário falhar em silêncio
- **Categoria:** feedback de erro. **Severidade: Média.**
- **Estado:** CONFIRMADO o mecanismo; ocorrência em cada tela depende de quais caminhos o servidor devolve.
- **Onde:** `forms.ts:26-30`: quando o erro tem `issues`, o banner geral não aparece ("Show the banner only when the error is not attached to a visible field"), mas o código não verifica se o campo está visível. No produto, só `name`, `priceCents`, `costCents`, `wholesalePriceCents`, `sku`, `category`, `ncm`, `cest` e `barcodes*` são exibidos (`products.tsx:404-518`); um erro em `wholesale.minQuantityMilli`, `components.0.quantity`, `stPauta` ou `catalog.*` não aparece em lugar nenhum.
- **Esperado × real:** esperado ver o que corrigir; real: o botão para de girar e nada acontece.
- **Correção proposta:** `useForm` recebe a lista de campos exibidos (ou o `Field` se registra) e mostra no banner os erros sem campo; no mínimo, sempre mostrar `error.message` no banner quando nenhum dos caminhos bater com um campo conhecido.
- **Teste de aceite:** simular resposta 400 com `issues: [{ path: 'components.0.quantity', ... }]` → o banner mostra a mensagem.

#### R2-08 — Baixa de conta: valor vazio vira R$ 0,00; texto inválido vira o valor antigo
- **Severidade: Média** — baixa com valor errado distorce o fluxo de caixa e a conciliação.
- **Estado:** CONFIRMADO.
- **Onde:** `finance.tsx:449` (`paidCents: paid ?? 0`); o schema aceita zero (`contracts.ts:1192`, `nonnegative`). Com texto inválido, o `MoneyField` não chama `onChange` (R2-01), então `paid` continua com `entry.amountCents` (`finance.tsx:371`) e o botão dá baixa no valor cheio enquanto mostra "Valor inválido". Na nova conta, `amountCents: amount ?? 0` (`:278`) é recusado pelo servidor com "Informe o valor" (`contracts.ts:1180`), que está correto.
- **Correção proposta:** desabilitar "Confirmar pagamento" com `paid === null` ou com campo inválido; perguntar "Confirmar baixa de R$ 0,00?" quando for zero de propósito.
- **Teste de aceite:** apagar o valor e clicar → nenhuma chamada a `/pay` e mensagem no campo.

#### R2-09 — Conferência de mercadoria: não dá para digitar decimal, e cada tecla grava
- **Severidade: Média** (quem confere frutas, carnes e granel por peso não consegue lançar 2,5 kg digitando).
- **Estado:** CONFIRMADO.
- **Onde:** `confere.tsx:700-705`: o campo é controlado por `String(c.counted)`; ao digitar `2,` o código faz `Number('2.')` = 2 e o campo volta a mostrar `2` (a vírgula some). Apagar tudo grava `0`. Cada tecla chama `save` → `PUT .../check` (`:565-576`), sem espera nem ordem garantida das respostas (FORTE INDÍCIO de sobrescrita fora de ordem em rede lenta).
- **Correção proposta:** guardar o texto local, converter com `parseQuantity` e gravar no `blur` ou com espera de 600 ms, mostrando "Salvo".
- **Teste de aceite:** digitar `2,5` → o campo mostra `2,5` e é feito um único `PUT` com 2,5.

#### R2-10 — Ficha técnica/kit: mesma armadilha da vírgula
- **Severidade: Média** — receita de restaurante é feita de frações (0,250 kg de queijo).
- **Estado:** CONFIRMADO: `product-kit.tsx:119-125` mostra `String(c.quantity).replace('.', ',')` e converte a cada tecla; `0,` vira `0`. A quantidade é `number` fracionário, não milésimos inteiros como no resto do estoque.
- **Correção proposta:** texto local + `parseQuantity` (milésimos), igual ao estoque.
- **Teste de aceite:** digitar `0,250` → o campo mantém `0,250` e o item guarda 250 milésimos.

#### R2-11 — Sangria, suprimento e fechamento de caixa sem trava de duplo envio
- **Severidade: Média.**
- **Estado:** FORTE INDÍCIO para o duplo envio (depende da latência do banco local e da autorização do gerente); CONFIRMADO para o fechamento em branco.
- **Onde:** `dialogs.tsx:1171-1197`: o valor só é limpo depois do `await pdv.addMovement`; não há `busy` e o botão (`:1249`) não usa `loading`. Dois Enter ou dois toques durante a autorização registram duas sangrias (cada uma com ID novo, então a idempotência do servidor não segura). No fechamento (`:1199-1215`), campos vazios são pulados e não há confirmação: "Confirmar fechamento" (`:1276`) com tudo em branco fecha o caixa sem nada declarado.
- **Correção proposta:** `busy` + `loading` nos dois formulários; no fechamento, uma tela de revisão ("Você vai fechar com: Dinheiro R$ 350,00; Pix não informado...") antes de gravar, e exigir pelo menos o dinheiro.
- **Teste de aceite:** dois `submit` seguidos → `addMovement` chamado uma vez; fechar com tudo vazio → pede revisão.

#### R2-12 — Ações destrutivas sem confirmação
- **Severidade: Média.** **Estado:** CONFIRMADO.
- **Onde:** "Descartar rascunho" da NF-e fica ao lado de "Emitir NF-e" e apaga na hora (`nfe.tsx:1421-1431`); "Excluir" regra de ICMS também (`icms-rules.tsx:191-196`, botão em `:323`; é alteração fiscal, sensível pela regra 8 do projeto). No caixa, "Limpar venda" usa `window.confirm` nativo (`register.tsx:840,920`), sem o visual do app.
- **Correção proposta:** um `ConfirmDialog` em `packages/ui` (título, consequência, botão perigoso com o verbo: "Descartar rascunho") usado em todas as exclusões e no "Limpar venda".
- **Teste de aceite:** clicar "Descartar rascunho" → aparece a confirmação; só o segundo clique chama `DELETE /fiscal/nfe/:id`.

#### R2-13 — Sessão que expira de vez perde o que estava sendo digitado
- **Severidade: Baixa** (a renovação automática cobre a maioria dos casos: `api-client.ts:230-232`).
- **Estado:** FORTE INDÍCIO.
- **Onde:** com o 401 depois da renovação falhar, `onSessionEnd` faz `setMe(null)` (`app.tsx:104-107`), o app troca para a tela de entrar e desmonta a gaveta aberta; um cadastro longo (NF-e manual, produto com fiscal) se perde.
- **Correção proposta:** em vez de desmontar, abrir uma janela "Sua sessão terminou. Entre de novo para salvar" por cima da tela e repetir a requisição depois do login.
- **Teste de aceite:** com a gaveta de produto preenchida, forçar 401 no salvar → aparece o login por cima e, depois de entrar, o salvamento acontece com os mesmos dados.

#### R2-14 — "Esqueci a senha" some sem explicação
- **Severidade: Baixa. Estado:** CONFIRMADO.
- **Onde:** `auth.tsx:194-197` devolve `null` quando o e-mail do servidor está desligado (ou quando `/health` falhou). A regra "capacidades nunca mentem" pede o aviso, não o sumiço.
- **Correção proposta:** mostrar "Esqueceu a senha? Fale com o dono da conta ou com o suporte do Bipaê" quando o e-mail estiver desligado.
- **Teste de aceite:** com `features.email = false`, a tela de entrar mostra o texto de ajuda.

#### R2-15 — Quantidade "1.000" lida como 1
- **Severidade: Baixa. Estado:** CONFIRMADO.
- **Onde:** `parseQuantity` aceita `[.,]` como decimal (`purchase-orders.tsx:44`); o caixa faz `Number(text.replace(',', '.'))` (`dialogs.tsx:208`). Para quem escreve milhar com ponto (padrão brasileiro), `1.000` vira 1 unidade. No caixa, um produto por unidade com `1.000` passa como 1 (`milli % 1000 === 0`).
- **Correção proposta:** tratar o ponto seguido de exatamente 3 dígitos como milhar (mesma regra de `parseBRL`), e usar vírgula como decimal; exibir a quantidade interpretada antes de confirmar ("= 1.000 unidades").
- **Teste de aceite:** `parseQuantity('1.000')` → 1.000.000 milésimos; `parseQuantity('1,5')` → 1500.

#### R2-16 — Pequenas falhas de acessibilidade por teclado
- **Severidade: Baixa. Estado:** CONFIRMADO.
- **Onde:** grupos com `role="radiogroup"`/`role="radio"` feitos de botões (`dialogs.tsx:303-329`, `801-814`): todos entram no Tab e as setas não mudam a escolha (padrão WAI-ARIA de rádio). `DataTable` com linha clicável usa `tabIndex=0` no `<tr>` sem `role` e só responde ao Enter (`components.tsx:713-728`); o leitor de tela não anuncia que a linha abre algo. No pagamento as letras D/P/B/C/V/R compensam no caixa.
- **Correção proposta:** usar `@radix-ui/react-radio-group` ou `ToggleGroup`; na tabela, um botão/link na primeira célula com o nome do item.
- **Teste de aceite:** com o foco no grupo de formas de pagamento, a seta para a direita troca a forma; axe sem violações.

## 6. Oportunidades de produto (ELIMINAR → JUNTAR → AUTOMATIZAR → ANTECIPAR → CRIAR)

| # | Tipo | Oportunidade | Impacto | Esforço | Justificativa (do código) |
|---|---|---|---|---|---|
| O1 | ELIMINAR | Um único `QuantityField` (texto local + `parseQuantity` em milésimos, vírgula decimal, ponto de milhar) no lugar dos `Number(text.replace(',', '.'))` espalhados | Alto | Baixo | Mesma classe de erro em R2-04, R2-09, R2-10, R2-15; o estoque já tem a função certa (`inventory.tsx:263`). |
| O2 | ELIMINAR | Locale pt do Zod em um ponto só | Alto | Muito baixo | Fecha R2-06 sem tocar nos ~365 campos. |
| O3 | JUNTAR | `MoneyField` que avisa o pai a cada digitação + `ConfirmDialog` comum em `packages/ui` | Alto | Baixo | Corrige R2-01/R2-08 em 25 telas e R2-12 de uma vez. |
| O4 | AUTOMATIZAR | Venda em andamento salva no banco local e "Retomar venda?" ao abrir o caixa | Alto | Médio | R2-02; o caixa já tem SQLite e outbox, falta só o carrinho. |
| O5 | AUTOMATIZAR | Cancelar sozinho as cobranças pendentes de Point/Pix ao sair do pagamento | Alto | Baixo | R2-03; `cancel` já existe nas duas APIs. |
| O6 | ANTECIPAR | No fechamento de caixa, tela de revisão antes de gravar e alerta "você não informou o dinheiro" | Médio | Baixo | R2-11; mantém o fechamento cego (não mostra o esperado). |
| O7 | ANTECIPAR | Mostrar a interpretação do que foi digitado ("= R$ 4.990,00", "= 1.000 un") ao lado de campos sensíveis (preço de plano, contagem) | Médio | Baixo | R2-05 e R2-15 viram autoconferência visível. |
| O8 | JUNTAR | Contagem de estoque só num lugar (tela Estoque), com a loja escolhida, e um atalho do produto que abre essa tela já filtrada | Médio | Baixo | Hoje há duas implementações diferentes (`products.tsx:623` e `inventory.tsx`), uma com o bug R2-04. |
| O9 | CRIAR (hipótese a validar) | Login por cima da tela quando a sessão termina, sem perder o formulário | Baixo | Médio | R2-13; validar com dados reais de quantas vezes a renovação falha. |

Prioridade sugerida: O2 e O3 (rápidos, amplos) → O5 → O1 → O4 → O6/O7 → O8 → O9.

## 7. Parecer do R2

**Parecer: REPROVADO na ótica de usuário e produto, com ressalva de que tudo foi apurado por análise estática.**

Motivo: há achados de **severidade Alta confirmados pelo código** que levam a dado errado gravado sem o usuário perceber: preço salvo com o valor antigo ao usar Enter (R2-01), estoque zerado com um clique (R2-04), preço de plano multiplicado por 100 no painel (R2-05), e risco de dinheiro recebido sem venda no pagamento integrado (R2-03). A perda do carrinho ao recarregar (R2-02) contradiz a promessa offline-first do caixa web.

O restante do produto mostra cuidado acima da média: componentes acessíveis com axe na CI, mensagens em pt-BR no código, tratamento amigável de rede caída, trava de duplo clique no fechamento da venda e fechamento cego.

Para mudar o parecer: corrigir R2-01 a R2-05 com os testes de aceite acima e confirmar em execução (R4) os cenários de Enter no `MoneyField`, F5 com janela aberta no caixa e fechar o pagamento com cobrança pendente. Os itens Média e Baixa podem entrar como ressalvas com prazo.

**Não verificado:** contraste real das cores, leitor de tela, layout em aparelhos físicos, comportamento real da Point e dos PSPs, o app desktop (Tauri) quanto ao F5.
