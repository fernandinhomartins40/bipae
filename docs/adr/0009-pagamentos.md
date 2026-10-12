# ADR-0009 — Pagamentos por adaptadores, prontos para split payment

**Status:** aceita (12/10/2026) · **Data:** 11/10/2026

## Contexto
Formas: dinheiro, Pix (QR dinâmico, Automático, por aproximação), cartão via TEF (SiTef, PayGo, Stone Connect...) ou maquininha smart, crediário, convênio, vale-presente. Cada integrador tem homologação própria. O split payment (LC 214, arts. 31–35) começa em 2027 de forma facultativa no B2B e depois se estende.

## Decisão
- Interface única `PaymentProvider` (`packages/payments`): `start`, `confirm`, `cancel/refund`, `status`, com eventos de ciclo de vida (`pending → authorized → captured | failed | refunded`).
- Um adaptador por integrador; **simulador** para cada tipo (dev, testes e demonstração).
- O pagamento sempre referencia a venda e, quando houver, a **chave de acesso** do documento fiscal e os valores de IBS/CBS da operação. É o insumo do split.
- Campo opcional `splitInstructions` no contrato desde o início; ignorado pelos adaptadores até a regulamentação técnica do arranjo de que participarem.
- Pix: confirmação por webhook **e** por consulta (polling com backoff), idempotente.
- Offline: só formas que não dependem de rede (dinheiro, crediário/convênio com limite em cache, TEF/maquininha que operem em contingência) ficam disponíveis; a UI explica por quê.

## Consequências
- Ativar um integrador real = escrever o adaptador + homologar com ele (exige credenciais/contrato do lojista ou parceria). Isso fica documentado por adaptador.
