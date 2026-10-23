import {
  formatTaxId,
  normalizePixKey,
  PAYMENT_PROVIDERS,
  PIX_API_PROFILES,
  PIX_PSP_INFO,
  PIX_PSP_PROVIDERS,
  type PixPspProvider,
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
    mpTerminalId: settings.mpPoint?.terminalId ?? '',
    mpAccessToken: '',
    apiBaseUrl: settings.pixApi?.baseUrl ?? '',
    apiTokenUrl: settings.pixApi?.tokenUrl ?? '',
    apiClientId: settings.pixApi?.clientId ?? '',
    apiClientSecret: '',
    apiCertificate: '',
    apiCertificatePassword: '',
    pspProvider: (settings.pixPsp?.provider ?? 'mercadopago') as PixPspProvider,
    pspEnvironment: settings.pixPsp?.environment ?? 'sandbox',
    pspToken: '',
    pspPayerName: settings.pixPsp?.payerName ?? '',
    pspPayerEmail: settings.pixPsp?.payerEmail ?? '',
    pspPayerTaxId: settings.pixPsp?.payerTaxId ? formatTaxId(settings.pixPsp.payerTaxId) : '',
    pspCustomerId: settings.pixPsp?.customerId ?? '',
    mpWebhookSecret: '',
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
        mpTerminalId,
        mpAccessToken,
        apiBaseUrl,
        apiTokenUrl,
        apiClientId,
        apiClientSecret,
        apiCertificate,
        apiCertificatePassword,
        pspProvider,
        pspEnvironment,
        pspToken,
        pspPayerName,
        pspPayerEmail,
        pspPayerTaxId,
        pspCustomerId,
        mpWebhookSecret,
        ...rest
      } = values;
      await api.put(`/stores/${settings.storeId}/payment-settings`, {
        ...rest,
        ...(mpWebhookSecret && { mpWebhookSecret }),
        ...(values.card === 'mp_point' && {
          mpPoint: {
            terminalId: mpTerminalId,
            ...(mpAccessToken && { accessToken: mpAccessToken }),
          },
        }),
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
        ...(values.pix === 'psp' && {
          pixPsp: {
            provider: pspProvider,
            environment: pspEnvironment,
            ...(pspToken && { accessToken: pspToken }),
            payerName: pspPayerName || null,
            payerEmail: pspPayerEmail || null,
            payerTaxId: pspPayerTaxId || null,
            customerId: pspCustomerId || null,
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
            {
              value: 'mp_point',
              label: 'Mercado Pago Point: o caixa manda o valor para a maquininha (em homologação)',
            },
            { value: 'simulator', label: 'Simulador (demonstração, não cobra ninguém)' },
          ]}
        />
        {v.card === 'mp_point' && (
          <div className="flex flex-col gap-4 rounded-ui border border-border p-4">
            <Alert tone="warning">
              Em homologação: teste primeiro com as credenciais de teste do Mercado Pago. Vale de
              vale-refeição continua na maquininha à parte; sem internet, também.
            </Alert>
            <TextField
              label="ID do terminal (Point)"
              hint="No formato TIPO__SERIE, como NEWLAND_N950__SBX0000001. Aparece na lista de terminais da sua conta."
              value={v.mpTerminalId}
              disabled={!canWrite}
              onChange={(e) => form.set('mpTerminalId', e.target.value)}
              error={form.errors['mpPoint.terminalId']}
            />
            <TextField
              label="Token de acesso (Access Token)"
              type="password"
              autoComplete="off"
              hint="No painel de desenvolvedores do Mercado Pago, em Credenciais."
              placeholder={
                settings.mpPoint?.hasAccessToken ? 'Guardado (deixe em branco para manter)' : ''
              }
              value={v.mpAccessToken}
              disabled={!canWrite}
              onChange={(e) => form.set('mpAccessToken', e.target.value)}
              error={form.errors['mpPoint.accessToken']}
            />
          </div>
        )}
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
            {
              value: 'psp',
              label:
                'Mercado Pago, PagBank ou Asaas: QR da sua conta e confirmação automática (em homologação)',
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
        {v.pix === 'psp' && (
          <div className="flex flex-col gap-4 rounded-ui border border-border p-4">
            <Alert tone="warning">
              Em homologação: teste primeiro com as credenciais de teste do parceiro, com valores
              pequenos. Sem internet, o caixa usa o QR da loja (preencha a chave, o nome e a cidade
              abaixo) ou o Pix manual.
            </Alert>
            <SelectField
              label="Parceiro do Pix"
              value={v.pspProvider}
              disabled={!canWrite}
              onChange={(e) => form.set('pspProvider', e.target.value as PixPspProvider)}
              options={PIX_PSP_PROVIDERS.map((p) => ({ value: p, label: PIX_PSP_INFO[p].name }))}
            />
            {PIX_PSP_INFO[v.pspProvider].sandbox && (
              <SelectField
                label="Ambiente"
                value={v.pspEnvironment}
                disabled={!canWrite}
                onChange={(e) =>
                  form.set('pspEnvironment', e.target.value as 'sandbox' | 'production')
                }
                options={[
                  { value: 'sandbox', label: 'Sandbox (teste, ninguém é cobrado)' },
                  { value: 'production', label: 'Produção (cobra de verdade)' },
                ]}
              />
            )}
            <TextField
              label="Token de acesso"
              type="password"
              autoComplete="off"
              hint={PIX_PSP_INFO[v.pspProvider].tokenHint}
              placeholder={
                settings.pixPsp?.hasAccessToken && settings.pixPsp.provider === v.pspProvider
                  ? 'Guardado (deixe em branco para manter)'
                  : ''
              }
              value={v.pspToken}
              disabled={!canWrite}
              onChange={(e) => form.set('pspToken', e.target.value)}
              error={form.errors['pixPsp.accessToken']}
            />
            {v.pspProvider === 'asaas' ? (
              <TextField
                label="ID do cliente no Asaas"
                hint='O Asaas exige um cliente em cada cobrança. Cadastre lá um "Consumidor final" e cole o ID (começa com cus_).'
                value={v.pspCustomerId}
                disabled={!canWrite}
                onChange={(e) => form.set('pspCustomerId', e.target.value)}
                error={form.errors['pixPsp.customerId']}
              />
            ) : (
              <>
                <p className="text-sm text-muted">
                  O {PIX_PSP_INFO[v.pspProvider].name} exige um pagador em cada cobrança. Use os
                  dados do consumidor final da loja; quem paga de verdade é quem lê o QR.
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  {v.pspProvider === 'pagbank' && (
                    <TextField
                      label="Nome do pagador padrão"
                      hint="Nome e sobrenome."
                      value={v.pspPayerName}
                      disabled={!canWrite}
                      onChange={(e) => form.set('pspPayerName', e.target.value)}
                      error={form.errors['pixPsp.payerName']}
                    />
                  )}
                  <TextField
                    label="E-mail do pagador padrão"
                    type="email"
                    value={v.pspPayerEmail}
                    disabled={!canWrite}
                    onChange={(e) => form.set('pspPayerEmail', e.target.value)}
                    error={form.errors['pixPsp.payerEmail']}
                  />
                  <TextField
                    label={
                      v.pspProvider === 'pagbank'
                        ? 'CPF ou CNPJ do pagador padrão'
                        : 'CPF ou CNPJ do pagador padrão (opcional)'
                    }
                    inputMode="numeric"
                    value={v.pspPayerTaxId}
                    disabled={!canWrite}
                    onChange={(e) => form.set('pspPayerTaxId', formatTaxId(e.target.value))}
                    error={form.errors['pixPsp.payerTaxId']}
                  />
                </div>
              </>
            )}
          </div>
        )}
        <WebhookSetup
          settings={settings}
          pix={v.pix}
          card={v.card}
          provider={v.pspProvider}
          canWrite={canWrite}
          secret={v.mpWebhookSecret}
          onSecret={(value) => form.set('mpWebhookSecret', value)}
          secretError={form.errors.mpWebhookSecret}
        />
        {(v.pix === 'static_qr' || v.pix === 'api' || v.pix === 'psp') && (
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

/** Um endereço ou segredo para copiar e colar no portal do parceiro. */
function CopyLine({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <span className="font-semibold">{label}</span>
      <code
        data-testid={testId}
        className="break-all rounded-ui border border-border bg-surface px-2 py-1 font-mono text-xs"
      >
        {value}
      </code>
    </div>
  );
}

/**
 * Avisos automáticos (webhooks, F8-09.c.2): o endereço que a loja cadastra no banco ou no
 * parceiro. O aviso só apressa a conferência; quem confirma o pagamento é sempre a consulta.
 */
function WebhookSetup({
  settings,
  pix,
  card,
  provider,
  canWrite,
  secret,
  onSecret,
  secretError,
}: {
  settings: PaymentSettingsView;
  pix: PaymentSettingsView['pix'];
  card: PaymentSettingsView['card'];
  provider: PixPspProvider;
  canWrite: boolean;
  secret: string;
  onSecret: (value: string) => void;
  secretError?: string;
}) {
  const w = settings.webhook;
  const bank = pix === 'api';
  const mercadoPago = (pix === 'psp' && provider === 'mercadopago') || card === 'mp_point';
  const pagbank = pix === 'psp' && provider === 'pagbank';
  const asaas = pix === 'psp' && provider === 'asaas';
  if (!bank && !mercadoPago && !pagbank && !asaas) return null;
  const saveFirst = 'Salve os meios de pagamento para gerar o endereço desta loja.';
  return (
    <div className="flex flex-col gap-4 rounded-ui border border-border p-4">
      <div>
        <p className="font-semibold">Aviso automático de pagamento (webhook)</p>
        <p className="text-sm text-muted">
          Com o aviso, o caixa fica sabendo do pagamento na hora. O Bipaê sempre confere o pagamento
          no {bank ? 'banco' : 'parceiro'} antes de confirmar; sem o aviso, ele confere sozinho a
          cada poucos segundos.
        </p>
      </div>
      {bank &&
        (w.pixApiUrl ? (
          <>
            <CopyLine label="Endereço para o banco" value={w.pixApiUrl} testId="webhook-pix-api" />
            <p className="text-sm text-muted">
              Cadastre no portal do seu banco como webhook da chave Pix da loja (na API Pix é o PUT
              /webhook/sua-chave). O banco acrescenta /pix sozinho. Se o banco pedir para validar o
              certificado (mTLS), escolha a opção sem validação: o segredo já vai no endereço.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted">{saveFirst}</p>
        ))}
      {mercadoPago && (
        <>
          <CopyLine
            label="Endereço para o Mercado Pago"
            value={w.mercadopagoUrl}
            testId="webhook-mercadopago"
          />
          <p className="text-sm text-muted">
            No painel do Mercado Pago, em Suas integrações, abra Webhooks, cole este endereço e
            marque os eventos de Pagamentos{card === 'mp_point' ? ' e Order (Mercado Pago)' : ''}.
            Depois copie a assinatura secreta que o Mercado Pago mostra e cole abaixo.
          </p>
          <TextField
            label="Assinatura secreta do webhook"
            type="password"
            autoComplete="off"
            placeholder={
              settings.webhook.hasMercadoPagoSecret ? 'Guardada (deixe em branco para manter)' : ''
            }
            value={secret}
            disabled={!canWrite}
            onChange={(e) => onSecret(e.target.value)}
            error={secretError}
          />
        </>
      )}
      {pagbank && (
        <p className="text-sm text-muted">
          Nada a fazer: o Bipaê manda o endereço do aviso junto com cada cobrança e confere a
          assinatura com o token da conta.
        </p>
      )}
      {asaas &&
        (w.token ? (
          <>
            <CopyLine label="Endereço para o Asaas" value={w.asaasUrl} testId="webhook-asaas" />
            <CopyLine label="Token de autenticação" value={w.token} testId="webhook-token" />
            <p className="text-sm text-muted">
              No Asaas, em Integrações, abra Webhooks, crie um webhook com este endereço e este
              token de autenticação e marque os eventos de cobrança.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted">{saveFirst}</p>
        ))}
    </div>
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
