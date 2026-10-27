import { encodeReceipt, type ReceiptBlock } from '@bipae/pdv-core';
import {
  loadTefConfig,
  saveTefConfig,
  TEF_PROVIDER_INFO,
  TEF_PROVIDERS,
  tefMissing,
  type CertificateInfo,
  type DeviceConfig,
  type PrinterConfig,
  type TefConfig,
  type TefProvider,
} from '@bipae/platform';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  PageHeader,
  SelectField,
  TextField,
} from '@bipae/ui';
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useApp } from '../context';
import { SmartTerminalSettings } from './smart-terminal';

const TEST_PAGE: ReceiptBlock[] = [
  { kind: 'text', text: 'Bipaê', align: 'center', bold: true },
  { kind: 'text', text: 'Teste de impressão: ação, maçã, café', align: 'center' },
  { kind: 'text', text: 'Bipou? Bipaê!', align: 'center' },
];

const BAUD_RATES = ['2400', '4800', '9600', '19200', '38400', '115200'];

/** Printer, scale and drawer for this computer, plus the Bipaê Conector (ADR-0012). */
export function DevicesPage() {
  const { platform } = useApp();
  return (
    <>
      <PageHeader
        title="Periféricos"
        description="Impressora térmica, balança e gaveta deste computador."
      />
      <div className="grid gap-6 xl:grid-cols-2">
        {platform.devices && <NativeDevices />}
        {platform.connectorHost && <ConnectorHost />}
        {platform.serialScale?.supported && <SerialScale />}
        {platform.connector && <ConnectorPairing />}
        {platform.certificate?.install && <LocalCertificate />}
        {platform.smartTerminal && <SmartTerminalSettings />}
        <TefSettings />
        <DeviceTests />
      </div>
    </>
  );
}

