Você vai implementar no Bipae (nosso PDV e ERP: API Node no contêiner `bipae-api`, app desktop Tauri e web em www.bipae.com.br) a integração nativa com o MercadoFlow, a plataforma de inteligência de varejo da mesma empresa. O lado do MercadoFlow já está pronto. A especificação completa está no documento anexo "Bipae × MercadoFlow: especificação de integração nativa". Siga esse documento como contrato: nomes de campos, endpoints, códigos de status e regras valem exatamente como estão lá.

## O que entregar, nesta ordem

1. **Catálogo nativo para todas as lojas Bipae** (seção 4), sem exigir conta no MercadoFlow:
   - no cadastro de produto, bipar o código de barras ou buscar pelo nome preenche tudo: descrição, marca, fabricante, departamento, unidade, conteúdo para o preço por kg/L, NCM e CEST sugeridos, códigos de caixa e fardo, ficha técnica e imagem;
   - a imagem é baixada para o storage do Bipae;
   - fotos genéricas para produtos de balança;
   - importação em massa revisada pelo catálogo;
   - cadastro rápido no caixa com tempo limite;
   - devolução ao catálogo (`/catalog/contributions`) do que as lojas cadastram.
2. **Contas e desconto** (seção 5):
   - tela "MercadoFlow" nas configurações, com "Criar minha conta MercadoFlow" (`POST /accounts`, com o aceite do dono) e "Já tenho conta" (fluxo `/connect`);
   - o 409 de "já tem conta" leva ao fluxo de vínculo;
   - `PUT /markets/{id}/customer` sempre que a assinatura Bipae da loja mudar, e uma vez por dia. É o que liga o desconto do plano MercadoFlow para clientes Bipae;
   - mostre o desconto vindo de `GET /markets/{id}/benefit`.
3. **Infra e base** (seções 2, 3 e 8):
   - rede Docker compartilhada no compose da VPS;
   - cliente HTTP do MercadoFlow com cache de token e espera exponencial;
   - outbox em tabela para tudo que é enviado;
   - endpoint de webhook com HMAC e idempotência;
   - registro do webhook.
4. **Vendas** (seção 7.1):
   - toda NFC-e autorizada vai pela outbox para `/sales`, e os cancelamentos para `/sales/cancel`;
   - carga inicial de 90 dias depois do vínculo (seção 7.4).
5. **Confere dentro do Bipae** (seção 6), em Compras → Notas de entrada:
   - aceite dos termos e certificado A1;
   - notas chegando sozinhas, com a notificação `confere.document.received`;
   - ler pela chave bipando o DANFE e importar XML;
   - conferência cega ou aberta bipando produto ou caixa, salva a cada item;
   - na conclusão, entrada no estoque do Bipae pelo `entry`:
     - o produto é achado por GTIN, depois por GTIN da caixa, depois pelo de-para fornecedor + código;
     - produtos novos cadastrados pelo catálogo;
     - quantidade em `receivedUnits` e custo em `unitCost`;
     - entrada idempotente por `accessKey` + `checkId`;
   - pendências com fornecedor;
   - compra de leituras por Pix.
6. **Inteligência** (seção 7.3):
   - card do Tino no painel inicial;
   - sugestão do Tino no pedido de compra;
   - preço da região na tela de preço;
   - encartes viram promoções pendentes;
   - `price.approved` vira alteração de preço pendente;
   - `order.sent` vira pedido de compra;
   - envio de produtos, preços, custos e estoque (seção 7.2).

## Regras que não podem ser quebradas

- Só a API do Bipae fala com o MercadoFlow. Desktop e web nunca veem credenciais, tokens ou o certificado A1. O Bipae não guarda o certificado.
- O caixa nunca espera o MercadoFlow. A consulta de catálogo no caixa tem tempo limite de 1,5 s. Todo envio passa pela outbox.
- Nada é cadastrado nem alterado sozinho. Catálogo, preço aprovado e encarte pré-preenchem ou criam pendência. O usuário confirma, salvo se ele ligar o modo automático.
- O Bipae nunca define nem vê a senha do MercadoFlow. A conta criada recebe o link de senha por e-mail.
- Idempotência:
  - venda pela chave da NFC-e;
  - webhook pelo `X-MercadoFlow-Delivery`;
  - entrada do Confere por `accessKey` + `checkId`.
- Sem as variáveis `MERCADOFLOW_*`, o Bipae funciona como hoje.
- Textos para o lojista em português claro, sem jargão técnico.

## Como trabalhar

- Antes de codar, leia a estrutura atual do Bipae (API, desktop e web) e proponha onde cada peça entra: módulos, tabelas e telas. Depois implemente em etapas, na ordem acima, com testes (seção 10) em cada etapa.
- Crie as migrações de banco do Bipae para:
  - `mercadoflow_links`;
  - a outbox;
  - os webhooks recebidos;
  - o de-para fornecedor + código;
  - o cache do catálogo;
  - as entradas do Confere já aplicadas.
- Teste contra o MercadoFlow real usando `?dryRun=true` nas vendas.
- Se algo no documento parecer ambíguo ou faltar um endpoint, **pare e pergunte** em vez de inventar um formato. O contrato do lado do MercadoFlow não muda sem combinarmos.
- Ao fim de cada etapa, informe:
  - o que foi feito;
  - o que foi testado e o resultado;
  - o que ficou pendente.
