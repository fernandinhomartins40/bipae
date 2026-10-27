# Banca PIE — R1 Red Team / Segurança, LGPD e proteção de receita

- **Revisor:** R1 (Red Team). Passagem feita por agente de IA, em contexto separado dos outros revisores; não há independência real de modelo.
- **Commit:** `728df79` (branch `main`), com alterações locais não commitadas em 8 arquivos (`git status`); nenhum deles foi usado como prova de achado.
- **Ambiente:** Windows, leitura do código-fonte. Modo **somente leitura**: nada do projeto foi alterado, a API não foi iniciada e a suíte de testes não foi rodada.
- **Data:** 27/10/2026.

## 1. Escopo

Autenticação, sessões e JWT, recuperação de senha, 2FA, força bruta e limites de pedidos; autorização no servidor e papéis; IDOR/BOLA; isolamento entre clientes (RLS); injeção SQL, XSS, SSRF, CORS, CSRF, uploads, travessia de caminho; segredos no repositório público; exposição de erros; webhooks de pagamento; proteção de receita (limites de plano, conta suspensa, recursos do plano, chaves da API pública, IA); LGPD (exportação, exclusão, PII em log); dependências (`pnpm audit --prod`).

## 2. O que foi inspecionado

| Área | Arquivos lidos (principais) |
|---|---|
| Guarda de autenticação, contexto, conta bloqueada, chave de API | `apps/api/src/common/auth.ts`, `common/api-keys.ts`, `common/tokens.ts`, `common/rate-window.ts`, `common/secrets.ts`, `common/password.ts` |
| Login, cadastro, convite, 2FA, senha nova, sessões | `apps/api/src/modules/auth/auth.controller.ts`, `auth.service.ts` (inteiro) |
| Bootstrap HTTP | `apps/api/src/app.ts` (helmet, CORS, rate-limit, `trustProxy`), `config.ts` |
| RLS e grants | as 89 migrações, com o script `scratchpad/r1/rls.mjs` (estático) que cruza todo `create table` com `tenant_id` contra `enable/force row level security`, `create policy` e os laços `foreach t in array[...]`; leitura de `0001_init.sql` (políticas e funções `security definer`), `0003`, `0004`, `0055` |
| Uso de `asPlatform()` / acesso ao banco fora de `withTenant` | `grep` em todo `apps/api/src`; `db/client.ts` |
| Equipe e papéis | `modules/team/team.service.ts`, `team.controller.ts`, `packages/domain/src/permissions.ts` |
| Limites de plano e conta bloqueada | `modules/account/limits.service.ts`, `catalog.service.ts`, `organization.service.ts` (pontos de `assertCanAdd`), `packages/domain/src/platform.ts` |
| Cobrança e simuladores | `modules/billing/billing.controller.ts`, `billing-gateway.ts`, `billing-methods.ts` |
| Webhooks de pagamento, de canais e MercadoFlow | `modules/payments/payment-webhooks.ts`, `pix-charges.service.ts`, `pix-api.ts`, `boleto.service.ts`, `modules/channels/channels.controller.ts`/`channels.service.ts`, `modules/mercadoflow/mercadoflow.webhook.ts` |
| SSRF | `common/ssrf.ts`, `modules/public-api/webhooks.service.ts`, `pix-api.ts`, transportes fiscais |
| Uploads e armazenamento | `common/storage.ts`, `modules/catalog/product-images.service.ts`, `modules/fiscal/certificates.service.ts` |
| Eventos do caixa (sync) | `modules/sync/sync.service.ts`, `sync.controller.ts`, `modules/audit/audit.service.ts` |
| IA | `modules/ai/ai.service.ts` |
| Painel super admin e suporte | `modules/admin/platform.guard.ts`, `admin.controller.ts`, `admin-auth.controller.ts`, `admin-tenants.service.ts` (personificação) |
| LGPD | `modules/account/data-export.service.ts`, `account.controller.ts`, `modules/maintenance/maintenance.service.ts` (exclusão definitiva) |
| Front-end | `apps/web/src/platform.ts` (innerHTML), `packages/pdv-core/src/receipt-html.ts`, `packages/erp-ui/src/api-client.ts`, `apps/web/docker/nginx.conf`, `security-headers.conf` |
| Deploy | `deploy/docker-compose.vps.yml`, `deploy/nginx/bipae.com.br.conf` |
| Segredos | `git ls-files`, `git grep` por padrões de chaves (Anthropic, AWS, GitHub, Mercado Pago, chave privada PEM, SMTP com senha) no HEAD e `git log --all -p` no histórico |
| Documentação existente | `docs/seguranca/asvs-n2.md` (riscos aceitos A-01 a A-09) |
| Dependências | `pnpm audit --prod` |

## 3. O que NÃO foi testado e por quê

