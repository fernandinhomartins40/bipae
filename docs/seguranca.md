# Segurança: revisão OWASP ASVS nível 2

Revisão interna feita em 18/10/2026 (tarefa F7-02.a), com base no OWASP Application Security Verification Standard 4.0.3, nível 2.

O pentest externo e o teste com pessoas de fora são a tarefa F7-02.b, que depende do item E15.

**Como ler:**
- **Atende:** o controle já existia e foi conferido no código.
- **Corrigido:** o controle entrou nesta revisão, com teste automatizado.
- **Pendente:** o que falta, com o motivo.

## V1 Arquitetura

- **Atende.** Isolamento por conta no banco: toda tabela de negócio tem `tenant_id` e política RLS, e a API usa o papel `bipae_app`, que não passa por cima da RLS (ADR-0003).
- **Atende.** O papel da plataforma (`bipae_platform`) só aparece no painel do Bipaê, na manutenção e na integração MercadoFlow.
- **Atende.** Os segredos (certificado A1, segredo do TOTP, tokens) ficam selados (`SecretBox`) ou só como hash, nunca em texto no banco, no log ou em teste versionado.

## V2 Autenticação

- **Atende.** As senhas são guardadas com Argon2 (`@node-rs/argon2`).
- **Atende.** Login com e-mail inexistente gasta o mesmo tempo que com senha errada (hash falso) e dá a mesma resposta.
- **Atende.** Limite de tentativas por IP nas rotas de credencial (`LOGIN_RATE_LIMIT_PER_MINUTE`).
- **Atende.** Verificação em duas etapas (TOTP) opcional. Desligar pede um código atual.
- **Atende.** O link de senha nova é de uso único, vale 1 hora e encerra todas as sessões.
- **Corrigido (2.1.7).** Senha muito comum é recusada, e também a que repete o e-mail ou o nome da pessoa. Continua sem regra de composição (2.1.9). A lista fica no código (`packages/domain/src/password-policy.ts`), sem consulta externa.
- **Corrigido (2.2.1).** Limite também por e-mail: 10 erros em 15 minutos travam o e-mail por 15 minutos, mesmo vindo de vários IPs. Vale para e-mail sem conta, para não revelar quem é cliente.
  - O controle fica na memória da API. Com mais de uma instância, passa para o Redis.
- **Corrigido (2.2.3).** A pessoa recebe um e-mail quando a senha é trocada ou quando a verificação em duas etapas é ligada ou desligada.
- **Pendente (2.1.7, completo).** Conferir a senha contra bases de senhas vazadas (como a da Have I Been Pwned) manda parte do hash para terceiros. Fica para decisão com o termo de uso (item E7).

## V3 Sessões

- **Atende.** Token de acesso curto (15 minutos) e token de renovação girado a cada uso.
- **Atende.** Reusar um token de renovação antigo derruba toda a família de sessões e entra na auditoria.
- **Atende.** Sair encerra a sessão no servidor. Trocar a senha encerra todas.
- **Atende.** Os tokens vão no cabeçalho `Authorization`, não em cookie, então não há CSRF nas rotas da API.

## V4 Controle de acesso

- **Atende.** Toda rota exige login, salvo as marcadas `@Public()`, e cada uma declara a sua permissão (`@RequirePermission`).
- **Atende.** As ações sensíveis entram na trilha de auditoria imutável, com hash encadeado.
- **Atende.** Testes provam que o operador de caixa não exporta clientes, não manda campanha e não usa o assistente.

## V5 Validação, sanitização e codificação

- **Atende.** Toda entrada passa pelos schemas Zod de `@bipae/domain`.
- **Atende.** As consultas ao banco são parametrizadas (Drizzle), sem SQL montado com texto do usuário.
- **Atende.** O XML de compra é lido sem resolver entidades externas (sem XXE).
- **Atende.** O corpo dos e-mails escapa o HTML.
- **Atende (5.2.6, SSRF).** Os webhooks recusam endereços de rede interna, inclusive depois de resolver o DNS.
- **Atende.** O assistente de IA nunca recebe SQL livre: só chama relatórios tipados, com o escopo da conta.

## V7 Erros e registros

- **Atende.** As mensagens de erro para o usuário são em português e não mostram a pilha nem detalhes internos.
- **Atende.** O log não leva senha, token nem o conteúdo de e-mails com link de acesso.
- **Atende.** Erro do provedor de IA não registra o corpo da resposta, que pode ecoar o pedido.

## V8 Proteção de dados

- **Corrigido (8.2.1).** Toda resposta da API sai com `Cache-Control: no-store`, para dados da conta não ficarem no cache do navegador nem de proxy.
- **Atende.** A exportação e a exclusão definitiva das contas canceladas seguem a LGPD (P-03).
- **Atende.** As campanhas por e-mail vão só para quem aceitou e têm descadastro sem login.
- **Atende.** O assistente de IA não envia dado pessoal de cliente ao provedor.

## V9 Comunicação

- **Atende.** HTTPS com HSTS (`max-age=31536000; includeSubDomains`). O HTTP redireciona para HTTPS.
- **Atende.** A conversa com a SEFAZ e com a Sefin Nacional usa TLS mútuo com o certificado da empresa.

## V10 Código malicioso e dependências

- **Atende.** O lockfile é congelado na CI (`--frozen-lockfile`), e as imagens publicadas são fixadas por digest.
- **Pendente.** Rodar `pnpm audit` na CI com um limite de gravidade. Vai junto com o pentest (F7-02.b).

## V12 Arquivos

- **Atende.** O corpo dos pedidos tem limite (2 MB na API, 4 MB no nginx).
- **Atende.** Upload de fotos e arquivos ainda não existe; depende do item E12.

## V13 API

- **Atende.** CORS só para as origens configuradas (`CORS_ORIGINS`), sem credenciais de cookie.
- **Atende.** A API pública usa chaves com escopo e os webhooks são assinados com HMAC.
- **Corrigido.** O descadastro de campanha, rota pública, ganhou o mesmo limite de tentativas das rotas de login.

## V14 Configuração

- **Atende.** Cabeçalhos de segurança no nginx da aplicação e no helmet da API:
  - CSP restrita (`default-src 'self'`, `frame-ancestors 'none'`);
  - `X-Frame-Options DENY`, `nosniff`, `Referrer-Policy` e `Permissions-Policy`.
- **Atende.** O deploy entra na VPS com uma chave só do Bipaê e com a chave do servidor fixada.

## O que fica para a F7-02.b (item E15)

- Pentest externo com escopo e regras combinadas.
- `pnpm audit` na CI.
- Decisão sobre a consulta de senhas vazadas.
- Limite de tentativas por e-mail no Redis, quando houver mais de uma instância da API.
