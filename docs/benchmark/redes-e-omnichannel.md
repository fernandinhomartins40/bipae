# Redes e omnichannel — Linx, TOTVS (Protheus, Consinco, VarejOnline), Shopify POS

Fonte: sites públicos, documentação pública de desenvolvedores (Shopify), notícias. Nenhum software foi descompilado ou inspecionado.

Contexto de mercado: a TOTVS assinou a compra da Linx (StoneCo) em jul/2025 por R$ 3,05 bi e da VarejOnline em 2024, ambas sujeitas ao Cade. A conclusão não foi confirmada nesta pesquisa. Se concluídas, consolidam boa parte do varejo médio e grande em um só fornecedor, o que abre espaço para alternativa moderna e simples.

## 1. Multiloja e retaguarda centralizada (Linx, TOTVS)

- **O que faz:** cadastro, preços, promoções e políticas definidos na matriz e distribuídos às lojas; consolidação de vendas e estoque de toda a rede.
- **Problema:** lojas com preços divergentes, cadastro duplicado, visão fragmentada.
- **Como o Bipaê faz:** hierarquia `tenant (grupo) → empresa (CNPJ) → loja → caixa`. Cadastro único por tenant com **sobrescritas por loja** (preço, estoque mínimo, mix). Cada loja/CNPJ tem sua configuração fiscal própria (UF, IE, regime).

## 2. Gestão de franquias

- **O que faz:** franqueador define mix, preços sugeridos e acompanha indicadores dos franqueados, que são CNPJs independentes.
- **Como o Bipaê faz (pós-MVP):** relação "rede" entre tenants independentes com compartilhamento explícito e consentido de catálogo e indicadores. Os dados de cada franqueado continuam isolados por RLS.

## 3. Compliance fiscal robusto (TOTVS)

- **O que faz:** cobertura ampla de regimes, UFs, benefícios e obrigações acessórias (SPED).
- **Problema:** em sistemas pequenos, a regra fiscal fica "na mão do contador" e erra.
- **Como o Bipaê faz:** motor de regras com vigência (ADR-0006); toda decisão fiscal tem explicação e origem; exportação SPED/EFD e pacote de XMLs para o contador; relatório de conferência de IBS/CBS (débitos e créditos).

## 4. Extensibilidade por apps (Shopify POS)

- **O que faz:** terceiros estendem o PDV com apps (telas, ações no carrinho, integrações) por APIs públicas e documentadas.
- **Problema:** o fornecedor não consegue atender toda necessidade de nicho.
- **Como o Bipaê faz (Fase 6):** API pública OpenAPI + webhooks assinados (HMAC) para eventos de negócio (venda concluída, nota autorizada, estoque baixo). Depois: "extensões de PDV" com pontos de extensão declarados (botão no carrinho, ação pós-venda) em sandbox (iframe com mensagens), sem acesso direto ao banco.

## 5. Clienteling e trocas omnichannel (Shopify POS)

- **O que faz:** o vendedor vê histórico e preferências do cliente; compra online pode ser trocada na loja física e vice-versa.
- **Problema:** cliente reconhecido só em um canal; troca entre canais vira burocracia.
- **Como o Bipaê faz:** cliente único por tenant (todos os canais); troca/devolução sempre referencia a venda original **por item**. Isso também atende à exigência fiscal da NT 2025.002 v1.52 (VC02-14) e permite troca entre lojas da rede.
