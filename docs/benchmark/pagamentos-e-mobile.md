# MEI, micro e pagamentos — Mercado Pago, PagVendas, Stone, InfinitePay

Fonte: sites públicos e notícias. Nenhum software foi descompilado ou inspecionado.

## 1. Celular ou maquininha Android como PDV, gratuito

- **O que faz:** o app da adquirente vira um PDV simples (catálogo, venda, recibo) no celular ou na maquininha smart; o vendedor não paga pelo software, a receita vem das taxas.
- **Por que é bom:** zero custo e zero hardware extra para o MEI.
- **Limite observado:** pouca gestão (estoque, financeiro, fiscal), preso a uma adquirente.
- **Como o Bipaê faz:** PDV PWA que roda em qualquer celular/tablet e, onde o SDK do fabricante permitir, em maquininhas Android smart (Fase 6, depende de parceria/homologação). **Agnóstico de adquirente:** o lojista escolhe com quem processa.

## 2. Pix integrado

- **O que faz:** QR Code dinâmico com valor da venda; confirmação automática quando o pagamento cai.
- **Problema:** Pix por chave estática exige conferir comprovante (golpe de comprovante falso).
- **Como o Bipaê faz:** QR dinâmico via API do PSP escolhido (adaptador), confirmação por webhook **e** por consulta (fallback); a venda só conclui com confirmação real. Offline: o Pix depende de internet; o PDV oferece as outras formas e avisa com clareza.
- **Pix Automático** (em operação desde 16/06/2025): cobrança recorrente para crediário e mensalidades, via PSP.
- **Pix por Aproximação:** suportado via maquininha/PSP quando disponível.

## 3. Split payment (Reforma Tributária)

- Etapa 1 em 2027: facultativa e B2B (Pix, boleto, TED, TEF). Etapa 2 (obrigatória, com cartões e B2C) em data a definir.
- **Como o Bipaê se prepara:** cada pagamento guarda o vínculo com o documento fiscal (chave de acesso) e com os valores de IBS/CBS da operação, que é a informação que o arranjo de split precisa. Os adaptadores de PSP têm um campo opcional de "dados de split" desde o início (ADR-0009). Na conciliação, o valor líquido recebido pode vir sem a parcela do tributo e isso não é tratado como divergência.
