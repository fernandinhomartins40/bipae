import { Alert, PageHeader, cx } from '@bipae/ui';
import { useQuery } from '@tanstack/react-query';
import { useAdmin } from './admin-app';

/**
 * Cobertura fiscal (F3-23.b): para cada UF e regime, se o motor calcula uma venda comum de
 * revenda por completo ou o que ainda falta. Mapa e plano em docs/fiscal/cobertura-ufs-regimes.md.
 */
interface Coverage {
  complete: number;
  total: number;
  rows: {
    uf: string;
    rateStatus: 'confirmado' | 'pendente' | 'divergente';
    rate: string | null;
    law: string;
    cells: { regime: string; complete: boolean; pending: string[] }[];
  }[];
}

const REGIMES: Record<string, string> = {
  mei: 'MEI',
  simples: 'Simples',
  'simples-excesso': 'Simples (sublimite)',
  presumido: 'Presumido',
  real: 'Real',
};

const STATUS: Record<Coverage['rows'][number]['rateStatus'], string> = {
  confirmado: 'confirmada',
  pendente: 'a confirmar',
  divergente: 'fontes divergem',
};

export function FiscalCoveragePage() {
  const { api } = useAdmin();
  const data = useQuery({
    queryKey: ['admin', 'fiscal-coverage'],
    queryFn: () => api.get<Coverage>('/admin/fiscal-coverage'),
  }).data;
  return (
    <>
      <PageHeader
        title="Cobertura fiscal"
        description="Venda comum de revenda: em quais UFs e regimes o Bipaê já calcula todos os impostos."
      />
      {data && (
        <>
          <div className="mb-4">
            <Alert
              tone={data.complete === data.total ? 'success' : 'warning'}
              title={`${data.complete} de ${data.total} combinações completas`}
            >
              Onde falta, a alíquota geral do ICMS da UF ainda não foi confirmada em fonte oficial
              (dúvida D-021). Os clientes dessas UFs cadastram a alíquota em Regras de ICMS, com o
              contador.
            </Alert>
          </div>
          <div className="overflow-x-auto rounded-ui border border-border">
            <table className="w-full text-sm">
              <caption className="sr-only">Cobertura por UF e regime</caption>
              <thead className="bg-surface-2">
                <tr>
                  <th scope="col" className="p-2 text-left">
                    UF
                  </th>
                  <th scope="col" className="p-2 text-left">
                    ICMS geral
                  </th>
                  {Object.values(REGIMES).map((label) => (
                    <th key={label} scope="col" className="p-2 text-center">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.uf} className="border-t border-border">
                    <th scope="row" className="p-2 text-left font-semibold">
                      {row.uf}
                    </th>
                    <td className="p-2" title={row.law}>
                      {row.rate ? `${row.rate.replace('.', ',')}%` : '—'}{' '}
                      <span className="text-muted">({STATUS[row.rateStatus]})</span>
                    </td>
                    {row.cells.map((cell) => (
                      <td
                        key={cell.regime}
                        className={cx(
                          'p-2 text-center font-semibold',
                          cell.complete ? 'text-success' : 'text-danger',
                        )}
                        title={cell.pending.join(' ')}
                      >
                        {cell.complete ? 'calcula' : 'falta'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
