import {
  cfopGroup,
  classTribStatus,
  findCest,
  findCfop,
  findClassTrib,
  findOrigin,
  findTaxSituation,
  isCfopValidOn,
} from '@bipae/fiscal/tables';
import { findNcm, isNcmValidOn } from '@bipae/fiscal/tables/ncm';
import { AppError } from '../../common/errors';

/**
 * Confere os códigos fiscais do cadastro contra as tabelas oficiais do motor (@bipae/fiscal).
 * O formato já foi validado pelos schemas do domínio; aqui a pergunta é "esse código existe e
 * vale hoje?". Erro de cadastro pego aqui não vira nota rejeitada na SEFAZ depois.
 */
type Issue = { path: string; message: string };

/** Data de hoje (AAAA-MM-DD) para as conferências de vigência. */
export const today = () => new Date().toISOString().slice(0, 10);

function fail(issues: Issue[]): void {
  if (issues.length > 0) throw new AppError(400, 'validation', issues[0]!.message, issues);
}

export function assertProductFiscal(
  input: { ncm?: string | null | undefined; cest?: string | null | undefined },
  date = today(),
): void {
  const issues: Issue[] = [];
  if (input.ncm) {
    const ncm = findNcm(input.ncm);
    if (!ncm) {
      issues.push({ path: 'ncm', message: `O NCM ${input.ncm} não existe na tabela vigente. Confira o código.` });
    } else if (!isNcmValidOn(ncm, date)) {
      issues.push({ path: 'ncm', message: `O NCM ${input.ncm} ainda não está em vigor.` });
    }
  }
  if (input.cest && !findCest(input.cest, date)) {
    issues.push({ path: 'cest', message: `O CEST ${input.cest} não existe na tabela vigente. Confira o código.` });
  }
  fail(issues);
}

export interface FiscalProfileCodes {
  origem: number;
  cfopInterna: string;
  cfopInterestadual: string;
  csosn?: string | null | undefined;
  cstIcms?: string | null | undefined;
  cstPisCofins?: string | null | undefined;
  cClassTrib?: string | null | undefined;
}

export function assertFiscalProfile(input: FiscalProfileCodes, date = today()): void {
  const issues: Issue[] = [];
  if (!findOrigin(input.origem)) {
    issues.push({ path: 'origem', message: 'Origem da mercadoria inválida.' });
  }

  const cfop = (path: 'cfopInterna' | 'cfopInterestadual', scope: 'interna' | 'interestadual', label: string) => {
    const code = input[path];
    const found = findCfop(code);
    const group = cfopGroup(code);
    if (!found || !isCfopValidOn(found, date)) {
      issues.push({ path, message: `O CFOP ${code} não existe na tabela vigente.` });
    } else if (!found.nfe) {
      issues.push({ path, message: `O CFOP ${code} não pode ser usado em NF-e nem em NFC-e.` });
    } else if (group?.direction !== 'saida' || group.scope !== scope) {
      issues.push({ path, message: `O CFOP ${code} não é de ${label}. Os CFOP de ${label} começam com ${scope === 'interna' ? '5' : '6'}.` });
    }
  };
  cfop('cfopInterna', 'interna', 'venda dentro do estado');
  cfop('cfopInterestadual', 'interestadual', 'venda para outro estado');

  if (input.csosn && !findTaxSituation('csosn', input.csosn)) {
    issues.push({ path: 'csosn', message: `O CSOSN ${input.csosn} não existe.` });
  }
  if (input.cstIcms && !findTaxSituation('icms', input.cstIcms)) {
    issues.push({ path: 'cstIcms', message: `O CST de ICMS ${input.cstIcms} não existe.` });
  }
  if (input.cstPisCofins && !findTaxSituation('pis', input.cstPisCofins)) {
    issues.push({ path: 'cstPisCofins', message: `O CST de PIS/COFINS ${input.cstPisCofins} não existe.` });
  }
  if (input.cClassTrib) {
    const item = findClassTrib(input.cClassTrib);
    if (!item) {
      issues.push({ path: 'cClassTrib', message: `A classificação tributária ${input.cClassTrib} não existe na tabela oficial.` });
    } else if (classTribStatus(item, date) !== 'vigente') {
      issues.push({ path: 'cClassTrib', message: `A classificação tributária ${input.cClassTrib} não está em vigor.` });
    }
  }
  fail(issues);
}
