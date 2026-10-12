# Plataformas: Bipaê Online e Bipaê Desktop

> Primeira versão (Fase 1). Atualizada a cada fase. Decisão de arquitetura: [ADR-0012](adr/0012-pdv-web-desktop-codigo-compartilhado.md).

Uma conta, os mesmos dados e as mesmas telas. A loja pode misturar: um caixa no app desktop e outro no navegador do tablet, sincronizados. Cada caixa recebe a **sua própria série de NFC-e**, para dois caixas sem internet nunca gerarem o mesmo número.

## O que cada versão faz

| Recurso | Online (navegador) | Desktop (app) | Situação em out/2026 |
|---|---|---|---|
| Retaguarda: produtos, clientes, fornecedores, caixas, equipe, auditoria | Sim | Sim | ✅ pronto |
| Vender (PDV) | Sim | Sim | Fase 2 |
| Vender sem internet | Sim, com limites | Sim, sem limite de tempo | Fase 2 (banco local SQLite) |
| Impressora térmica | Pela janela de impressão do navegador ou pelo Bipaê Conector | Direto (USB, serial ou rede) | Navegador: ✅; demais: Fase 2 |
| Balança | Pelo navegador (Chrome/Edge, via WebSerial) ou Conector | Direto | Fase 2 |
| Gaveta de dinheiro | Pelo Bipaê Conector | Direto | Fase 2 |
| TEF / pinpad | Pelo Conector ou maquininha integrada | Direto | Fase 6 (real); simulador antes |
| Certificado A1 | Assinatura na nuvem | No computador e/ou na nuvem | Fase 3 |
| Certificado A3 (token/cartão) | Pelo Conector | Direto | Fase 3 |
| Atualização | Automática ao recarregar, nunca durante uma venda | Automática, assinada, nunca durante uma venda | Navegador: ✅; desktop: Fase 2 |

Quando algo não está disponível, a tela inicial explica em português simples e diz como resolver (por exemplo: "Para usar a gaveta de dinheiro no navegador, instale o Bipaê Conector"). O que ainda não foi construído aparece como **"Chega em breve"**, nunca como disponível.

## Bipaê Online

- Endereço: `app.bipae.com.br` (homologação: `homolog.bipae.com.br`). *A hospedagem ainda será contratada.*
- Navegadores: Google Chrome e Microsoft Edge atuais (recomendados, têm WebSerial para balança); Firefox e Safari funcionam para retaguarda e vendas, mas sem acesso direto a periféricos.
- Pode ser **instalado** como aplicativo (PWA): no Chrome/Edge, ícone "Instalar" na barra de endereço; no celular, "Adicionar à tela inicial".

## Bipaê Desktop

- Windows 10 ou superior (prioridade) e Linux (Ubuntu 22.04+ ou equivalente); macOS depois.
- Instaladores: `.msi` e `.exe` (Windows), `.deb` e AppImage (Linux), gerados pela CI a cada mudança.
- **Ainda sem assinatura de código:** no Windows, o SmartScreen mostra "O Windows protegeu o computador". Clique em *Mais informações → Executar assim mesmo*. Isso some quando o certificado de assinatura for adquirido (decisão pendente do dono do projeto).
- Também será o **Bipaê Conector** (modo bandeja) para o PDV no navegador usar periféricos (Fase 2).

### Compilar o desktop

1. Instale o Rust: <https://rustup.rs>.
2. Windows: instale as *Visual Studio Build Tools* com "Desenvolvimento para desktop com C++". O WebView2 já vem no Windows 10/11.
3. Linux: `sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`.
4. `pnpm --filter @bipae/desktop tauri:build`.

## Versões e compatibilidade

- Todo cliente se identifica (`X-Bipae-Client: desktop/0.1.0`).
- O servidor pode exigir uma versão mínima. Abaixo dela, o app pede para atualizar, mas **nunca deixa de receber vendas pendentes** de versões antigas.

## Suporte

| Situação | O que fazer |
|---|---|
| "Sua sessão expirou" | Entre de novo. Por segurança, sessões antigas são encerradas. |
| "Sem conexão com o servidor" | Verifique a internet. Nada do que foi digitado é perdido. |
| "Há uma nova versão do Bipaê" | Atualize; vendas pendentes são enviadas depois. |
| Windows bloqueou o instalador | Veja "Ainda sem assinatura de código" acima. |
