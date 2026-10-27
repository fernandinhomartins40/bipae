# Revisão de segurança OWASP ASVS nível 2 — segunda passada (F7-02.c)

Feita em 27/10/2026 sobre a API (`apps/api`), o sync do caixa e a web, com o OWASP ASVS 4.0.3 nível 2 como régua. Ela continua a primeira passada (F7-02.a, [../seguranca.md](../seguranca.md)): lá estão os capítulos já conferidos; aqui estão só os achados novos, o que foi corrigido (cada correção tem teste em `apps/api/test/security.test.ts` que falharia antes) e o que ficou pendente, com gravidade.

O pentest externo continua sendo a F7-02.b (item E15).

**Gravidade:** Alta (explorável por quem está de fora ou derruba o isolamento), Média (exige conta, sessão roubada ou condição especial), Baixa (endurecimento).

## Como foi feito

- Leitura do código dos pontos de entrada: `AuthGuard`, `PlatformGuard`, controladores e serviços de autenticação, sync, API pública, webhooks, pagamentos, exportações e upload de foto.
- Varredura automática: toda rota sem `@RequirePermission`, todo `asPlatform`, toda consulta sem `withTenant`/`asApp`, todo `sql.raw`/`sql.identifier`, todo `fetch`/`https.request`, comparação de segredos, funções `security definer`.
- `pnpm audit --prod`.

## Achados corrigidos

| # | Gravidade | ASVS | Achado | Correção |
|---|-----------|------|--------|----------|
| C-01 | Alta | 5.2.6 | **SSRF nos webhooks**: `isPrivateAddress` não reconhecia IPv4 escrito em IPv6 (`[::ffff:7f00:1]`, que o Node normaliza assim), NAT64, 6to4, `fe90::`–`febf::`, multicast, `198.18/15`, `192.0.0/24` e faixas reservadas. Um endereço desses passava pela checagem e chegava na rede interna da VPS. | Nova implementação em `common/ssrf.ts` (expande o IPv6 e olha o IPv4 embutido); na dúvida, recusa. |
| C-02 | Alta | 5.2.6 | **SSRF na API Pix do banco**: `baseUrl` e `tokenUrl` são digitados pelo cliente e a API os chamava (com o certificado dele) sem olhar o destino; a mensagem de erro de conexão ainda servia de "varredor de portas". | Cadastro recusa IP/nome interno, usuário e senha no endereço (`unsafeUrlReason`); a chamada usa `safeLookup`, que recusa nome que resolve para rede interna na hora de conectar (fecha o DNS rebinding); resposta limitada a 1 MB. |
| C-03 | Média | 2.2.1 | **Autorização de supervisor e troca de operador** (`/auth/authorize`, `/auth/operator`) conferiam senha de outra pessoa sem o travamento por e-mail: uma sessão de caixa roubada adivinhava a senha dos colegas, só limitada por IP. | Mesmo contador do login (10 erros em 15 minutos), compartilhado. |
| C-04 | Média | 2.8.4 | **Código do 2FA** ao ligar ou desligar sem limite por conta (1 milhão de códigos, só limite por IP). | Travamento por usuário depois de 10 erros. |
| C-05 | Média | 2.2.1 / 2.8 | **Login da equipe do painel** sem travamento por e-mail nem para o código TOTP (só por IP): quem soubesse a senha de um membro da equipe podia testar códigos de vários IPs. | Mesmo travamento, com chave própria (`admin:`). |
| C-06 | Média | 3.3 / 7.1 | **Sessão de suporte** (`impersonate`) podia chamar `/auth/switch-tenant` e receber um token comum, sem a marca do suporte na auditoria. | A rota recusa sessão de suporte (403). |
| C-07 | Média | 5.2 | **Injeção de fórmula em CSV**: nome de cliente ou produto como `=HYPERLINK(...)` virava fórmula no Excel nas exportações. | `toCsv` põe `'` na frente de texto que começa com `= + - @ TAB CR`; número negativo fica igual. |
| C-08 | Média | 13.2 / 11.1 | **Chave da API pública** sem limite de pedidos e sem freio para chave errada. | 600 pedidos por minuto por chave e 30 chaves erradas por minuto por IP (429). |
| C-09 | Baixa | 11.1 | `refresh`, convite (`GET /auth/invites/:token`) e aviso do MercadoFlow sem limite por IP. | Limites de 120/min, 10/min e 600/min. |
| C-10 | Média | 14.1 | **Produção com 2FA da equipe desligado**: `PLATFORM_REQUIRE_TOTP=false` valia também em produção. | `loadConfig` recusa subir assim em produção. |
| C-11 | Baixa | 5.1 | Cabeçalho `x-terminal-id` entrava no contexto sem ser validado como UUID. | Só entra se tiver formato de UUID. |
| C-12 | Média | 10.3 | **Dependências**: `nodemailer` 10.0.14 (3 avisos), `fastify` 5.12.5 (1), `fast-uri` (8 avisos, via ajv). | `nodemailer` 10.1.4, `fastify` 5.12.7, `fast-uri` forçado para 3.1.9/4.2.3 (`pnpm-workspace.yaml`). `pnpm audit --prod --audit-level=high` entrou na CI. |

