# PMEs e micro — Bling, Olist ERP (Tiny), VHSYS, Tedsys, MarketUP, Nex

Fonte: sites públicos, avaliações em agregadores e notícias. Nenhum software foi descompilado ou inspecionado.

## 1. Simplicidade e PDV no navegador (Bling, Olist ERP)

- **O que faz:** ERP 100% web, sem instalação; PDV abre no navegador; emissão de NFC-e incluída no plano.
- **Por que é bom:** zero atrito de instalação; o dono acessa de qualquer lugar.
- **Problema:** sistemas instalados exigem técnico, servidor e atualização manual.
- **Limite observado:** PDV web costuma depender de internet e tem acesso limitado a periféricos.
- **Como o Bipaê faz:** o mesmo PDV roda como **PWA instalável** (com SQLite em WASM, offline) e como **app Tauri** (com periféricos). Mesmo código de UI, duas embalagens (ADR-0005). NFC-e sem limite de quantidade em todos os planos.

## 2. Integração com marketplaces (Bling, Olist)

- **O que faz:** publica produtos, sincroniza estoque e importa pedidos de marketplaces.
- **Problema:** vender em vários canais sem estourar o estoque.
- **Como o Bipaê faz (Fase 6):** estoque como livro de movimentações (ADR-0004) com **reserva** por canal; conectores como adaptadores com fila e retentativa; uma visão única de pedidos.

## 3. Maquininha integrada que baixa estoque (VHSYS)

- **O que faz:** a venda na maquininha sai do sistema; aprovada, baixa estoque e registra no financeiro sem redigitar.
- **Problema:** digitar o valor duas vezes (sistema + maquininha) causa erro e divergência na conciliação.
- **Como o Bipaê faz:** camada de pagamentos com adaptadores (ADR-0009): TEF, maquininha smart, Pix via PSP. O PDV envia o valor, recebe NSU/autorização e grava tudo no mesmo evento de venda. Simulador de adquirente para desenvolvimento.

## 4. Operação offline completa (Tedsys)

- **O que faz:** sistema funciona sem internet e sincroniza depois.
- **Como o Bipaê faz:** ver supermercados §1 e ADR-0004. Diferencial: além do PDV, **consulta de preço, inventário pelo celular e comandas** também funcionam offline.

## 5. Freemium e onboarding para leigos (MarketUP, Nex)

- **O que faz:** plano gratuito de entrada; cadastro rápido; interface simples.
- **Problema:** MEI e micro não pagam por algo que não entendem; a configuração fiscal assusta.
- **Como o Bipaê faz:**
  - **Primeira venda de teste em menos de 2 minutos** após o cadastro, sem nenhuma configuração (modo demonstração com produtos de exemplo e nota em homologação).
  - **Onboarding por XML:** arraste os XMLs de compra (ou baixe via Distribuição DF-e com o certificado) e o sistema cria produtos, fornecedores, NCM, CEST, custos e estoque. É o principal acelerador do onboarding.
  - Assistente de certificado digital passo a passo, com teste de validade e aviso de vencimento.
  - Plano gratuito para MEI (ver PRD §8).

## Lacunas observadas no segmento (oportunidades)

1. Pouca transparência fiscal: o lojista não entende por que um imposto deu aquele valor. **Bipaê:** cada cálculo do motor traz uma "explicação" legível (qual regra, de qual vigência, qual base, qual alíquota).
2. Erros da SEFAZ mostrados como código cru. **Bipaê:** catálogo de rejeições traduzidas com sugestão de correção e link para a tela que resolve.
3. Preparação para a Reforma tratada como remendo. **Bipaê:** motor versionado por vigência desde o primeiro dia (ADR-0006).
