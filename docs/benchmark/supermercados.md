# Supermercados — Zanthus, RP Info, Arius, VR Software

Fonte: conceitos públicos do segmento (sites institucionais, material comercial, notícias). Nenhum software foi descompilado ou inspecionado.

## 1. PDV autônomo quando o servidor cai (RP Info, Zanthus)

- **O que faz:** cada caixa tem cópia local do cadastro e preços e continua vendendo se o servidor da loja ou a internet cair. Quando volta, envia as vendas acumuladas.
- **Por que é bom:** em supermercado, caixa parado é fila, abandono de carrinho e perda direta.
- **Problema que resolve:** dependência de rede e de um servidor único na loja.
- **Como o Bipaê faz:** offline-first por padrão, não como modo de emergência. O PDV **sempre** lê e grava no SQLite local; a sincronização roda em segundo plano (ADR-0004). Indicador discreto de "sincronizado há X min" e alerta se a fila passar de um limite. NFC-e em contingência offline (`tpEmis=9`) automática, com transmissão posterior dentro do prazo legal.

## 2. Balança e pesáveis

- **O que faz:** leitura do peso direto da balança no caixa; etiquetas com código de barras de peso/preço variável (prefixo 2) geradas na balança da seção.
- **Problema:** digitação manual de peso é lenta e dá erro.
- **Como o Bipaê faz:** driver de balança no Tauri (serial/USB) com protocolos comuns de mercado documentados publicamente pelos fabricantes; parser configurável do código EAN-13 de prefixo 2 (posições de PLU, peso ou preço, dígito); exportação de itens para carga da balança de etiquetas. Simulador de balança para desenvolvimento e testes.

## 3. Promoções avançadas e atacarejo (Zanthus)

- **O que faz:** leve X pague Y, segunda unidade com desconto, preço por faixa de quantidade (atacarejo), combos, promoção por cliente/convênio, por horário.
- **Problema:** promoção mal aplicada gera prejuízo ou reclamação; configurar costuma ser complicado.
- **Como o Bipaê faz:** **motor de promoções declarativo** (regras como dados: condição + benefício + vigência + prioridade + acumulabilidade), avaliado localmente no PDV, determinístico e testável. O cupom mostra "Você economizou R$ X" (comemoração da marca). Simulador de promoção no backoffice: "se o cliente levar isto, quanto paga?" antes de publicar.

## 4. Vasilhame, convênios e chama-fila

- **Vasilhame:** controle de cascos retornáveis (crédito/débito por cliente). Bipaê: item tipo "retornável" com saldo por cliente.
- **Convênios:** venda faturada para funcionários de empresas conveniadas com limite. Bipaê: forma de pagamento "convênio" ligada ao crediário, com limite e fechamento mensal.
- **Chama-fila:** painel/aviso que orienta o cliente ao próximo caixa livre. Bipaê: Fase 5, tela simples alimentada pelo status dos caixas em tempo real.

## 5. Self-checkout com conferência por peso (RP Info)

- **O que faz:** cliente passa os itens sozinho; uma balança na área de ensacamento confere se o peso bate com o item bipado.
- **Problema:** custo de operador × risco de perda.
- **Como o Bipaê faz (Fase 5):** modo quiosque do PDV com fluxo simplificado; conferência de peso com tolerância por produto (peso médio aprendido das vendas); chamada de fiscal por divergência; nunca bloqueia sem explicação.

## 6. Monitoramento de PDVs em tempo real e prevenção de perdas (Arius)

- **O que faz:** central que vê todos os caixas ao vivo: status, vendas, cancelamentos, sangrias, padrões suspeitos.
- **Problema:** perdas por fraude interna (cancelamento após pagamento, desconto indevido) e por falha operacional.
- **Como o Bipaê faz:** os eventos do PDV já são a fonte da verdade (ADR-0004), então o painel ao vivo sai quase de graça. Regras de alerta configuráveis (ex.: "mais de 3 cancelamentos de item em 10 min", "sangria acima de R$ X", "desconto acima de Y% sem gerente"). Trilha de auditoria imutável com quem autorizou o quê.

## 7. Conciliador de cartões, CRM e fidelidade (VR Software)

- **O que faz:** confere vendas no cartão contra o extrato das adquirentes (taxas, prazos, chargebacks); programa de fidelidade integrado ao PDV.
- **Problema:** taxa cobrada errada e recebível que não chega passam despercebidos; fidelidade em sistema separado não conversa com o caixa.
- **Como o Bipaê faz (Fase 4):** importação de extratos de adquirentes e de Pix; conciliação automática por NSU/valor/data com fila de divergências. Fidelidade/cashback nativos (o cliente se identifica por CPF ou telefone na venda), com consentimento LGPD.