- **Nenhum teste dinâmico (DAST) nem reprodução em execução.** Regra da banca: não subir a API nem a suíte (outro revisor usa as portas e o PGlite). Todos os achados são de leitura de código; as "reproduções seguras" abaixo são roteiros para rodar em ambiente de teste, ainda não executados.
- **Produção e VPS:** fora do escopo autorizado. A configuração real do nginx do host, o `.env` da VPS, os backups e a retenção deles não foram vistos.
- **Front-end em profundidade** (todas as telas), app desktop Tauri/Rust, Android, kit PDV Embed (Node/PHP) e site: só os pontos citados.
- **BOLA rota a rota:** conferi o padrão (RLS em todas as tabelas, `withTenant` em todo acesso, `storeCondition`/`assertStore` nos serviços com loja), não cada um dos mais de 300 endpoints.
- **Histórico do git:** busca por padrões conhecidos, não uma varredura completa com ferramenta dedicada (gitleaks/trufflehog não estão instalados).
- **Conformidade jurídica com a LGPD:** fora do alcance de uma inspeção técnica (bases legais, contratos, encarregado).

## 4. Achados

Severidade: **Crítica** (exploração remota sem credencial com acesso a dados de outros clientes ou a dinheiro), **Alta** (tomada de conta ou fraude com pouca exigência), **Média** (abuso que exige papel interno ou causa perda de receita), **Baixa** (defesa em profundidade, desvio de política ou risco pequeno).

### Resumo

| ID | Título | Categoria | Severidade | Comprovação |
|---|---|---|---|---|
| R1-01 | IP do cliente falsificável por `X-Forwarded-For`: os limites por IP não seguram | Força bruta / configuração | Média | FORTE INDÍCIO |
| R1-02 | Aceitar convite adivinha a senha de qualquer pessoa sem o travamento por e-mail e entrega a sessão dela | Autenticação | **Alta** | CONFIRMADO (leitura) |
| R1-03 | Evento do caixa cancela qualquer venda e registra sangria sem conferir permissão, loja nem autorizador; a trilha não guarda quem enviou | Autorização / auditoria / fraude | **Alta** | CONFIRMADO (leitura) |
| R1-04 | Limites de plano de produtos e usuários burláveis por desativar e reativar | Receita | Média | CONFIRMADO (leitura) |
| R1-05 | Quem tem `admin.users` pode desativar o Dono ou dar o papel de Dono | Elevação de privilégio | Média | CONFIRMADO (leitura) |
| R1-06 | Suporte em modo somente leitura baixa a exportação completa da conta (LGPD) | LGPD / privilégio da equipe | Média | CONFIRMADO (leitura) |
| R1-07 | Webhook de saída com janela de DNS rebinding | SSRF | Baixa | CONFIRMADO (leitura; já registrado como A-05) |
| R1-08 | Cota diária da IA conferida uma vez por pergunta, sem trava concorrente nem diferença por plano | Receita / IA | Baixa | CONFIRMADO (leitura) |
| R1-09 | Recursos do plano (`features`) não são aplicados no servidor | Receita | Baixa | HIPÓTESE (depende da política comercial) |
| R1-10 | `asPlatform()` no módulo MercadoFlow além das duas finalidades permitidas pelo CLAUDE.md | Isolamento / política | Baixa | CONFIRMADO (leitura) |
| R1-11 | Aviso do MercadoFlow: assinatura só do corpo, sem carimbo de tempo; id da entrega fora da assinatura | Webhook / replay | Baixa | HIPÓTESE |
| R1-12 | API conecta como superusuário do PostgreSQL; RLS depende só do `SET LOCAL ROLE`; colunas de senha visíveis ao papel `bipae_app` | Defesa em profundidade | Baixa | CONFIRMADO (leitura) |
| R1-13 | `roleId` de outra empresa aceito ao editar membro (chave estrangeira não passa pelo RLS) | Integridade | Baixa | FORTE INDÍCIO |
| R1-14 | Erros 500 registrados por inteiro no log (podem levar dados pessoais do PostgreSQL) | PII em log | Baixa | HIPÓTESE |
| R1-15 | IP público da VPS no compose do repositório público | Exposição de informação | Baixa | CONFIRMADO |

Não houve achado **Crítico**: não encontrei caminho, sem credencial, para ler dados de outro cliente ou mexer em dinheiro de terceiros.

---

### R1-01 — IP do cliente falsificável por `X-Forwarded-For` (Média, FORTE INDÍCIO)

