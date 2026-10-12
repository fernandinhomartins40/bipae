# ADR-0011 — Assistente de IA opcional, com confirmação humana

**Status:** aceita (12/10/2026) (implementação na Fase 6) · **Data:** 11/10/2026

## Decisão
- **Opcional** por tenant; desligado não afeta nenhuma função.
- **Sugestão fiscal** (NCM, CEST, cClassTrib, CST): a IA só sugere, com justificativa e nível de confiança; **nunca grava sozinha**. A aprovação registra quem aprovou, quando, a sugestão original e o modelo usado (auditoria).
- **Perguntas sobre o negócio** ("quanto lucrei esta semana com bebidas?"): a IA traduz a pergunta em chamadas a ferramentas de relatório tipadas e com escopo do tenant (RLS); nunca recebe SQL livre nem dados de outros tenants.
- Dados pessoais de clientes não são enviados ao provedor de IA; agregados e cadastro de produto, sim, com aviso no termo de uso.
- Provedor: modelos Claude via API, atrás de uma interface própria para permitir troca.

## Consequências
- Custo por uso precisa caber no preço do plano; medir na Fase 6.
