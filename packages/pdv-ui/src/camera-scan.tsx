import type { Platform } from '@bipae/platform';
import { Alert, Button, Modal } from '@bipae/ui';
import { Camera } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

/**
 * Câmera como leitor de código (F8-05): abre a câmera traseira e entrega cada código lido.
 * Só aparece onde o aparelho sabe ler (Chrome do Android, app Bipaê); nos outros, a capacidade
 * explica o porquê (Início → O que funciona).
 */
export function CameraScanButton({
  platform,
  onCode,
  label = 'Ler com a câmera',
}: {
  platform: Platform;
  onCode: (code: string) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!platform.barcodeCamera) return null;
  return (
    <>
      <Button
        variant="secondary"
        icon={<Camera className="size-5" aria-hidden />}
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
      {open && (
        <CameraScanDialog platform={platform} onCode={onCode} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function CameraScanDialog({
  platform,
  onCode,
  onClose,
}: {
  platform: Platform;
  onCode: (code: string) => void;
  onClose: () => void;
}) {
  // O vídeo nasce dentro do portal da janela, depois deste componente: liga quando aparecer.
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [last, setLast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A câmera liga uma vez; quem recebe o código pode mudar a cada renderização.
  const deliver = useRef(onCode);
  useEffect(() => {
    deliver.current = onCode;
  });

  useEffect(() => {
    let stop: (() => void) | null = null;
    let alive = true;
    const camera = platform.barcodeCamera;
    if (!camera || !video) return;
    camera
      .start(video, (code) => {
        setLast(code);
        deliver.current(code);
      })
      .then((fn) => {
        if (alive) stop = fn;
        else fn();
      })
      .catch(() =>
        setError(
          'Não deu para abrir a câmera. Libere a câmera para o Bipaê nas permissões do aparelho e tente de novo.',
        ),
      );
    return () => {
      alive = false;
      stop?.();
    };
  }, [platform, video]);

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="Ler código com a câmera">
      <div className="flex flex-col gap-3">
        {error && <Alert>{error}</Alert>}
        <video
          ref={setVideo}
          muted
          playsInline
          aria-label="Imagem da câmera"
          className="aspect-[4/3] w-full rounded-ui bg-black object-cover"
        />
        <p className="text-sm text-muted" role="status">
          {last
            ? `Lido: ${last}. Pode ler o próximo.`
            : 'Aponte para o código de barras. Cada leitura entra sozinha.'}
        </p>
        <Button onClick={onClose}>Pronto</Button>
      </div>
    </Modal>
  );
}
