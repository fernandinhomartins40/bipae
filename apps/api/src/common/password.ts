import { passwordProblem } from '@bipae/domain';
import { AppError } from './errors';

/** Recusa senha comum ou que repete o e-mail ou o nome da pessoa (F7-02, OWASP ASVS 2.1). */
export function assertPasswordAllowed(
  password: string,
  person: { email?: string | null; name?: string | null },
) {
  const problem = passwordProblem(password, person);
  if (problem) {
    throw new AppError(400, 'validation', problem, [{ path: 'password', message: problem }]);
  }
}