- **Onde:** `apps/api/src/app.ts:395` (`new FastifyAdapter({ trustProxy: true, ... })`); `deploy/nginx/bipae.com.br.conf:26` e `apps/web/docker/nginx.conf:23` (`proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`, que **acrescenta** ao valor que o cliente mandou).
- **Raciocínio:** com `trustProxy: true` o Fastify confia em todos os saltos e usa como `request.ip` a entrada **mais à esquerda** do `X-Forwarded-For` (comportamento documentado do Fastify). Os dois nginx só acrescentam o IP real no fim. Quem manda `X-Forwarded-For: 1.2.3.4` aparece para a API como `1.2.3.4`. É FORTE INDÍCIO e não CONFIRMADO porque não executei.
- **O que depende do IP:** `@fastify/rate-limit` do login, cadastro, senha esquecida, convite e 2FA (`app.ts:410`, `auth.controller.ts:19`); `keyFailureRate` das chaves da API (`common/auth.ts:197`); limites do login do painel e dos webhooks; o IP gravado na auditoria do painel (`platform.guard.ts`, `admin.ip`).
- **Impacto:** com IP trocado a cada pedido, o limite por IP some. Continuam valendo os travamentos por e-mail (10 erros em 15 min, `auth.service.ts:442`), mas: (a) o caminho do R1-02 não tem esse travamento; (b) o "Esqueci a senha" vira bombardeio de e-mail sem limite (não há limite por e-mail em `forgotPassword`, `auth.service.ts:662`); (c) o IP na auditoria do painel pode ser forjado. Além disso, qualquer pessoa pode travar o login de outra por 15 min errando a senha dela 10 vezes (risco conhecido do travamento por e-mail).
- **Reprodução segura (ambiente de teste):** API atrás do `apps/web/docker/nginx.conf`; 11 `POST /v1/auth/signup` inválidos com o mesmo IP real e `X-Forwarded-For` diferente em cada um; esperado 429 no 11º; com a falha, nunca chega 429.
- **Correção:** `trustProxy` com o número exato de saltos (`trustProxy: 2`, host nginx + nginx do contêiner) ou a lista de redes dos proxies; e no nginx do contêiner usar `proxy_set_header X-Forwarded-For $http_x_forwarded_for;` repassando só o que o nginx do host montou, enquanto o do host faz `proxy_set_header X-Forwarded-For $remote_addr;` (sobrescreve). Acrescentar limite por e-mail em `forgotPassword` (ex.: 3 por hora).
- **Teste de aceite:** teste de integração do `createApp` com `inject` mandando `x-forwarded-for: a, b, c` e conferindo que `request.ip` é o salto confiável; teste de rate limit que troca o cabeçalho e ainda recebe 429.

### R1-02 — Aceitar convite adivinha a senha de qualquer pessoa sem o travamento por e-mail (Alta, CONFIRMADO por leitura)

- **Onde:** `apps/api/src/modules/auth/auth.service.ts:341-415` (`acceptInvite`), em especial `:362` (`verify(found.password_hash, input.password)`) e `:364` (`checkSecondFactor`), sem `checkFailures`/`recordFailure`; o login (`:499-523`) e a autorização de supervisor (`:486-497`) usam o travamento, este caminho não. Rota pública `POST /v1/auth/invites/:token/accept` (`auth.controller.ts:139-150`), só com o limite por IP.
- **Cadeia de ataque:** (1) o atacante cria uma conta grátis (`/auth/signup`), vira Dono e tem `admin.users`; (2) cria um convite **sem e-mail** (`team.service.ts` `createInvite`, `email: null`); (3) chama o aceite com o e-mail da vítima e senhas candidatas. Senha errada devolve 401 e **não consome o convite** nem conta tentativa; com o R1-01, o limite por IP também some. (4) Na senha certa, a vítima vira membro da empresa do atacante e a resposta traz uma **sessão da vítima** (`issueSession(invite.tenant_id, userId)` em `:414`). (5) Com essa sessão, `POST /v1/auth/switch-tenant` (`auth.service.ts:525-531`) troca para a empresa real da vítima, porque `userTenants` lista todas as empresas dela. Resultado: tomada da conta da vítima, sem passar pelo travamento por e-mail.
- **2FA:** se a vítima tem 2FA, o código também é testado aqui sem contador de erros (`checkSecondFactor` sem `recordFailure`). O espaço é de 10⁶ por janela de 30 s, então a 2FA ainda segura bem, mas sem nenhum freio do lado do servidor.
- **Efeito colateral:** a resposta diferencia "conta existe" (401 `invalid_login`) de "conta não existe" (400 "Informe o seu nome"), o que permite enumerar e-mails.
- **Severidade:** Alta. Exige só uma conta grátis, e o resultado é a tomada de conta de qualquer cliente com senha fraca.
- **Reprodução segura (ambiente de teste, contas fictícias):** conta A (vítima, senha conhecida pelo teste) e conta B (atacante). B cria convite sem e-mail; 30 aceites com o e-mail de A e senha errada devem dar 429 a partir do 11º; hoje dão 401 sempre. No 31º, com a senha certa, a resposta traz `accessToken` de A; `switch-tenant` para a empresa de A devolve 200.
- **Correção:** em `acceptInvite`, no ramo `found`, usar `checkCredentials`-like: `this.checkFailures(input.email)` antes, `this.recordFailure(input.email)` na senha errada **e** no código 2FA errado, `this.failures.delete` no acerto. Responder igual para conta existente e inexistente (pedir o nome só depois de validar o token, ou devolver erro genérico). Considerar exigir que o convite tenha e-mail quando a conta já existe, ou confirmação por e-mail para quem já tem conta.
- **Teste de aceite:** teste da API: 11 aceites errados com o mesmo e-mail devolvem 429 com a mensagem do travamento; o login comum desse e-mail também fica travado; acerto depois da janela funciona.

