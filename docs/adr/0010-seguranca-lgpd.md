# ADR-0010 — Certificados, auditoria imutável e LGPD

**Status:** aceita (12/10/2026) · **Data:** 11/10/2026

## Decisão

### Certificado A1 e segredos
- **Criptografia envelopada:** cada segredo cifrado com chave de dados (AES-256-GCM), que por sua vez é cifrada por uma chave mestra em KMS (na nuvem) ou variável de ambiente protegida (desenvolvimento).
- O PFX nunca é devolvido pela API depois do upload; a senha nunca é logada.
- No PDV desktop, o A1 é guardado no cofre do sistema operacional (Windows Credential Manager / libsecret) e usado só para assinar. A3 via PKCS#11.

### Trilha de auditoria imutável
- Tabela `audit_log` só com INSERT (sem UPDATE/DELETE para o papel da aplicação).
- **Encadeamento por hash:** cada registro guarda `hash = sha256(prev_hash + conteúdo)`, por tenant; verificação periódica detecta adulteração.
- Ações sensíveis exigem autorização (PIN/senha do gerente) e registram quem pediu e quem autorizou.

### LGPD
- Inventário de dados pessoais por tabela (finalidade e base legal).
- Consentimento registrado (data, canal, texto aceito) para marketing (WhatsApp/e-mail); CPF na nota é obrigação legal, não marketing.
- **Anonimização** do cliente a pedido, preservando documentos fiscais (que têm guarda obrigatória de 5 anos).
- Backups automáticos cifrados, com teste de restauração.

## Consequências
- Fixtures de teste usam certificados de teste gerados localmente, nunca reais.
