# Food service — Saipos, Consumer, Colibri, Linx Degust

Fonte: sites públicos, vídeos de demonstração e notícias. Nenhum software foi descompilado ou inspecionado.

## 1. Mapa de mesas e comandas

- **O que faz:** visão gráfica das mesas com status (livre, ocupada, pedindo a conta), tempo de ocupação e valor parcial; comandas individuais (cartão/pulseira numerada).
- **Problema:** perder pedido, cobrar errado, mesa esquecida.
- **Como o Bipaê faz (Fase 5):** mesa e comanda são "vendas abertas" (mesmo modelo da venda do PDV, status `open`). Divisão de conta por pessoa, por item ou em partes iguais. Taxa de serviço configurável e opcional por mesa. Transferência de itens entre mesas com trilha de auditoria.

## 2. Garçom no celular

- **O que faz:** app/PWA no celular do garçom lança pedidos direto na mesa.
- **Problema:** ida e volta ao caixa, comanda de papel ilegível.
- **Como o Bipaê faz:** PWA leve que funciona **na rede local mesmo sem internet**: o PDV Tauri do salão atua como servidor local de sincronização (ADR-0004). Observações rápidas por item ("sem cebola") como botões configuráveis.

## 3. KDS (tela de cozinha)

- **O que faz:** pedidos aparecem na tela da cozinha/bar por praça de produção, com tempo e cores de atraso; substitui a impressora da cozinha.
- **Problema:** papel perdido, atraso invisível, sem métrica de tempo de preparo.
- **Como o Bipaê faz:** KDS como web app na rede local, roteamento por praça (cozinha, bar, sobremesa); ao marcar "pronto", avisa o garçom/balcão. Métricas de tempo médio por prato. Fallback para impressora ESC/POS.

## 4. Integração iFood e delivery

- **O que faz:** pedidos do iFood e outros apps entram direto no sistema e na cozinha; status volta para a plataforma.
- **Problema:** um tablet por plataforma e redigitação.
- **Como o Bipaê faz (Fase 6):** conector oficial via API de parceiros (depende de homologação no programa do iFood; até lá, simulador). Pedidos externos viram vendas abertas no mesmo fluxo do KDS. Delivery próprio com **taxa por bairro** e cardápio digital simples.

## 5. Ficha técnica com baixa de insumos

- **O que faz:** cada prato tem receita (insumos e quantidades); a venda baixa os insumos do estoque e calcula o CMV real.
- **Problema:** dono não sabe o custo real do prato nem onde há desperdício.
- **Como o Bipaê faz:** produto do tipo "composto" com ficha técnica versionada (alterar a receita não reescreve o passado), fator de rendimento/perda, baixa de insumos no evento de venda. Relatório de CMV teórico × real (inventário).