### R1-03 — Evento do caixa cancela qualquer venda e registra sangria sem conferir permissão, loja nem autorizador (Alta, CONFIRMADO por leitura)

- **Onde:** `apps/api/src/modules/sync/sync.controller.ts:32-35` (só exige `pos.sell`); `sync.service.ts:105` (confere só a loja do **caixa**); `:172-179` (`requireMember` confere só se o `operatorId` é membro, sem olhar se está ativo nem a permissão); `:188` (`actor = { userId: event.operatorId }`, o operador que o cliente declarou); `:284-310` (sangria: `authorizedBy` gravado como veio); `:460-510` (`sale.cancelled`: busca a venda só por id, sem conferir a loja dela, a permissão `pos.sale.cancel` do operador nem quem autorizou; pede o cancelamento da NFC-e na SEFAZ). O schema aceita `authorizedBy` como qualquer UUID (`packages/domain/src/events.ts:154`, `:197`).
- **Raciocínio:** quem tem só `pos.sell` (operador de caixa, inclusive restrito a uma loja) pode mandar por `POST /v1/sync/events`, com o próprio caixa, um evento `sale.cancelled` de **qualquer venda da empresa, de qualquer loja**, com `operatorId` = id do Dono e `authorizedBy` inventado. O servidor cancela a venda, devolve o estoque, estorna o crediário, pede o cancelamento da NFC-e e grava na trilha de auditoria **como se o Dono tivesse feito**. `sync_events` não tem coluna de quem enviou e `audit.record` recebe `actor` com o `operatorId` declarado, ou seja: **não sobra registro do usuário da sessão**.
- **Relação com o risco aceito A-02** (`docs/seguranca/asvs-n2.md:37`): o A-02 trata da atribuição a outro membro e diz que "a trilha de auditoria guarda o usuário da sessão que enviou". **O código não faz isso:** a mitigação declarada não existe. Este achado vai além do A-02: falta conferir permissão, autorizador e loja para cancelamento e sangria, que não são "venda" (a regra "a venda nunca é recusada" não se aplica a cancelar venda).
- **Impacto:** fraude interna clássica de PDV (recebe em dinheiro, cancela a venda, embolsa) com a culpa jogada em outra pessoa, e cancelamento fiscal indevido na SEFAZ. Fere a regra inegociável 8 do CLAUDE.md (trilha de ações sensíveis confiável).
- **Reprodução segura (ambiente de teste):** empresa com lojas L1 e L2, operador O (papel "Operador de caixa", só L1) e venda V feita no caixa da L2. O manda `sale.cancelled` de V pelo caixa da L1 com `operatorId` = Dono e `authorizedBy` = UUID aleatório. Hoje: evento aceito, V cancelada, auditoria `sale.cancelled` com `actor_id` = Dono.
- **Correção (sem quebrar o offline):**
  1. Gravar sempre `sent_by = ctx.userId` (e `api_key_id`/`impersonated_by`, se houver) em `sync_events` (migração nova) e em `data.enviadoPor` de toda auditoria vinda do sync.
  2. `sale.cancelled`: rejeitar (`Rejection`) quando `sale.storeId` não é a loja do caixa ou não está em `ctx.storeIds`.
  3. Conferir no servidor se o operador tem `pos.sale.cancel` ou se o `authorizedBy` é membro ativo com essa permissão (o mesmo vale para sangria, `pos.cash.withdrawal`, e desconto acima do limite). Para não recusar trabalho legítimo feito offline antes de uma troca de papel, aceitar o evento mas marcar `needs_review` e avisar o Dono, em vez de rejeitar.
  4. `requireMember` também deve exigir `memberships.active`.
- **Teste de aceite:** teste de integração do sync: o cenário acima é rejeitado ("Venda de outra loja") ou fica marcado para revisão; a auditoria mostra `enviadoPor` = O; `authorizedBy` inexistente gera marcação.

### R1-04 — Limites de plano de produtos e usuários burláveis (Média, CONFIRMADO por leitura)

- **Onde:** `apps/api/src/modules/account/limits.service.ts:48-57` (uso conta só `memberships.active = true` e `products.active = true`); `catalog.service.ts:117` (`assertCanAdd` só no `createProduct`); `catalog.service.ts:141-176` e `:241` (`updateProduct` grava `active: input.active` sem conferir limite); `team.service.ts:209-240` (`updateMember` grava `active` sem `assertCanAdd`).
- **Raciocínio:** (a) produtos: criar produtos com `active: false` nunca esbarra no limite (não entram na contagem), e depois o `PUT` com `active: true` ativa todos; (b) usuários: com o limite cheio, desativa-se um membro, cria-se outro, e reativa-se o primeiro. O plano Grátis (`0003_platform_saas.sql:41`: 3 usuários, 2.000 produtos) vira ilimitado. Lojas, empresas e caixas não têm caminho de reativação (`organization.service.ts` só revoga caixa).
- **Também:** contagem e inserção na mesma transação em READ COMMITTED não seguram pedidos simultâneos (dois cadastros em paralelo passam do limite por um). Efeito pequeno.
- **Impacto:** perda de receita (upgrade evitado), sem dano a terceiros.
- **Reprodução segura:** conta no plano Grátis com override `products: 2`; criar 2 ativos, criar o 3º com `active:false` (aceito), `PUT` com `active:true` (aceito; deveria dar 403 `plan_limit`).
- **Correção:** em `updateProduct`, quando `current.active === false && input.active === true`, chamar `assertCanAdd(tx, 'products')`; em `updateMember`, quando `active` passa a `true`, chamar `assertCanAdd(tx, 'users')`. Opcional: `select ... for update` na linha de `tenants` em `assertCanAdd` para serializar cadastros concorrentes.
- **Teste de aceite:** dois testes da API (produto reativado e membro reativado acima do limite devolvem 403 `plan_limit`).

