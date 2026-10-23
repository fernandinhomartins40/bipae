import { PosApp } from '@bipae/pdv-ui';
import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useApp, useMe } from '../context';
import { createPosBackend } from '../pos-backend';

export function PosPage() {
  const { api, platform } = useApp();
  const me = useMe();
  const navigate = useNavigate();
  const backend = useMemo(() => createPosBackend(api), [api]);
  const user = useMemo(
    () => ({ id: me.user.id, name: me.user.name, tenantId: me.tenant.id, permissions: me.permissions }),
    [me],
  );
  return <PosApp platform={platform} backend={backend} user={user} onExit={() => navigate('/')} />;
}
