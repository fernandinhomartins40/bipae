# PROMPT PARA O CLAUDE CODE — Bipaê: PDV + ERP brasileiro

> Briefing original do produto, recebido em 11/10/2026. Este arquivo é a fonte de requisitos; divergências encontradas na pesquisa estão em `docs/fiscal/versoes.md` e `docs/benchmark/README.md`.

**Marca:** Bipaê · **Domínio:** bipae.com.br · **Slogan:** "Bipou? Bipaê!"
Use o nome "Bipaê" (com acento na interface e nos textos; `bipae` sem acento em código, pacotes, repositório, e-mails e URLs). O conceito da marca é o "bip" do leitor de código de barras com o "aê!" de comemoração: vender é rápido e dá alegria. Reflita isso na identidade: tom de voz leve, simpático e brasileiro; som curto de "bip" de confirmação a cada venda (desativável); visual limpo, alegre e de alto contraste.

---

## 1. Seu papel

Você é um time completo de produto e engenharia: arquiteto de software sênior, especialista em automação comercial brasileira, especialista em legislação fiscal (NF-e/NFC-e/NFS-e e Reforma Tributária do consumo), designer de UX para varejo e engenheiro de QA.

Sua missão é construir, do zero, o **Bipaê**: um **PDV com ERP completo para comércios brasileiros** (MEI, micro, pequenas e médias empresas, com caminho para redes), que reúna o melhor dos líderes do mercado em um produto **único, simples, rápido, offline-first e pronto para a Reforma Tributária**.

Trabalhe em fases, com entregas funcionais e testadas ao fim de cada uma. Nunca entregue "esqueleto bonito sem lógica": cada funcionalidade entregue precisa funcionar de ponta a ponta, com testes.

---

## 2. Regras de engenharia reversa (obrigatórias)

Use a ferramenta **REA (Reverse Engineer Anything — github.com/morluto/rea)** para estudar como funcionalidades de referência funcionam. Instale com `npx rea-agents setup` se ainda não estiver configurada.

Faça isso em modo **"sala limpa" (clean room)**:

1. **Pode:** analisar comportamento observável (fluxos de tela, tempos, atalhos, estrutura de páginas web públicas, documentação pública, APIs públicas documentadas, vídeos de demonstração, contas de teste/trial cujos termos permitam), projetos open source com licença compatível, e softwares que eu indicar como de minha propriedade ou com autorização.
2. **Não pode:** copiar código, textos, ícones, marcas, layouts idênticos, bancos de dados ou assets de nenhum concorrente; descompilar binários proprietários cuja licença proíba engenharia reversa; contornar proteções ou licenças. (Respeite a Lei 9.609/98 e a LGPD.)
3. Para cada referência estudada, registre em `docs/benchmark/` **o que** a funcionalidade faz, **por que** é boa e **qual problema do usuário resolve** — e então projete a **nossa própria implementação**, melhor e original.
4. Se tiver dúvida se uma análise é permitida, **pare e me pergunte**.

---

## 3. Referências de mercado — o que absorver de cada uma

| Referência | Segmento | O que absorver (comportamento/conceito, nunca código) |
|---|---|---|
| Linx / TOTVS (Protheus, Consinco, VarejOnline) | Médio e grande varejo, redes | Multiloja, retaguarda centralizada, omnichannel, gestão de franquias, compliance fiscal robusto |
| Zanthus (Zeus Retail) | Supermercados | Promoções avançadas (leve X pague Y, atacarejo), balança e pesáveis, vasilhame, self-checkout, chama-fila, convênios |
| RP Info | Supermercados | PDV que continua vendendo de forma independente se o servidor cair; self-checkout com conferência por peso |
| Arius | Supermercados / lojas autônomas | Monitoramento de PDVs em tempo real e prevenção de perdas |
| VR Software | Supermercados | Conciliador de cartões, CRM e fidelidade integrados, e-commerce do próprio mercado |
| Bling / Tiny (Olist) | PMEs e e-commerce | Simplicidade, NFC-e ilimitada, integração com marketplaces, PDV no navegador |
| VHSYS | PMEs | Maquininha integrada que sincroniza venda e baixa estoque automaticamente |
| Tedsys | PMEs | Operação offline completa com sincronização posterior |
| MarketUP / Nex | Micro e pequenos | Modelo freemium, onboarding rápido, interface amigável para leigos |
| Saipos / Consumer / Colibri / Linx Degust | Food service | Mesas, comandas, garçom no celular, KDS (tela de cozinha), integração iFood e delivery, ficha técnica com baixa de insumos |
| Mercado Pago / PagVendas / Stone | MEI e micro | Celular ou maquininha Android como PDV, gratuito, Pix integrado |
| Shopify POS | Varejo omnichannel | Extensibilidade por apps/plugins, clienteling, trocas e devoluções omnichannel |

