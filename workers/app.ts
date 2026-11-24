import { CORS_HEADERS, jsonResponse, type PagesContext, type PagesEnv } from '../functions/_shared/cf.ts';
import { onRequest as apiMiddleware } from '../functions/api/_middleware.ts';
import { onRequest as healthHandler } from '../functions/api/health.ts';
import { onRequest as saludHandler } from '../functions/api/salud.ts';
import { onRequestGet as authStatusHandler } from '../functions/api/auth/status.ts';
import { onRequestPost as authRegisterHandler } from '../functions/api/auth/register.ts';
import { onRequestPost as authVerifyHandler } from '../functions/api/auth/verify-email.ts';
import { onRequestPost as authResendHandler } from '../functions/api/auth/resend-code.ts';
import { onRequestPost as authLoginHandler } from '../functions/api/auth/login.ts';
import { onRequestGet as authMeHandler } from '../functions/api/auth/me.ts';
import { onRequestPost as authUpdateNameHandler } from '../functions/api/auth/update-name.ts';
import { onRequestPost as callsSessionHandler } from '../functions/api/calls/session.ts';
import { onRequestPost as callsTracksPostHandler, onRequestPut as callsTracksPutHandler } from '../functions/api/calls/tracks.ts';
import { onRequestPut as callsRenegotiateHandler } from '../functions/api/calls/renegotiate.ts';
import { onRequestPost as geminiSuperKeyHandler } from '../functions/api/gemini/super-key.ts';
import { onRequestGet as adminMetricsHandler } from '../functions/api/admin/metrics.ts';
import { onRequestPost as adminUserCreateHandler } from '../functions/api/admin/users/create.ts';
import { onRequestPost as adminUserRoleHandler } from '../functions/api/admin/users/role.ts';
import { onRequestPost as adminRoomActionHandler } from '../functions/api/admin/rooms/[code]/action.ts';
import { onRequestGet as roomGetHandler, onRequestPost as roomPostHandler } from '../functions/api/room/[code].ts';
import { onRequest as roomWsHandler } from '../functions/api/room/[code]/ws.ts';

export { RoomDurableObject } from '../functions/durable/RoomDurableObject.ts';

interface AssetsFetcher {
  fetch(input: Request | string): Promise<Response>;
}

interface WorkerEnv extends PagesEnv {
  ASSETS?: AssetsFetcher;
}

interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

