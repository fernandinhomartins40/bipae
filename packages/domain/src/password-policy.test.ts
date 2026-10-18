import { describe, expect, it } from 'vitest';
import { passwordSchema } from './contracts';
import { passwordProblem } from './password-policy';

describe('política de senha (F7-02, ASVS 2.1)', () => {
  it('recusa as senhas óbvias, sem diferenciar maiúscula e acento', () => {
    for (const p of ['12345678', 'Senha123', 'SÃOPAULO', 'aaaaaaaa', '1234567890123', 'Password1']) {
      expect(passwordProblem(p), p).toContain('muito comum');
    }
  });

  it('recusa a senha que repete o e-mail ou o nome', () => {
    expect(passwordProblem('joana.lima2026', { email: 'joana.lima@exemplo.com.br' })).toContain(
      'e-mail',
    );
    expect(passwordProblem('ana@x.com', { email: 'ana@x.com' })).toContain('e-mail');
    expect(passwordProblem('Fernanda123', { name: 'Fernanda Souza' })).toContain('nome');
    expect(passwordProblem('rosa1234', { name: 'Rosa' })).toContain('nome');
  });

  it('aceita frase ou senha longa sem regra de composição', () => {
    expect(passwordProblem('cafe com pao de queijo')).toBeNull();
    expect(passwordProblem('senha-forte-123', { email: 'ana@x.com', name: 'Ana' })).toBeNull();
    expect(passwordSchema.safeParse('12345678').success).toBe(false);
    expect(passwordSchema.safeParse('curta').error?.issues).toHaveLength(1);
    expect(passwordSchema.safeParse('cafe com pao de queijo').success).toBe(true);
  });
});
