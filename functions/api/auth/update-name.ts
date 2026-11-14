import { requireAuth } from '../../_shared/auth.ts';
import { jsonResponse, parseJsonBody, type PagesContext } from '../../_shared/cf.ts';
import { sanitizePublicUser, updateUser } from '../../_shared/store.ts';

export async function onRequestPost(context: PagesContext): Promise<Response> {
  const auth = await requireAuth(context);
  if ('errorResponse' in auth) return auth.errorResponse;

  const body = await parseJsonBody<{ name?: string }>(context.request);
  const cleanName = (typeof body.name === 'string' ? body.name : '').trim().slice(0, 24);
  if (cleanName.length < 2) {
    return jsonResponse({ error: 'Mínimo 2 letras.' }, 400);
  }

  auth.user.name = cleanName;
  await updateUser(context.env, auth.user);
  return jsonResponse({ ok: true, user: sanitizePublicUser(auth.user) });
}
