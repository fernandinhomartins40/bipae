# Acessibilidade (F7-03)

Meta: **WCAG 2.2 nível AA** na retaguarda e no caixa.

## Como é conferido

O teste `apps/web/e2e/a11y.spec.ts` roda o axe-core (regras `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` e `wcag22aa`) a cada push. Ele confere:

- **Telas:**
  - entrar e criar conta;
  - início;
  - produtos, clientes, compras e vendas;
  - financeiro e relatórios;
  - relacionamento, integrações e condicional;
  - promoções, equipe, empresas e configurações;
  - o cadastro de produto aberto na gaveta;
  - abrir o caixa, o caixa com um item e o pagamento.
- **Tema escuro e celular (390 px de largura):** início, produtos, clientes, relatórios e financeiro.
- **Teclado:**
  - o primeiro Tab leva ao link "Pular para o conteúdo" (critério 2.4.1);
  - a gaveta abre com Enter e fecha com Esc;
  - o foco volta para o botão que abriu a gaveta (critério 2.4.3).
- **Prova de que a auditoria funciona:** uma página com erros de propósito (imagem sem texto alternativo, botão sem nome), que o axe precisa acusar.

Qualquer violação faz a CI falhar, com a lista do que corrigir.

## Resultado de 16/10/2026

- **axe:** zero violações em todas as telas, nos dois temas e no celular.
- **Corrigido pela auditoria manual de teclado:**
  - faltava o link "Pular para o conteúdo". Com o menu lateral longo, quem usa teclado passava por todos os itens antes de chegar à tela;
  - ao fechar uma gaveta ou janela, o foco se perdia (ia para a página). Agora volta para quem abriu. Não interfere quando o caixa leva o foco de volta ao campo de bipar.

## O que o axe não cobre (conferir à mão a cada tela nova)

Ferramentas automáticas acham só parte dos problemas. Em tela nova, conferir:

- **Teclado:** tudo funciona sem mouse, e o foco fica visível. O foco visível vem de `:focus-visible` em `packages/ui/src/theme.css`.
- **Mensagens:** erros e confirmações são anunciados (`role="alert"` ou `role="status"`, como nos componentes `Alert`) e explicam o que fazer.
- **Ordem:** a ordem de leitura faz sentido, e o título da página (`h1`) é único.
- **Toque:** área de pelo menos 24 × 24 px (critério 2.5.8). Os botões do Bipaê têm 44 px de altura.
- **Pessoas reais:** o teste de usabilidade com 10 pessoas (F7-07) depende do item E15.
