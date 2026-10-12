# PRD — Bipaê

> **Bipou? Bipaê!** PDV + ERP brasileiro, offline-first e pronto para a Reforma Tributária.
> Versão 0.1 · 11/10/2026 · Status: **aguardando aprovação** (fim da Fase 0)

## 1. Problema

Pequenos e médios comércios brasileiros escolhem entre:
- **sistemas simples e baratos** (web ou de maquininha) que param sem internet, têm pouca gestão e tratam o fiscal como caixa-preta; ou
- **sistemas robustos** (redes e supermercados) caros, complexos, que exigem implantação e servidor na loja.

Ao mesmo tempo, a **Reforma Tributária** (2026–2033) obriga todos a emitir documentos com IBS/CBS sob regras que mudam a cada nota técnica. Os sistemas legados estão remendando; o pequeno lojista não entende o que muda nem confia que o sistema acompanhará.

## 2. Visão

O PDV mais rápido e confiável do Brasil, que qualquer pessoa usa sem treinamento, que nunca para e que absorve a Reforma como atualização de dados. Do MEI ao supermercado de bairro, com caminho para redes.

## 3. Público e personas

| Persona | Contexto | O que precisa |
|---|---|---|
| **Dona Célia, MEI** (bazar/papelaria) | Vende pelo celular, nunca emitiu NFC-e, medo de "complicação fiscal" | Grátis, vender em 3 toques, nota sem pensar |
| **Rafael, dono de minimercado** (Simples Nacional, 2 caixas) | Internet instável, compra de 30 fornecedores | Caixa que não para, entrada por XML, balança, promoções, saber a margem |
| **Juliana, operadora de caixa** | Alta rotatividade, fila no horário de pico | Teclado rápido, telas claras, erro que se entende |
| **Marcos, dono de lanchonete** | Salão + iFood | Mesas, comandas, KDS, ficha técnica |
| **Patrícia, gerente de rede regional** (Lucro Presumido, 8 lojas) | Precisa de controle e prevenção de perdas | Multiloja, auditoria, painel ao vivo, SPED |
| **Sérgio, contador** | Atende 60 clientes | XMLs, SPED, conferência de IBS/CBS sem pedir nada ao cliente |

## 4. Objetivos e métricas

| Objetivo | Métrica | Meta |
|---|---|---|
| Vender rápido | Tempo da última bipagem à nota autorizada/contingência, local | **< 1 s** (p95) |
| Nunca parar | Vendas perdidas por falta de rede | **0** |
| Onboarding | Cadastro → primeira venda de teste | **< 2 min** sem configuração; **< 10 min** até primeira NFC-e real com XMLs importados |
| Usabilidade | Pessoa leiga abre caixa, vende e emite NFC-e de homologação sem ajuda | **≥ 9 de 10** participantes no teste |
| Confiabilidade fiscal | Rejeições por erro de cálculo/leiaute do sistema | **< 0,1%** das notas |
| Transparência | Cálculos fiscais com explicação disponível | **100%** |

## 5. Escopo por fase

Princípio: cada fase entrega algo que funciona de ponta a ponta, com testes (ver Definição de Pronto no briefing).

### Fase 1 — Fundação
Monorepo, Docker Compose, CI (lint, typecheck, testes, build). Auth (e-mail+senha, 2FA opcional), multi-tenant com RLS, hierarquia tenant/empresa/loja/caixa, papéis e permissões granulares, trilha de auditoria encadeada. Cadastros: produtos (GTIN, variações, kits, pesáveis, lote/validade, fotos), clientes, fornecedores, unidades, tabelas de preço, perfis fiscais (sem cálculo ainda). Seeds de demonstração realistas.
**Adendo 01:** estrutura de núcleo compartilhado + cascas web e desktop (ADR-0012), interfaces dos ports com simuladores, CI construindo e testando os dois alvos, API versionada (`/v1`) com versão mínima de cliente, cadastro de terminais com série de NFC-e exclusiva.

### Fase 2 — PDV MVP offline-first
PDV (PWA + Tauri) com SQLite local; venda por bipagem/busca; descontos com permissão; múltiplas formas de pagamento (dinheiro, Pix simulado, cartão simulado); abertura, sangria, suprimento e **fechamento cego**; troca/devolução vinculada por item; orçamento → venda; CPF na nota; estoque por livro de movimentações; sincronização por eventos; impressão de cupom (ESC/POS e navegador); som de "bip". **Teste automatizado com rede desligada.**
**Adendo 01:** paridade web/desktop; Bipaê Conector (impressora, gaveta, balança) para o PDV web; auto-update do desktop com canais estável/beta; instaladores Windows/Linux; mesma suíte E2E nos dois alvos; teste de dois terminais (web + desktop) offline simultâneos; teste de update com fila pendente; `docs/plataformas.md`.

