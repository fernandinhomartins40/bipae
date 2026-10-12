# ADENDO 01 — Bipaê: PDV online (web) + desktop

> Recebido em 12/10/2026. **Complementa e tem prioridade** sobre o `docs/PROMPT.md` original nos pontos abaixo. Todo o resto do prompt original continua valendo.
> Análise de impacto: [01-analise-impacto.md](01-analise-impacto.md) · Decisão: [ADR-0012](../adr/0012-pdv-web-desktop-codigo-compartilhado.md)

---

## 1. O que mudou

O PDV do Bipaê deve existir em **duas formas, ambas de primeira classe**, com as mesmas funcionalidades e a mesma experiência:

1. **Bipaê Online (web):** acessado pelo navegador em `app.bipae.com.br`, sem instalar nada. Serve para o PDV e para toda a retaguarda (ERP).
2. **Bipaê Desktop:** aplicativo instalável (Windows como prioridade; Linux e macOS em seguida). É o PDV de balcão "raiz", com periféricos e operação offline completa.

Uma única conta, os mesmos dados e as mesmas telas. O lojista escolhe onde usar e pode misturar, por exemplo um caixa no desktop e outro no navegador do tablet, todos na mesma loja e sincronizados.

---

## 2. Antes de mudar qualquer código

Você já está implementando o projeto. **Não recomece do zero.**

1. Faça um levantamento do estado atual: o que já existe, em que fase está, qual stack foi adotada para web e desktop, e o que já está testado.
2. Escreva `docs/adendos/01-analise-impacto.md` com:
   - o que já atende este adendo;
   - o que precisa ser ajustado (com estimativa de esforço);
   - riscos de quebrar o que já funciona;
   - a ordem proposta das mudanças.
3. Crie um ADR (`docs/adr/`) registrando a decisão "PDV web + desktop com código compartilhado".
4. **Pare e me mostre a análise antes de alterar código.** Depois da minha aprovação, aplique as mudanças em etapas pequenas, com testes passando e um commit ao fim de cada uma.

---

## 3. Arquitetura obrigatória: um código, dois alvos

- **UI compartilhada:** todas as telas do PDV e do ERP vivem em pacotes comuns (ex.: `packages/ui`, `packages/pdv-core`). Web e desktop são "cascas" finas sobre o mesmo código. Proibido duplicar telas ou regras de negócio.
- **Regras de negócio no core:** cálculo de venda, descontos, promoções, troco, motor fiscal e validações ficam em pacotes TypeScript puros, executados igualmente no navegador, no desktop e no servidor.
- **Camada de plataforma (adaptadores):** tudo que muda entre web e desktop fica atrás de interfaces, com uma implementação para cada alvo:
  - `StoragePort`: IndexedDB (web) / SQLite (desktop)
  - `PrinterPort`, `ScalePort`, `CashDrawerPort`, `TefPort`, `CertificatePort`
  - `UpdaterPort`, `NotificationPort`
- **Desktop:** Tauri (já sugerido no prompt original). Se outra tecnologia já foi adotada, justifique no ADR se mantém ou migra.
- **Web:** PWA instalável, também com cache offline.
- **Nuvem como fonte da verdade:** PostgreSQL no servidor; cada terminal mantém banco local e sincroniza por fila de eventos idempotente (já previsto no original). Web e desktop usam **a mesma API e o mesmo protocolo de sincronização**.
- **Compatibilidade de versões:** a API é versionada, e o desktop informa sua versão em cada requisição. O servidor pode exigir uma versão mínima, e o app avisa o usuário para atualizar sem perder vendas pendentes.

---

## 4. Diferenças de capacidade (o que cada versão faz)