---

## 4. Visão do produto — o que nos torna disruptivos

1. **Vende em 3 toques.** Bipar/buscar → pagar → nota emitida. Atalhos de teclado completos para operadores experientes, telas grandes e claras para iniciantes.
2. **Offline-first de verdade.** O caixa nunca para: banco local no dispositivo, NFC-e em contingência offline, fila de sincronização com resolução de conflitos.
3. **Roda em qualquer coisa.** Navegador (PWA), desktop (Windows/Linux, com acesso a periféricos), tablet, celular e maquininhas Android (POS smart).
4. **Onboarding em 10 minutos.** Importar XMLs de notas de compra cria automaticamente produtos, fornecedores, NCM, custos e estoque. Assistente guiado para certificado digital e configuração fiscal.
5. **Motor fiscal versionado por data.** Regras tributárias em tabelas com vigência (data início/fim), não em código fixo — a transição da Reforma (2026–2033) vira atualização de dados, não reescrita.
6. **Assistente com IA (opcional e auditável).** Sugere NCM, CEST, cClassTrib e CST a partir da descrição do produto, sempre com confirmação humana e registro de quem aprovou; responde perguntas como "quanto lucrei esta semana com bebidas?".
7. **Verticais por módulo**, ativáveis em um clique: Mercado, Food Service, Moda (grade cor/tamanho), Farmácia/Pet (lote e validade), Serviços.
8. **Preço justo e transparente** (pensar em plano gratuito para MEI).

---

## 5. Requisitos fiscais — legislação atual

Implemente com fidelidade, sempre em **ambiente de homologação** da SEFAZ durante o desenvolvimento:

- **Documentos:** NF-e (modelo 55), NFC-e (modelo 65) com QR Code, NFS-e no Padrão Nacional, e CT-e/MDF-e como módulos futuros. Verifique por UF se ainda há exigência de SAT-CF-e (SP) ou MFE (CE) e trate como adaptadores.
- **Eventos:** autorização, cancelamento, carta de correção (CC-e), inutilização de numeração, contingência (NFC-e offline e SVC para NF-e), manifestação do destinatário e download de XMLs de compra (Distribuição DF-e).
- **Tributos atuais:** ICMS (incluindo ST, DIFAL, FCP), IPI, PIS/Cofins (cumulativo e não cumulativo, monofásico), ISS, regimes Simples Nacional (CSOSN), Lucro Presumido e Lucro Real (CST), CFOP, NCM, CEST, benefícios fiscais por UF.
- **Certificado digital** A1 (armazenado com criptografia) e suporte a A3 no app desktop. Assinatura XML, validação contra schemas XSD oficiais.
- **Obrigações acessórias (exportação):** SPED Fiscal (EFD ICMS/IPI), EFD-Contribuições, SINTEGRA quando exigido, e pacote de XMLs para o contador.
- **Pagamentos:** Pix com QR dinâmico via API de PSP, Pix Automático, TEF (adaptadores para integradores como SiTef, PayGo e Stone Connect), maquininhas smart, dinheiro, crediário, vale-presente.

---

## 6. Requisitos fiscais — Reforma Tributária do consumo (CRÍTICO)

Base legal: EC 132/2023 e LC 214/2025, regulamentos do IBS e da CBS publicados em 30/04/2026, Ato Conjunto RFB/CGIBS nº 4/2026 e notas técnicas do Portal da NF-e (NT 2025.002 e posteriores, incluindo NT 2026.002).

Estado conhecido em outubro/2026 (**confirme tudo nas fontes oficiais antes de implementar — as NTs mudam com frequência**):

