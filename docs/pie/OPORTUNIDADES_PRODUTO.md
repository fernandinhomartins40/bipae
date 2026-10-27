# Oportunidades de produto — frontend para quem não é da área

> Base: `ANALISE_PRODUTO_FRONTEND.md` (R2-P, análise estática do commit `728df79`) e `BANCA_R2_USUARIO.md`.
> Público: donos e operadores de pequenos comércios, leigos em tecnologia e em termos fiscais.
> Heurística: cada objetivo em até 3 ações (informar → revisar o necessário → concluir), sem tirar
> controles. Contagens de passos vêm do código, não de uso observado.

## Diagnóstico em uma página

- **Menu** (`packages/erp-ui/src/nav.ts`): 7 grupos e 51 itens, mais Início, Abrir o caixa e Ajuda. Já
  está organizado por objetivo e tem palavras de busca leigas (`keywords`), o que é bom. O problema
  não é o agrupamento, e sim o **excesso de itens no mesmo nível**: o mesmo objetivo está partido em
  várias telas (Compras × Notas de entrada; 4 telas fiscais; Restaurante em 4 telas; Equipe ×
  Vendedores; Fiado × Inadimplência).
- **O operador de caixa vê 31 itens**, entre eles NF-e, Perfis fiscais, Regras de ICMS e Compras,
  porque essas telas pedem só `catalog.read`.
- **Tela inicial** (`pages/home.tsx`) já tem atalhos, "Precisa da sua atenção", "Hoje na loja" e
  "Primeiros passos". Faltavam a pergunta mais comum do dono ("quanto lucrei hoje?") e os passos que
  deixam a loja pronta para emitir nota.
- **Estados vazios**: só 12 de 49 dizem qual é o próximo passo. Nenhuma tela leva ao seu artigo de
  ajuda (há 26 artigos).

## Implementado nesta rodada (grupo A, só frontend, sem mudar regra de negócio)

| ID | Tipo | Situação anterior | O que mudou | Esforço eliminado | Teste |
|---|---|---|---|---|---|
| OP-03 | ANTECIPAR | "Hoje na loja" mostrava vendas, faturamento e ticket médio; o lucro exigia abrir Relatórios | Cartão mostra a **Margem (venda − custo)** de hoje, que o relatório do dia já calcula (o nome evita confusão com o "Lucro bruto" da DRE, que desconta impostos); sem custo cadastrado, diz o que falta e leva aos produtos | 2 telas e um filtro de datas | typecheck + suíte `erp-ui`; E2E de relatórios |
| OP-01 | ANTECIPAR | "Primeiros passos" tinha 3 itens (conta, produtos, venda) | Inclui **completar os dados da empresa** (CNPJ, UF, regime) e, como passo opcional que não segura o cartão, **instalar o certificado digital**, usando `/companies` e `/fiscal/certificates`, que já existiam | Descobrir sozinho por que a nota não sai | typecheck + suíte `erp-ui` |
| OP-05 | JUNTAR | Inadimplência dizia "receba na ficha do cliente" e só tinha um botão para a lista de clientes | Tocar no cliente em atraso abre **a ficha dele** (`/clientes?abrir=<CPF/CNPJ>`) | Voltar, procurar o nome e abrir a ficha (3 ações) | typecheck + E2E `finance.spec` |
| ACH-17 | ELIMINAR | Perfis fiscais avisava "NFC-e chega em breve" | Aviso explica para que serve o perfil, sem prometer o que já existe | Confusão sobre o que o sistema faz | E2E `fiscal-profiles.spec` atualizado |
| ACH-05/06/07/16 | ELIMINAR (erro) | Dinheiro e quantidade lidos errado em silêncio | Ver `ACHADOS_CONSOLIDADOS.md` | Retrabalho e dado errado | `ui.test.tsx` |

## Próxima rodada — grupo A (seguro, só frontend), em ordem