function NativeDevices() {
  const { platform } = useApp();
  const devices = platform.devices!;
  const [ports, setPorts] = useState<string[]>([]);
  const [printers, setPrinters] = useState<string[]>([]);
  const [config, setConfig] = useState<DeviceConfig | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    void devices.listSerialPorts().then(setPorts);
    void devices.listPrinters?.().then(setPrinters);
    void devices.getConfig().then(setConfig);
  }, [devices]);
  if (!config) return null;

  const printer: PrinterConfig = config.printer ?? {
    transport: 'tcp',
    host: '',
    port: 9100,
    columns: 48,
    codePage: 3,
  };
  const setPrinter = (patch: Partial<PrinterConfig>) =>
    setConfig({ ...config, printer: { ...printer, ...patch } as PrinterConfig });
  const portOptions = [
    { value: '', label: 'Escolha a porta' },
    ...ports.map((p) => ({ value: p, label: p })),
  ];

  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await devices.setConfig(config);
      setMessage({ ok: true, text: 'Periféricos salvos.' });
    } catch (error) {
      setMessage({ ok: false, text: (error as Error).message });
    }
  };

  return (
    <Card>
      <form onSubmit={save} className="flex flex-col gap-4">
        <h2 className="text-lg font-bold">Neste computador</h2>
        {message && <Alert tone={message.ok ? 'success' : 'danger'}>{message.text}</Alert>}
        <Checkbox
          label="Usar impressora térmica"
          checked={Boolean(config.printer)}
          onChange={(v) => setConfig({ ...config, ...(v ? { printer } : { printer: undefined }) })}
        />
        {config.printer && (
          <>
            <SelectField
              label="Conexão da impressora"
              value={printer.transport}
              onChange={(e) =>
                setConfig({
                  ...config,
                  printer:
                    e.target.value === 'tcp'
                      ? {
                          transport: 'tcp',
                          host: '',
                          port: 9100,
                          columns: printer.columns,
                          codePage: printer.codePage,
                        }
                      : e.target.value === 'spooler'
                        ? {
                            transport: 'spooler',
                            printerName: '',
                            columns: printer.columns,
                            codePage: printer.codePage,
                          }
                        : {
                            transport: 'serial',
                            port: '',
                            baudRate: 9600,
                            columns: printer.columns,
                            codePage: printer.codePage,
                          },
                })
              }
              options={[
                { value: 'tcp', label: 'Rede (IP)' },
                { value: 'serial', label: 'USB ou serial (porta COM)' },
                ...(devices.listPrinters
                  ? [{ value: 'spooler', label: 'Impressora do Windows (USB)' }]
                  : []),
              ]}
            />
            {printer.transport === 'spooler' ? (
              <SelectField
                label="Impressora instalada no Windows"
                hint="A impressora térmica precisa estar instalada no Windows. O Bipaê manda os comandos dela sem conversão (modo RAW)."
                value={printer.printerName}
                onChange={(e) => setPrinter({ printerName: e.target.value })}
                options={[
                  {
                    value: '',
                    label: printers.length
                      ? 'Escolha a impressora'
                      : 'Nenhuma impressora encontrada',
                  },
                  ...printers.map((p) => ({ value: p, label: p })),
                ]}
              />
            ) : printer.transport === 'tcp' ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  label="IP da impressora"
                  placeholder="192.168.0.50"
                  value={printer.host}
                  onChange={(e) => setPrinter({ host: e.target.value })}
                />
                <TextField
                  label="Porta"
                  inputMode="numeric"
                  value={String(printer.port)}
                  onChange={(e) => setPrinter({ port: Number(e.target.value) || 9100 })}
                />
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField
                  label="Porta da impressora"
                  value={printer.port}
                  onChange={(e) => setPrinter({ port: e.target.value })}
                  options={portOptions}
                />
                <SelectField
                  label="Velocidade"
                  value={String(printer.baudRate)}
                  onChange={(e) => setPrinter({ baudRate: Number(e.target.value) })}
                  options={BAUD_RATES.map((b) => ({ value: b, label: b }))}
                />
              </div>
            )}
            <SelectField
              label="Largura do papel"
              value={String(printer.columns)}
              onChange={(e) => setPrinter({ columns: Number(e.target.value) as 32 | 48 })}
              options={[
                { value: '48', label: '80 mm (48 colunas)' },
                { value: '32', label: '58 mm (32 colunas)' },
              ]}
            />
            <Checkbox
              label="Abrir a gaveta pela impressora em vendas no dinheiro"
              checked={config.drawerViaPrinter !== false}
              onChange={(v) => setConfig({ ...config, drawerViaPrinter: v })}
            />
          </>
        )}
        <Checkbox
          label="Usar balança"
          hint="Balanças Toledo e Filizola por cabo serial/USB."
          checked={Boolean(config.scale)}
          onChange={(v) =>
            setConfig({ ...config, scale: v ? { port: '', baudRate: 9600 } : undefined })
          }
        />
        {config.scale && (
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label="Porta da balança"
              value={config.scale.port}
              onChange={(e) =>
                setConfig({ ...config, scale: { ...config.scale!, port: e.target.value } })
              }
              options={portOptions}
            />
            <SelectField
              label="Velocidade da balança"
              value={String(config.scale.baudRate)}
              onChange={(e) =>
                setConfig({
                  ...config,
                  scale: { ...config.scale!, baudRate: Number(e.target.value) },
                })
              }
              options={BAUD_RATES.map((b) => ({ value: b, label: b }))}
            />
          </div>
        )}
        <Button type="submit">Salvar periféricos</Button>
      </form>
    </Card>
  );
}

