import {
  normalizePixKey,
  PAYMENT_PROVIDERS,
  PIX_API_PROFILES,
  staticPixPayload,
  type PaymentSettingsView,
} from '@bipae/domain';
import { Alert, Badge, Button, Card, PageHeader, SelectField, TextField } from '@bipae/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useApp, useCan, useMe } from '../context';
import { useForm } from '../forms';

const TARGET_LABEL = { web: 'navegador', desktop: 'computador', android: 'Android' } as const;

/**
 * Meios de pagamento por loja (F8-08, ADR-0018): como o caixa cobra cartão e Pix, e o catálogo
 * das integrações com o que já funciona e o que chega em breve.
 */
export function PaymentsPage() {
  const { api } = useApp();
  const stores = useQuery({
    queryKey: ['stores'],
    queryFn: () => api.get<{ id: string; name: string }[]>('/stores'),
  });
  const [storeId, setStoreId] = useState('');
  const store = storeId || stores.data?.[0]?.id || '';
  const settings = useQuery({
    queryKey: ['payment-settings', store],
    queryFn: () => api.get<PaymentSettingsView>(`/stores/${store}/payment-settings`),
    enabled: Boolean(store),
  });

  return (
    <>
      <PageHeader
        title="Meios de pagamento"
        description="Como o caixa cobra cartão e Pix nesta loja. Sem integração, tudo já funciona com a sua maquininha e a chave Pix da loja."
      />
      {(stores.data?.length ?? 0) > 1 && (
        <div className="mb-4 max-w-xs">
          <SelectField
            label="Loja"
            value={store}
            onChange={(e) => setStoreId(e.target.value)}
            options={(stores.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
          />
        </div>
      )}
      {settings.error && <Alert>{(settings.error as Error).message}</Alert>}
      {settings.data && <SettingsForm key={store} settings={settings.data} />}
      <Catalog />
    </>
  );
}

function SettingsForm({ settings }: { settings: PaymentSettingsView }) {
  const { api } = useApp();
  const me = useMe();
  const canWrite = useCan('admin.stores');
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);
  const form = useForm({
    card: settings.card,
    pix: settings.pix,
    pixKey: settings.pixKey ?? '',
    pixMerchantName: settings.pixMerchantName ?? me.tenant.name.slice(0, 25),
    pixCity: settings.pixCity ?? '',
    apiBaseUrl: settings.pixApi?.baseUrl ?? '',
    apiTokenUrl: settings.pixApi?.tokenUrl ?? '',
    apiClientId: settings.pixApi?.clientId ?? '',
    apiClientSecret: '',
    apiCertificate: '',
    apiCertificatePassword: '',
  });
  const v = form.values;
  const [certName, setCertName] = useState<string | null>(null);
  const pickProfile = (id: string) => {
    const p = PIX_API_PROFILES.find((x) => x.id === id);
    if (!p) return;
    form.set('apiBaseUrl', p.baseUrl);
    form.set('apiTokenUrl', p.tokenUrl);
  };
  const readCertificate = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const data = String(reader.result ?? '');
      form.set('apiCertificate', data.slice(data.indexOf(',') + 1));
      setCertName(file.name);
    };
    reader.readAsDataURL(file);
  };
  // Prévia: o mesmo QR que o caixa vai mostrar, com R$ 1,00 para testar no seu banco.
  let preview: string | null = null;
  if (v.pix === 'static_qr' && normalizePixKey(v.pixKey) && v.pixMerchantName && v.pixCity) {
    try {
      preview = staticPixPayload({
        key: v.pixKey,
        merchantName: v.pixMerchantName,
        city: v.pixCity,
        amountCents: 100,
      });
    } catch {
      preview = null;
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSaved(false);
    void form.submit(async (values) => {
      const {
        apiBaseUrl,
        apiTokenUrl,
        apiClientId,
        apiClientSecret,
        apiCertificate,
        apiCertificatePassword,
        ...rest
      } = values;
      await api.put(`/stores/${settings.storeId}/payment-settings`, {
        ...rest,
        ...(values.pix === 'api' && {
          pixApi: {
            baseUrl: apiBaseUrl,
            tokenUrl: apiTokenUrl,
            clientId: apiClientId,
            ...(apiClientSecret && { clientSecret: apiClientSecret }),
            ...(apiCertificate && {
              certificateBase64: apiCertificate,
              certificatePassword: apiCertificatePassword,
            }),
          },
        }),
      });
      await queryClient.invalidateQueries({ queryKey: ['payment-settings'] });
      setSaved(true);
    });
  };

  return (
    <Card className="mb-8 max-w-2xl">
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {form.formError && <Alert>{form.formError}</Alert>}
        {saved && (
          <Alert tone="success">Salvo. Os caixas da loja recebem na próxima sincronização.</Alert>
        )}
        <SelectField
          label="Cartão (crédito, débito e vale)"
          value={v.card}
          disabled={!canWrite}
          onChange={(e) => form.set('card', e.target.value as typeof v.card)}
          options={[
            { value: 'manual', label: 'Maquininha à parte: cobro nela e confirmo no caixa' },
            { value: 'simulator', label: 'Simulador (demonstração, não cobra ninguém)' },
          ]}
        />
        <SelectField
          label="Pix"
          value={v.pix}
          disabled={!canWrite}
          onChange={(e) => form.set('pix', e.target.value as typeof v.pix)}
          options={[
            { value: 'manual', label: 'Chave Pix da loja, sem QR: o cliente digita a chave' },
            { value: 'static_qr', label: 'QR Code com a chave da loja e o valor da venda' },
            {
              value: 'api',
              label: 'API Pix do seu banco: QR do banco e confirmação automática (em homologação)',
            },
            { value: 'simulator', label: 'Simulador (demonstração, não cobra ninguém)' },
          ]}
        />
        {v.pix === 'api' && (
          <div className="flex flex-col gap-4 rounded-ui border border-border p-4">
            <Alert tone="warning">
              Em homologação: teste primeiro no sandbox do seu banco, com valores pequenos. Sem
              internet, o caixa usa o QR da loja (preencha nome e cidade abaixo) ou o Pix manual.
            </Alert>
            <SelectField
              label="Banco"
              value=""
              disabled={!canWrite}
              onChange={(e) => pickProfile(e.target.value)}
              options={[
                {
                  value: '',
                  label: 'Escolha para preencher os endereços (ou digite os do seu banco)',
                },
                ...PIX_API_PROFILES.map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
            <TextField
              label="Endereço da API Pix"
              hint="No portal de desenvolvedores do seu banco. Começa com https://"
              value={v.apiBaseUrl}
              disabled={!canWrite}
              onChange={(e) => form.set('apiBaseUrl', e.target.value)}
              error={form.errors['pixApi.baseUrl']}
            />
            <TextField
              label="Endereço do token (OAuth)"
              value={v.apiTokenUrl}
              disabled={!canWrite}
              onChange={(e) => form.set('apiTokenUrl', e.target.value)}
              error={form.errors['pixApi.tokenUrl']}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Client ID"
                value={v.apiClientId}
                disabled={!canWrite}
                onChange={(e) => form.set('apiClientId', e.target.value)}
                error={form.errors['pixApi.clientId']}
              />
              <TextField
                label="Client Secret"
                type="password"
                autoComplete="off"
                placeholder={
                  settings.pixApi?.hasClientSecret ? 'Guardado (deixe em branco para manter)' : ''
                }
                value={v.apiClientSecret}
                disabled={!canWrite}
                onChange={(e) => form.set('apiClientSecret', e.target.value)}
                error={form.errors['pixApi.clientSecret']}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm font-semibold">
                Certificado da API (.pfx ou .p12)
                <input
                  type="file"
                  accept=".pfx,.p12"
                  disabled={!canWrite}
                  onChange={(e) => readCertificate(e.target.files?.[0])}
                  className="text-sm font-normal"
                />
                <span className="font-normal text-muted">
                  {certName ??
                    (settings.pixApi?.hasCertificate
                      ? 'Certificado guardado.'
                      : 'O banco entrega junto com as credenciais.')}
                </span>
              </label>
              <TextField
                label="Senha do certificado"
                type="password"
                autoComplete="off"
                value={v.apiCertificatePassword}
                disabled={!canWrite}
                onChange={(e) => form.set('apiCertificatePassword', e.target.value)}
                error={form.errors['pixApi.certificateBase64']}
              />
            </div>
          </div>
        )}
        {(v.pix === 'static_qr' || v.pix === 'api') && (
          <div className="flex flex-col gap-4 rounded-ui border border-border p-4">
            <TextField
              label="Chave Pix da loja"
              hint="CPF, CNPJ, e-mail, celular com DDD ou chave aleatória."
              value={v.pixKey}
              disabled={!canWrite}
              onChange={(e) => form.set('pixKey', e.target.value)}
              error={form.errors.pixKey}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Nome que aparece no Pix"
                hint="Até 25 letras, sem acento."
                value={v.pixMerchantName}
                disabled={!canWrite}
                onChange={(e) => form.set('pixMerchantName', e.target.value)}
                error={form.errors.pixMerchantName}
              />
              <TextField
                label="Cidade"
                hint="Até 15 letras."
                value={v.pixCity}
                disabled={!canWrite}
                onChange={(e) => form.set('pixCity', e.target.value)}
                error={form.errors.pixCity}
              />
            </div>
            {preview && (
              <p className="text-sm text-muted" data-testid="pix-preview">
                Teste antes de usar: no app do seu banco, escolha "Pix copia e cola" e cole{' '}
                <span className="break-all font-mono text-xs">{preview}</span> (R$ 1,00 para você
                mesmo).
              </p>
            )}
          </div>
        )}
        {canWrite && (
          <Button type="submit" loading={form.submitting}>
            Salvar meios de pagamento
          </Button>
        )}
      </form>
    </Card>
  );
}

function Catalog() {
  return (
    <section aria-labelledby="integracoes-titulo">
      <h2 id="integracoes-titulo" className="mb-1 text-xl font-bold">
        Integrações
      </h2>
      <p className="mb-4 text-muted">
        Cada integração é homologada com o parceiro antes de aparecer como pronta.
      </p>
      <ul className="grid gap-3 lg:grid-cols-2" aria-label="Integrações de pagamento">
        {PAYMENT_PROVIDERS.map((p) => (
          <li key={p.id} className="rounded-ui border border-border bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="font-semibold">{p.name}</p>
              {p.status === 'ready' ? (
                <Badge tone="success">Pronto</Badge>
              ) : p.status === 'homologation' ? (
                <Badge tone="warning">Em homologação</Badge>
              ) : (
                <Badge>Chega em breve</Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-muted">{p.description}</p>
            <p className="mt-2 text-xs text-muted">
              Funciona no {p.targets.map((t) => TARGET_LABEL[t]).join(', ')}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