### R1-05 — Quem tem `admin.users` pode desativar o Dono ou dar o papel de Dono (Média, CONFIRMADO por leitura)

- **Onde:** `apps/api/src/modules/team/team.service.ts:209-240` (`updateMember`: aceita qualquer `roleId` e `active`, só bloqueia mudar a si mesmo); compare com `:134` (`createInvite` recusa o papel de Dono, o que mostra a intenção) e `:44-50` (`updateRole` protege só o papel de Dono, mas `createRole` aceita qualquer lista de permissões).
- **Raciocínio:** no padrão só o Dono tem `admin.users` (`packages/domain/src/permissions.ts:43-48`), mas o Dono pode criar um papel personalizado com `admin.users` (ex.: "Sócio" ou "RH"). Quem tiver esse papel pode desativar o Dono (`active:false`) e tirá-lo da própria empresa, ou promover outra conta a Dono.
- **Impacto:** tomada da empresa por um funcionário com papel administrativo; o Dono só volta com o suporte do Bipaê.
- **Correção:** em `updateMember`, recusar quando o alvo tem papel `systemKey = 'owner'` e quem pede não é Dono, e recusar `roleId` de papel `owner` por quem não é Dono; garantir que sempre sobre ao menos um Dono ativo. Auditar como ação sensível.
- **Teste de aceite:** membro com papel personalizado `admin.users` recebe 403 ao desativar o Dono e ao atribuir o papel de Dono; o Dono continua podendo.

### R1-06 — Suporte em modo somente leitura baixa a exportação completa da conta (Média, CONFIRMADO por leitura)

- **Onde:** `apps/api/src/common/auth.ts:143-149` (sessão de suporte `ro` só bloqueia métodos diferentes de GET); `modules/account/account.controller.ts:28-35` (`GET /v1/account/export`, permissão `admin.users`, que a sessão de suporte herda do Dono); `modules/admin/admin-tenants.service.ts:515-575` (a personificação em modo leitura não exige `platform.tenants.manage`; o papel `support` tem `platform.support`, `packages/domain/src/platform.ts:126`).
- **Raciocínio:** um atendente do Bipaê (papel `support`) abre sessão somente leitura num cliente e baixa o ZIP com todas as tabelas: clientes, CPF, telefones, vendas, fornecedores. É uma extração em massa de dados pessoais que a função de suporte não precisa. Fica registrado na auditoria do cliente (`suporteBipae`) e na da plataforma (início da sessão), mas não é impedido.
- **Impacto LGPD:** minimização e necessidade (art. 6º, III); aumenta o estrago de uma conta de suporte comprometida.
- **Correção:** em `account.controller.ts` `export`, recusar quando `ctx.impersonatedBy` (403 "A exportação é só do próprio cliente"); revisar outras rotas de exportação em massa (`accountant-export`, `reports/export`, EFD) com a mesma regra.
- **Teste de aceite:** com token de suporte (`imp`, `ro`), `GET /v1/account/export` devolve 403; com token do Dono, 200.

### R1-07 — Webhook de saída com janela de DNS rebinding (Baixa, CONFIRMADO por leitura)

- **Onde:** `apps/api/src/modules/public-api/webhooks.service.ts:132-144` (resolve o DNS e confere) e `:171` (`fetch(e.url)` resolve de novo, sem `safeLookup`).
- **Raciocínio:** já registrado como A-05 em `docs/seguranca/asvs-n2.md:40`. Confirmo que continua aberto. O alcance é limitado: o endereço precisa ser `https`, e os serviços internos (Postgres, Redis, `mercadoflow-backend:8080`) falam texto puro, então o que sobra é um "varredor de portas" pela mensagem de erro (`lastError`) que o cliente vê.
- **Correção:** trocar `fetch` por `https.request` com `lookup: safeLookup` (como em `pix-api.ts:44-52`), mantendo `redirect` manual.
- **Teste de aceite:** teste unitário com `lookup` simulado que devolve primeiro IP público e depois `127.0.0.1`: a entrega falha com `EBLOCKED`.

### R1-08 — Cota diária da IA conferida uma vez por pergunta (Baixa, CONFIRMADO por leitura)

