# ADR-0017 — Um app Android só (caixa móvel e vendas), pelo Tauri 2

**Status:** aceita (20/10/2026) · **Data:** 20/10/2026

## Contexto
O dono do projeto pediu três coisas para celular e tablet:
- um caixa (PDV) para a loja que quiser vender por celular ou tablet;
- um app de vendas para vendedores de loja (o cliente vai escolhendo e paga no caixa) e para garçons (comandas);
- comissão por vendedor.

Ele já tem conta de desenvolvedor do Google. O PRD prevê Android 9+.

O Bipaê já tem:
- um app Tauri 2 (`apps/desktop`) com ponto de entrada para celular (`mobile_entry_point`) e SQLite nativo;
- as telas e regras em `packages/*` (ADR-0012);
- a tela do garçom (F5-08), que hoje precisa de internet para mandar o pedido.

## Decisão
- **Um app só na Play Store:** "Bipaê", pacote `br.com.bipae.app`, decidido pelo dono em 20/10/2026. Ao entrar, a pessoa vê o que as permissões dela deixam:
  - **Caixa** (`pos.sell`): o mesmo PDV offline-first do desktop, com layout para celular e tablet.
  - **Vendas** (pedidos de vendedor e comandas): para quem lança pedidos.
  - Quem tem as duas permissões escolhe na tela inicial do app.
- **Tecnologia: Tauri 2 Android, a partir de `apps/desktop`.** É a mesma casca, compilada para Android, e as mesmas telas de `packages/*`. Nada de React Native agora (ADR-0005 só o admite se um SDK de maquininha exigir).
  - No Android ficam de fora a porta serial, a bandeja, o início automático e o atualizador do desktop. Quem atualiza o app é a Play Store.
  - Os periféricos do Android entram como ports de `packages/platform`: impressora térmica Bluetooth (ESC/POS), câmera como leitor de código e leitor Bluetooth (já funciona como teclado).
- **Pedidos de vendedor e de garçom funcionam sem internet no aparelho.** O pedido entra numa fila local com ID UUIDv7 (ADR-0004) e sobe quando houver rede. O caixa o recebe na sincronização, uma vez só.
- **O vendedor recebe no celular só se também tiver a permissão de caixa** (decisão do dono). Fora isso, o pedido vai para o caixa e o cliente paga lá.
- **Comissão:**
  - Cada vendedor tem um % sobre o que vendeu.
  - Produto ou categoria pode ter um % próprio, que vale no lugar do % do vendedor.
  - Só conta venda paga, e a devolução desconta.
  - Regras com vigência, e toda mudança de % fica na auditoria (regra 8).
- **Distribuição:** AAB assinado na CI, enviado à faixa de teste interno da Play Store. A chave de upload fica nos secrets do GitHub (regra 10); a assinatura final é a do Play App Signing.

## Consequências
- O mesmo código roda em quatro alvos: web, desktop, Android caixa e Android vendas. O E2E do Playwright cobre as telas em largura de celular, e o build Android roda na CI.
- As maquininhas smart que proíbem WebView (Mercado Pago Point Smart) não rodam o app. Para elas vale a cobrança pela nuvem (ADR-0018).
- iOS fica fora até haver pedido. O Tauri 2 também compila para iOS, o que exige a conta Apple (E23).
