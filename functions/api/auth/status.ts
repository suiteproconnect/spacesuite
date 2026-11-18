import { jsonResponse, type PagesContext } from '../../_shared/cf.ts';
import { ensureBootstrapAdmin, hasVerifiedAdmin } from '../../_shared/store.ts';

export async function onRequestGet(context: PagesContext): Promise<Response> {
  await ensureBootstrapAdmin(context.env);
  const hasAdmin = await hasVerifiedAdmin(context.env);
  const requiresAdminKey = Boolean(
    typeof context.env.ADMIN_SETUP_KEY === 'string' && context.env.ADMIN_SETUP_KEY.trim(),
  );

  return jsonResponse({
    ok: true,
    hasAdmin,
    requiresAdminKey,
  });
}
