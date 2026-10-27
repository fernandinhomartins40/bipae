# Canais de venda e boletos: o que foi construído e o que falta conferir

Documento vivo das pendências de F4-15, F6-05 e F6-06. Regra do projeto: nada de endpoint ou posição de layout inventada; o que não foi confirmado em fonte oficial fica configurável e listado aqui.

## Boleto: multa, juros e CNAB (F4-15.b)

Código em `apps/api/src/modules/payments/cnab/`, TypeScript puro, sem I/O.

- `fees.ts`: multa única (bps do valor) e juros de mora ao mês pro rata por dia (mês de 30 dias), só com inteiros e arredondamento "meio para cima" explícito. Vencimento em fim de semana ou feriado passa para o dia útil seguinte; a lista de feriados e a carência vêm de configuração. As taxas são as combinadas com o cliente, não regra de lei no código.
- `cnab240.ts`: remessa (header de arquivo e de lote, segmentos P, Q e R, trailers) e leitura de retorno (segmentos T e U).
- `cnab400.ts`: remessa (header, detalhe tipo 1, multa tipo 2, trailer) e leitura de retorno.
- `fields.ts`: campos de posição fixa. Número que não cabe no campo gera erro em vez de ser cortado.

### Falta conferir (E9, conta e manual de um banco real)

- As posições seguem o layout geral FEBRABAN (240) e o desenho mais comum do 400 como o projeto os conhece. **Não foram conferidas com o manual de nenhum banco.** Cada banco muda convênio, carteira, código de movimento e campos de uso do banco.
- Os testes provam o formato interno (tamanho exato de cada registro, campos nos lugares que o código declara, totais), não a aceitação por um banco.
- Os códigos de ocorrência do retorno (`02` entrada confirmada, `06` liquidação etc.) variam por banco; o parser devolve o código bruto.
- Ainda não há tela nem rota para gerar remessa ou importar retorno: fica para quando houver o banco definido.

## Cardápio e estoque nos canais (F6-05.b, F6-06.b)

- Envio idempotente: cada item enviado grava um resumo (preço, disponibilidade e estoque) em `channel_catalog_state`; só o que mudou volta a sair. O resumo só é gravado depois que o canal aceitou o lote, então falha temporária reenvia tudo na próxima tentativa. "Reenviar tudo" existe (`force`).
- Fila `canais.cardapio` com nova tentativa; a varredura agenda a cada 10 minutos os conectores genéricos que têm endereço de envio.
- **Simulador:** recebe o envio, usado para provar o fluxo. **Conector genérico:** recebe `POST` JSON (`{ "type": "availability", "items": [...] }`, lotes de 200) no endereço https configurado, assinado como os pedidos que ele manda (`x-bipae-signature: t=<s>,v1=<hmac>`). Esse contrato é do Bipaê.
- **iFood:** continua "chega em breve" no envio de cardápio e estoque. O portal developer.ifood.com.br recusa a leitura automática (HTTP 403) e o catálogo do iFood não foi conferido em fonte oficial. Falta: credenciais de integrador (E14) e a leitura da documentação do catálogo.

## Marketplaces (Mercado Livre, Shopee, Amazon)

- Cadastrados como canais; mostram "falta configurar" na ordem: endereço da API (configurável por integração), acesso de integrador, e por fim "adaptador chega em breve".
- **Nenhum endereço, caminho ou corpo de requisição foi inventado.** Em 27/10/2026 a documentação do Mercado Livre devolveu HTTP 403 à leitura automática; Shopee e Amazon não foram alcançadas. Quando alguém com acesso confirmar as APIs oficiais, falta: autenticação (OAuth de cada um), estoque e preço por item, e leitura de pedidos.
- Já pronto e testado: `mapMarketplaceOrder`, que traduz o JSON de qualquer marketplace para o pedido normalizado por um mapeamento de caminhos configurável (valores em reais ou centavos, sem ponto flutuante acumulado). Falta ligar o mapeamento (`orderMap`) à tela e à entrada de pedidos de cada marketplace, o que depende de conhecer o formato real.
