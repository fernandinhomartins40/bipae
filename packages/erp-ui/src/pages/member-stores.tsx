import { Alert, Button, Checkbox, Drawer } from '@bipae/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useApp } from '../context';

export interface StoreOption {
  id: string;
  name: string;
}

/**
 * Lojas de uma pessoa da equipe (F1-05). "Todas as lojas" vale também para lojas criadas
 * depois; escolher lojas restringe caixas, vendas e estoque a elas.
 */
export function MemberStoresForm({
  member,
  stores,
  onClose,
}: {
  member: { userId: string; name: string; storeIds: string[] | null };
  stores: StoreOption[];
  onClose: () => void;
}) {
  const { api } = useApp();
  const queryClient = useQueryClient();
  const [all, setAll] = useState(member.storeIds === null);
  const [chosen, setChosen] = useState<string[]>(member.storeIds ?? []);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!all && chosen.length === 0) {
      setError('Escolha pelo menos uma loja ou marque "Todas as lojas".');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/members/${member.userId}`, { storeIds: all ? null : chosen });
      await queryClient.invalidateQueries({ queryKey: ['members'] });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer open onOpenChange={(o) => !o && onClose()} title={`Lojas de ${member.name}`}>
      <div className="flex flex-col gap-4">
        <p className="text-muted">
          A pessoa só vê e usa os caixas, as vendas e o estoque das lojas escolhidas.
        </p>
        {error && <Alert>{error}</Alert>}
        <Checkbox
          label="Todas as lojas"
          hint="Inclui as lojas que forem criadas depois."
          checked={all}
          onChange={setAll}
        />
        {!all && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 font-semibold">Só estas lojas</legend>
            {stores.map((s) => (
              <Checkbox
                key={s.id}
                label={s.name}
                checked={chosen.includes(s.id)}
                onChange={(v) =>
                  setChosen((list) => (v ? [...list, s.id] : list.filter((id) => id !== s.id)))
                }
              />
            ))}
          </fieldset>
        )}
        <div className="flex gap-2 pt-2">
          <Button onClick={() => void save()} loading={saving}>
            Salvar lojas
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
        </div>
      </div>
    </Drawer>
  );
}
