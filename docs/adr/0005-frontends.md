# ADR-0005 — Um PDV, duas embalagens (PWA e Tauri); backoffice em Vite

**Status:** substituída pela [ADR-0012](0012-pdv-web-desktop-codigo-compartilhado.md) em 12/10/2026 · **Data:** 11/10/2026

## Contexto
O PDV precisa rodar no navegador, celular, tablet e desktop com periféricos (impressora ESC/POS, gaveta, balança, TEF, certificado A3). Manter dois PDVs diferentes dobraria o custo e os bugs.

## Decisão
- **Um único app React + Vite** (`apps/web`) com duas áreas: backoffice e PDV.
- **PWA:** instalável, offline (service worker + SQLite WASM).
- **Tauri 2** (`apps/desktop`) embala o mesmo build e expõe plugins Rust por uma interface `Peripherals`:
  - impressora ESC/POS (USB/serial/rede), gaveta via impressora;
  - balança serial/USB;
  - TEF (bibliotecas dos integradores);
  - certificado A3 (PKCS#11) para assinatura.
  No PWA, a mesma interface usa WebUSB/WebSerial quando houver, impressão via navegador ou "ponte" para um PDV Tauri na rede local.
- **Backoffice em Vite, não Next.js:** é uma SPA autenticada, sem necessidade de SEO/SSR; compartilha componentes e estado com o PDV. O site institucional (bipae.com.br) pode ser separado e estático.
- Tailwind + Radix; tokens de marca no `packages/ui`; modo claro/escuro, alto contraste e fonte grande.
- Atalhos: F-keys documentadas e visíveis na tela; tudo também por toque.
- Som de "bip" de confirmação a cada venda (desativável).

## Alternativas
- **Electron:** mais pesado (~10× o tamanho), maior consumo de memória em PCs fracos de caixa.
- **React Native para POS Android:** só se o SDK de alguma maquininha exigir app nativo; avaliar na Fase 6.

## Consequências
- Código de UI do PDV não pode chamar periféricos diretamente: sempre pela interface `Peripherals` (com simuladores em dev/teste).
