/**
 * Política de senha (F7-02, OWASP ASVS 2.1): pelo menos 8 caracteres, sem regra de composição,
 * e recusa das senhas mais óbvias e das que repetem o e-mail ou o nome da pessoa. A lista é curta
 * e fica no código, sem consulta externa: o cadastro funciona sem rede de terceiros.
 */
const COMMON = new Set([
  '12345678',
  '123456789',
  '1234567890',
  '12345678910',
  '87654321',
  '11111111',
  '00000000',
  '01234567',
  '11223344',
  '12341234',
  '12121212',
  '123123123',
  '112233445566',
  '99999999',
  '88888888',
  '77777777',
  '66666666',
  '55555555',
  '44444444',
  '33333333',
  '22222222',
  'abcd1234',
  'abc12345',
  'abcdefgh',
  'qwertyui',
  'qwerty123',
  'asdfghjk',
  'zxcvbnm1',
  'password',
  'password1',
  'password123',
  'passw0rd',
  'iloveyou',
  'sunshine',
  'princess',
  'football',
  'baseball',
  'welcome1',
  'trustno1',
  'superman',
  'whatever',
  'letmein1',
  'senha123',
  'senha1234',
  'senha12345',
  'minhasenha',
  'mudar123',
  'trocar123',
  'senhasenha',
  'admin123',
  'admin1234',
  'administrador',
  'brasil123',
  'brasil2026',
  'flamengo',
  'corinthians',
  'palmeiras',
  'saopaulo',
  'vasco123',
  'gremio123',
  'cruzeiro',
  'botafogo',
  'fluminense',
  'santos123',
  'internacional',
  'atletico',
  'bipaebipae',
  'mercado123',
  'loja1234',
  'caixa123',
  'vendas123',
  'teste123',
  'teste1234',
  'testando',
  'deusefiel',
  'jesuscristo',
  'eusouamor',
  'amor1234',
  'meuamor1',
  'familia1',
  'felicidade',
  'qwerty12',
]);

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

/** Motivo para recusar a senha, em português, ou null se ela serve. */
export function passwordProblem(
  password: string,
  person: { email?: string | null; name?: string | null } = {},
): string | null {
  const p = fold(password);
  if (COMMON.has(p) || /^(.)\1+$/.test(p) || /^(0123456789|1234567890)+/.test(p)) {
    return 'Essa senha é muito comum. Escolha outra, mais difícil de adivinhar.';
  }
  const local = fold(person.email?.split('@')[0] ?? '');
  if (local.length >= 4 && p.includes(local)) return 'A senha não pode repetir o seu e-mail.';
  if (person.email && p === fold(person.email)) return 'A senha não pode repetir o seu e-mail.';
  const names = fold(person.name ?? '')
    .split(/\s+/)
    .filter((n) => n.length >= 4);
  if (names.some((n) => p === n || p === `${n}123` || p === `${n}1234`)) {
    return 'A senha não pode ser o seu nome.';
  }
  return null;
}