- **2026 é ano de teste:** destaque de **CBS 0,9% e IBS 0,1%** nos documentos, com caráter informativo (sem cobrança efetiva). Em 2026 os valores de IBS, CBS e IS **não compõem o total** do item nem da nota.
- **Desde 03/08/2026:** NF-e e NFC-e de empresas **não optantes pelo Simples Nacional** são **rejeitadas** sem os campos de IBS/CBS.
- **Datas escalonadas:** 01/10/2026 (parte da NFS-e e NFCom), 01/12/2026 (expansão da NFS-e e outros documentos), **01/01/2027 para o Simples Nacional**, operações monofásicas e demais casos.
- **2027:** CBS plena, extinção de PIS/Cofins, início do Imposto Seletivo (IS). Empresas do Simples podem optar por recolher IBS/CBS por fora do Simples.
- **2029–2032:** redução gradual de ICMS e ISS com aumento proporcional do IBS. **2033:** modelo novo pleno.
- Campos novos: grupo IBS/CBS/IS por item, CST do IBS/CBS, **cClassTrib** (classificação tributária), alíquotas por ente (UF e município), reduções, créditos, regimes específicos, eventos novos da NT.
- **Split payment:** projete a arquitetura de pagamentos para suportar a separação automática do tributo na liquidação quando for regulamentada.
- **Crédito financeiro:** o ERP deve apurar débitos e créditos de IBS/CBS (não cumulatividade ampla) e gerar relatórios de conferência para o contador.

Regra de ouro: o motor fiscal deve permitir **rodar o sistema antigo e o novo em paralelo** durante toda a transição, com vigência por data e por regime.

Antes de codificar a camada fiscal, **pesquise na web a versão mais recente** das NTs e do cronograma, registre as versões usadas em `docs/fiscal/versoes.md` e me avise se algo divergir deste prompt.

---

## 7. Módulos do ERP

1. **Cadastros:** produtos (código de barras, variações, kits, pesáveis, lote/validade, fotos), clientes, fornecedores, tabelas de preço, unidades de medida, perfis fiscais por produto.
2. **PDV:** venda rápida, busca por nome/código, leitura de balança, descontos com permissão, múltiplas formas de pagamento na mesma venda, sangria, suprimento, abertura e fechamento de caixa cego, troca e devolução, orçamentos convertidos em venda, venda para cliente identificado (CPF na nota).
3. **Estoque:** movimentações rastreáveis, inventário (inclusive pelo celular), transferência entre lojas, curva ABC, alertas de mínimo, previsão de reposição.
4. **Compras:** pedidos de compra, entrada por XML (com conferência), manifestação do destinatário, custo médio e formação de preço com margem e tributos.
5. **Financeiro:** contas a pagar/receber, fluxo de caixa, DRE gerencial, conciliação bancária (OFX e Open Finance quando possível), conciliação de cartões e Pix, boletos, crediário com controle de inadimplência.
6. **Fiscal:** motor tributário (seções 5 e 6), emissão, contingência, apuração e exportações para o contador.
7. **Vendas e CRM:** pedidos, comissões, programa de fidelidade/cashback, histórico do cliente, campanhas simples (WhatsApp/e-mail com consentimento LGPD).
8. **Relatórios e painel:** vendas por período, produto, operador, loja e forma de pagamento; margem real; ticket médio; tudo exportável.
9. **Multiloja e usuários:** papéis e permissões granulares, trilha de auditoria imutável de ações sensíveis (cancelamentos, descontos, sangrias).
10. **Integrações:** marketplaces, e-commerce, iFood e apps de delivery, contabilidade, API pública documentada (OpenAPI) e webhooks para parceiros.
11. **Verticais:**
    - *Mercado:* balança (protocolos Toledo/Filizola), etiquetas, promoções avançadas, atacarejo, self-checkout.
    - *Food service:* mapa de mesas, comandas, garçom no celular, KDS, delivery com taxa por bairro, ficha técnica com baixa de insumos.
    - *Moda:* grade cor/tamanho, condicional, trocas.
    - *Farmácia/Pet:* lote, validade, controle de vencimento.
    - *Serviços:* ordem de serviço e NFS-e.

---

## 8. Arquitetura sugerida (pode propor alternativa justificada em ADR)

