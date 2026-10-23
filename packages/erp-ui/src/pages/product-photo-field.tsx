import { ProductThumb } from '@bipae/pdv-ui';
import { Alert, Button } from '@bipae/ui';
import { Camera, ClipboardPaste, ImagePlus, Trash2 } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import {
  checkPhotoFile,
  imageFromTransfer,
  loadImage,
  NOT_AN_IMAGE,
  UNREADABLE_IMAGE,
} from '../product-photo';

/** O que muda na foto ao salvar o produto (F2-14). */
export type PhotoChange =
  | { kind: 'keep' }
  | { kind: 'remove' }
  | { kind: 'new'; image: HTMLImageElement; url: string; zoom: number };

/** Câmera no celular: o seletor de arquivo abre direto a câmera traseira. */
function useTouchDevice() {
  const [touch] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches,
  );
  return touch;
}

/**
 * Campo "Foto" do cadastro de produto (F2-14): escolher arquivo, colar (Ctrl+V ou o botão),
 * arrastar, ou tirar com a câmera do celular. Mostra a prévia já recortada em quadrado no centro,
 * com zoom opcional; a redução para 512×512 acontece ao salvar.
 */
export function ProductPhotoField({
  name,
  productId,
  imageHash,
  value,
  onChange,
}: {
  name: string;
  productId: string | null;
  imageHash: string | null;
  value: PhotoChange;
  onChange: (next: PhotoChange) => void;
}) {
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const touch = useTouchDevice();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canPaste = typeof navigator !== 'undefined' && !!navigator.clipboard?.read;

  // A prévia da foto nova usa um endereço local, liberado quando a foto sai.
  const pendingUrl = value.kind === 'new' ? value.url : null;
  useEffect(
    () => () => {
      if (pendingUrl) URL.revokeObjectURL(pendingUrl);
    },
    [pendingUrl],
  );

  const take = async (file: Blob | null) => {
    setError(null);
    if (!file) return setError(NOT_AN_IMAGE);
    const problem = checkPhotoFile(file);
    if (problem) return setError(problem);
    setBusy(true);
    try {
      const image = await loadImage(file);
      onChange({ kind: 'new', image, url: URL.createObjectURL(file), zoom: 1 });
    } catch {
      setError(UNREADABLE_IMAGE);
    } finally {
      setBusy(false);
    }
  };
  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    e.target.value = '';
    if (file) void take(file);
  };
  const pasteFromClipboard = async () => {
    setError(null);
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((t) => t.startsWith('image/'));
        if (type) return void (await take(await item.getType(type)));
      }
      setError('Não tem foto copiada. Copie uma imagem e tente de novo.');
    } catch {
      setError('O navegador não deixou colar. Clique na área da foto e use Ctrl+V.');
    }
  };

  const hasCurrent = value.kind === 'keep' && !!imageHash;
  const zoom = value.kind === 'new' ? value.zoom : 1;

  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={`${id}-hint`}>
      <legend className="mb-1 font-semibold">Foto (opcional)</legend>
      <div className="flex flex-wrap items-start gap-4">
        <div
          tabIndex={0}
          role="group"
          aria-label="Área da foto: cole uma imagem aqui (Ctrl+V) ou arraste um arquivo"
          data-testid="product-photo-zone"
          onPaste={(e) => {
            const file = imageFromTransfer(e.clipboardData);
            if (file) {
              e.preventDefault();
              void take(file);
            }
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void take(imageFromTransfer(e.dataTransfer));
          }}
          className="relative size-28 shrink-0 overflow-hidden rounded-2xl border-2 border-dashed border-border bg-surface-2 focus-visible:outline-2 focus-visible:outline-primary"
        >
          {value.kind === 'new' ? (
            // Prévia do recorte: quadrado no centro, aproximado pelo zoom (o mesmo que vai salvar).
            <img
              src={value.url}
              alt={`Prévia da foto de ${name || 'produto'}`}
              data-testid="product-photo-preview"
              className="size-full object-cover"
              style={{ transform: `scale(${zoom})` }}
            />
          ) : hasCurrent ? (
            <ProductThumb
              name={name || '?'}
              productId={productId}
              imageHash={imageHash}
              size="cover"
            />
          ) : (
            <span className="flex size-full flex-col items-center justify-center gap-1 p-2 text-center text-xs text-muted">
              <ImagePlus className="size-7" aria-hidden />
              Sem foto
            </span>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              icon={<ImagePlus className="size-5" aria-hidden />}
              onClick={() => fileRef.current?.click()}
              loading={busy}
            >
              Escolher foto
            </Button>
            {touch && (
              <Button
                variant="secondary"
                icon={<Camera className="size-5" aria-hidden />}
                onClick={() => cameraRef.current?.click()}
              >
                Tirar foto
              </Button>
            )}
            {canPaste && (
              <Button
                variant="secondary"
                icon={<ClipboardPaste className="size-5" aria-hidden />}
                onClick={() => void pasteFromClipboard()}
              >
                Colar
              </Button>
            )}
            {(hasCurrent || value.kind === 'new') && (
              <Button
                variant="ghost"
                icon={<Trash2 className="size-5" aria-hidden />}
                onClick={() => {
                  setError(null);
                  onChange(imageHash ? { kind: 'remove' } : { kind: 'keep' });
                }}
              >
                Remover foto
              </Button>
            )}
          </div>
          {value.kind === 'new' && (
            <label className="flex max-w-xs flex-col gap-1 text-sm">
              <span>Aproximar</span>
              <input
                type="range"
                min={1}
                max={3}
                step={0.05}
                value={zoom}
                onChange={(e) => onChange({ ...value, zoom: Number(e.target.value) })}
                className="accent-primary"
              />
            </label>
          )}
          {value.kind === 'remove' && (
            <p className="text-sm text-muted">A foto sai quando você salvar.</p>
          )}
          <p id={`${id}-hint`} className="text-sm text-muted">
            Aparece no caixa e na busca. Fica quadrada e leve (até 512 × 512) para abrir rápido.
          </p>
        </div>
      </div>
      {error && <Alert>{error}</Alert>}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-label="Arquivo da foto"
        data-testid="product-photo-file"
        onChange={onFile}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-label="Câmera para a foto"
        onChange={onFile}
      />
    </fieldset>
  );
}
