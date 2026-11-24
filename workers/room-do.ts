export { RoomDurableObject } from '../functions/durable/RoomDurableObject.ts';

export default {
  fetch() {
    return new Response(JSON.stringify({ ok: true, service: 'spacesuite-do' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  },
};
