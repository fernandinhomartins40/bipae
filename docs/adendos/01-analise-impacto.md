# Adendo 01 — Análise de impacto (PDV web + desktop)

> 12/10/2026 · Status: **aguardando aprovação**. Nenhum código foi alterado (ainda não existe código).

## 1. Estado atual do projeto

| Item | Situação |
|---|---|
| Fase | **Fase 0 concluída** (só documentação), aguardando aprovação. Fase 1 não começou |
| Código | **Nenhum.** Repositório tem apenas `docs/`, `README.md`, `CLAUDE.md`, `CHANGELOG.md` |
| Commits | **Nenhum.** Arquivos da Fase 0 estão no stage; o commit falhou por falta de identidade do Git (`user.name`/`user.email`) |
| Stack definida (em ADRs propostas) | Web: React + Vite, PWA (ADR-0005). Desktop: **Tauri 2** embalando o mesmo build (ADR-0005). Banco local: SQLite nativo no Tauri e **SQLite WASM + OPFS** no navegador (ADR-0004). API: NestJS/Fastify + PostgreSQL com RLS (ADR-0002/0003) |
| Testes | Nenhum (não há código) |

**Consequência:** o adendo chega **antes da Fase 1**. Não há código que possa quebrar, nem retrabalho de implementação. Pela seção 9 do adendo, ele é incorporado direto nas Fases 1 e 2, **sem precisar de uma "Fase 2.5"**. O impacto é em documentação e no escopo/esforço das fases.

## 2. O que já atende ao adendo

| Requisito do adendo | Onde já está previsto | Atende? |
|---|---|---|
| Um código, dois alvos; Tauri no desktop; PWA no web | ADR-0005 ("Um PDV, duas embalagens") | ✅ Sim, mas as telas estavam em `apps/web`, não em pacotes |
| Regras de negócio em pacotes TS puros (venda, promoções, fiscal) | ADR-0001 (`domain`, `fiscal`, `promotions`), ADR-0006 | ✅ Sim |
| Adaptadores de periféricos atrás de interface | ADR-0005 (interface `Peripherals` única) | 🟡 Parcial: uma interface genérica, não os *ports* separados do adendo |
| Nuvem como fonte da verdade; fila de eventos idempotente; mesmo protocolo | ADR-0004 | ✅ Sim |
| Série de NFC-e própria por terminal | ADR-0004 ("faixa de numeração por caixa") | ✅ Sim; falta o cadastro de terminais/séries na retaguarda |
| A1 cifrado no servidor (KMS) | ADR-0010 | ✅ Sim |
| A1 no desktop (cofre do SO) e A3 via PKCS#11 | ADR-0010, ADR-0005 | ✅ Sim |
| Ponte do navegador para periféricos | ADR-0005 citava "ponte para um PDV Tauri na rede local" | 🟡 Só a ideia; falta o Conector com pareamento, token e restrição de origem |
| Mensagem amigável quando o recurso não existe na plataforma | PRD §7 (erros com causa e solução) | 🟡 Princípio geral; falta o padrão "capacidade indisponível + como resolver" |

## 3. O que precisa ser ajustado

Estimativas em **dias de trabalho de implementação** (agente + revisão), adicionados ao plano original. São ordens de grandeza para comparar itens, não prazo comprometido.

