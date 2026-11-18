import { jsonResponse, parseJsonBody, type PagesContext } from '../../_shared/cf.ts';
import { generateOtpCode, verifyPassword } from '../../_shared/crypto.ts';
import {
  addAuditEvent,
  createAuthToken,
  ensureBootstrapAdmin,
  findUserByEmail,
  sanitizePublicUser,
  updateUser,
} from '../../_shared/store.ts';

export async function onRequestPost(context: PagesContext): Promise<Response> {
  await ensureBootstrapAdmin(context.env);
  const body = await parseJsonBody<{ email?: string; password?: string }>(context.request);
  const cleanEmail = (typeof body.email === 'string' ? body.email : '').trim().toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';

  const user = await findUserByEmail(context.env, cleanEmail);
  if (!user || !password || !(await verifyPassword(password, user.passwordSalt, user.passwordHash))) {
    return jsonResponse({ error: 'Correo o contraseña incorrectos.' }, 401);
  }

  if (!user.verified) {
    const code = generateOtpCode();
    user.verificationCode = code;
    user.verificationExpiresAt = Date.now() + 10 * 60 * 1000;
    user.lastCodeSentAt = Date.now();
    await updateUser(context.env, user);

    return jsonResponse(
      {
        error: 'Debes verificar tu correo electrónico antes de entrar.',
        requiresVerification: true,
        email: user.email,
        deliveredVia: 'dev',
        devCode: code,
      },
      403,
    );
  }

  user.lastLoginAt = Date.now();
  await updateUser(context.env, user);
  const token = await createAuthToken(context.env, user);
  await addAuditEvent(context.env, 'auth', user.email, `Inicio de sesión (${user.role})`);

  return jsonResponse({ ok: true, user: sanitizePublicUser(user, token) });
}
