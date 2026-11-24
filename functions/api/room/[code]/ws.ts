import { jsonResponse, normalizeRoomCode, type PagesContext } from '../../../_shared/cf.ts';

export async function onRequest(context: PagesContext<{ code?: string }>): Promise<Response> {
  const code = normalizeRoomCode(context.params.code || '');
  const upgrade = context.request.headers.get('Upgrade') || '';
  if (upgrade.toLowerCase() !== 'websocket') {
    return jsonResponse({ ok: false, error: 'Se requiere conexión WebSocket (Upgrade: websocket).' }, 426);
  }

  const ns = context.env.ROOM_DO;
  if (!ns) {
    return jsonResponse({ ok: false, error: 'ROOM_DO binding no configurado.' }, 503);
  }

  const id = ns.idFromName(code);
  const stub = ns.get(id);
  const url = new URL(context.request.url);
  url.searchParams.set('room', code);
  const forwarded = new Request(url.toString(), context.request);
  return stub.fetch(forwarded);
}