| Recurso | Online (web) | Desktop |
|---|---|---|
| Vender, consultar, cadastrar, ERP completo | Sim | Sim |
| Vender sem internet | Sim, limitado (PWA com cache; NFC-e em contingência só se o certificado estiver disponível no dispositivo, ver seção 5) | Sim, completo e por tempo indeterminado |
| Impressora térmica | Via "Bipaê Conector" (seção 6) ou impressão do navegador | Direta (USB/serial/rede, ESC/POS) |
| Balança, gaveta, leitor serial | Via Bipaê Conector; WebSerial/WebUSB quando o navegador suportar | Direto |
| TEF / pinpad | Via Bipaê Conector ou maquininha smart integrada por API | Direto |
| Certificado A1 | Sim (assinatura no servidor) | Sim (local e/ou servidor) |
| Certificado A3 (token/cartão) | Via Bipaê Conector | Direto |
| Atualização | Automática ao recarregar | Auto-update assinado, em segundo plano, nunca durante uma venda |

Na interface, quando um recurso não estiver disponível na versão atual, explique em linguagem simples e ofereça a solução ("Para usar a balança no navegador, instale o Bipaê Conector — 1 clique").

---

## 5. Regras fiscais por plataforma

- **Numeração de NFC-e por terminal:** cada PDV (web ou desktop) recebe a **sua própria série** de NFC-e, para que dois caixas offline nunca gerem o mesmo número. Faça o controle de séries e terminais na retaguarda.
- **Assinatura:**
  - *Desktop:* assina localmente (A1 criptografado no dispositivo ou A3), o que permite contingência offline completa.
  - *Web online:* assina no servidor com o A1 armazenado de forma criptografada (HSM/KMS quando possível).
  - *Web offline:* emite NFC-e em contingência offline somente se o lojista autorizar guardar o certificado no dispositivo, de forma criptografada. Caso contrário, registra a venda e emite a nota assim que a conexão voltar, dentro do prazo legal, avisando o operador.
- A transmissão das notas em contingência deve respeitar os prazos da SEFAZ, com alerta visível de notas pendentes.
- Todas as regras de IBS/CBS e da legislação atual do prompt original valem igualmente para as duas versões. O motor fiscal é o mesmo código.

---

## 6. Bipaê Conector (agente local leve)

Crie um pequeno serviço local opcional (pode ser o próprio app desktop rodando em modo "conector", na bandeja do sistema) que permite ao **PDV web** usar periféricos:

- impressora, gaveta, balança, pinpad/TEF e certificado A3;
- comunicação segura com o navegador (WebSocket local com pareamento por código e token, restrito ao domínio `app.bipae.com.br`);
- instalação em 1 clique a partir da própria tela do PDV web.

---

## 7. Distribuição e entrega

- **Web:** deploy contínuo em `app.bipae.com.br` (ambiente de homologação em `homolog.bipae.com.br`), com HTTPS, CSP e cabeçalhos de segurança.
- **Desktop:**
  - instaladores para Windows (`.msi` ou `.exe`), Linux (`.deb` e AppImage) e macOS (`.dmg`, depois);
  - assinatura de código (deixe o pipeline pronto e documente que eu preciso adquirir o certificado de assinatura);
  - canal de atualização estável e beta;
  - página de download em `bipae.com.br/download`.
- **CI:** build e testes dos dois alvos a cada PR.

---

## 8. Testes adicionais (definição de pronto deste adendo)

- O mesmo conjunto de testes end-to-end do fluxo de venda roda **no navegador e no app desktop**.
- Teste automatizado com dois terminais (um web e um desktop) vendendo offline ao mesmo tempo e sincronizando sem conflito de estoque nem de numeração fiscal.
- Teste de atualização do desktop com vendas pendentes na fila (nada pode ser perdido).
- Teste do Bipaê Conector com impressora e balança simuladas.
- Documentação: `docs/plataformas.md` explicando as diferenças, a instalação e o suporte de cada versão.

---

## 9. Ajuste no plano de fases

Encaixe este adendo na fase atual sem perder o trabalho feito. Sugestão:

- Se ainda estiver na **Fase 1 ou 2**: incorpore a separação core/adaptadores e as duas cascas imediatamente.
- Se já estiver na **Fase 3 ou além**: crie uma "Fase 2.5 — Paridade web/desktop" antes de seguir, garantindo que tudo o que já existe funcione nos dois alvos.
