import {
  jsonResponse,
  MAX_ROOM_PARTICIPANTS,
  normalizeMeteredDomain,
  normalizeRoomCode,
  parseJsonBody,
  type PagesContext,
} from '../../_shared/cf.ts';
import { getRoomSummary } from '../../_shared/store.ts';

interface IceServerEntry {
  urls: string | string[];
  username?: string;
  credential?: string;
}

const PUBLIC_STUN_SERVERS: IceServerEntry[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:global.stun.twilio.com:3478' },
];

async function resolveIceServers(
  env: PagesContext['env'],
  domain: string,
  secretKey: string,
): Promise<IceServerEntry[]> {
  const servers: IceServerEntry[] = [...PUBLIC_STUN_SERVERS];

  const turnUrl = typeof env.TURN_URL === 'string' ? env.TURN_URL.trim() : '';
  const turnUser = typeof env.TURN_USERNAME === 'string' ? env.TURN_USERNAME.trim() : '';
  const turnCred = typeof env.TURN_CREDENTIAL === 'string' ? env.TURN_CREDENTIAL.trim() : '';
  if (turnUrl && turnUser && turnCred) {
    servers.push({ urls: turnUrl, username: turnUser, credential: turnCred });
  }

  const cfTurnUrl = typeof env.CLOUDFLARE_TURN_URL === 'string' ? env.CLOUDFLARE_TURN_URL.trim() : '';
  const cfTurnUser = typeof env.CLOUDFLARE_TURN_USERNAME === 'string' ? env.CLOUDFLARE_TURN_USERNAME.trim() : '';
  const cfTurnCred = typeof env.CLOUDFLARE_TURN_CREDENTIAL === 'string' ? env.CLOUDFLARE_TURN_CREDENTIAL.trim() : '';
  if (cfTurnUrl && cfTurnUser && cfTurnCred) {
    servers.push({ urls: cfTurnUrl, username: cfTurnUser, credential: cfTurnCred });
  }

  const twilioTurnUrl = typeof env.TWILIO_TURN_URL === 'string' ? env.TWILIO_TURN_URL.trim() : '';
  const twilioTurnUser = typeof env.TWILIO_TURN_USERNAME === 'string' ? env.TWILIO_TURN_USERNAME.trim() : '';
  const twilioTurnCred = typeof env.TWILIO_TURN_CREDENTIAL === 'string' ? env.TWILIO_TURN_CREDENTIAL.trim() : '';
  if (twilioTurnUrl && twilioTurnUser && twilioTurnCred) {
    servers.push({ urls: twilioTurnUrl, username: twilioTurnUser, credential: twilioTurnCred });
  }

  if (domain && secretKey) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1800);
      const iceRes = await fetch(
        `https://${domain}/api/v1/turn/credentials?apiKey=${encodeURIComponent(secretKey)}`,
        { signal: controller.signal },
      );
      clearTimeout(timer);
      if (iceRes.ok) {
        const list = (await iceRes.json().catch(() => null)) as IceServerEntry[] | null;
        if (Array.isArray(list)) {
          for (const item of list) {
            if (item && item.urls) servers.push(item);
          }
        }
      }
    } catch {
      // ignore optional TURN lookup failures
    }
  }

  return servers;
}

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
  const iceServers = await resolveIceServers(context.env, domain, secretKey);

  if (!domain || !secretKey) {
    return jsonResponse({
      ok: true,
      configured: false,
      mode: 'p2p-fallback',
      roomName,
      iceServers,
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
      return jsonResponse({
        ok: true,
        configured: false,
        mode: 'p2p-fallback',
        roomName,
        iceServers,
        maxParticipants: MAX_ROOM_PARTICIPANTS,
        currentCount,
      });
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
      return jsonResponse({
        ok: true,
        configured: false,
        mode: 'p2p-fallback',
        roomName,
        iceServers,
        maxParticipants: MAX_ROOM_PARTICIPANTS,
        currentCount,
      });
    }

    return jsonResponse({
      ok: true,
      configured: true,
      mode: 'metered-sfu',
      roomURL: `${domain}/${roomName}`,
      roomName,
      domain,
      accessToken: tokenJson.token,
      iceServers,
      maxParticipants: MAX_ROOM_PARTICIPANTS,
      currentCount,
    });
  } catch {
    return jsonResponse({
      ok: true,
      configured: false,
      mode: 'p2p-fallback',
      roomName,
      iceServers,
      maxParticipants: MAX_ROOM_PARTICIPANTS,
      currentCount,
    });
  }
}

export async function onRequest(context: PagesContext): Promise<Response> {
  if (context.request.method === 'POST') {
    return onRequestPost(context);
  }
  return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);
}