- **Onde:** `apps/api/src/modules/ai/ai.service.ts:243-270` (`guard` confere `usedToday < AI_DAILY_LIMIT` uma vez); `:740-800` (`ask` faz até `MAX_TOOL_ROUNDS + 1 = 6` chamadas ao provedor, `:50`); `:202-209` (a contagem é por chamada).
- **Raciocínio:** com 199 chamadas usadas, uma pergunta ainda faz até 6; pedidos em paralelo passam todos pelo `guard` antes de qualquer gravação. A cota é a mesma em todos os planos (`config.ts`, `AI_DAILY_LIMIT`), sem relação com o plano contratado. O histórico (`history`, até 4.000 caracteres por mensagem) vem do cliente; isso só afeta a própria conta (as ferramentas rodam com o `ctx` e o RLS do próprio cliente, e propor preço exige `catalog.price.write` e confirmação humana, `:617-651`), então não há vazamento entre clientes.
- **Hoje:** a IA está desligada em produção (sem `AI_API_KEY` no compose).
- **Correção:** reservar a cota antes de cada chamada (inserir a linha em `ai_requests` antes de chamar, ou contar dentro de `call`); limite por plano; limitar o tamanho total do `history`.
- **Teste de aceite:** com `AI_DAILY_LIMIT=1` e um provedor falso que pede ferramenta, uma pergunta faz no máximo 1 chamada.

### R1-09 — Recursos do plano não são aplicados no servidor (Baixa, HIPÓTESE)

- **Onde:** `apps/api/src/db/migrations/0003_platform_saas.sql:39-45` (planos com `features` como `reports` e `multistore`); nenhum `features.includes` na API nem nas telas (`grep` sem resultado).
- **Raciocínio:** se a política comercial é vender relatórios só a partir do Essencial, nada impede o plano Grátis de usar `/v1/reports`. Se `features` é só vitrine, não há falha. Fica como HIPÓTESE até o dono confirmar a política (não inventar regra comercial).
- **Correção, se for política:** `@RequireFeature('reports')` na guarda, lendo `plans.features` do cliente.

### R1-10 — `asPlatform()` no MercadoFlow além do permitido (Baixa, CONFIRMADO por leitura)

- **Onde:** `mercadoflow.accounts.ts:390,402,412,419,436,447`; `mercadoflow.encartes.ts:116,170`; `mercadoflow.market-sync.ts:257,291,298`; `mercadoflow.orders.ts:210`; `mercadoflow.pendings.ts:142`; `mercadoflow.pendings.helpers.ts:55`; `mercadoflow.sales.ts:208,293,317`.
- **Raciocínio:** o CLAUDE.md permite `asPlatform()` em `modules/mercadoflow` "só para esvaziar a outbox e tratar o webhook". Estes usos são rotinas entre clientes (sincronização diária, encartes, carga inicial). Os que li filtram por `tenantId` explicitamente (ex.: `market-sync.ts:261-275`), então não achei vazamento; mas sem RLS um filtro esquecido vaza entre clientes, e nenhum teste segura isso.
- **Correção:** trocar por `withTenant(db, { tenantId }, ...)` quando o tenant é conhecido, ou atualizar o CLAUDE.md com a exceção explícita e um teste de que cada função recebe e filtra o tenant.

### R1-11 — Aviso do MercadoFlow sem carimbo de tempo (Baixa, HIPÓTESE)

- **Onde:** `apps/api/src/modules/mercadoflow/mercadoflow.webhook.ts:69-78` (HMAC só do corpo); `:171-188` (o `x-mercadoflow-delivery`, usado para não repetir, não entra na assinatura).
- **Raciocínio:** quem capturar um aviso válido pode reenviá-lo com outro id de entrega e ele é tratado de novo (ex.: `connection.authorized` depois de um `revoked`). Capturar exige acesso ao tráfego interno (rede Docker) ou aos logs: HIPÓTESE de baixa probabilidade. O formato é contrato do MercadoFlow.
- **Correção:** propor no contrato um cabeçalho de tempo assinado (`t=...,v1=...`, como já se faz em `channels`) e janela de 5 min; enquanto isso, deduplicar também pelo hash do corpo.

### R1-12 — RLS depende só do `SET LOCAL ROLE`; colunas de senha visíveis ao papel da aplicação (Baixa, CONFIRMADO por leitura)

