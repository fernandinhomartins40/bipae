import { encodeReceipt, type ReceiptBlock } from '@bipae/pdv-core';
import type { DeviceConfig, PrinterConfig } from '@bipae/platform';
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
        {platform.connector && <ConnectorPairing />}
        <DeviceTests />
      </div>
    </>
  );
}

function NativeDevices() {
  const { platform } = useApp();
  const devices = platform.devices!;
  const [ports, setPorts] = useState<string[]>([]);
  const [config, setConfig] = useState<DeviceConfig | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    void devices.listSerialPorts().then(setPorts);
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
              ]}
            />
            {printer.transport === 'tcp' ? (
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
  const reload = () => void host.status().then(setStatus);
  useEffect(reload, [host]);
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
        O navegador não fala direto com impressora, balança e gaveta. Instale o Bipaê Desktop neste
        computador; ele traz o Conector, que faz essa ponte com segurança.{' '}
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
