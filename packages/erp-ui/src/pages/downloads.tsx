import { formatFileSize, type DesktopFile, type DesktopRelease } from '@bipae/domain';
import { Alert, buttonClass, Card, Logo, PageHeader, Spinner } from '@bipae/ui';
import { useQuery } from '@tanstack/react-query';
import { Download, MonitorCheck } from 'lucide-react';
import { Link } from 'react-router';
import { useApp } from '../context';

const BENEFITS = [
  'Impressora térmica, balança e gaveta ligadas direto no computador.',
  'Vende sem internet e envia tudo quando a conexão volta.',
  'Traz o Bipaê Conector: os caixas abertos no navegador deste computador também usam a impressora e a balança.',
  'Mesma conta e mesmos dados do Bipaê no navegador: dá para misturar os dois na mesma loja.',
];

/** Recommended installer for this visitor's system (Windows when unsure). */
function recommended(files: DesktopFile[]): DesktopFile | undefined {
  const linux =
    typeof navigator !== 'undefined' &&
    /Linux/.test(navigator.userAgent) &&
    !/Android/.test(navigator.userAgent);
  const order = linux
    ? ['linux-deb', 'linux-appimage', 'windows-setup']
    : ['windows-setup', 'windows-msi'];
  for (const kind of order) {
    const file = files.find((f) => f.kind === kind);
    if (file) return file;
  }
  return files[0];
}

function DownloadContent({ inApp }: { inApp: boolean }) {
  const { api, platform } = useApp();
  const release = useQuery({
    queryKey: ['downloads', 'desktop'],
    queryFn: () => api.get<DesktopRelease>('/downloads/desktop'),
    staleTime: 10 * 60_000,
  });

  if (platform.kind === 'desktop') {
    return (
      <Alert tone="success" title="Você já está no Bipaê Desktop">
        Versões novas ficam em www.bipae.com.br/app/download. Para atualizar, baixe e instale por
        cima: as vendas e os dados do caixa são mantidos.
      </Alert>
    );
  }

  const data = release.data;
  const main = data?.available ? recommended(data.files) : undefined;

  return (
    <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
      <Card>
        {release.isPending ? (
          <div className="flex items-center gap-3 text-muted">
            <Spinner /> Procurando a versão mais recente…
          </div>
        ) : main && data ? (
          <>
            <h2 className="text-xl font-bold">Versão {data.version}</h2>
            {data.publishedAt && (
              <p className="text-muted">
                Publicada em {new Date(data.publishedAt).toLocaleDateString('pt-BR')}
              </p>
            )}
            <a
              href={main.url}
              className={buttonClass('primary', 'lg') + ' mt-5 w-full sm:w-auto'}
              download
            >
              <Download className="size-6" aria-hidden />
              Baixar para {main.kind.startsWith('linux') ? 'Linux' : 'Windows'}
            </a>
            <p className="mt-2 text-sm text-muted">
              {main.label} · {formatFileSize(main.sizeBytes)}
            </p>

            {data.files.length > 1 && (
              <>
                <h3 className="mt-6 font-semibold">Outras opções</h3>
                <ul className="mt-2 flex flex-col gap-2">
                  {data.files
                    .filter((f) => f !== main)
                    .map((f) => (
                      <li key={f.kind}>
                        <a href={f.url} className="font-medium text-primary underline" download>
                          {f.label}
                        </a>
                        <span className="text-sm text-muted"> · {formatFileSize(f.sizeBytes)}</span>
                      </li>
                    ))}
                </ul>
              </>
            )}

            <h3 className="mt-6 font-semibold">Como instalar</h3>
            <ol className="mt-2 flex list-decimal flex-col gap-2 pl-5">
              <li>Abra o arquivo baixado e siga o instalador.</li>
              <li>
                Se o Windows mostrar <strong>"O Windows protegeu o computador"</strong>, clique em{' '}
                <strong>Mais informações</strong> e depois em <strong>Executar assim mesmo</strong>.
                O aviso aparece porque o instalador ainda não tem assinatura digital; o arquivo vem
                direto do Bipaê.
              </li>
              <li>Abra o Bipaê e entre com o mesmo e-mail e senha da sua conta.</li>
              <li>
                Em <strong>Abrir o caixa</strong>, escolha qual caixa é este computador ou crie um
                novo. Pronto: Bipou? Bipaê!
              </li>
            </ol>
          </>
        ) : (
          <>
            <h2 className="text-xl font-bold">O instalador está quase pronto</h2>
            <p className="mt-2 text-muted">
              Ainda não há uma versão do Bipaê Desktop para baixar. Enquanto isso, o caixa funciona
              direto no navegador, inclusive sem internet (Chrome ou Edge).
            </p>
            {inApp && (
              <Link to="/caixa" className={buttonClass('secondary') + ' mt-4'}>
                Abrir o caixa no navegador
              </Link>
            )}
          </>
        )}
      </Card>

      <Card>
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <MonitorCheck className="size-5 text-primary" aria-hidden /> Para que serve
        </h2>
        <ul className="mt-3 flex list-disc flex-col gap-2 pl-5">
          {BENEFITS.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
        <h3 className="mt-5 font-semibold">Precisa de</h3>
        <p className="text-muted">
          Windows 10 ou 11 (64 bits), ou Linux Ubuntu 22.04 ou mais novo. 4 GB de memória já bastam.
        </p>
      </Card>
    </div>
  );
}

/** Inside the back office (menu "Baixar o Bipaê Desktop"). */
export function DownloadsPage() {
  return (
    <>
      <PageHeader
        title="Bipaê Desktop"
        description="O caixa de balcão instalado no computador, com impressora, balança e gaveta."
      />
      <DownloadContent inApp />
    </>
  );
}

/** Public page (no login), linked from the landing page: /app/download. */
export function PublicDownloadsPage() {
  return (
    <main className="mx-auto max-w-5xl p-4 md:p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Logo className="text-3xl" />
        <Link to="/entrar" className="font-semibold text-primary underline">
          Entrar na minha conta
        </Link>
      </div>
      <h1 className="text-3xl font-bold">Baixe o Bipaê Desktop</h1>
      <p className="mb-6 mt-1 text-lg text-muted">
        O caixa de balcão instalado no computador, com impressora, balança e gaveta.
      </p>
      <DownloadContent inApp={false} />
    </main>
  );
}
