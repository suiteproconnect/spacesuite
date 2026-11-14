import { jsonResponse, parseJsonBody, type PagesContext } from '../../_shared/cf.ts';
import {
  addAuditEvent,
  createAuthToken,
  findUserByEmail,
  sanitizePublicUser,
  updateUser,
} from '../../_shared/store.ts';

export async function onRequestPost(context: PagesContext): Promise<Response> {
  const body = await parseJsonBody<{ email?: string; code?: string }>(context.request);
  const cleanEmail = (typeof body.email === 'string' ? body.email : '').trim().toLowerCase();
  const cleanCode = (typeof body.code === 'string' ? body.code : '').trim();

  const user = await findUserByEmail(context.env, cleanEmail);
  if (!user) {
    return jsonResponse({ error: 'No encontramos ese correo registrado.' }, 404);
  }
  if (!user.verificationCode || user.verificationExpiresAt < Date.now()) {
    return jsonResponse({ error: 'El código expiró. Solicita un código nuevo.' }, 400);
  }
  if (user.verificationCode !== cleanCode) {
    return jsonResponse({ error: 'Código incorrecto. Revisa e intenta de nuevo.' }, 400);
  }

  user.verified = true;
  user.verificationCode = null;
  user.verificationExpiresAt = 0;
  user.lastLoginAt = Date.now();
  await updateUser(context.env, user);

  const token = await createAuthToken(context.env, user);
  await addAuditEvent(context.env, 'auth', user.email, `Correo verificado (${user.role})`);

  return jsonResponse({ ok: true, user: sanitizePublicUser(user, token) });
}
