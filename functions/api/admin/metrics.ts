import { requireAuth } from '../../_shared/auth.ts';
import { jsonResponse, type PagesContext } from '../../_shared/cf.ts';
import { getAdminSnapshot } from '../../_shared/store.ts';

export async function onRequestGet(context: PagesContext): Promise<Response> {
  const auth = await requireAuth(context);
  if ('errorResponse' in auth) return auth.errorResponse;
  if (auth.user.role !== 'admin') {
    return jsonResponse({ error: 'Acceso restringido a cuentas principales.' }, 403);
  }

  const snapshot = await getAdminSnapshot(context.env);
  return jsonResponse({ ok: true, ...snapshot });
}
