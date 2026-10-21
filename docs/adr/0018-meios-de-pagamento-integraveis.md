# ADR-0018 — Meios de pagamento que o próprio cliente integra (TEF, maquininha, Pix)

**Status:** aceita (20/10/2026) · **Data:** 20/10/2026 · **Detalha:** ADR-0009

## Contexto
O dono do projeto pediu que cada loja possa ligar o meio de pagamento que já usa, no PDV web, no desktop e no Android, cobrindo os principais do Brasil para supermercados e qualquer ramo, inclusive o QR Code do Pix.

A ADR-0009 definiu a interface `PaymentProvider` e simuladores, mas o pacote `packages/payments` nunca foi criado. Hoje o caixa usa sempre o `SimulatedTef` (`packages/pdv-ui/src/dialogs.tsx`).

Pesquisa feita em 20/10/2026. Há quatro famílias de integração no mercado:

| Família | Exemplos | Onde roda | Como integra |
|---|---|---|---|
| TEF com pinpad | SiTef/CliSiTef (Fiserv), PayGo, Auttar (Getnet), Linx D-TEF | Desktop (Windows/Linux) e Android (m-SiTef, PayGo por Intent) | Biblioteca local do integrador; homologação com ele |
| Maquininha smart com SDK | PagBank PlugPag, Stone SDK, Cielo LIO (deeplink), Getnet POS, Rede | App Android dentro da maquininha | SDK Kotlin/Java do adquirente; homologação e loja de apps própria |
| Maquininha pela nuvem | Mercado Pago Point (payment intents), Stone Connect | Web, desktop e Android, sem instalar nada | API REST + webhook com o token do lojista |
| Pix com QR dinâmico | API Pix do Banco Central (`PUT /cob/{txid}`, webhook), seguida por Efí, Sicoob, Itaú, BB, Inter, Santander, Bradesco; APIs próprias de Mercado Pago, PagBank, Asaas | Servidor do Bipaê (qualquer alvo) | OAuth2 + mTLS por banco; confirmação por webhook **e** consulta |

## Decisão
- **Criar `packages/payments`** com a interface `PaymentProvider` da ADR-0009, um registro de adaptadores e os simuladores. O caixa passa a pedir o meio configurado à loja em vez de usar o simulador fixo.
  - **Sem configuração, nada muda.** O cartão é informado à mão, "na maquininha à parte", como hoje.
- **Configuração por loja na retaguarda ("Meios de pagamento"):** a pessoa escolhe o provedor, informa as credenciais e testa a conexão.
  - Segredos ficam selados no banco (regra 10, colunas `*_sealed`), nunca voltam para a tela nem para o log.
  - Toda mudança fica na auditoria (regra 8).
  - Cada provedor diz em quais alvos funciona; onde não funciona, a tela mostra "não funciona neste aparelho" ("capacidades nunca mentem").
- **Onde cada família roda:**
  - **Pix e maquininha pela nuvem** rodam no servidor (`modules/payments` na API). O caixa pede a cobrança, mostra o QR ou "pague na maquininha" e recebe a confirmação.
    - A confirmação chega por webhook assinado ou por consulta com espera crescente, e a operação é idempotente pelo `txid` ou pelo ID da intenção.
    - Sem internet, esses meios ficam indisponíveis, e a tela explica por quê (ADR-0009).
  - **TEF com pinpad no desktop** roda pelo Rust do desktop e pelo Bipaê Conector (o PDV web chama o Conector). O protocolo fica em TypeScript puro e testável; o Rust só carrega a biblioteca do integrador e move bytes.
  - **TEF e SDK no Android:** plugin Tauri em Kotlin por integrador (m-SiTef e PayGo por Intent, PlugPag, Stone, Cielo LIO), espelhando o mesmo `PaymentProvider`.
- **Ordem de entrega:**
  1. A base com os simuladores e a tela.
  2. A API Pix padrão do Banco Central, porque cobre a maioria dos bancos com um adaptador só.
  3. Maquininha pela nuvem (Mercado Pago Point, Stone Connect).
  4. TEF no desktop (SiTef e PayGo).
  5. SDKs Android (PagBank, Stone, Cielo, Getnet, m-SiTef e PayGo).
- **Cada adaptador real** só fica "pronto" depois de testado no sandbox ou na homologação do parceiro. Até lá, a tela o mostra como "em homologação" e ele não aparece para clientes.
- **O pagamento guarda** NSU, autorização, bandeira, adquirente e `txid`. São os insumos da conciliação de recebíveis, que já existe (F4-08), e do split (`splitInstructions`, ADR-0009).

## Ajuste na implementação (21/10/2026)
- Em vez de um pacote `packages/payments`, o catálogo e a configuração ficam em `@bipae/domain` (`payments.ts`), compartilhados pela API e pelas telas, e o gerador do BR Code em `@bipae/domain` (`pix.ts`). Cada adaptador real mora onde roda: na API (Pix e nuvem) ou nos ports de `packages/platform` (TEF e SDKs).
- Adaptador construído e testado contra o padrão, mas ainda sem homologação com um parceiro real, aparece como "Em homologação" e pode ser escolhido pela loja, com o aviso de testar antes no sandbox do banco (pedido do dono: deixar pronto para o próprio cliente integrar).
- O padrão sem integração deixou de ser o simulador: cartão na maquininha à parte e Pix pela chave da loja, com QR Code estático opcional.

## Consequências
- Ativar um meio novo = escrever o adaptador e homologar com o parceiro. A homologação exige conta sandbox ou credenciamento (E9, E10, E26), que só o dono ou o lojista consegue.
- O PDV Embed (ADR-0014) pode usar os meios que rodam no servidor (Pix e nuvem) sem mudar o contrato. Os outros precisam de nova versão do contrato.