- **Onde:** `deploy/docker-compose.vps.yml` (`DATABASE_URL: postgres://bipae:...`, o mesmo `POSTGRES_USER` do contêiner, que é superusuário); `apps/api/src/db/client.ts:65-92` (`set local role bipae_app`/`bipae_platform`); `0001_init.sql:291-300` (política `user_visibility` em `users` + `grant select ... on all tables` para `bipae_app`, que inclui `password_hash` e `totp_secret`); tabelas `tenants`, `users`, `memberships`, `invites`, `company_certificates`, `company_icms_rules` sem `FORCE ROW LEVEL SECURITY` (resultado do script).
- **Raciocínio:** hoje todo acesso passa por `withTenant`/`asApp`/`asPlatform` (o `grep` por `this.db.select|insert|update|delete|execute` e `.transaction(` fora de `db/client.ts` não achou nada). Mas qualquer consulta futura fora desses invólucros roda como superusuário, sem RLS. E dentro do tenant uma consulta descuidada em `users` traz o hash da senha de colegas que também estão em outras empresas.
- **Correção:** criar um papel de login sem superusuário e sem `BYPASSRLS` para a API (migrações com um papel de dono separado); `revoke select (password_hash, totp_secret) on users from bipae_app` e ler essas colunas só pelas funções `security definer` que já existem; teste de arquitetura que falha se aparecer `db.select(` fora de `db/client.ts`.

### R1-13 — `roleId` de outra empresa aceito ao editar membro (Baixa, FORTE INDÍCIO)

- **Onde:** `apps/api/src/modules/team/team.service.ts:209-240` (não confere se `input.roleId` existe nesta empresa; `addMember` e `createInvite` conferem).
- **Raciocínio:** a chave estrangeira `memberships.role_id → roles.id` é conferida pelo PostgreSQL sem RLS, então um id de papel de outra empresa é aceito. Depois, na guarda (`common/auth.ts:98-104`), o `join` com `roles` sob RLS não acha o papel e a pessoa perde o acesso (401). Não dá privilégio, mas é um oráculo de existência de id e quebra o membro. Precisa conferir o schema da FK para fechar (não executado).
- **Correção:** `select` do papel com `withTenant` antes de atualizar, como em `addMember`.

### R1-14 — Erros 500 registrados por inteiro (Baixa, HIPÓTESE)

- **Onde:** `apps/api/src/common/errors.ts:124` (`this.logger.error(exception)` para status ≥ 500).
- **Raciocínio:** erros do PostgreSQL que não caem nas traduções (`errors.ts:95-110`) trazem `detail` com valores (ex.: e-mail, CPF). A resposta ao usuário é genérica (bom), mas o log da VPS pode guardar dado pessoal sem prazo de retenção definido.
- **Correção:** registrar só `code`, `constraint`, `table` e um id de correlação; política de retenção de log documentada.

### R1-15 — IP público da VPS no repositório público (Baixa, CONFIRMADO)

- **Onde:** `deploy/docker-compose.vps.yml:1` (comentário com o IP da VPS compartilhada).
- **Impacto:** facilita mirar a VPS (e as outras aplicações dela) sem passar pela Cloudflare. Sem segredo exposto.
- **Correção:** tirar o IP do comentário (o histórico continua com ele; avaliar firewall que só aceite a Cloudflare nas portas 80/443).

## 5. Controles verificados como corretos

