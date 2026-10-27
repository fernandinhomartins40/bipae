# Matriz de verificação

> Atualiza os estados do `INVENTARIO_APLICACAO.md` com o que foi **executado** nesta auditoria
> (27/10/2026, Windows, PGlite, sem Docker/PostgreSQL real/Rust). Método de prova:
> **AUT** = teste automatizado executado e verde (Vitest com API real em processo, ou Playwright com
> API + web locais); **EST** = só leitura do código; **—** = sem prova.
> "VERIFICADA" aqui significa verificada **por teste automatizado em ambiente local**, não observada
> em produção.

## Execuções que sustentam a matriz

| Execução | Commit/estado | Resultado |
|---|---|---|
| `pnpm test --force` (R4) | `728df79` | 213 arquivos, **1.556 testes verdes**, 0 falhas |
| `pnpm test:e2e` completo (R4) | `728df79` | 206 testes: 112 verdes, 1 falha intermitente (`admin.spec.ts:32`, passou ao repetir), 93 pulados (casca `desktop-ui`) |
| Cobertura do motor fiscal (R4) | `728df79` | 98,07 % linhas, 91,18 % ramos |
| Testes após as correções | árvore de trabalho | ver `RELATORIO_VALIDACAO_FINAL.md` |

## Estado por domínio

Inventário: 121 jornadas em 12 domínios. As 75 "IMPLEMENTADA, NÃO VERIFICADA" do inventário tinham
teste identificado; como a suíte inteira foi executada e ficou verde, passam a **VERIFICADA (AUT)**
no escopo do que esses testes cobrem. As demais mantêm o estado.

| Domínio | VERIFICADA (AUT) | PARCIAL | BLOQUEADA | NÃO LOCALIZADA | FALHA REPRODUZIDA (e corrigida) |
|---|---|---|---|---|---|
| 2.1 Identidade, conta e equipe | jornadas com teste em `auth`, `invites`, `security`, `totp`, `password-reset`, `platform`, `data-rights` | — | E-mail real (E11) | — | Convite sem trava (ACH-01); Dono desprotegido (ACH-13); exportação pelo suporte (ACH-14) |
| 2.2 Organização e dispositivos | `seed`, `store-permissions`, `downloads`, `sync` | — | Android (E24/E25) | — | IP falsificável e 429→500 (ACH-02) |
| 2.3 Catálogo, preços e promoções | `catalog`, `pricing`, `price-tables`, `promotions`, `product-images` | — | — | — | Reativação fura limite (ACH-12); preço com Enter (ACH-05) |
| 2.4 Pessoas, CRM e fidelidade | `crm`, `campaigns`, `loyalty`, `store-credit` | — | Envio real de campanha (E11) | — | — |
| 2.5 PDV / caixa | `sync` (dois terminais offline), `pos.spec`, `order-offline.spec`, `pos-modes.spec` | Venda em andamento não sobrevive ao recarregar (ACH-08, EST) | Periféricos reais | INV-POS-12: dois terminais **web e desktop** offline ao mesmo tempo em E2E | Evento envenenado trava o caixa (ACH-04); cancelamento de outra loja (ACH-03) |
| 2.6 Food service | `tabs`, E2E de comandas/cozinha/delivery | — | iFood/marketplaces (E14) | — | — |
| 2.7 Estoque e compras | `inventory`, `lots`, `transfers`, `losses`, `purchases`, `purchase-orders`, `mercadoflow-confere` | Revisão do XML limitada a 200 produtos (EST) | — | — | Contagem vazia zera estoque (ACH-06) |
| 2.8 Fiscal | 651 testes do motor; `fiscal`, `nfce-emission`, `nfe-invoices`, `sefaz`, `dfe`, `nfse` | ST/cBenef de UFs sem fonte oficial | Certificado A1 (E1), contador (E3) | INV-FIS-17 (validação com contador e leigos) | Aviso "NFC-e chega em breve" desatualizado (ACH-17) |
| 2.9 Financeiro e pagamentos | `finance`, `bank`, `pix-*`, `boletos`, `settlements`, `payment-webhooks`, `reports`, `dre` | — | Contas reais de PSP (E9/E26) | — | Baixa com R$ 0,00 (ACH-16, EST) |
| 2.10 Canais, API pública, integrações | `channels`, `public-api`, `webhooks`, `api-keys`, `mercadoflow*`, `ai` | — | MercadoFlow (E19), IA (E13) | — | — |
| 2.11 Plataforma SaaS e cobrança | `platform`, `billing`, `billing-methods`, `admin.spec` | — | — | INV-SAAS-08: funcionalidades diferentes por plano | Preço do plano lido errado (ACH-07) |
| 2.12 Desktop, Android, site, PDV Embed | `kits/pdv-embed` (conformance), E2E `desktop-ui` (10 de 103) | — | Rust/Tauri e Android não executados aqui (CI cobre Rust) | INV-SITE-01: landing sem teste | — |

## Não verificado nesta auditoria (e por quê)

- API contra PostgreSQL 16 real, testes Rust, WebView do Tauri: sem Docker, PostgreSQL e `cargo` nesta máquina. A CI cobre.
- Comportamento em produção: a VPS roda `07bfa9a`, 36 commits atrás.
- Rotas sem nenhum teste (~28, lista no `BANCA_R4_QUALIDADE.md`): 9 do painel admin, `channels/inbound`, cancelamento de Pix, `boletos/:id/refresh`, `mercadoflow/confere/*`.
