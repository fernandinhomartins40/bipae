# Benchmark de mercado — sala limpa

## Método e limites

Este benchmark registra **comportamento observável e conceitos**: o que a funcionalidade faz, por que é boa e qual problema resolve. Depois projeta a **solução própria do Bipaê**. Não há código, texto, ícone, layout ou dado de concorrente aqui, nem haverá no produto.

Fontes permitidas (seção 2 do briefing): sites e documentação públicos, APIs públicas documentadas, vídeos de demonstração, notícias, trials cujos termos permitam, projetos open source com licença compatível.

### Sobre a ferramenta REA

A REA (github.com/morluto/rea, licença MIT) é um kit de engenharia reversa para agentes, com servidor MCP e cerca de 70 ferramentas: decompilação de binários nativos (Ghidra/Hopper), análise de apps JavaScript/Electron e .NET, e inspeção de sites.

**Na Fase 0 ela não foi instalada nem usada**, por dois motivos:

1. A maior parte do que ela faz (descompilar binários, desmontar apps Electron/.NET) cai no que o briefing **proíbe** para software proprietário. Os PDVs de referência são proprietários, e suas licenças normalmente proíbem engenharia reversa.
2. `npx rea-agents setup` instala um servidor MCP e altera a configuração do agente na máquina. Isso merece decisão explícita do dono do projeto.

O que a Fase 0 precisava (validar a matriz e entender os conceitos) foi feito com pesquisa web em fontes públicas. **Uso recomendado da REA nas próximas fases**, com aprovação: (a) inspecionar **páginas web públicas** de demonstração e documentação; (b) estudar **projetos open source** com licença compatível; (c) analisar software próprio ou com autorização por escrito. Nunca em binários de concorrentes.

## Matriz validada

Correções em relação ao briefing estão em **negrito**.

| Referência | Situação verificada (out/2026) | Arquivo |
|---|---|---|
| Linx | **Era da StoneCo desde 2020. Em jul/2025 a TOTVS assinou a compra da Linx por R$ 3,05 bi, sujeita ao Cade; conclusão não confirmada** | [redes-e-omnichannel.md](redes-e-omnichannel.md) |
| TOTVS (Protheus, Consinco, VarejOnline) | Consinco é TOTVS. **VarejOnline: compra pela TOTVS anunciada em 2024 (R$ 49 mi), sujeita ao Cade** | [redes-e-omnichannel.md](redes-e-omnichannel.md) |
| Zanthus, RP Info, Arius, VR Software | Fornecedores especializados em supermercados; matriz mantida | [supermercados.md](supermercados.md) |
| Bling | **Pertence à LWSA (Locaweb) desde 2021, não à Olist.** Planos pagos a partir de ~R$ 100/mês | [pme-e-micro.md](pme-e-micro.md) |
| Tiny | **Hoje "Olist ERP"** (a Olist comprou a Tiny) | [pme-e-micro.md](pme-e-micro.md) |
| VHSYS, Tedsys | Matriz mantida | [pme-e-micro.md](pme-e-micro.md) |
| MarketUP | Plano de entrada gratuito confirmado em agregadores | [pme-e-micro.md](pme-e-micro.md) |
| Nex | **Pouca informação pública encontrada**; manter como referência secundária | [pme-e-micro.md](pme-e-micro.md) |
| Saipos, Consumer, Colibri, Linx Degust | Matriz mantida | [food-service.md](food-service.md) |
| Mercado Pago, PagVendas, Stone, InfinitePay | Adicionada a **InfinitePay** (citada com MarketUP entre as soluções gratuitas para pequenos) | [pagamentos-e-mobile.md](pagamentos-e-mobile.md) |
| Shopify POS | Matriz mantida | [redes-e-omnichannel.md](redes-e-omnichannel.md) |
| SAT-CF-e (SP) / MFE (CE) | **Ambos encerrados em 01/01/2026.** Não serão adaptadores | [../fiscal/versoes.md](../fiscal/versoes.md) |

Preços e planos mudam muito; confira no site de cada fornecedor antes de usar em material comercial.

## Síntese: o que o Bipaê faz diferente

Ver [sintese.md](sintese.md): a lista de diferenciais que viraram requisitos no [PRD](../PRD.md).

## Fontes

- [Startups – TOTVS compra a Linx](https://startups.com.br/negocios/totvs-compra-a-linx-para-reforcar-posicao-no-varejo/) · [B3 Bora Investir](https://borainvestir.b3.com.br/noticias/empresas/totvs-compra-a-linx-da-stone-em-negocio-de-r-305-bilhoes/)
- [Startups – TOTVS compra VarejOnline](https://startups.com.br/negocios/ma/de-olho-no-varejo-totvs-paga-r-49m-por-varejonline/)
- [Startups – Bling](https://startups.com.br/negocios/bling-quer-ir-alem-do-erp-e-ser-one-stop-shop-para-pmes/) · [LWSA](https://lwsa.tech/en/)
- [Shopify App Store – Olist ERP (Tiny)](https://apps.shopify.com/tiny-erp?locale=es)
- [B2B Stack – MarketUP × Bling](https://www.b2bstack.com.br/compare/marketup-vs-bling-erp)
- [REA no skills.sh](https://skills.sh/morluto/rea/reverse-engineer-anything) · [Runtimewire sobre a REA](https://runtimewire.com/article/matthew-berman-rea-ai-reverse-engineering)
