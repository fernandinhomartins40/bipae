# ADR-0006 — Motor fiscal puro com regras versionadas por vigência

**Status:** aceita (12/10/2026) · **Data:** 11/10/2026

## Contexto
Entre 2026 e 2033 o Brasil roda dois sistemas tributários em paralelo (ICMS/ISS/PIS/Cofins/IPI e IBS/CBS/IS), com alíquotas, regras de validação e obrigatoriedades mudando por data, regime, UF e município. As NTs mudaram mais de dez vezes em um ano (ver `docs/fiscal/versoes.md`). Regra fixa em código vira reescrita a cada NT.

## Decisão

### Pacote puro
`packages/fiscal` não faz I/O. Entrada: contexto da operação (emitente, destinatário, itens, data de emissão, UF/município de origem e destino, finalidade) + conjunto de regras. Saída: tributos por item e totais, **com explicação** (trace) de cada valor.

### Regras como dados (`packages/fiscal-rules`)
Cada regra tem:
- `vigencia: { inicio, fim? }` — intervalo semiaberto `[inicio, fim)`;
- escopo: tributo, regime (CRT), UF, município, NCM (prefixo), CEST, cClassTrib, CFOP, tipo de operação;
- efeito: alíquota, redução de base, CST/CSOSN, diferimento, crédito presumido, flags (ex.: `compoeTotal`);
- `fonte`: norma/NT e versão que a justificam (para auditoria e para o contador).

Seleção da regra: filtra por vigência na **data do fato gerador** e escolhe a mais específica; empate é erro de dados (detectado em teste de consistência das tabelas, nunca em produção).

### Dois sistemas em paralelo
O motor sempre calcula os dois "trilhos" (atual e IBS/CBS/IS); a vigência decide o que é exigido, informativo ou ausente. 2026: IBS/CBS informativos; 2027: CBS plena, PIS/Cofins zerados por vigência; 2029–2032: redução de ICMS/ISS por tabela; 2033: só o novo.

### Validação de leiaute
Regras de validação da SEFAZ relevantes (ex.: UB12-10, VC02-14) são replicadas como **validações locais com vigência** para que o lojista veja o problema antes de transmitir.

### Distribuição
As tabelas são versionadas no repositório e publicadas para os PDVs como dados (sincronização, ADR-0004). Atualizar uma alíquota não exige novo build do PDV.

## Alternativas
- **Serviço fiscal terceirizado (API de cálculo):** depende de internet, quebra o offline-first e cria custo por documento. Pode ser usado como **conferência** opcional no futuro.

## Consequências
- Cobertura ≥ 90% e matriz de testes: regime (Simples, Presumido, Real) × período (2026, 2027, 2029–2032, 2033) × UF de exemplo.
- Toda dúvida de `docs/fiscal/duvidas.md` vira flag em tabela, nunca `if` no código.
