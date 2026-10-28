import { useState } from 'react';
import { ApiError } from './api-client';

/** Minimal form state with server-side field errors (the API validates with the same Zod schemas). */
export function useForm<T extends Record<string, unknown>>(initial: T) {
  const [values, setValues] = useState<T>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const set = <K extends keyof T>(key: K, value: T[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => {
      const { [key as string]: _, ...rest } = e;
      return rest;
    });
  };

  async function submit(action: (values: T) => Promise<void>) {
    setSubmitting(true);
    setFormError(null);
    setErrors({});
    try {
      await action(values);
    } catch (error) {
      if (error instanceof ApiError) {
        const fields = error.fieldErrors();
        setErrors(fields);
        // Erro preso a um campo que este formulário não tem (ex.: components.0.quantity) não
        // aparecia em lugar nenhum e o botão só parava de girar (PIE R2-07): vai para o aviso geral.
        // Conta como visível o campo do formulário e o que começa por ele (barcodes.0 → barcodes).
        const shown = (path: string) =>
          Object.keys(values).some((key) => path === key || path.startsWith(`${key}.`));
        const hidden = Object.entries(fields).filter(([path]) => !shown(path));
        if (Object.keys(fields).length === 0) setFormError(error.message);
        else if (hidden.length > 0) setFormError(hidden.map(([, message]) => message).join(' '));
      } else {
        setFormError('Algo deu errado. Tente de novo.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return { values, set, setValues, errors, formError, submitting, submit };
}
