import type { CertificateStatus } from '@bipae/domain';
import { Alert, Button, Drawer, TextField } from '@bipae/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { ApiError } from '../api-client';
import { useApp, useCan } from '../context';

/**
 * Certificado digital A1 da empresa (F3-10): mostra a validade e deixa enviar ou trocar o
 * arquivo. O arquivo e a senha vão direto para o servidor, que guarda os dois cifrados.
 */
export function useCertificates() {
  const { api } = useApp();
  return useQuery({
    queryKey: ['certificates'],
    queryFn: () => api.get<CertificateStatus[]>('/fiscal/certificates'),
  });
}

const date = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');

export function CertificateLine({
  companyId,
  certificate,
}: {
  companyId: string;
  certificate?: CertificateStatus;
}) {
  const canWrite = useCan('fiscal.profile.write');
  const [open, setOpen] = useState(false);
  let text: string;
  let tone = 'text-muted';
  if (!certificate) {
    text = 'Sem certificado digital A1: ele é necessário para emitir notas.';
  } else if (certificate.status === 'vencido') {
    text = `Certificado A1 vencido em ${date(certificate.notAfter)}. Envie o novo para continuar emitindo notas.`;
    tone = 'text-danger font-semibold';
  } else if (certificate.status === 'vencendo') {
    text = `Certificado A1 vence em ${certificate.daysLeft} dia(s), em ${date(certificate.notAfter)}. Providencie a renovação.`;
    tone = 'text-danger font-semibold';
  } else {
    text = `Certificado A1 de ${certificate.subject}, válido até ${date(certificate.notAfter)}.`;
  }
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <p className={`text-sm ${tone}`}>{text}</p>
      {canWrite && (
        <Button variant="ghost" onClick={() => setOpen(true)}>
          {certificate ? 'Trocar certificado' : 'Enviar certificado'}
        </Button>
      )}
      {open && <CertificateForm companyId={companyId} onClose={() => setOpen(false)} />}
    </div>
  );
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    reader.readAsDataURL(file);
  });
}

function CertificateForm({ companyId, onClose }: { companyId: string; onClose: () => void }) {
  const { api } = useApp();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!file) return setError('Escolha o arquivo do certificado (.pfx ou .p12).');
    setSending(true);
    try {
      await api.post(`/fiscal/certificates/${companyId}`, {
        pfxBase64: await readBase64(file),
        password,
      });
      await queryClient.invalidateQueries({ queryKey: ['certificates'] });
      onClose();
    } catch (err) {
      setError(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : 'Algo deu errado. Tente de novo.',
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <Drawer open onOpenChange={(o) => !o && onClose()} title="Certificado digital A1">
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Alert tone="warning" title="Seu certificado fica protegido">
          O arquivo e a senha são guardados cifrados no servidor e nunca aparecem de novo na tela.
          Use o certificado e-CNPJ A1 da empresa (arquivo .pfx ou .p12).
        </Alert>
        {error && <Alert>{error}</Alert>}
        <label className="flex flex-col gap-1">
          <span className="font-semibold">Arquivo do certificado</span>
          <input
            type="file"
            accept=".pfx,.p12,application/x-pkcs12"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <TextField
          label="Senha do certificado"
          type="password"
          autoComplete="off"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <div className="flex gap-2">
          <Button type="submit" loading={sending}>
            Enviar certificado
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
        </div>
      </form>
    </Drawer>
  );
}
