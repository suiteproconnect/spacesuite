import { requireAuth } from '../../../_shared/auth.ts';
import { jsonResponse, parseJsonBody, type PagesContext } from '../../../_shared/cf.ts';
import {
  addAuditEvent,
  createVerifiedUserDirect,
  findUserByEmail,
  sanitizePublicUser,
  type StoredUserRole,
} from '../../../_shared/store.ts';

export async function onRequestPost(context: PagesContext): Promise<Response> {
  const auth = await requireAuth(context);
  if ('errorResponse' in auth) return auth.errorResponse;
  if (auth.user.role !== 'admin') {
    return jsonResponse({ error: 'Acceso restringido a cuentas principales.' }, 403);
  }

  const body = await parseJsonBody<{
    name?: string;
    email?: string;
    password?: string;
    role?: string;
  }>(context.request);

  const cleanName = (typeof body.name === 'string' ? body.name : '').trim();
  const cleanEmail = (typeof body.email === 'string' ? body.email : '').trim().toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';
  const role: StoredUserRole = body.role === 'admin' ? 'admin' : 'user';

  if (cleanName.length < 2) {
    return jsonResponse({ error: 'Escribe el nombre (mínimo 2 letras).' }, 400);
  }
  if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) {
    return jsonResponse({ error: 'Escribe un correo electrónico válido.' }, 400);
  }
  if (!password || password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return jsonResponse({ error: 'La contraseña necesita 8+ caracteres con letras y números.' }, 400);
  }

  const existing = await findUserByEmail(context.env, cleanEmail);
  if (existing) {
    return jsonResponse({ error: 'Ya existe una cuenta registrada con ese correo.' }, 409);
  }

  const created = await createVerifiedUserDirect(context.env, {
    name: cleanName,
    email: cleanEmail,
    password,
    role,
  });

  await addAuditEvent(
    context.env,
    'admin',
    auth.user.email,
    `Creó cuenta ${role} para ${created.email}`,
  );

  return jsonResponse({ ok: true, user: sanitizePublicUser(created) }, 201);
}
