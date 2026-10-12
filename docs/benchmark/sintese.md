# Síntese — diferenciais do Bipaê

O que o benchmark mostrou e como o Bipaê se posiciona. Cada item vira requisito no [PRD](../PRD.md).

| # | Lacuna observada no mercado | Diferencial do Bipaê | Inspirado em (conceito) |
|---|---|---|---|
| 1 | Offline é "modo de emergência" ou exige servidor na loja | **Offline-first por padrão** em todos os dispositivos, sem servidor local obrigatório | RP Info, Tedsys |
| 2 | PDV web não acessa periféricos; PDV desktop não roda no celular | **Mesmo PDV** como PWA e como app Tauri | Bling/Olist + supermercados |
| 3 | Onboarding fiscal assusta o pequeno | **Primeira venda de teste sem configurar nada** + cadastro automático por XML de compra | MarketUP |
| 4 | Imposto "caixa-preta" | **Explicação de cada cálculo** (regra, vigência, base, alíquota) | — (original) |
| 5 | Reforma tratada como remendo | **Motor com vigência por data e regime**, antigo e novo em paralelo | — (original) |
| 6 | Erros da SEFAZ em código cru | **Rejeições traduzidas** com sugestão e atalho para corrigir | — |
| 7 | Prevenção de perdas só em sistemas caros de supermercado | **Painel ao vivo e alertas de fraude** em todos os planos, porque o PDV já é orientado a eventos | Arius |
| 8 | Promoções difíceis de configurar e testar | **Motor de promoções declarativo com simulador** | Zanthus |
| 9 | Preso a uma adquirente | **Agnóstico de adquirente/PSP**, com simuladores | VHSYS, Stone, Mercado Pago |
| 10 | Extensão por terceiros rara no Brasil | **API pública + webhooks** e, depois, extensões de PDV | Shopify POS |
| 11 | Ficha técnica e KDS só em sistemas de food service | **Verticais como módulos** no mesmo produto | Saipos, Colibri |
| 12 | Software caro para MEI | **Plano gratuito para MEI** | MarketUP, maquininhas |
