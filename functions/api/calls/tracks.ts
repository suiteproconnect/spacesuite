import { jsonResponse, parseJsonBody, type PagesContext } from '../../_shared/cf.ts';

function getCallsCreds(env: PagesContext['env']) {
  const appId = typeof env.CLOUDFLARE_CALLS_APP_ID === 'string' ? env.CLOUDFLARE_CALLS_APP_ID.trim() : '';
  const appSecret =
    typeof env.CLOUDFLARE_CALLS_APP_SECRET === 'string' ? env.CLOUDFLARE_CALLS_APP_SECRET.trim() : '';
  return { appId, appSecret };
}

export async function onRequestPost(context: PagesContext): Promise<Response> {
  const { appId, appSecret } = getCallsCreds(context.env);
  if (!appId || !appSecret) {
    return jsonResponse({ ok: false, configured: false, error: 'Cloudflare Calls no configurado.' }, 503);
  }

  const body = await parseJsonBody<{
    sessionId?: string;
    sessionDescription?: Record<string, unknown>;
    tracks?: Array<Record<string, unknown>>;
  }>(context.request);

  const sessionId = String(body.sessionId || '').trim();
  if (!sessionId || !Array.isArray(body.tracks) || body.tracks.length === 0) {
    return jsonResponse({ ok: false, error: 'sessionId y tracks requeridos.' }, 400);
  }

  try {
    const payload: Record<string, unknown> = { tracks: body.tracks };
    if (body.sessionDescription) {
      payload.sessionDescription = body.sessionDescription;
    }
    const cfRes = await fetch(
      `https://rtc.live.cloudflare.com/v1/apps/${encodeURIComponent(appId)}/sessions/${encodeURIComponent(sessionId)}/tracks/new`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${appSecret}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      },
    );
    const data = (await cfRes.json().catch(() => ({}))) as Record<string, unknown>;
    if (!cfRes.ok) {
      return jsonResponse(
        { ok: false, error: String(data.errorDescription || 'Error al negociar tracks en Cloudflare Calls.'), data },
        cfRes.status || 502,
      );
    }
    return jsonResponse({ ok: true, ...data });
  } catch {
    return jsonResponse({ ok: false, error: 'Error de conexión con Cloudflare Calls.' }, 502);
  }
}

export async function onRequestPut(context: PagesContext): Promise<Response> {
  const { appId, appSecret } = getCallsCreds(context.env);
  if (!appId || !appSecret) {
    return jsonResponse({ ok: false, configured: false, error: 'Cloudflare Calls no configurado.' }, 503);
  }

  const body = await parseJsonBody<{
    sessionId?: string;
    sessionDescription?: Record<string, unknown>;
    tracks?: Array<Record<string, unknown>>;
    force?: boolean;
  }>(context.request);

  const sessionId = String(body.sessionId || '').trim();
  if (!sessionId || !Array.isArray(body.tracks) || body.tracks.length === 0) {
    return jsonResponse({ ok: false, error: 'sessionId y tracks requeridos.' }, 400);
  }

  try {
    const payload: Record<string, unknown> = {
      tracks: body.tracks,
      force: Boolean(body.force),
    };
    if (body.sessionDescription) {
      payload.sessionDescription = body.sessionDescription;
    }
    const cfRes = await fetch(
      `https://rtc.live.cloudflare.com/v1/apps/${encodeURIComponent(appId)}/sessions/${encodeURIComponent(sessionId)}/tracks/close`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${appSecret}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      },
    );
    const data = (await cfRes.json().catch(() => ({}))) as Record<string, unknown>;
    if (!cfRes.ok) {
      return jsonResponse(
        { ok: false, error: String(data.errorDescription || 'Error al cerrar tracks en Cloudflare Calls.'), data },
        cfRes.status || 502,
      );
    }
    return jsonResponse({ ok: true, ...data });
  } catch {
    return jsonResponse({ ok: false, error: 'Error de conexión con Cloudflare Calls.' }, 502);
  }
}
