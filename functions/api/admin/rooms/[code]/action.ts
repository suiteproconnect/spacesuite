import { requireAuth } from '../../../../_shared/auth.ts';
import { jsonResponse, parseJsonBody, type PagesContext } from '../../../../_shared/cf.ts';
import { adminMutateRoom } from '../../../../_shared/store.ts';

export async function onRequestPost(
  context: PagesContext<{ code?: string }>,
): Promise<Response> {
  const auth = await requireAuth(context);
  if ('errorResponse' in auth) return auth.errorResponse;
  if (auth.user.role !== 'admin') {
    return jsonResponse({ error: 'Acceso restringido a administradores.' }, 403);
  }

  const body = await parseJsonBody<{
    action?: 'endRoom' | 'lock' | 'waitingRoom' | 'muteAll';
    value?: boolean;
  }>(context.request);

  if (!body.action) {
    return jsonResponse({ error: 'Acción no válida.' }, 400);
  }

  const result = await adminMutateRoom(
    context.env,
    context.params.code || '',
    auth.user.name,
    auth.user.email,
    body.action,
    body.value,
  );

  if (!result.ok) {
    return jsonResponse({ error: result.error }, result.status);
  }

  return jsonResponse({ ok: true });
}