function ConnectorHost() {
  const { platform } = useApp();
  const host = platform.connectorHost!;
  const [status, setStatus] = useState<Awaited<ReturnType<typeof host.status>> | null>(null);
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const reload = () => void host.status().then(setStatus);
  useEffect(reload, [host]);
  useEffect(() => {
    void host.autostart
      ?.isEnabled()
      .then(setAutostart)
      .catch(() => setAutostart(null));
  }, [host]);
  if (!status) return null;
  return (
    <Card>
      <h2 className="text-lg font-bold">Bipaê Conector</h2>
      <p className="mt-1 text-muted">
        Permite que o caixa no navegador deste computador use a impressora, a balança e a gaveta
        configuradas aqui.
      </p>
      <div className="mt-4 flex items-center gap-3">
        {status.running ? (
          <Badge tone="success">Ligado (porta {status.port})</Badge>
        ) : (
          <Badge tone="warning">Desligado</Badge>
        )}
      </div>
      {host.autostart && autostart !== null && (
        <div className="mt-4">
          <Checkbox
            label="Iniciar o Bipaê Conector junto com o computador"
            hint="Ele abre sozinho na bandeja, perto do relógio, para o caixa do navegador usar os periféricos."
            checked={autostart}
            onChange={(v) =>
              void host
                .autostart!.setEnabled(v)
                .then(() => host.autostart!.isEnabled().then(setAutostart))
            }
          />
        </div>
      )}
      <p className="mt-4 text-sm font-semibold">Código de pareamento</p>
      <p className="font-mono text-4xl font-bold tracking-widest" data-testid="connector-code">
        {status.code}
      </p>
      <p className="text-sm text-muted">
        No navegador, abra Configurações → Periféricos e digite este código.
      </p>
      <Button variant="secondary" className="mt-3" onClick={() => void host.newCode().then(reload)}>
        Gerar novo código
      </Button>
      {status.clients.length > 0 && (
        <ul className="mt-4 divide-y divide-border">
          {status.clients.map((c) => (
            <li key={c.id} className="flex items-center justify-between py-2">
              <span>{c.name}</span>
              <Button variant="ghost" onClick={() => void host.revoke(c.id).then(reload)}>
                Desconectar
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ConnectorPairing() {
  const { platform } = useApp();
  const connector = platform.connector!;
  const [paired, setPaired] = useState<boolean | null>(null);
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    void connector.isPaired().then(setPaired);
  }, [connector]);

  const pair = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await connector.pair(
        code,
        navigator.userAgent.includes('Edg') ? 'Microsoft Edge' : 'Navegador',
      );
      setPaired(true);
      setMessage({ ok: true, text: 'Pareado! Agora o caixa usa os periféricos deste computador.' });
    } catch (error) {
      setMessage({ ok: false, text: (error as Error).message });
    }
  };

  return (
    <Card>
      <h2 className="text-lg font-bold">Bipaê Conector</h2>
      <p className="mt-1 text-muted">
        O navegador não fala direto com a impressora térmica e a gaveta (a balança, no Chrome e no
        Edge, pode). Instale o Bipaê Desktop neste computador; ele traz o Conector, que faz essa
        ponte com segurança.{' '}
        <Link to="/baixar" className="font-semibold text-primary underline">
          Baixar o Bipaê Desktop
        </Link>
      </p>
      {message && (
        <div className="mt-3">
          <Alert tone={message.ok ? 'success' : 'danger'}>{message.text}</Alert>
        </div>
      )}
      {paired ? (
        <div className="mt-4 flex items-center gap-3">
          <Badge tone="success">Pareado</Badge>
          <Button
            variant="ghost"
            onClick={() => void connector.unpair().then(() => setPaired(false))}
          >
            Desparear
          </Button>
        </div>
      ) : (
        <form onSubmit={pair} className="mt-4 flex flex-col gap-3">
          <TextField
            label="Código mostrado no Bipaê Conector"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          />
          <Button type="submit">Parear este navegador</Button>
          <p className="text-sm text-muted">
            Se o navegador pedir permissão para acessar "apps neste dispositivo", clique em
            Permitir.
          </p>
        </form>
      )}
    </Card>
  );
}

function DeviceTests() {
  const { platform } = useApp();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (fn: () => Promise<string>) => {
    try {
      setMessage({ ok: true, text: await fn() });
    } catch (error) {
      setMessage({ ok: false, text: (error as Error).message });
    }
  };
  return (
    <Card>
      <h2 className="text-lg font-bold">Testar</h2>
      {message && (
        <div className="mt-3">
          <Alert tone={message.ok ? 'success' : 'danger'}>{message.text}</Alert>
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={!platform.printer}
          onClick={() =>
            void run(async () => {
              await platform.printer!.print({ kind: 'escpos', data: encodeReceipt(TEST_PAGE) });
              return 'Página de teste enviada para a impressora.';
            })
          }
        >
          Imprimir teste
        </Button>
        <Button
          variant="secondary"
          disabled={!platform.cashDrawer}
          onClick={() =>
            void run(async () => {
              await platform.cashDrawer!.open();
              return 'Comando de abrir a gaveta enviado.';
            })
          }
        >
          Abrir gaveta
        </Button>
        <Button
          variant="secondary"
          disabled={!platform.scale}
          onClick={() =>
            void run(async () => {
              const { grams } = await platform.scale!.read();
              return `Peso lido: ${(grams / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 3 })} kg`;
            })
          }
        >
          Ler balança
        </Button>
      </div>
    </Card>
  );
}

/**
 * Certificado A1 instalado neste aparelho (F3-21), para assinar a nota mesmo sem internet. A
 * chave fica guardada aqui sem poder ser copiada; o arquivo e a senha não ficam guardados.
 */
function LocalCertificate() {
  const { platform } = useApp();
  const certificate = platform.certificate!;
  const [info, setInfo] = useState<CertificateInfo | null | undefined>(undefined);
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void certificate.info().then(setInfo);
  }, [certificate]);

  const install = async (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);
    if (!file)
      return setMessage({ ok: false, text: 'Escolha o arquivo do certificado (.pfx ou .p12).' });
    setBusy(true);
    try {
      const installed = await certificate.install!(
        new Uint8Array(await file.arrayBuffer()),
        password,
      );
      setInfo(installed);
      setPassword('');
      setFile(null);
      setMessage({ ok: true, text: 'Certificado instalado neste aparelho.' });
    } catch (error) {
      setMessage({ ok: false, text: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    await certificate.remove!();
    setInfo(null);
    setMessage({ ok: true, text: 'Certificado removido deste aparelho.' });
  };

  return (
    <Card>
      <h2 className="text-lg font-bold">Certificado digital neste aparelho</h2>
      <p className="mt-1 text-sm text-muted">
        Para emitir a nota mesmo sem internet. A chave fica guardada aqui sem poder ser copiada, e o
        arquivo e a senha não ficam salvos.
      </p>
      {message && (
        <div className="mt-3">
          <Alert tone={message.ok ? 'success' : 'danger'}>{message.text}</Alert>
        </div>
      )}
      {info ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <p className="text-sm">
            <Badge tone="success">Instalado</Badge> {info.subject}, válido até{' '}
            {new Date(info.notAfter).toLocaleDateString('pt-BR')}.
          </p>
          <Button variant="ghost" onClick={() => void remove()}>
            Remover deste aparelho
          </Button>
        </div>
      ) : (
        info === null && (
          <form onSubmit={install} className="mt-4 flex flex-col gap-3" noValidate>
            <label className="flex flex-col gap-1">
              <span className="font-semibold">Arquivo do certificado A1</span>
              <input
                type="file"
                accept=".pfx,.p12,application/x-pkcs12"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <TextField
              label="Senha do certificado A1"
              type="password"
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Button type="submit" disabled={busy}>
              {busy ? 'Instalando...' : 'Instalar neste aparelho'}
            </Button>
          </form>
        )
      )}
    </Card>
  );
}

/**
 * Balança direto no navegador (F2-06): Chrome e Edge do computador falam com a porta serial sem
 * o Bipaê Conector. A pessoa escolhe a porta uma vez; o navegador lembra.
 */
function SerialScale() {
  const { platform } = useApp();
  const serial = platform.serialScale!;
  const [paired, setPaired] = useState<boolean | null>(null);
  const [baudRate, setBaudRate] = useState('9600');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    void serial.isPaired().then(setPaired);
  }, [serial]);

  const choose = async () => {
    setMessage(null);
    try {
      await serial.pair(Number(baudRate));
      setPaired(await serial.isPaired());
      setMessage({ ok: true, text: 'Balança escolhida. Use "Ler balança" para testar.' });
    } catch (error) {
      const name = (error as Error).name;
      setMessage({
        ok: false,
        text: name === 'NotFoundError' ? 'Nenhuma porta foi escolhida.' : (error as Error).message,
      });
    }
  };

  return (
    <Card>
      <h2 className="text-lg font-bold">Balança neste navegador</h2>
      <p className="mt-1 text-sm text-muted">
        Ligue a balança no computador (cabo serial ou USB-serial) e escolha a porta. Funciona no
        Chrome e no Edge, sem instalar nada.
      </p>
      {message && (
        <div className="mt-3">
          <Alert tone={message.ok ? 'success' : 'danger'}>{message.text}</Alert>
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-end gap-2">
        <SelectField
          label="Velocidade (baud)"
          value={baudRate}
          onChange={(e) => setBaudRate(e.target.value)}
          options={BAUD_RATES.map((b) => ({ value: b, label: b }))}
        />
        <Button onClick={() => void choose()}>
          {paired ? 'Trocar a porta da balança' : 'Escolher a porta da balança'}
        </Button>
        {paired && (
          <Button
            variant="ghost"
            onClick={() =>
              void serial.forget().then(async () => {
                setPaired(await serial.isPaired());
                setMessage({ ok: true, text: 'Balança desligada deste navegador.' });
              })
            }
          >
            Esquecer
          </Button>
        )}
      </div>
      {paired && <p className="mt-3 text-sm text-success">Balança configurada neste navegador.</p>}
    </Card>
  );
}

/**
 * TEF com pinpad (F8-11): escolhe o provedor e guarda os dados do contrato da loja neste
 * computador. Nada aqui é segredo. O que ainda falta (biblioteca, pinpad) aparece como
 * "falta configurar"; o caixa nunca promete o que não existe.
 */
function TefSettings() {
  const { platform } = useApp();
  const [config, setConfig] = useState<TefConfig | null>(null);
  const [libs, setLibs] = useState<{ sitef: boolean; paygo: boolean }>({
    sitef: false,
    paygo: false,
  });
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    void loadTefConfig(platform.preferences).then(setConfig);
    void platform.tefLibs
      ?.status()
      .then(setLibs)
      .catch(() => undefined);
  }, [platform]);
  if (!config) return null;

  const provider = config.provider;
  const installed = provider === 'paygo' ? libs.paygo : libs.sitef;
  const missing = tefMissing(config, installed);
  const sitef = config.sitef ?? { host: '', storeCode: '', terminalId: '' };
  const paygo = config.paygo ?? { automationName: '', automationVersion: '', captureTerminal: '' };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await saveTefConfig(platform.preferences, config);
      setMessage({ ok: true, text: 'Configuração do TEF salva neste computador.' });
    } catch (error) {
      setMessage({ ok: false, text: (error as Error).message });
    }
  };

  return (
    <Card>
      <form onSubmit={save} className="flex flex-col gap-4">
        <h2 className="text-lg font-bold">TEF com pinpad</h2>
        {message && <Alert tone={message.ok ? 'success' : 'danger'}>{message.text}</Alert>}
        <SelectField
          label="Como o cartão é cobrado neste caixa"
          value={provider}
          onChange={(e) => setConfig({ ...config, provider: e.target.value as TefProvider })}
          options={TEF_PROVIDERS.map((p) => ({ value: p, label: TEF_PROVIDER_INFO[p].name }))}
        />
        <p className="text-sm text-muted">{TEF_PROVIDER_INFO[provider].note}</p>
        {provider === 'sitef' && (
          <div className="grid gap-4 sm:grid-cols-3">
            <TextField
              label="Servidor do SiTef"
              value={sitef.host}
              onChange={(e) => setConfig({ ...config, sitef: { ...sitef, host: e.target.value } })}
            />
            <TextField
              label="Código da loja"
              value={sitef.storeCode}
              onChange={(e) =>
                setConfig({ ...config, sitef: { ...sitef, storeCode: e.target.value } })
              }
            />
            <TextField
              label="Número do terminal"
              value={sitef.terminalId}
              onChange={(e) =>
                setConfig({ ...config, sitef: { ...sitef, terminalId: e.target.value } })
              }
            />
          </div>
        )}
        {provider === 'paygo' && (
          <div className="grid gap-4 sm:grid-cols-3">
            <TextField
              label="Nome da automação"
              value={paygo.automationName}
              onChange={(e) =>
                setConfig({ ...config, paygo: { ...paygo, automationName: e.target.value } })
              }
            />
            <TextField
              label="Versão da automação"
              value={paygo.automationVersion}
              onChange={(e) =>
                setConfig({ ...config, paygo: { ...paygo, automationVersion: e.target.value } })
              }
            />
            <TextField
              label="Ponto de captura"
              value={paygo.captureTerminal}
              onChange={(e) =>
                setConfig({ ...config, paygo: { ...paygo, captureTerminal: e.target.value } })
              }
            />
          </div>
        )}
        {(provider === 'sitef' || provider === 'paygo') &&
          (missing.length > 0 ? (
            <Alert tone="warning" title="Falta configurar">
              <ul className="list-disc pl-5">
                {missing.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </Alert>
          ) : (
            <Badge tone="success">Pronto para usar</Badge>
          ))}
        <Button type="submit">Salvar TEF</Button>
      </form>
    </Card>
  );
}