- **JWT:** HS256 fixado em `algorithms`, `issuer` conferido, audiências separadas para cliente e equipe (`tokens.ts:25-26`, `:65-69`, `:95-99`); `JWT_SECRET` de desenvolvimento recusado em produção (`config.ts`, `loadConfig`); acesso de 15 min; permissões e situação da conta relidas a cada pedido (`auth.ts:90-128`), então revogação e suspensão valem na hora.
- **Renovação de sessão:** token opaco, só o hash SHA-256 no banco, comparação em tempo constante, rotação a cada uso e revogação da família inteira ao detectar reuso (`auth.service.ts:533-562`).
- **Senha:** argon2 (`@node-rs/argon2`), hash falso para e-mail inexistente (tempo igual, `:83`), lista de senhas comuns no `passwordSchema`, travamento por e-mail no login e na autorização de supervisor, aviso por e-mail ao mudar 2FA ou senha.
- **Recuperação de senha:** link de uso único, 1 hora, só o hash no banco, pedido novo invalida os antigos, troca encerra todas as sessões (`0055_password_resets.sql`), resposta igual para e-mail com e sem conta.
- **2FA:** semente cifrada com AES-256-GCM (`secrets.ts`), desligar exige código, suporte não mexe na 2FA do cliente, painel exige 2FA em produção sem exceção (`config.ts`, `platform.guard.ts`).
- **Painel super admin:** guarda que nega por padrão (rota sem permissão declarada só passa para `owner`), staff relido a cada pedido, modo leitura do suporte bloqueia escrita e troca de empresa.
- **RLS:** **todas** as tabelas com `tenant_id` têm `enable row level security` e política `tenant_id = app_tenant()` (diretamente ou pelos laços); a única exceção, `platform_audit_log`, tem `revoke all ... from bipae_app` (`0003_platform_saas.sql:136`). As tabelas da plataforma (`plans`, `platform_admins`, `admin_sessions`, `announcements`) estão fechadas para `bipae_app` (só `select` em `plans`). Sem acesso ao banco fora dos invólucros.
- **Injeção SQL:** nenhum `sql.raw` com dado do usuário (o único em produção, `maintenance.service.ts:369`, monta nomes de coluna constantes); identificadores dinâmicos com `sql.identifier` vindos do `information_schema`.
- **XSS:** sem `dangerouslySetInnerHTML`; o único `innerHTML` (`apps/web/src/platform.ts:65`) recebe o cupom de `receiptToHtml`, que escapa todo texto; CSP restrita (`script-src 'self' 'wasm-unsafe-eval'`, `frame-ancestors 'none'`), HSTS, nosniff, `X-Frame-Options DENY`.
- **CSRF/CORS:** autenticação por `Authorization: Bearer` (sem cookie), então não há CSRF clássico; CORS com lista explícita e `credentials: false`; `Cache-Control: no-store` em toda resposta.
- **SSRF:** URL do banco (API Pix) e da cobrança passam por `unsafeUrlReason` e `safeLookup` (fecha o rebinding), resposta limitada a 1 MB; endpoints de PSP fixos no código.
- **Uploads:** foto de produto com tamanho máximo, tipo conferido pelos bytes (`sniffImageType`), chave de armazenamento montada pelo servidor e conferida por `assertSafeKey` contra `..`; certificado A1 e senha selados.
- **Webhooks de pagamento:** resposta única para qualquer aviso; assinatura conferida com o segredo da loja (Mercado Pago HMAC, PagBank SHA-256, token da loja, Asaas) em tempo constante; **o aviso nunca confirma sozinho**: a cobrança é consultada na API do provedor com o tenant dela (`pix-charges.service.ts:320-350`); pagamento repetido ou cobrança já resolvida não muda nada. Canais com HMAC do corpo e chave de entrada por integração.
- **Simuladores de cobrança:** `simulate-pay` e boleto simulado só existem fora da produção (`billing-gateway.ts:161`, `billing-methods.ts:182,197`).
- **Chaves da API pública:** só o hash no banco, id do cliente dentro da chave (busca com RLS), escopos nunca maiores que as permissões atuais de quem criou, só nas rotas `@PublicApi`, limite por chave e por IP com chave errada.
- **Conta bloqueada:** suspensa, cancelada ou teste vencido só alcança `/v1/sync/events` (não perder vendas), `/v1/auth/me` e `/v1/account` (inclui a exportação LGPD).
- **Segredos no repositório:** nenhum arquivo `.env`, `.pem`, `.pfx`, `.key` versionado (só `.env.example` com marcadores); nenhum padrão de chave conhecido no HEAD nem no histórico; `pubkey` do atualizador é marcador; compose exige `JWT_SECRET`, `SECRETS_KEY` e `POSTGRES_PASSWORD` do `.env` da VPS (o A-07 está resolvido no compose).
- **LGPD:** exportação em ZIP sem colunas de segredo (`data-export.service.ts`, regex `SECRET_COLUMN`) e auditada; exclusão definitiva apaga todas as tabelas do cliente em ordem de chave estrangeira, as pessoas sem outra empresa e os arquivos (`maintenance.service.ts:660-725`).
- **Erros:** resposta 500 genérica em pt-BR, sem stack para o cliente.
- **Dependências:** `pnpm audit --prod`: 1 alta, ignorada com justificativa escrita (`GHSA-86w9-cpqp-85rv` em `node-forge`, só leitura de PKCS#12; `pnpm-workspace.yaml:13-17` e A-01). Overrides de `fastify` e `fast-uri` já aplicados.

## 6. Questões para o responsável jurídico/encarregado (não são achados técnicos)

- Prazo de retenção dos backups do PostgreSQL em relação aos 90 dias da exclusão definitiva (`ACCOUNT_PURGE_DAYS`): dado excluído continua no backup até ele vencer. Não verifiquei os backups (R5).
- Base legal e aviso ao titular para a exportação feita pela equipe do Bipaê (ver R1-06) e para o envio de dados ao MercadoFlow.
- Retenção de logs da API (ver R1-14).

## 7. Parecer final do R1

**REPROVADO para liberação sem ressalvas** enquanto R1-02 e R1-03 estiverem abertos. Os dois são **Altos e confirmados por leitura**: o R1-02 permite tomar a conta de qualquer cliente com senha fraca a partir de uma conta grátis, contornando o travamento que o próprio projeto declarou (F7-02, ASVS 2.2.1); o R1-03 permite fraude no caixa e cancelamento fiscal com a autoria falsificada, e a mitigação registrada no A-02 não existe no código. As duas correções são pequenas e locais (`auth.service.ts` e `sync.service.ts`, mais uma migração para `sent_by`). O R1-01 (IP falsificável) deve ir junto, porque agrava o R1-02 e anula os limites por IP.

Os demais (R1-04 a R1-06 Médios, R1-07 a R1-15 Baixos) podem entrar como ressalvas no backlog com teste de aceite.

A base de segurança é **boa**: isolamento por RLS completo, autenticação e sessões bem feitas, webhooks de pagamento que nunca confiam no aviso, SSRF tratado na API Pix, segredos fora do repositório e LGPD com exportação e exclusão de fato. Este parecer vem só de leitura: nenhum achado foi reproduzido em execução, e a aprovação final depende de rodar os testes de aceite propostos num ambiente de teste.
