import { requireAuth } from '../../_shared/auth.ts';
import { jsonResponse, type PagesContext } from '../../_shared/cf.ts';
import { sanitizePublicUser } from '../../_shared/store.ts';

export async function onRequestGet(context: PagesContext): Promise<Response> {
  const auth = await requireAuth(context);
  if ('errorResponse' in auth) return auth.errorResponse;
  return jsonResponse({ ok: true, user: sanitizePublicUser(auth.user) });
}
