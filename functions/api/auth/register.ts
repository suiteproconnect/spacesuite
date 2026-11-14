import { jsonResponse, parseJsonBody, type PagesContext } from '../../_shared/cf.ts';
import {
  addAuditEvent,
  createOrUpdatePendingUser,
  findUserByEmail,
} from '../../_shared/store.ts';

export async function onRequestPost(context: PagesContext): Promise<Response> {
  const body = await parseJsonBody<{
    name?: string;
    email?: string;
    password?: string;
    dob?: string;
  }>(context.request);

  const cleanName = (typeof body.name === 'string' ? body.name : '').trim();
  const cleanEmail = (typeof body.email === 'string' ? body.email : '').trim().toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';
  const dob = typeof body.dob === 'string' ? body.dob : '';

  if (cleanName.length < 2) {
    return jsonResponse({ error: 'Escribe tu nombre o alias (mínimo 2 letras).' }, 400);
  }
  if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) {
    return jsonResponse({ error: 'Escribe un correo electrónico válido.' }, 400);
  }
  if (!password || password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return jsonResponse({ error: 'La contraseña necesita 8+ caracteres con letras y números.' }, 400);
  }
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 18);
  if (!dob || dob > cutoff.toISOString().slice(0, 10)) {
    return jsonResponse({ error: 'Debes ser mayor de 18 años para registrarte.' }, 400);
  }

  const existing = await findUserByEmail(context.env, cleanEmail);
  if (existing && existing.verified) {
    return jsonResponse({ error: 'Ya existe una cuenta verificada con ese correo.' }, 409);
  }

  const { user, code } = await createOrUpdatePendingUser(context.env, {
    name: cleanName,
    email: cleanEmail,
    password,
  });
  await addAuditEvent(context.env, 'auth', user.email, 'Registro iniciado (verificación Edge)');

  return jsonResponse({
    ok: true,
    requiresVerification: true,
    email: user.email,
    deliveredVia: 'dev',
    devCode: code,
  });
}
