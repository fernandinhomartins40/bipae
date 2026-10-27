import {
  Catch,
  HttpException,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { ApiErrorBody } from '@bipae/domain';
import type { FastifyReply } from 'fastify';
import { z, ZodError, type ZodType } from 'zod';

// Regras sem mensagem própria chegavam ao usuário em inglês (PIE R2-06).
z.config(z.locales.pt());

/** Error with a user-facing pt-BR message (UX rule: errors explain cause and fix). */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly issues?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new AppError(404, 'not_found', `${what} não encontrado.`);
export const forbidden = () =>
  new AppError(
    403,
    'forbidden',
    'Você não tem permissão para fazer isso. Peça ao dono ou gerente.',
  );

export function parse<S extends ZodType>(schema: S, value: unknown) {
  const result = schema.safeParse(value);
  if (!result.success) throw fromZod(result.error);
  return result.data as S['_output'];
}

function fromZod(error: ZodError): AppError {
  const issues = error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  return new AppError(400, 'validation', issues[0]?.message ?? 'Dados inválidos.', issues);
}

/** PostgreSQL error codes we translate. */
const PG_UNIQUE = '23505';
const PG_FK = '23503';
const PG_RLS = '42501';

const UNIQUE_MESSAGES: Record<string, string> = {
  users_email_key: 'Já existe uma conta com este e-mail.',
  products_sku_key: 'Já existe um produto com este código interno (SKU).',
  product_barcodes_pkey: 'Este código de barras já está em outro produto.',
  customers_tax_id_key: 'Já existe um cliente com este CPF/CNPJ.',
  suppliers_tax_id_key: 'Já existe um fornecedor com este CPF/CNPJ.',
  companies_tax_id_key: 'Já existe uma empresa com este CNPJ.',
  units_pkey: 'Já existe uma unidade com este código.',
  fiscal_profiles_tenant_id_name_key: 'Já existe um perfil fiscal com este nome.',
  price_tables_tenant_id_name_key: 'Já existe uma tabela de preço com este nome.',
  roles_tenant_id_name_key: 'Já existe um papel com este nome.',
  memberships_pkey: 'Esta pessoa já faz parte da equipe.',
  terminals_company_id_nfce_series_key: 'Esta série de NFC-e já está em uso. Tente de novo.',
};

function pgError(error: unknown): { code: string; constraint?: string } | null {
  let current: unknown = error;
  for (let depth = 0; current && depth < 4; depth++) {
    const e = current as { code?: unknown; constraint?: string; cause?: unknown };
    if (typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)) {
      return { code: e.code, ...(e.constraint && { constraint: e.constraint }) };
    }
    current = e.cause;
  }
  return null;
}

/**
 * Resumo de um erro para o log sem os parâmetros da consulta (CPF, valores): o texto do erro do
 * driver traz a consulta inteira (PIE R1-14).
 */
export function errorSummary(error: unknown): string {
  const pg = pgError(error);
  if (pg) return `erro do banco ${pg.code}${pg.constraint ? ` (${pg.constraint})` : ''}`;
  return (error as Error)?.message ?? String(error);
}

export function toApiError(error: unknown): ApiErrorBody {
  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
      ...(error.issues && { issues: error.issues }),
    };
  }
  if (error instanceof ZodError) return toApiError(fromZod(error));
  if (error instanceof HttpException) {
    const status = error.getStatus();
    return {
      statusCode: status,
      code: status === 404 ? 'not_found' : 'http_error',
      message: status === 404 ? 'Endereço não encontrado.' : error.message,
    };
  }
  const pg = pgError(error);
  if (pg?.code === PG_UNIQUE) {
    return {
      statusCode: 409,
      code: 'conflict',
      message: UNIQUE_MESSAGES[pg.constraint ?? ''] ?? 'Este registro já existe.',
    };
  }
  if (pg?.code === PG_FK) {
    return {
      statusCode: 409,
      code: 'reference',
      message: 'Este registro está ligado a outro que não existe ou ainda está em uso.',
    };
  }
  if (pg?.code === PG_RLS) {
    return { statusCode: 403, code: 'forbidden', message: 'Acesso negado a este registro.' };
  }
  return {
    statusCode: 500,
    code: 'internal',
    message: 'Algo deu errado do nosso lado. Já registramos o problema; tente de novo.',
  };
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ApiError');

  catch(exception: unknown, host: ArgumentsHost) {
    const body = toApiError(exception);
    if (body.statusCode >= 500) this.logger.error(exception);
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    void reply.status(body.statusCode).send(body);
  }
}
