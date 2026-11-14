import {
  jsonResponse,
  MAX_ROOM_PARTICIPANTS,
  normalizeMeteredDomain,
  normalizeRoomCode,
  parseJsonBody,
  type PagesContext,
} from '../../_shared/cf.ts';
import { getRoomSummary } from '../../_shared/store.ts';

export async function onRequestPost(context: PagesContext): Promise<Response> {
  const body = await parseJsonBody<{
    roomCode?: string;
    peerId?: string;
    name?: string;
    isAdmin?: boolean;
  }>(context.request);

  const roomName = normalizeRoomCode(typeof body.roomCode === 'string' ? body.roomCode : '');
  const summary = await getRoomSummary(context.env, roomName);
  const currentCount = summary.participants;

  if (currentCount >= MAX_ROOM_PARTICIPANTS) {
    return jsonResponse(
      {
        ok: false,
        error: `La sala alcanzó el límite de ${MAX_ROOM_PARTICIPANTS} participantes.`,
        maxParticipants: MAX_ROOM_PARTICIPANTS,
        currentCount,
      },
      403,
    );
  }

  const rawDomain = typeof context.env.METERED_DOMAIN === 'string' ? context.env.METERED_DOMAIN : '';
  const rawSecret =
    typeof context.env.METERED_SECRET_KEY === 'string' && context.env.METERED_SECRET_KEY.trim()
      ? context.env.METERED_SECRET_KEY
      : typeof context.env.METERED_API_KEY === 'string'
        ? context.env.METERED_API_KEY
        : '';

  const domain = normalizeMeteredDomain(rawDomain);
  const secretKey = rawSecret.trim();

  if (!domain || !secretKey) {
    return jsonResponse({
      ok: true,
      configured: false,
      mode: 'p2p-fallback',
      roomName,
      maxParticipants: MAX_ROOM_PARTICIPANTS,
      currentCount,
    });
  }

  const cleanName = (typeof body.name === 'string' ? body.name : 'Invitado').trim().slice(0, 32) || 'Invitado';
  const externalUserId =
    (typeof body.peerId === 'string' && body.peerId.trim() ? body.peerId.trim() : crypto.randomUUID()).slice(
      0,
      64,
    );

  try {
    const roomResp = await fetch(
      `https://${domain}/api/v1/room?secretKey=${encodeURIComponent(secretKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomName,
          privacy: 'public',
          autoJoin: true,
          maxParticipants: MAX_ROOM_PARTICIPANTS,
        }),
      },
    );

    if (!roomResp.ok && roomResp.status !== 400 && roomResp.status !== 409) {
      const errBody = await roomResp.text();
      return jsonResponse(
        {
          ok: false,
          error: `Error creando sala en Metered (${roomResp.status}): ${errBody.slice(0, 120)}`,
        },
        502,
      );
    }

    const tokenResp = await fetch(
      `https://${domain}/api/v1/token?secretKey=${encodeURIComponent(secretKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomName,
          externalUserId,
          name: cleanName,
          isAdmin: Boolean(body.isAdmin),
        }),
      },
    );

    const tokenJson = (await tokenResp.json().catch(() => ({}))) as {
      token?: string;
      message?: string;
    };

    if (!tokenResp.ok || !tokenJson.token) {
      return jsonResponse(
        {
          ok: false,
          error: tokenJson.message || `No se pudo generar token Metered (${tokenResp.status}).`,
        },
        502,
      );
    }

    return jsonResponse({
      ok: true,
      configured: true,
      mode: 'metered-sfu',
      roomURL: `${domain}/${roomName}`,
      roomName,
      domain,
      accessToken: tokenJson.token,
      maxParticipants: MAX_ROOM_PARTICIPANTS,
      currentCount,
    });
  } catch (err) {
    return jsonResponse(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'Fallo de conexión con Metered SFU.',
      },
      500,
    );
  }
}

export async function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method === 'POST') {
    return onRequestPost(context);
  }
  return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
}
