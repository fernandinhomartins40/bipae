# Plataformas: Bipaê Online e Bipaê Desktop

> Atualizado ao fim da Fase 2 (12/10/2026). Decisão de arquitetura: [ADR-0012](adr/0012-pdv-web-desktop-codigo-compartilhado.md).

Uma conta, os mesmos dados e as mesmas telas. A loja pode misturar: um caixa no app desktop e outro no navegador do tablet, sincronizados. Cada caixa recebe **sua própria série de NFC-e**, para dois caixas sem internet nunca gerarem o mesmo número.

## O que cada versão faz

| Recurso | Online (navegador) | Desktop (app) | Situação |
|---|---|---|---|
| Retaguarda (produtos, clientes, vendas, estoque, equipe, auditoria) | Sim | Sim | ✅ |
| Caixa (PDV): vender, descontos, pagamentos, sangria, fechamento cego, devolução | Sim | Sim | ✅ |
| Vender sem internet | Sim, com o banco do navegador (OPFS). Em navegador sem OPFS o caixa avisa que não é seguro | Sim, sem limite de tempo | ✅ |
| Impressora térmica | Pelo Bipaê Conector (ESC/POS) ou pela janela de impressão do navegador | Direto: rede (IP, porta 9100) ou USB/serial (porta COM) | ✅ código pronto; desktop **não testado em hardware** |
| Gaveta de dinheiro | Pelo Conector | Direto (pulso pela impressora) | ✅ idem |
| Balança (Toledo/Filizola) | Pelo Conector | Direto (serial/USB) | ✅ idem |
| TEF / pinpad | Simulador | Simulador | Fase 6 |
| Pix | Simulador | Simulador | Fase 6 (PSP real) |
| Certificado A1 / A3 | — | — | Fase 3 |
| Atualização | Ao recarregar a página, nunca durante uma venda | Automática e assinada, canais estável e beta; nunca durante uma venda | ✅ web; desktop depende das chaves (abaixo) |

Quando algo não está disponível, a tela inicial explica em português simples e diz como resolver (por exemplo: "Para usar a gaveta de dinheiro no navegador, instale o Bipaê Conector"). O que ainda não foi construído aparece como **"Chega em breve"**, nunca como disponível.

## O caixa (PDV)

1. Na retaguarda, clique em **Abrir o caixa**.
2. Na primeira vez, escolha qual caixa é este aparelho (ou crie um, se você for gerente).
3. Informe o troco inicial e comece a vender.

| Tecla | Ação |
|---|---|
| Enter | Bipar/buscar. `3*código` multiplica; `0,5*banana` vende por peso |
| F2 | Voltar para a busca |
| F3 | Quantidade do item selecionado |
| F4 | Desconto na venda (acima de 10% pede autorização de gerente) |
| F5 / F7 | Salvar orçamento / abrir orçamentos |
| F6 | CPF/CNPJ na nota |
| F8 | Remover o item selecionado |
| F9 | Caixa: sangria, suprimento, fechamento cego |
| F10 | Pagar (dinheiro com troco, Pix, débito, crédito, vale; vários na mesma venda) |
| F11 | Vendas do caixa: reimprimir, cancelar, devolver itens |
| F12 | Limpar a venda |

Etiquetas de balança (código começando com 2) são lidas automaticamente: o código do produto na etiqueta é o **código interno (SKU)** do produto pesável.

Sem internet, o caixa continua vendendo. O selo no topo mostra "Sem conexão · N para enviar". Quando a internet volta, tudo é enviado sozinho; a cada 30 segundos o caixa também sincroniza.

## Bipaê Online

- Endereço: `app.bipae.com.br` (homologação: `homolog.bipae.com.br`). *A hospedagem ainda será contratada.*
- Navegadores: Google Chrome e Microsoft Edge atuais (recomendados). Firefox e Safari funcionam para retaguarda e vendas.
- Pode ser **instalado** como aplicativo (PWA): no Chrome/Edge, ícone "Instalar" na barra de endereço; no celular, "Adicionar à tela inicial".

### Usar impressora, balança e gaveta no navegador (Bipaê Conector)

