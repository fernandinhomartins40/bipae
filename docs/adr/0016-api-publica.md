# ADR-0016 — API pública com chaves por cliente e webhooks

- **Status:** aceita (16/10/2026, tarefa F6-01)

## Contexto

Parceiros (e-commerce, BI, sistemas do próprio lojista) precisam ler produtos, estoque, clientes e vendas e ser avisados quando algo acontece, sem usar o login de uma pessoa. A API interna já tem tudo, mas as rotas mudam junto com as telas e são autenticadas por sessão.

## Decisão

1. **Chave de API por cliente (empresa), criada pelo dono na retaguarda.** Formato `bpk_<id do cliente sem hífens>_<32 bytes aleatórios em base64url>`. A chave aparece **uma única vez**. O banco guarda só o SHA-256 (`api_keys.key_hash`) e um prefixo para mostrar na tela (regra 10 do CLAUDE.md).
2. **A busca da chave respeita o isolamento:** o id do cliente vem dentro da chave, e a consulta roda em `withTenant`, com RLS, sem `asPlatform()`.
3. **Escopos são permissões do catálogo** (`catalog.read`, `parties.read`...). A chave nunca tem mais poder do que quem a criou: o contexto usa a interseção dos escopos com as permissões atuais dessa pessoa, que respondem por ela na auditoria (com o id da chave). Se a pessoa perde o acesso, a chave para de funcionar.
4. **Só rotas marcadas com `@PublicApi()` aceitam chave.** Qualquer outra rota responde 403. A API pública cresce rota a rota, sem expor por acidente o que a tela usa.
5. **Contrato OpenAPI 3.1 escrito à mão** (`apps/api/src/modules/public-api/openapi.ts`), servido em `/v1/public/openapi.json`. Um teste confere que cada rota do contrato existe e está marcada como pública. Mudança incompatível exige nova versão do caminho.
6. **Webhooks por cliente:** URL `https`, eventos escolhidos e segredo guardado selado (`SecretBox`, AES-256-GCM), porque a assinatura precisa do valor.
   - **Assinatura:** cabeçalho `X-Bipae-Signature: t=<segundos>,v1=<HMAC-SHA256 de "<segundos>.<corpo cru>">`. O tempo dentro da assinatura deixa o parceiro recusar repetição antiga.
   - **Entrega:** cada uma vai pela fila (`QUEUE`), com o id único em `X-Bipae-Delivery` (para o parceiro descartar repetições) e o evento em `X-Bipae-Event`.
   - **Novas tentativas:** as esperas (1 min, 5 min, 30 min, 2 h e 12 h) ficam na própria linha. Depois disso, a entrega é dada como falha.
   - **Reenvio do que venceu:** a rotina de `modules/maintenance` (onde `asPlatform()` já é permitido) põe de volta na fila o que venceu.
   - **Rede interna:** endereço que resolve para rede interna (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, IPv6 local) é recusado no cadastro e no envio, porque a VPS é compartilhada. Redirecionamento não é seguido.
   - **Histórico:** as entregas e o "aviso de teste" aparecem na tela.
7. **Eventos nascem na mesma transação do fato** (outbox `webhook_deliveries`). Venda que chega do caixa gera o evento quando o servidor aplica o evento do caixa. O caixa nunca espera pela internet.

## Alternativas

- **OAuth com consentimento por aplicativo:** fica para quando houver loja de aplicativos. Para integração do próprio lojista, a chave é mais simples e segura o bastante com escopos e revogação.
- **Gerar o OpenAPI dos schemas Zod automaticamente:** descartado por agora. As rotas internas não são todas públicas, e o contrato escrito à mão com teste de conformidade deixa claro o que é promessa.

## Consequências

- Nova permissão sensível `admin.integrations` (criar e revogar chaves, configurar webhooks), só do dono por padrão.
- Limite de pedidos por chave entra junto com o limitador geral da API (tarefa de endurecimento).
