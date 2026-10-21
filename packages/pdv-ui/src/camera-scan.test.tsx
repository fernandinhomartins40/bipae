import { createSimulatedPlatform } from '@bipae/platform/simulators';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { CameraScanButton } from './camera-scan';

describe('ler com a câmera (F8-05)', () => {
  it('cada código lido é entregue e a câmera desliga ao fechar', async () => {
    const platform = createSimulatedPlatform('web');
    const onCode = vi.fn();
    render(<CameraScanButton platform={platform} onCode={onCode} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ler com a câmera' }));
    await vi.waitFor(() => expect(platform.barcodeCamera.active).toBe(true));
    act(() => platform.barcodeCamera.show('78912342'));
    expect(onCode).toHaveBeenCalledWith('78912342');
    expect(screen.getByRole('status')).toHaveTextContent('Lido: 78912342');
    await userEvent.click(screen.getByRole('button', { name: 'Pronto' }));
    expect(platform.barcodeCamera.active).toBe(false);
  });

  it('não aparece onde o aparelho não lê código', () => {
    const { barcodeCamera: _, ...semCamera } = createSimulatedPlatform('web');
    render(<CameraScanButton platform={semCamera} onCode={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Ler com a câmera' })).not.toBeInTheDocument();
  });
});