1. Instale o **Bipaê Desktop** no computador do caixa. Ele traz o Conector.
2. No Bipaê Desktop, configure os periféricos em **Periféricos** e anote o **código de pareamento**.
3. No navegador, abra **Periféricos**, digite o código e clique em **Parear este navegador**. Se o Chrome perguntar sobre acesso a "apps neste dispositivo", clique em **Permitir**.
4. Pronto: o caixa do navegador imprime, lê a balança e abre a gaveta por esse computador.

Para deixar só o Conector rodando, sem a janela do PDV, inicie o app com `--connector` (ex.: `"Bipaê.exe" --connector`): ele fica como um ícone perto do relógio. *Ainda não há atalho automático do instalador nem início junto com o Windows.*

Segurança do Conector:
- ele aceita só os endereços oficiais do Bipaê;
- cada navegador precisa ser pareado com o código, e 5 erros bloqueiam até gerar um novo;
- pareamentos podem ser desfeitos no Bipaê Desktop;
- ele só sabe imprimir, abrir a gaveta, ler a balança e listar portas.

## Bipaê Desktop

- Windows 10 ou superior (prioridade) e Linux (Ubuntu 22.04+ ou equivalente); macOS depois.
- Instaladores `.msi`/`.exe` (Windows) e `.deb`/AppImage (Linux), gerados pela CI.
- Dados do caixa: um banco SQLite na pasta de dados do app, que **sobrevive às atualizações**.
- **Ainda sem assinatura de código:** no Windows, o SmartScreen mostra "O Windows protegeu o computador". Clique em *Mais informações → Executar assim mesmo*. Isso some quando o certificado de assinatura for configurado (abaixo).

### Compilar o desktop

1. Instale o Rust: <https://rustup.rs>.
2. Windows: *Visual Studio Build Tools* com "Desenvolvimento para desktop com C++". O WebView2 já vem no Windows 10/11.
3. Linux: `sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf libudev-dev`.
4. `pnpm --filter @bipae/desktop tauri:build`.

### Atualização automática (o que o dono do projeto precisa fazer)

O atualizador só entra nos builds de **release** (`.github/workflows/release-desktop.yml`, disparado por tag `v1.2.3`; tags com hífen, como `v1.2.3-beta.1`, vão para o canal **beta**).

1. Gere o par de chaves do atualizador **no seu computador** (a chave privada nunca entra no repositório):
   `pnpm --filter @bipae/desktop tauri signer generate -w ~/.tauri/bipae.key`
2. No GitHub, crie os segredos `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` e `BIPAE_UPDATER_PUBKEY`.
3. Hospede os artefatos de atualização em `releases.bipae.com.br/desktop/<canal>/...` (hospedagem a contratar).
4. Opcional: certificado de assinatura de código do Windows, nos segredos `WINDOWS_CERTIFICATE` (pfx em base64) e `WINDOWS_CERTIFICATE_PASSWORD`.

Sem esses segredos, a release gera instaladores normais, sem atualizador e sem assinatura.

## Versões e compatibilidade

- Todo cliente se identifica (`X-Bipae-Client: desktop/0.1.0`).
- O servidor pode exigir uma versão mínima. Abaixo dela, o app pede para atualizar, mas **nunca deixa de receber vendas pendentes** de versões antigas.
- Um app mais antigo se recusa a abrir um banco local criado por uma versão mais nova, em vez de corrompê-lo.

## Desenvolvimento

- Simulador do Conector (protocolo real, periféricos simulados): `pnpm --filter @bipae/web connector:sim`. O estado fica em `http://127.0.0.1:47801/state`.

## Suporte

| Situação | O que fazer |
|---|---|
| "Sua sessão expirou" | Entre de novo. Por segurança, sessões antigas são encerradas. |
| "Sem conexão" no caixa | Continue vendendo. As vendas são enviadas quando a internet voltar. |
| "Há uma nova versão do Bipaê" | Atualize; vendas pendentes são enviadas depois. |
| "Este navegador não guarda dados no aparelho" | Use Chrome/Edge atualizados ou o Bipaê Desktop antes de vender sem internet. |
| "O Bipaê Conector não está aberto neste computador" | Abra o Bipaê Desktop (ou `--connector`). |
| A balança "não respondeu" | Confira cabo, porta e velocidade em Periféricos. |
| Windows bloqueou o instalador | Veja "Ainda sem assinatura de código" acima. |