## Pendências e riscos aceitos

| # | Gravidade | Assunto | Situação |
|---|-----------|---------|----------|
| A-01 | Média | `node-forge` (GHSA-86w9-cpqp-85rv, "alta"): aceita elementos a mais em `DigestAlgorithm` ao **conferir** assinatura RSA PKCS#1 v1.5. O Bipaê só usa o `node-forge` para **ler** o PKCS#12 do certificado A1, nunca para conferir assinatura, então a falha não é alcançável. Não há versão corrigida. | Ignorada no `pnpm audit` (`auditConfig.ignoreGhsas`) com o motivo escrito. Reavaliar a cada auditoria; trocar por leitura própria do PKCS#12 se a falha passar a atingir o uso real. |
| A-02 | Média | **Eventos do caixa dizem quem é o operador** (`operatorId`) e o servidor só confere que a pessoa é da empresa. Quem tem `pos.sell` poderia atribuir um evento a outro membro (por exemplo, um cancelamento ao dono). Conferir a permissão do operador no servidor rejeitaria para sempre vendas feitas offline antes de uma troca de papel, e "a venda nunca é recusada" é regra do produto (ADR-0004). | Risco aceito. A trilha de auditoria guarda o usuário da sessão que enviou. Avaliar um campo `sentBy` visível no relatório de auditoria na F7-02.b. |
| A-03 | Média | Limites de tentativas (login, supervisor, 2FA, painel, chave da API) ficam na **memória** da API. Com mais de uma instância o limite vale por instância e some a cada reinício. | Já registrado em F7-02.b: mover para o Redis quando houver mais de uma instância. |
| A-04 | Baixa | O token de renovação do navegador fica no `localStorage` (via `PreferencesPort`). Um XSS o leria. A CSP é restrita (`script-src 'self'`, sem `unsafe-inline` em script), não há `innerHTML` com dado do cliente (o cupom escapa todo o texto) e o token gira a cada uso com detecção de reuso. | Risco aceito. Alternativa (cookie `HttpOnly` + CSRF) muda o contrato do PDV offline; decidir na F7-02.b. |
| A-05 | Baixa | O webhook de saída confere o endereço antes de enviar; o `fetch` do Node resolve o DNS de novo (janela de DNS rebinding). Com a nova regra o endereço literal em IPv6 está coberto, mas o nome ainda tem essa janela. | Trocar `fetch` por `https.request` com `safeLookup` (já existe) na próxima mexida em `webhooks.service.ts`. |
| A-06 | Baixa | Senha vazada (HIBP): decisão do dono com o termo de uso (E7). | Sem mudança desde a F7-02.a. |
| A-07 | Baixa | `SECRETS_KEY` cai para `JWT_SECRET` quando não definida; trocar o JWT_SECRET perderia os segredos selados. | Definir `SECRETS_KEY` própria na VPS antes do primeiro cliente real. |
| A-08 | Baixa | O `resumo.csv` da exportação para o contador monta o CSV à mão, sem o `neutralizeFormula`. Só tem números de documento, chaves e valores (nada digitado pelo cliente). | Sem ação; revisar se entrar nome de pessoa. |
| A-09 | Baixa | Modos `simulator` de Pix e cartão existem como valor de configuração da loja também em produção; só afetam a própria conta. | Esconder da tela em produção na Fase 8. |

## Conferido sem achado

- **Isolamento por empresa:** nenhum serviço usa o banco fora de `withTenant`/`asApp`/`asPlatform`; `asPlatform` só aparece nos locais permitidos (admin, manutenção, MercadoFlow, webhooks de pagamento, seed, admin-cli e o atalho de desenvolvimento, que é recusado em produção). O teste de RLS cobre toda tabela de negócio.
- **Rotas:** toda rota sem `@RequirePermission` é pública de propósito (login, webhooks assinados, descadastro) ou fala só dos dados da própria pessoa (`/auth/me`, 2FA, `/account`).
- **SQL:** parametrizado em todo lugar; `sql.raw` e `sql.identifier` só recebem constantes do código. As funções `security definer` fixam `search_path`.
- **Segredos:** comparações de assinatura e token com `timingSafeEqual`; colunas de segredo seladas (`SecretBox`) ou só com hash; o log não leva corpo de pedido.
- **Upload:** a foto do produto é conferida pelos primeiros bytes (não pelo que o cliente diz), tem limite de 200 KB, é servida com o tipo detectado e `nosniff`, e entra na auditoria.
- **Web:** CSP restrita, sem `eval`, sem HTML de dado do cliente sem escape, service worker não guarda `/v1/`.