| # | Ajuste | Onde | Esforço |
|---|---|---|---|
| A1 | **Telas em pacotes:** mover PDV e ERP de `apps/web` para `packages/pdv-core` (estado, fluxos, casos de uso do PDV), `packages/pdv-ui` e `packages/erp-ui` (telas), `packages/ui` (design system). `apps/web` e `apps/desktop` viram cascas finas | ADR-0001, ADR-0012 | P (1–2 d), só estrutura na Fase 1 |
| A2 | **Ports nomeados:** trocar `Peripherals` por `StoragePort`, `PrinterPort`, `ScalePort`, `CashDrawerPort`, `TefPort`, `CertificatePort`, `UpdaterPort`, `NotificationPort` + registro de capacidades (`capabilities()`) que a UI consulta | ADR-0012 | P (1–2 d) |
| A3 | **Implementações por alvo** dos ports + simuladores para teste | Fase 2 (impressora, gaveta, balança, storage); Fase 3 (certificado); Fase 6 (TEF real) | M (5–8 d, distribuídos) |
| A4 | **Bipaê Conector:** modo bandeja do app desktop, servidor WebSocket local, pareamento por código, token por terminal, checagem de origem, lista fechada de comandos; botão "instalar Conector" no PDV web | Fase 2 (impressora/gaveta/balança simuladas), Fase 3 (A3), Fase 6 (TEF) | M–G (6–10 d) |
| A5 | **Cadastro de terminais e séries de NFC-e** na retaguarda (alocação automática de série por terminal, bloqueio de reuso) | Fase 1 (cadastro), Fase 3 (uso fiscal) | P (2–3 d) |
| A6 | **Assinatura por plataforma:** servidor (web online), local (desktop), opcional no navegador com chave **não exportável** do WebCrypto (web offline, só com autorização do lojista); fila "nota a emitir quando voltar a conexão" com alerta de prazo | Fase 3 | M (4–6 d) |
| A7 | **Versionamento de API e versão mínima:** prefixo `/v1`, cabeçalho de versão do cliente, resposta "atualize" que **nunca recusa receber vendas pendentes** | Fase 1 (API), Fase 2 (sync) | P (1–2 d) |
| A8 | **Auto-update do desktop:** plugin updater do Tauri com assinatura, canais estável/beta, instalação só com caixa fechado ou ocioso, backup do banco local antes de migrar | Fase 2 | M (3–5 d) |
| A9 | **Pipeline de distribuição:** CI com matriz Windows/Linux (macOS depois), instaladores `.msi`/`.exe`, `.deb`, AppImage, passo de assinatura pronto e desligado até existir certificado, publicação de canais, página `bipae.com.br/download` | Fase 1 (build dos dois alvos no CI), Fase 2 (instaladores e canais) | M (4–6 d) |
| A10 | **Deploy web** em `app.bipae.com.br` e `homolog.bipae.com.br` com HTTPS, CSP e cabeçalhos | Fase 1–2; depende da escolha de hospedagem (custo, ver §6) | P–M (2–4 d) |
| A11 | **Testes do adendo:** mesma suíte E2E nos dois alvos; dois terminais (web + desktop) offline ao mesmo tempo; update com fila pendente; Conector com impressora e balança simuladas | Fase 2 | M (5–7 d) |
| A12 | **`docs/plataformas.md`** (diferenças, instalação, suporte) | Fase 2 (primeira versão), atualizar a cada fase | P (1 d) |

**Total adicionado:** cerca de **35–55 dias** de trabalho, espalhados pelas Fases 1, 2, 3 e 6. Itens fora das fases 1–2 (A6, TEF do Conector) entram nas fases onde a funcionalidade nasce.

## 4. Divergência a decidir: `StoragePort` na web

O adendo cita "IndexedDB (web) / SQLite (desktop)". A ADR-0004 propôs **SQLite WASM + OPFS** no navegador, com IndexedDB só como fallback.

| | SQLite WASM + OPFS (recomendado) | IndexedDB |
|---|---|---|
| Schema e consultas | **Os mesmos** do desktop (um só `packages/local-db`) | Duas implementações de consultas e migrações |
| Relatórios locais, busca por nome, joins | SQL completo | Índices manuais, mais lento em 100 mil SKUs |
| Risco de divergência entre alvos | Baixo | Alto: bugs que só acontecem em um alvo |
| Suporte de navegador | Chrome, Edge, Firefox e Safari atuais suportam OPFS; navegadores antigos caem no fallback | Universal |
| Tamanho | ~1 MB de WASM, em cache após o primeiro acesso | Nenhum |

Ambas as opções ficam atrás do `StoragePort`, então o requisito do adendo é atendido nos dois casos. **Recomendação:** SQLite WASM como implementação web principal, IndexedDB como fallback. Preciso da sua confirmação.

## 5. Riscos

Como não há código, **não há risco de quebrar algo que funciona**. Os riscos são técnicos e de prazo:

| Risco | Impacto | Mitigação |
|---|---|---|
| **Navegadores pedindo permissão para acessar o Conector local.** O Chrome (desde a versão 142) mostra um aviso de "Acesso à rede local / Apps no dispositivo" quando um site público acessa `localhost`. Há relatos (não confirmados oficialmente) de que isso passou a valer também para WebSocket no Chrome 147. Safari tem regras mais restritas para conexões locais a partir de páginas HTTPS | O operador vê um pedido de permissão; se negar, periféricos não funcionam | Tela de instalação explica e guia o "Permitir" uma vez; detecção do bloqueio com instrução; política de empresa (Chrome Enterprise) documentada para redes; validar Safari/iPad cedo. Plano B: Conector expõe também `https://` local com certificado próprio instalado pelo instalador |
| **Conector como superfície de ataque** (outro site ou programa usando a impressora/gaveta/certificado) | Gaveta aberta, impressão indevida, uso do A3 | Checagem do cabeçalho `Origin` (só `app.bipae.com.br` e `homolog`), pareamento com código exibido no Conector, token por terminal revogável, lista fechada de comandos, PIN do A3 digitado só na janela do Conector, nunca no navegador |
| **Certificado A1 guardado no navegador** (web offline) | Uso indevido se o dispositivo ou a página forem comprometidos | Opt-in explícito do dono; chave importada como **não exportável** no WebCrypto (nem um script malicioso consegue copiá-la, só usar enquanto estiver na página); desligável remotamente pela retaguarda; registro em auditoria |
| **E2E no desktop:** o `tauri-driver` (WebDriver) funciona em Windows e Linux, **não em macOS** | Testes desktop no macOS só manuais por enquanto | Escrever os cenários uma vez (camada de cenários compartilhada) e rodá-los com Playwright (web) e WebdriverIO + tauri-driver (desktop); macOS fica para quando o alvo entrar |
| **Atualização do desktop corromper o banco local** com vendas pendentes | Perda de vendas, que é inaceitável | Fila no SQLite fora do pacote do app; backup automático antes de migrar; migrações transacionais e só para frente; servidor aceita eventos das versões antigas suportadas; teste automatizado obrigatório (A11) |
| **Séries de NFC-e por terminal:** séries 000–889 são de uso livre (890–899 são reservadas para nota avulsa); a regra antiga de série exclusiva 890–989 para contingência foi revogada (Ajuste SINIEF 26/19), mas isso precisa ser confirmado no MOC atual | Rejeição por série inválida | Alocação só em 1–889, configurável; nova dúvida **D-010** em `docs/fiscal/duvidas.md` |
| **Custos novos** | Orçamento | Ver §6: nada é contratado sem aprovação |
| **Escopo maior da Fase 2** | Prazo | Conector entra na Fase 2 só com impressora, gaveta e balança (simuladas e reais); A3 e TEF via Conector nas Fases 3 e 6 |

