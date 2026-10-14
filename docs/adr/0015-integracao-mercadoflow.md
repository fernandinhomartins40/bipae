# ADR-0015 — Integração nativa com o MercadoFlow

- **Status:** aceita (13/10/2026, pedido do dono do projeto)
- **Contrato:** `BIPAE-INSTRUCOES-PARA-IA.md` (o lado do MercadoFlow já está pronto e não muda sem combinar).

## Contexto

O MercadoFlow é a plataforma de inteligência de varejo da mesma empresa e roda na mesma VPS. Ele oferece ao Bipaê um catálogo de produtos, contas vinculadas com desconto, o Confere (notas de entrada) e análises sobre as vendas.

## Decisão

1. **Só a API do Bipaê fala com o MercadoFlow**, pela API HTTP de parceiro. Sem banco compartilhado. Web, desktop e caixa nunca veem credencial nem token.
2. **Desligada por padrão.** Sem `MERCADOFLOW_API_URL`, `MERCADOFLOW_CLIENT_ID` e `MERCADOFLOW_CLIENT_SECRET`, nada muda no Bipaê.
3. **Outbox em tabela** (`mercadoflow_outbox`) para tudo o que é enviado: o caixa nunca espera, e com o MercadoFlow fora do ar nada se perde. Espera crescente de 1 minuto até 6 horas; recusa por dado inválido não é repetida.
4. **Webhook com HMAC do corpo cru e id de entrega único** (`mercadoflow_webhook_deliveries`). Evento de módulo ainda não construído fica guardado, sem data de tratamento.
5. **Vínculo por loja** (`mercadoflow_links`, `externalStoreId` = id da loja no Bipaê), com o CNPJ da empresa da loja.
6. **Exceção ao isolamento por cliente, restrita a `modules/mercadoflow`:** a outbox é esvaziada para todos os clientes de uma vez, e o webhook chega só com o id do mercado, sem cliente logado. Esses dois pontos usam `asPlatform()`. Rotas chamadas pelo lojista continuam em `withTenant`.
7. **Cache do catálogo sem `tenant_id`** (`mercadoflow_catalog_cache`): é dado público de produto, igual para todas as lojas, sem nenhuma informação de cliente.
8. **Nada é cadastrado sozinho.** O catálogo pré-preenche; preço aprovado e encarte viram pendência. NCM e CEST do catálogo são sugestão e passam pela conferência na tabela oficial (regra 3 do CLAUDE.md).
9. **Dinheiro:** o contrato usa número decimal em JSON. A conversão para centavos acontece na borda, com decimal de precisão arbitrária (ADR-0008).

## Alternativas

- **Banco compartilhado ou leitura direta do banco do MercadoFlow:** descartado; acopla os dois sistemas e fura o isolamento.
- **Chamar o MercadoFlow direto do navegador ou do caixa:** descartado; exporia credenciais e faria o caixa depender de rede.
- **Fila só no Redis, sem tabela:** descartado; a tabela dá histórico, idempotência por chave e o que mostrar ao lojista ("fila e erros").

## Consequências

- O compose da VPS passa a ligar a API também à rede do MercadoFlow (tarefa MF-05, mudança em produção).
- Vendas só são enviadas depois que o Bipaê emitir NFC-e (F3-14); imagens do catálogo dependem de onde guardar arquivos (E12).
- O Confere reaproveita a entrada de compra da F3-19 (de-para fornecedor + código, estoque e custo).