async function routeApi(request: Request, env: WorkerEnv, execCtx: WorkerExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  const makeCtx = <P extends Record<string, string>>(params: P, next: () => Promise<Response>): PagesContext<P> => ({
    request,
    env,
    params,
    waitUntil: (p) => execCtx.waitUntil(p),
    next,
  });

  // WebSocket upgrade route must return raw 101 response untouched
  const wsMatch = /^\/api\/room\/([^/]+)\/ws\/?$/.exec(path);
  if (wsMatch) {
    return roomWsHandler(makeCtx({ code: decodeURIComponent(wsMatch[1]) }, async () => jsonResponse({ ok: false }, 404)));
  }

  return apiMiddleware(
    makeCtx({}, async () => {
      if (path === '/api/health') return healthHandler(makeCtx({}, async () => jsonResponse({ ok: false }, 404)));
      if (path === '/api/salud') return saludHandler(makeCtx({}, async () => jsonResponse({ ok: false }, 404)));

      if (path === '/api/auth/status' && method === 'GET') {
        return authStatusHandler(makeCtx({}, async () => jsonResponse({ ok: false }, 404)));
      }
      if (path === '/api/auth/register' && method === 'POST') {
        return authRegisterHandler(makeCtx({}, async () => jsonResponse({ ok: false }, 404)));
      }
      if (path === '/api/auth/verify-email' && method === 'POST') {
        return authVerifyHandler(makeCtx({}, async () => jsonResponse({ ok: false }, 404)));
      }
      if (path === '/api/auth/resend-code' && method === 'POST') {
        return authResendHandler(makeCtx({}, async () => jsonResponse({ ok: false }, 404)));
      }
      if (path === '/api/auth/login' && method === 'POST') {
        return authLoginHandler(makeCtx({}, async () => jsonResponse({ ok: false }, 404)));
      }
      if (path === '/api/auth/me' && method === 'GET') {
        return authMeHandler(makeCtx({}, async () => jsonResponse({ ok: false }, 404)));
      }
      if (path === '/api/auth/update-name' && method === 'POST') {
        return authUpdateNameHandler(makeCtx({}, async () => jsonResponse({ ok: false }, 404)));
      }

      if (path === '/api/calls/session' && method === 'POST') {
        return callsSessionHandler(makeCtx({}, async () => jsonResponse({ ok: false }, 404)));
      }
      if (path === '/api/calls/tracks' && method === 'POST') {
        return callsTracksPostHandler(makeCtx({}, async () => jsonResponse({ ok: false }, 404)));
      }
      if (path === '/api/calls/tracks' && method === 'PUT') {
        return callsTracksPutHandler(makeCtx({}, async () => jsonResponse({ ok: false }, 404)));
      }
      if (path === '/api/calls/renegotiate' && method === 'PUT') {
        return callsRenegotiateHandler(makeCtx({}, async () => jsonResponse({ ok: false }, 404)));
      }

      if (path === '/api/gemini/super-key' && method === 'POST') {
        return geminiSuperKeyHandler(makeCtx({}, async () => jsonResponse({ ok: false }, 404)));
      }

      if (path === '/api/admin/metrics' && method === 'GET') {
        return adminMetricsHandler(makeCtx({}, async () => jsonResponse({ ok: false }, 404)));
      }
      if (path === '/api/admin/users/create' && method === 'POST') {
        return adminUserCreateHandler(makeCtx({}, async () => jsonResponse({ ok: false }, 404)));
      }
      if (path === '/api/admin/users/role' && method === 'POST') {
        return adminUserRoleHandler(makeCtx({}, async () => jsonResponse({ ok: false }, 404)));
      }
      const adminRoomMatch = /^\/api\/admin\/rooms\/([^/]+)\/action\/?$/.exec(path);
      if (adminRoomMatch && method === 'POST') {
        return adminRoomActionHandler(
          makeCtx({ code: decodeURIComponent(adminRoomMatch[1]) }, async () => jsonResponse({ ok: false }, 404)),
        );
      }

      const roomMatch = /^\/api\/room\/([^/]+)\/?$/.exec(path);
      if (roomMatch) {
        const roomParams = { code: decodeURIComponent(roomMatch[1]) };
        if (method === 'GET') return roomGetHandler(makeCtx(roomParams, async () => jsonResponse({ ok: false }, 404)));
        if (method === 'POST') return roomPostHandler(makeCtx(roomParams, async () => jsonResponse({ ok: false }, 404)));
      }

      return jsonResponse({ ok: false, error: 'Ruta API no encontrada' }, 404);
    }),
  );
}

export default {
  async fetch(request: Request, env: WorkerEnv, execCtx: WorkerExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      }
      return routeApi(request, env, execCtx);
    }

    if (!env.ASSETS) {
      return new Response('ASSETS binding missing', { status: 500 });
    }

    // Serve static asset, with SPA fallback to index.html for deep room links (/sala/...)
    let assetRes = await env.ASSETS.fetch(request);
    if (assetRes.status === 404 && !url.pathname.includes('.')) {
      const indexUrl = new URL('/index.html', url.origin);
      assetRes = await env.ASSETS.fetch(new Request(indexUrl.toString(), request));
    }

    const contentType = assetRes.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      return assetRes;
    }

    const html = await assetRes.text();
    const updated = html.replaceAll('https://spacesuite.pages.dev', url.origin);
    const headers = new Headers(assetRes.headers);
    headers.delete('content-length');
    return new Response(updated, {
      status: assetRes.status,
      statusText: assetRes.statusText,
      headers,
    });
  },
};
