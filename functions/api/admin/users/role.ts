import { requireAuth } from '../../../_shared/auth.ts';
import { jsonResponse, parseJsonBody, type PagesContext } from '../../../_shared/cf.ts';
import { addAuditEvent, findUserByEmail, updateUser } from '../../../_shared/store.ts';

export async function onRequestPost(context: PagesContext): Promise<Response> {
  const auth = await requireAuth(context);
  if ('errorResponse' in auth) return auth.errorResponse;
  if (auth.user.role !== 'admin') {
    return jsonResponse({ error: 'Acceso restringido a cuentas principales.' }, 403);
  }

  const body = await parseJsonBody<{
    email?: string;
    role?: 'admin' | 'user';
    verified?: boolean;
  }>(context.request);

  const target = await findUserByEmail(context.env, typeof body.email === 'string' ? body.email : '');
  if (!target) {
    return jsonResponse({ error: 'Usuario no encontrado.' }, 404);
  }
  if (target.id === auth.user.id && body.role === 'user') {
    return jsonResponse({ error: 'No puedes quitar tu propio acceso principal.' }, 400);
  }

  if (body.role === 'admin' || body.role === 'user') {
    target.role = body.role;
    target.plan = body.role === 'admin' ? 'Acceso Total · Cuenta Principal' : 'Prueba gratis';
  }
  if (typeof body.verified === 'boolean') {
    target.verified = body.verified;
    if (body.verified) target.verificationCode = null;
  }

  await updateUser(context.env, target);
  await addAuditEvent(
    context.env,
    'admin',
    auth.user.email,
    `Actualizó usuario ${target.email} (${target.role})`,
  );

  return jsonResponse({ ok: true });
}
