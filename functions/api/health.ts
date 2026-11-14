import { jsonResponse, MAX_ROOM_PARTICIPANTS, type PagesContext } from '../_shared/cf.ts';
import { getActiveRoomsCount } from '../_shared/store.ts';

export async function onRequest(context: PagesContext): Promise<Response> {
  const activeRooms = await getActiveRoomsCount(context.env);
  return jsonResponse({
    ok: true,
    status: 'ok',
    runtime: 'cloudflare-pages',
    storage: context.env.DB ? 'd1' : 'memory',
    activeRooms,
    maxParticipants: MAX_ROOM_PARTICIPANTS,
    timestamp: Date.now(),
  });
}