## 6. Decisões e custos que dependem de você

1. **`StoragePort` web:** SQLite WASM (recomendado) ou IndexedDB (§4).
2. **Certificado de assinatura de código para Windows:** opções comuns são um certificado OV/EV de autoridade certificadora ou o serviço de assinatura em nuvem da Microsoft (Azure Artifact Signing, antigo Trusted Signing). Sem ele o instalador funciona, mas o Windows SmartScreen mostra aviso. O pipeline fica pronto e desligado até você adquirir.
3. **macOS:** exige conta Apple Developer (anual) para assinar e notarizar. Proposta: deixar para depois de Windows e Linux, como o adendo sugere.
4. **Hospedagem** de `app.bipae.com.br`, `homolog.bipae.com.br`, API e banco: escolha de provedor e custo. Proponho apresentar opções na abertura da Fase 1. Até lá, tudo roda via `docker compose`.
5. **Domínio e DNS** de `bipae.com.br`: confirmar que você tem acesso.

## 7. Ordem proposta das mudanças

Tudo encaixado no plano, sem Fase 2.5:

**Agora (após sua aprovação desta análise, só documentação)**
1. Aceitar ADR-0012; marcar ADR-0005 como substituída e atualizar ADR-0001 (nova estrutura de pacotes) e ADR-0004 (StoragePort).
2. Atualizar PRD (§5 e §6), `TAREFAS.md`, `CLAUDE.md` e acrescentar D-010.
3. Commit (depois que a identidade do Git estiver configurada).

**Fase 1 — Fundação (ampliada)**
4. Monorepo com a nova estrutura: `apps/web` e `apps/desktop` como cascas; `packages/pdv-core`, `pdv-ui`, `erp-ui`, `ui`, `platform` (interfaces dos ports + simuladores).
5. CI com build e testes dos dois alvos (Windows e Linux) a cada PR, já no primeiro commit de código.
6. API `/v1` com cabeçalho de versão do cliente e política de versão mínima.
7. Cadastro de terminais (web/desktop) e alocação de série de NFC-e.

**Fase 2 — PDV MVP offline-first (ampliada)**
8. `StoragePort` (SQLite nativo + SQLite WASM) e sincronização idênticos nos dois alvos.
9. `PrinterPort`, `CashDrawerPort`, `ScalePort` diretos no desktop e via navegador/Conector na web; mensagens de capacidade indisponível.
10. Bipaê Conector (bandeja, pareamento, token, origem) com impressora e balança simuladas.
11. Auto-update com canais e instaladores; pipeline de assinatura pronto e desligado.
12. Testes do adendo (A11) e `docs/plataformas.md`.

**Fase 3 — Fiscal:** `CertificatePort` nas três formas (servidor, local, WebCrypto opcional), A3 via Conector, fila de emissão pós-conexão com alerta de prazo.

**Fase 6 — Integrações:** `TefPort` real (direto e via Conector).

## Fontes

- [Chrome Developers – Local Network Access](https://developer.chrome.com/blog/local-network-access)
- [Dynamsoft – Chromium 142 Local Network Access](https://www.dynamsoft.com/web-twain/docs/faq/chromium-142-local-network-access-issue.md)
- [Visualware – Chrome LNA e WebSocket](https://myconnectionserver.visualware.com/support/v11/userguide/chrome-lna-websocket)
- [Webmania – Séries reservadas da NF-e](https://ajuda.webmania.com.br/pt-BR/articles/12680801-series-reservadas-da-nota-fiscal-eletronica-nf-e)
- [Projeto ACBr – série específica de contingência dispensada](https://www.projetoacbr.com.br/forum/topic/55916-nfc-e-com-s%C3%A9rie-espec%C3%ADfica-para-conting%C3%AAncia-n%C3%A3o-precisa-mais-fazer/)
