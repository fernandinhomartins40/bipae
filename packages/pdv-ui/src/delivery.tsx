import { cents, formatBRL, parseTaxId } from '@bipae/domain';
import type { CartDelivery, PdvService } from '@bipae/pdv-core';
import { Alert, Button, Modal, SelectField, TextField } from '@bipae/ui';
import { useEffect, useState, type FormEvent } from 'react';

const brl = (value: number) => formatBRL(cents(value));
const digits = (text: string) => text.replace(/\D/g, '');

type Zone = Awaited<ReturnType<PdvService['deliveryZones']>>[number];

/**
 * Venda para entrega (F5-10): o bairro (com a taxa da loja), o contato e o endereço. O CPF ou
 * CNPJ é obrigatório porque a NFC-e de entrega a domicílio exige o cliente identificado e o
 * endereço (rejeições 787 e 788 da SEFAZ). A cidade vem a da loja; o caixa não precisa de
 * internet para isso.
 */
export function DeliveryDialog({
  pdv,
  current,
  taxId,
  onSave,
  onRemove,
  onClose,
}: {
  pdv: PdvService;
  current: CartDelivery | null;
  taxId: string | null;
  onSave: (delivery: CartDelivery, taxId: string) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [zones, setZones] = useState<Zone[] | null>(null);
  const [city, setCity] = useState<{ code: string | null; name: string | null; uf: string | null }>(
    {
      code: null,
      name: null,
      uf: null,
    },
  );
  const [zoneId, setZoneId] = useState(current?.zoneId ?? '');
  const [name, setName] = useState(current?.name ?? '');
  const [phone, setPhone] = useState(current?.phone ?? '');
  const [document, setDocument] = useState(taxId ?? '');
  const [street, setStreet] = useState(current?.address.street ?? '');
  const [number, setNumber] = useState(current?.address.number ?? '');
  const [complement, setComplement] = useState(current?.address.complement ?? '');
  const [district, setDistrict] = useState(current?.address.district ?? '');
  const [cep, setCep] = useState(current?.address.cep ?? '');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void pdv.deliveryZones().then((list) => {
      setZones(list);
      if (!zoneId && list[0]) {
        setZoneId(list[0].id);
        if (!district) setDistrict(list[0].name);
      }
    });
    void pdv.fiscalContext().then(({ issuer, company }) =>
      setCity({
        code: issuer?.address.cityCode ?? null,
        name: issuer?.address.cityName ?? null,
        uf: company.uf,
      }),
    );
    // Só ao abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdv]);

  const zone = zones?.find((z) => z.id === zoneId) ?? null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!zone) return setError('Escolha o bairro da entrega.');
    if (!parseTaxId(digits(document))) {
      return setError('Informe um CPF ou CNPJ válido: a nota de entrega exige o cliente.');
    }
    if (name.trim().length < 2) return setError('Informe o nome de quem recebe.');
    if (digits(phone).length < 10) return setError('Informe o telefone com DDD.');
    if (!street.trim() || !number.trim() || !district.trim()) {
      return setError('Informe a rua, o número e o bairro.');
    }
    onSave(
      {
        zoneId: zone.id,
        zoneName: zone.name,
        feeCents: zone.feeCents,
        name: name.trim().slice(0, 80),
        phone: digits(phone).slice(0, 20),
        address: {
          street: street.trim().slice(0, 60),
          number: number.trim().slice(0, 10),
          complement: complement.trim() ? complement.trim().slice(0, 60) : null,
          district: district.trim().slice(0, 60),
          cityCode: city.code,
          cityName: city.name,
          uf: city.uf,
          cep: digits(cep).length === 8 ? digits(cep) : null,
        },
      },
      digits(document),
    );
  };

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Entrega" wide>
      {zones && zones.length === 0 ? (
        <Alert tone="warning" title="Falta configurar">
          Cadastre os bairros atendidos e as taxas em Delivery, na retaguarda. Depois da próxima
          sincronização, eles aparecem aqui.
        </Alert>
      ) : (
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label="Bairro da entrega"
            value={zoneId}
            onChange={(e) => {
              setZoneId(e.target.value);
              const next = zones?.find((z) => z.id === e.target.value);
              if (next) setDistrict(next.name);
            }}
            options={(zones ?? []).map((z) => ({
              value: z.id,
              label: `${z.name} · ${brl(z.feeCents)}`,
            }))}
          />
          <TextField
            label="CPF ou CNPJ na nota"
            inputMode="numeric"
            value={document}
            onChange={(e) => setDocument(e.target.value)}
          />
          <TextField label="Quem recebe" value={name} onChange={(e) => setName(e.target.value)} />
          <TextField
            label="Telefone"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <TextField label="Rua" value={street} onChange={(e) => setStreet(e.target.value)} />
          <TextField label="Número" value={number} onChange={(e) => setNumber(e.target.value)} />
          <TextField
            label="Complemento"
            value={complement}
            onChange={(e) => setComplement(e.target.value)}
          />
          <TextField
            label="Bairro"
            value={district}
            onChange={(e) => setDistrict(e.target.value)}
          />
          <TextField
            label="CEP"
            inputMode="numeric"
            value={cep}
            onChange={(e) => setCep(e.target.value)}
          />
          <p className="self-end text-sm text-muted">
            Cidade: {city.name ? `${city.name} - ${city.uf ?? ''}` : 'a da loja'}
          </p>
          {error && (
            <div className="sm:col-span-2">
              <Alert>{error}</Alert>
            </div>
          )}
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button type="submit">
              {zone ? `Confirmar entrega · taxa ${brl(zone.feeCents)}` : 'Confirmar entrega'}
            </Button>
            {current && (
              <Button variant="ghost" onClick={onRemove}>
                Não é entrega
              </Button>
            )}
          </div>
        </form>
      )}
    </Modal>
  );
}
