import {
  jsonResponse,
  MAX_ROOM_PARTICIPANTS,
  normalizeRoomCode,
  parseJsonBody,
  type PagesContext,
} from '../../_shared/cf.ts';
import { getRoomSummary } from '../../_shared/store.ts';

function getCallsCreds(env: PagesContext['env']) {
  const appId = typeof env.CLOUDFLARE_CALLS_APP_ID === 'string' ? env.CLOUDFLARE_CALLS_APP_ID.trim() : '';
  const appSecret =
    typeof env.CLOUDFLARE_CALLS_APP_SECRET === 'string' ? env.CLOUDFLARE_CALLS_APP_SECRET.trim() : '';
  return { appId, appSecret };
}

export async function onRequestPost(context: PagesContext): Promise<Response> {
  const body = await parseJsonBody<{
    roomCode?: string;
    peerId?: string;
    thirdparty?: boolean;
  }>(context.request);

  const roomCode = normalizeRoomCode(body.roomCode || '');
  const summary = await getRoomSummary(context.env, roomCode);
  let liveParticipants = summary.participants;

  if (context.env.ROOM_DO) {
    try {
      const stub = context.env.ROOM_DO.get(context.env.ROOM_DO.idFromName(roomCode));
      const snapRes = await stub.fetch(`https://room-do/snapshot?room=${encodeURIComponent(roomCode)}`);
      if (snapRes.ok) {
        const snapJson = (await snapRes.json().catch(() => null)) as { participants?: number } | null;
        if (typeof snapJson?.participants === 'number') {
          liveParticipants = Math.max(liveParticipants, snapJson.participants);
        }
      }
    } catch {
      // fall back to D1 summary count
    }
  }

  if (liveParticipants >= MAX_ROOM_PARTICIPANTS) {
    return jsonResponse(
      {
        ok: false,
        error: `La sala alcanzó el límite de ${MAX_ROOM_PARTICIPANTS} participantes (1 emisor + 19 espectadores).`,
        maxParticipants: MAX_ROOM_PARTICIPANTS,
      },
      403,
    );
  }

  const { appId, appSecret } = getCallsCreds(context.env);
  if (!appId || !appSecret) {
    return jsonResponse({
      ok: true,
      configured: false,
      sfuMode: 'cloudflare-calls',
      roomCode,
      maxParticipants: MAX_ROOM_PARTICIPANTS,
      sessionId: null,
    });
  }

  try {
    const cfRes = await fetch(`https://rtc.live.cloudflare.com/v1/apps/${encodeURIComponent(appId)}/sessions/new`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${appSecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        thirdparty: Boolean(body.thirdparty),
      }),
    });

    const data = (await cfRes.json().catch(() => ({}))) as {
      sessionId?: string;
      errorDescription?: string;
      errorCode?: string;
    };

    if (!cfRes.ok || !data.sessionId) {
      return jsonResponse(
        {
          ok: false,
          configured: true,
          error: data.errorDescription || 'No se pudo abrir sesión SFU en Cloudflare Calls.',
        },
        cfRes.status || 502,
      );
    }

    return jsonResponse({
      ok: true,
      configured: true,
      sfuMode: 'cloudflare-calls',
      roomCode,
      maxParticipants: MAX_ROOM_PARTICIPANTS,
      sessionId: data.sessionId,
    });
  } catch {
    return jsonResponse(
      {
        ok: false,
        configured: true,
        error: 'Error de red conectando con Cloudflare Calls SFU.',
      },
      502,
    );
  }
}