| ID | Tipo | Oportunidade | Arquivos | Prioridade |
|---|---|---|---|---|
| OP-04 | ELIMINAR | Na primeira vez, criar o caixa "Caixa 1" com um clique | `packages/pdv-ui/src/pos-app.tsx` | Alta |
| OP-06 | ELIMINAR | Busca de produto na revisão do XML de compra (hoje a lista para em 200) | `pages/purchases.tsx` | Alta |
| OP-11 | ANTECIPAR | "N produtos sem estoque" em "Precisa da sua atenção" | `pages/home.tsx` | Média |
| OP-10 | ANTECIPAR | Link "Como funciona?" em cada tela que tem artigo de ajuda | `pages/shell.tsx` | Média |
| OP-07 | ELIMINAR | Pagamento cobriu o total: foco vai para "Finalizar venda" (confirmar no caixa antes) | `packages/pdv-ui/src/dialogs.tsx` | Média |
| OP-09 | AUTOMATIZAR | Mandar o convite pelo WhatsApp | `pages/invites.tsx` | Média |
| OP-12 | ANTECIPAR | Estados vazios que dizem o próximo passo (37 telas) | várias | Média |
| OP-13 | ELIMINAR | Trocar `alert()`/`confirm()` do navegador e códigos `cStat` crus por frases e um `ConfirmDialog` comum | `packages/ui`, telas fiscais | Média |
| OP-02 | JUNTAR | Compras + Notas de entrada numa só tela "Notas dos fornecedores" | `pages/confere.tsx`, `pages/purchases.tsx`, `nav.ts` | Média |
| OP-08 | JUNTAR | Menu com ~24 itens: páginas do mesmo objetivo viram abas (árvore abaixo) | `nav.ts`, `nav.test.ts`, `shell.tsx`, componente de abas em `packages/ui` | Média; exige migrar os E2E que clicam no menu pelo nome |

### Menu proposto (OP-08)

As 51 rotas continuam existindo (links antigos não quebram); os nomes antigos viram palavras de busca.

```
Fixos: Início · Vender · Buscar
1 Vendas ............ Vendas e notas · Mesas, pedidos e cozinha · Pedidos da internet · Condicional · Ordens de serviço · Promoções
2 Produtos e estoque  Produtos (serviços, tabelas de preço, etiquetas em abas) · Estoque (inventário, lotes, transferências, perdas em abas)
3 Compras ........... Notas dos fornecedores · Pedidos de compra · Fornecedores
4 Clientes .......... Clientes e fiado · Fidelidade e campanhas
5 Dinheiro .......... Contas (pagar/receber, boletos, conciliação) · Cartão e Pix a cair · Resultados (relatórios, fluxo, DRE, comissões) · Assistente
6 Impostos e contador Arquivos para o contador · Impostos do mês · Como cada produto paga imposto
7 Configurações ..... Minha empresa e notas · Equipe e vendedores · Caixas e aparelhos · Formas de pagamento · Assinatura · Avançado
Rodapé: Ajuda · Minha conta · Sair
```

**Por que não foi feito agora:** mexe em 51 rotas e nos seletores de dezenas de specs E2E
(`abrirNoMenu(page, '<nome>')`). Precisa de uma rodada própria com o E2E inteiro como rede de
segurança. Não remove nenhuma função.

## Grupo B — depende de decisão do dono ou de backend

| ID | Oportunidade | Por que precisa de decisão |
|---|---|---|
| B01 | Menu enxuto por papel (operador não vê telas fiscais e de compras) | Muda permissões (`catalog.read` hoje abre essas telas) |
| B02 | Perguntar o ramo do negócio no cadastro e esconder o que não serve (comandas, cozinha, condicional, OS) | Campo novo e regra de exibição |
| B03 | Produto novo já com o perfil fiscal padrão; sugestão fiscal antes de salvar | Decisão fiscal (regra 3 do CLAUDE.md) |
| B04 | Fechamento de caixa sem pedir contagem de Pix integrado e de formas sem movimento | Mexe no fechamento cego |
| B05 | Ficar só com o convite e tirar "Adicionar pessoa" (o dono digita a senha do funcionário) | Muda fluxo de equipe |
| B06 | Preencher a empresa pelo CNPJ e o endereço pelo CEP | Serviço externo |
| B07 | Estoque mínimo e alerta de reposição | Não existe no modelo de dados |
| B08 | Busca global (produto, cliente, venda) com Ctrl+K | Endpoint de busca unificada |
| B09/B10 | "Deixar a nota fiscal pronta" em 3 passos, com uma consulta que diga o que falta | Depende de revisar as perguntas fiscais |