### Fase 3 — Fiscal
Motor tributário (atual + IBS/CBS/IS com vigência), NFC-e e NF-e em homologação com grupos IBS/CBS conforme a NT vigente, QR Code, contingência offline (NFC-e) e SVC (NF-e), cancelamento, CC-e, inutilização, manifestação do destinatário, Distribuição DF-e, **importação de XML de compra criando produtos/fornecedores/estoque**, certificado A1 com assistente, rejeições traduzidas. **Revalidar `docs/fiscal/versoes.md` no início da fase.**

### Fase 4 — ERP
Pedidos de compra, entrada com conferência, custo médio, formação de preço com margem e tributos; contas a pagar/receber, fluxo de caixa, DRE gerencial, conciliação bancária (OFX) e de cartões/Pix, boletos (via PSP), crediário com inadimplência; relatórios (período, produto, operador, loja, forma de pagamento, margem, ticket médio, curva ABC) exportáveis; inventário pelo celular; transferências; apuração de IBS/CBS (débitos e créditos) e exportações SPED/EFD/pacote de XMLs.

### Fase 5 — Verticais
Mercado (balança, etiquetas, promoções avançadas, atacarejo, self-checkout, painel de prevenção de perdas) e Food Service (mesas, comandas, garçom, KDS, delivery com taxa por bairro, ficha técnica). Depois Moda (grade, condicional), Farmácia/Pet (lote/validade) e Serviços (OS + NFS-e Nacional).

### Fase 6 — Integrações e IA
TEF real, PSP Pix real, marketplaces, iFood, API pública OpenAPI + webhooks, assistente de IA (ADR-0011), CRM/fidelidade/campanhas com consentimento.

### Fase 7 — Endurecimento
Carga (meta < 1 s), pentest/segurança, documentação de usuário, guia de implantação.

## 6. Requisitos não funcionais

- **Desempenho:** busca de produto < 100 ms com 100 mil SKUs locais; venda < 1 s p95.
- **Offline:** ilimitado para vendas em dinheiro/crediário; NFC-e em contingência dentro do prazo legal de transmissão.
- **Disponibilidade da nuvem:** 99,9% (o PDV não depende dela para vender).
- **Segurança:** ADR-0010; OWASP ASVS nível 2 como referência.
- **Acessibilidade:** WCAG 2.2 AA; alto contraste e fonte grande.
- **Compatibilidade:** Windows 10+, Linux (Ubuntu LTS), Android 9+, Chrome/Edge atuais; PCs de caixa modestos (4 GB RAM).
- **Plataformas (Adendo 01):** Bipaê Online (`app.bipae.com.br`) e Bipaê Desktop (Windows primeiro; Linux; macOS depois) com as mesmas telas e funcionalidades; diferenças só de periféricos e de tempo de operação offline (ver ADR-0012 e `docs/plataformas.md`).

## 7. UX — princípios

Vender em 3 toques; 100% teclado (F-keys visíveis) e 100% toque; nenhuma configuração antes da primeira venda de teste; erros com causa e solução em linguagem humana; tom simpático e brasileiro; celebração discreta a cada venda (o "aê!").

## 8. Modelo de negócio (hipótese a validar)

| Plano | Para quem | Inclui |
|---|---|---|
| **Grátis (MEI)** | MEI, 1 caixa | PDV, NFC-e/NF-e ilimitadas, estoque e financeiro básicos |
| **Essencial** | Micro, até 3 caixas | Tudo do grátis + compras por XML, relatórios, crediário |
| **Profissional** | Pequenas/médias, multiloja | + verticais, conciliação, SPED, painel de perdas, API |
| **Rede** | Redes e franquias | + retaguarda centralizada, SLA, banco dedicado opcional |

Receita adicional possível: intermediação de pagamentos (parceria com PSP/adquirente), sempre opcional e sem amarrar o lojista.

## 9. Fora de escopo (por enquanto)

CT-e e MDF-e (módulos futuros); SAT-CF-e e MFE (extintos em 01/01/2026); emissão em produção sem aprovação explícita; contabilidade completa (o Bipaê exporta para o contador, não substitui o sistema contábil).

## 10. Riscos

| Risco | Mitigação |
|---|---|
| Mudanças frequentes das NTs | Regras como dados (ADR-0006); revisão de `versoes.md` a cada NT; validações locais com vigência |
| Homologação de parceiros (TEF, PSP, iFood, maquininhas) demora | Simuladores desde o início; adaptadores isolados |
| Sincronização offline com bugs sutis | Modelo append-only + testes E2E de rede desligada + testes de propriedade |
| Ambiguidade fiscal | `docs/fiscal/duvidas.md` + configuração + validação com contador |
| Escopo enorme | Fases verticais com valor de ponta a ponta; MVP = Fases 1–3 |

## 11. Dependências externas (o que o dono do projeto precisa providenciar)

- **Certificado digital A1 de teste/homologação** de um CNPJ real (e CSC de homologação da NFC-e na SEFAZ da UF) para a Fase 3.
- UF(s) prioritária(s) para começar a emissão e os testes fiscais.
- Contador parceiro para validar `docs/fiscal/duvidas.md`.
- Contas sandbox de PSP Pix e de integrador TEF (Fase 6).
- Hardware de teste opcional: impressora térmica ESC/POS, leitor de código de barras, balança.
