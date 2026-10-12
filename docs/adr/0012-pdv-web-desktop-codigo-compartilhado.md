# ADR-0012 — PDV web + desktop com código compartilhado

**Status:** aceita (12/10/2026) · **Data:** 12/10/2026 · **Substitui:** ADR-0005 · **Origem:** [Adendo 01](../adendos/01-online-desktop.md)

## Contexto
O Adendo 01 torna o **Bipaê Online** (navegador, `app.bipae.com.br`) e o **Bipaê Desktop** (instalável; Windows primeiro, depois Linux e macOS) alvos de primeira classe, com as mesmas telas, a mesma conta e terminais dos dois tipos na mesma loja. A ADR-0005 já previa "um PDV, duas embalagens", mas com telas dentro de `apps/web` e uma interface de periféricos genérica. O adendo exige telas em pacotes, adaptadores por capacidade, um agente local (Conector), versionamento de clientes e distribuição do desktop.

## Decisão

### 1. Estrutura: núcleo compartilhado + cascas finas
```
apps/
  web/        casca: bootstrap do PWA, service worker, implementações web dos ports
  desktop/    casca: Tauri 2, plugins Rust, implementações nativas dos ports, modo Conector
  api/        NestJS (ADR-0002)
packages/
  pdv-core/   estado e casos de uso do PDV (venda, pagamento, caixa, troca) — sem DOM, sem I/O
  pdv-ui/     telas do PDV (React), só falam com pdv-core e com os ports
  erp-ui/     telas da retaguarda (React)
  ui/         design system (Radix + Tailwind, tokens da marca)
  platform/   interfaces dos ports, registro de capacidades e simuladores
  domain/ fiscal/ fiscal-rules/ promotions/ local-db/ sync/ payments/   (ADR-0001)
```
Regra verificada por lint (`eslint-plugin-boundaries`): `pdv-ui`, `erp-ui` e `pdv-core` **não importam** nada de `apps/*` nem APIs específicas de plataforma (`@tauri-apps/*`, `navigator.serial` etc.). Telas e regras não podem ser duplicadas entre cascas.

### 2. Ports de plataforma
| Port | Web | Desktop |
|---|---|---|
| `StoragePort` | SQLite WASM + OPFS (fallback IndexedDB)¹ | SQLite nativo |
| `PrinterPort` | Conector → impressão do navegador (fallback) | ESC/POS direto (USB/serial/rede) |
| `CashDrawerPort` | Conector | Direto (pulso via impressora) |
| `ScalePort` | Conector → WebSerial quando suportado | Serial/USB direto |
| `TefPort` | Conector ou maquininha smart via API | Biblioteca do integrador direto |
| `CertificatePort` | Servidor (A1 em KMS); opcional WebCrypto não exportável (A1); Conector (A3) | Cofre do SO (A1); PKCS#11 (A3); servidor |
| `UpdaterPort` | Service worker: nova versão aplicada ao recarregar, **nunca durante uma venda** | Updater do Tauri assinado, canais estável/beta |
| `NotificationPort` | Web Notifications | Notificação nativa |

¹ Divergência com o adendo, que cita IndexedDB. Ver [análise de impacto §4](../adendos/01-analise-impacto.md#4-divergência-a-decidir-storageport-na-web): **Decidido em 12/10/2026: SQLite WASM + OPFS, com IndexedDB como fallback** (atende ao adendo, pois tudo fica atrás do `StoragePort`).

Cada port expõe `capabilities()`. A UI consulta as capacidades e, se algo faltar, mostra causa + solução em linguagem simples ("Para usar a balança no navegador, instale o Bipaê Conector, é 1 clique"). Todo port tem simulador em `packages/platform` para desenvolvimento e testes.

### 3. Bipaê Conector
- É o **próprio app desktop** em modo bandeja (sem janela de PDV), instalável a partir do PDV web.
- Servidor WebSocket em `127.0.0.1`, porta fixa com alternativas.
- Segurança:
  - aceita só `Origin` `https://app.bipae.com.br` e `https://homolog.bipae.com.br` (+ `localhost` em build de desenvolvimento);
  - pareamento por código de 6 dígitos exibido no Conector;
  - token por terminal, revogável na retaguarda;
  - **lista fechada de comandos** (imprimir, abrir gaveta, ler peso, operação TEF, assinar com A3);
  - o PIN do A3 só é digitado na janela do Conector.
- Mesma implementação Rust dos periféricos do desktop: um só driver por dispositivo.

### 4. Numeração fiscal por terminal
Cada terminal (web ou desktop) é cadastrado na retaguarda e recebe **série de NFC-e exclusiva**. A alocação é automática e nunca reutiliza série, dentro da faixa permitida (configurável, ver D-010). Isso substitui a "faixa de numeração por caixa" da ADR-0004.

### 5. Assinatura e contingência por plataforma
- **Desktop:** assina localmente; contingência offline completa.
- **Web online:** assina no servidor.
- **Web offline:** com opt-in do dono, assina com A1 importado como chave **não exportável** no WebCrypto. Sem opt-in, a venda é registrada e a nota fica na fila "emitir ao reconectar", com alerta do prazo legal visível ao operador e à retaguarda.

### 6. Versões e compatibilidade
- API com prefixo de versão (`/v1`).
- Todo cliente envia `X-Bipae-Client: <web|desktop|connector>/<semver>` e o ID do terminal.
- O servidor publica versão mínima suportada; abaixo dela, responde pedindo atualização (HTTP 426) **em todos os endpoints, exceto os de envio de eventos de sincronização**. Vendas pendentes de clientes antigos são sempre aceitas pelo período de suporte.
- Migrações do banco local: transacionais, só para frente, com backup antes de aplicar.

### 7. Distribuição
- Web: deploy contínuo (`homolog.bipae.com.br` → `app.bipae.com.br`), HTTPS, CSP restritiva, HSTS e demais cabeçalhos de segurança.
- Desktop: Windows `.msi`/`.exe`, Linux `.deb` e AppImage; macOS `.dmg` depois. Assinatura de código no pipeline, **desligada até o dono adquirir o certificado**. Assinatura do updater com chave própria (separada da de código). Canais estável e beta. Página `bipae.com.br/download`.
- CI: build e testes dos dois alvos (Windows e Linux) em todo PR.

## Por que manter Tauri (e não Electron)
Já era a escolha da ADR-0005 e nada foi implementado com outra tecnologia. Tauri gera instaladores pequenos e usa pouca memória em PCs de caixa modestos. O núcleo em Rust serve bem a periféricos e PKCS#11, e o mesmo binário funciona como Conector. O preço é que o webview varia por SO (WebView2 no Windows, WebKitGTK no Linux): testar os dois na CI é obrigatório.

## Consequências
- A mesma suíte E2E roda nos dois alvos: cenários escritos uma vez, executados por Playwright (web) e WebdriverIO + `tauri-driver` (desktop; Windows e Linux; macOS sem suporte de WebDriver, então testes manuais).
- Teste obrigatório: dois terminais (web + desktop) vendendo offline ao mesmo tempo, sem conflito de estoque nem de numeração.
- Teste obrigatório: atualização do desktop com vendas pendentes, sem perda.
- `docs/plataformas.md` passa a ser documentação mantida a cada fase.