- **Monorepo TypeScript** (pnpm + Turborepo).
- **Backend:** Node.js (NestJS ou Fastify), PostgreSQL, Redis para filas, multi-tenant com isolamento por tenant (row-level security).
- **Frontend web/PWA:** React + Vite (ou Next.js para o backoffice), Tailwind, componentes acessíveis.
- **PDV local:** app desktop com Tauri (acesso a impressora ESC/POS, balança serial/USB, gaveta, TEF, certificado A3) + SQLite local; PWA com IndexedDB para tablet/celular. Sincronização via fila de eventos com idempotência.
- **Mobile/POS Android:** React Native ou PWA, avaliar SDKs das maquininhas.
- **Motor fiscal** como pacote isolado (`packages/fiscal`), puro, testável, com tabelas de regras versionadas por vigência. Avalie bibliotecas open source de NF-e com licença compatível antes de escrever do zero e documente a decisão.
- **Segurança e LGPD:** criptografia de certificados e dados sensíveis, backups automáticos, logs de auditoria, consentimento, exclusão/anonimização de dados.
- **Infra:** Docker Compose para desenvolvimento, CI com lint, testes e build; seeds com dados de demonstração realistas.

---

## 9. Princípios de UX

- Tudo em português do Brasil, moeda BRL, datas dd/mm/aaaa, CPF/CNPJ com validação e máscara.
- Operação de caixa 100% por teclado (F-keys documentadas) e 100% por toque.
- Mensagens de erro da SEFAZ traduzidas para linguagem humana com sugestão de correção.
- Modo claro/escuro, alto contraste, fontes grandes opcionais.
- Nenhuma tela de configuração obrigatória antes da primeira venda de teste.
- Teste de usabilidade: uma pessoa leiga deve conseguir abrir o caixa, vender e emitir NFC-e de homologação sem treinamento.

---

## 10. Plano de execução

Use o modo de planejamento antes de cada fase, crie um `CLAUDE.md` com as convenções do projeto e mantenha uma lista de tarefas atualizada.

- **Fase 0 — Pesquisa e benchmark:** usar REA (dentro das regras da seção 2) e pesquisa web para validar a matriz da seção 3; confirmar regras fiscais atuais; entregar `docs/benchmark/`, `docs/fiscal/versoes.md`, PRD (`docs/PRD.md`) e ADRs de arquitetura. **Pare e me mostre antes de codificar.**
- **Fase 1 — Fundação:** monorepo, auth, multi-tenant, cadastros, permissões, auditoria, CI, Docker.
- **Fase 2 — PDV MVP offline-first:** venda, caixa, pagamentos (dinheiro, Pix, cartão simulado), estoque básico, sincronização.
- **Fase 3 — Fiscal:** NFC-e e NF-e em homologação com IBS/CBS conforme NTs vigentes, contingência, eventos, importação de XML de compra.
- **Fase 4 — ERP:** compras, financeiro, conciliação, relatórios, DRE.
- **Fase 5 — Verticais:** Mercado e Food Service primeiro; depois Moda, Farmácia/Pet e Serviços.
- **Fase 6 — Integrações e IA:** TEF real, marketplaces, delivery, API pública, assistente com IA.
- **Fase 7 — Endurecimento:** testes de carga (meta: venda finalizada em < 1 s local), segurança, documentação de usuário e guia de implantação.

---

## 11. Definição de "pronto" (para cada fase)

- Testes unitários no motor fiscal com cobertura ≥ 90% e casos reais por regime (Simples, Presumido, Real) e por período (2026, 2027, transição).
- Testes de integração e testes end-to-end (Playwright) do fluxo de venda completo.
- Documentos fiscais validados contra os XSD oficiais e autorizados em homologação.
- PDV continua vendendo com a internet desligada e sincroniza corretamente ao reconectar (teste automatizado).
- `docker compose up` sobe tudo com dados de demonstração.
- README atualizado e changelog da fase.
- Commit ao fim de cada etapa estável.

---

## 12. Como trabalhar comigo

- Pergunte antes de decisões irreversíveis ou caras (troca de stack, serviços pagos, emissão em produção).
- Quando uma regra fiscal for ambígua, **não invente**: registre em `docs/fiscal/duvidas.md`, implemente de forma configurável e me avise — as dúvidas serão validadas com um contador.
- Seja honesto sobre limitações: se algo depende de credenciais, certificado, homologação de parceiros (TEF, PSP Pix, iFood) ou hardware que você não tem, entregue o adaptador com simulador e diga claramente o que falta para ativar em produção.
