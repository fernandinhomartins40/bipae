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
