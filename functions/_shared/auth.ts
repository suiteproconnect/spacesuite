import { jsonResponse, type PagesContext } from './cf.ts';
import { verifyAuthToken, type StoredUser } from './store.ts';

export async function requireAuth(
  context: PagesContext<Record<string, unknown>>,
): Promise<{ user: StoredUser } | { errorResponse: Response }> {
  const header = context.request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const user = await verifyAuthToken(context.env, token);
  if (!user || !user.verified) {
    return {
      errorResponse: jsonResponse({ error: 'Sesión inválida o correo sin verificar.' }, 401),
    };
  }
  return { user };
}
