# ADR-0007 — XML fiscal próprio em TypeScript (sem lib GPL)

**Status:** aceita (12/10/2026) · **Data:** 11/10/2026

## Contexto
Precisamos montar, assinar, validar (XSD) e transmitir NF-e/NFC-e (e depois NFS-e Nacional), com eventos, contingência e Distribuição DF-e. O briefing pede avaliar bibliotecas open source antes de escrever do zero.

## Bibliotecas avaliadas

| Projeto | Linguagem | Licença | RTC (IBS/CBS) | Avaliação |
|---|---|---|---|---|
| nfephp-org/sped-nfe | PHP | **LGPLv3 ou MIT (à escolha)** | Sim (NT 2025.002 v1.20+, schema PL_010) | Madura (1,6 mil estrelas). Linguagem diferente da stack; usar como **referência de comportamento** (permitido pela MIT) |
| NFeWizard (`nfewizard-io`) | Node/TS | **GPL-3.0** | Não confirmado | **Descartada:** GPL contaminaria o produto proprietário. Não ler o código, para manter a sala limpa |
| ACBr / ACBrLib | Delphi/Lazarus (DLL/SO) | LGPL | Sim | Muito completa; integração via FFI no Tauri seria possível, mas não roda no PWA nem no servidor Node com facilidade. **Plano B** |
| SDKs de APIs pagas (NFE.io, Focus, Tecnospeed) | — | Comercial | Sim | Custo por nota e dependência de internet. Opção comercial futura para quem preferir |

## Decisão
Implementação própria em `packages/fiscal`:
- **Tipos gerados a partir dos XSD oficiais** do pacote de schemas vigente, não escritos à mão.
- Serialização com builder XML determinístico (ordem de elementos conforme XSD).
- Assinatura XMLDSig (RSA-SHA1/C14N, conforme manual) com biblioteca MIT (`xml-crypto` ou equivalente) para A1; A3 via plugin PKCS#11 no Tauri.
- Validação XSD em teste e antes da transmissão (libxml2 via WASM).
- Comunicação SOAP com os web services da SEFAZ/SVRS/SVC em módulo de I/O separado (`apps/api` e `apps/desktop`), mantendo o pacote puro.
- QR Code da NFC-e versão vigente com CSC.

## Consequências
- Mais trabalho inicial que adotar uma lib pronta, mas: mesma linguagem do motor, roda no servidor, no Tauri e no navegador, e o controle sobre a cadência de NTs fica conosco.
- Se o cronograma apertar, o ACBrLib no Tauri é o plano B para emissão no PDV desktop.
