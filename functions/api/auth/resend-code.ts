import { jsonResponse, parseJsonBody, type PagesContext } from '../../_shared/cf.ts';
import { generateOtpCode } from '../../_shared/crypto.ts';
import { addAuditEvent, findUserByEmail, updateUser } from '../../_shared/store.ts';

export async function onRequestPost(context: PagesContext): Promise<Response> {
  const body = await parseJsonBody<{ email?: string }>(context.request);
  const cleanEmail = (typeof body.email === 'string' ? body.email : '').trim().toLowerCase();
  const user = await findUserByEmail(context.env, cleanEmail);

  if (!user) {
    return jsonResponse({ error: 'No existe cuenta pendiente con ese correo.' }, 404);
  }
  if (user.verified) {
    return jsonResponse({ error: 'Este correo ya está verificado.' }, 400);
  }
  if (Date.now() - user.lastCodeSentAt < 15000) {
    return jsonResponse({ error: 'Espera unos segundos antes de pedir otro código.' }, 429);
  }

  const code = generateOtpCode();
  user.verificationCode = code;
  user.verificationExpiresAt = Date.now() + 10 * 60 * 1000;
  user.lastCodeSentAt = Date.now();
  await updateUser(context.env, user);

  await addAuditEvent(context.env, 'auth', user.email, 'Código reenviado (verificación Edge)');

  return jsonResponse({
    ok: true,
    deliveredVia: 'dev',
    devCode: code,
  });
}
