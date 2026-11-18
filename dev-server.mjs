import http from 'node:http';
import fs from 'node:fs/promises';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PORT = Number(process.env.PORT || 3000);
const ROOT_DIR = process.cwd();
const STATIC_DIR = ROOT_DIR;
const FUNCTIONS_DIR = path.join(ROOT_DIR, 'functions');
const ALLOWED_ROOT_FILES = new Set([
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.webmanifest',
  '/favicon.ico',
]);
const ALLOWED_PREFIXES = ['/js/', '/assets/'];

// Load .env if present without external dependencies
const envPath = path.join(ROOT_DIR, '.env');
if (existsSync(envPath)) {
  try {
    const raw = readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const k = trimmed.slice(0, eq).trim();
      let v = trimmed.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (!(k in process.env)) process.env[k] = v;
    }
  } catch {
    // ignore .env read errors
  }
}

function createNodeSqliteD1(dbFilePath) {
  mkdirSync(path.dirname(dbFilePath), { recursive: true });
  const sqlite = new DatabaseSync(dbFilePath);
  sqlite.exec('PRAGMA journal_mode = WAL;');
  sqlite.exec('PRAGMA busy_timeout = 5000;');

  function makeStatement(query, boundParams = []) {
    const cleanParams = boundParams.map((v) => (v === undefined ? null : v));
    return {
      bind(...values) {
        return makeStatement(query, values);
      },
      async first(colName) {
        const stmt = sqlite.prepare(query);
        const row = stmt.get(...cleanParams);
        if (!row) return null;
        if (colName) return row[colName] ?? null;
        return row;
      },
      async run() {
        const stmt = sqlite.prepare(query);
        const info = stmt.run(...cleanParams);
        return {
          results: [],
          success: true,
          meta: {
            last_row_id: Number(info.lastInsertRowid || 0),
            changes: Number(info.changes || 0),
          },
        };
      },
      async all() {
        const stmt = sqlite.prepare(query);
        const rows = stmt.all(...cleanParams);
        return {
          results: rows,
          success: true,
          meta: {},
        };
      },
    };
  }

  return {
    prepare(query) {
      return makeStatement(query);
    },
    async batch(statements) {
      const out = [];
      for (const st of statements) {
        out.push(await st.run());
      }
      return out;
    },
    async exec(query) {
      sqlite.exec(query);
      return { count: 1 };
    },
  };
}

const localDb = createNodeSqliteD1(path.join(ROOT_DIR, '.data', 'spacesuite.sqlite'));
const runtimeEnv = {
  ...process.env,
  DB: localDb,
};

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const STATIC_API_ROUTES = {
  '/api/health': 'api/health.ts',
  '/api/salud': 'api/salud.ts',
  '/api/metered/session': 'api/metered/session.ts',
  '/api/auth/status': 'api/auth/status.ts',
  '/api/auth/register': 'api/auth/register.ts',
  '/api/auth/verify-email': 'api/auth/verify-email.ts',
  '/api/auth/resend-code': 'api/auth/resend-code.ts',
  '/api/auth/login': 'api/auth/login.ts',
  '/api/auth/me': 'api/auth/me.ts',
  '/api/auth/update-name': 'api/auth/update-name.ts',
  '/api/admin/metrics': 'api/admin/metrics.ts',
  '/api/admin/users/role': 'api/admin/users/role.ts',
  '/api/admin/users/create': 'api/admin/users/create.ts',
  '/api/gemini/super-key': 'api/gemini/super-key.ts',
};

const moduleCache = new Map();
async function loadFn(relPath) {
  if (!moduleCache.has(relPath)) {
    const abs = path.join(FUNCTIONS_DIR, relPath);
    const mod = await import(pathToFileURL(abs).href);
    moduleCache.set(relPath, mod);
  }
  return moduleCache.get(relPath);
}

function matchApiRoute(pathname) {
  if (STATIC_API_ROUTES[pathname]) {
    return { file: STATIC_API_ROUTES[pathname], params: {} };
  }
  const roomMatch = /^\/api\/room\/([^/]+)$/.exec(pathname);
  if (roomMatch) {
    return {
      file: 'api/room/[code].ts',
      params: { code: decodeURIComponent(roomMatch[1]) },
    };
  }
  const adminRoomMatch = /^\/api\/admin\/rooms\/([^/]+)\/action$/.exec(pathname);
  if (adminRoomMatch) {
    return {
      file: 'api/admin/rooms/[code]/action.ts',
      params: { code: decodeURIComponent(adminRoomMatch[1]) },
    };
  }
  return null;
}

function pickHandler(mod, method) {
  const m = method.toUpperCase();
  const specific = `onRequest${m.charAt(0)}${m.slice(1).toLowerCase()}`;
  if (typeof mod[specific] === 'function') return mod[specific];
  if (typeof mod.onRequest === 'function') return mod.onRequest;
  return null;
}

async function readBodyBuffer(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}

async function handleApi(req, res, url) {
  const matched = matchApiRoute(url.pathname);
  const mw = await loadFn('api/_middleware.ts');

  const bodyBuf = await readBodyBuffer(req);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) {
      for (const item of v) headers.append(k, item);
    } else if (typeof v === 'string') {
      headers.set(k, v);
    }
  }
  const request = new Request(url.toString(), {
    method: req.method,
    headers,
    body: bodyBuf,
  });

  const context = {
    request,
    env: runtimeEnv,
    params: matched ? matched.params : {},
    next: async () => {
      if (!matched) {
        return new Response(JSON.stringify({ ok: false, error: 'Endpoint no encontrado' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });
      }
      const mod = await loadFn(matched.file);
      const handler = pickHandler(mod, req.method || 'GET');
      if (!handler) {
        return new Response(JSON.stringify({ ok: false, error: 'Método no permitido' }), {
          status: 405,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });
      }
      return handler({
        request,
        env: runtimeEnv,
        params: matched.params,
        next: async () => new Response(null, { status: 404 }),
      });
    },
  };

  const response = typeof mw.onRequest === 'function' ? await mw.onRequest(context) : await context.next();
  const resHeaders = {};
  response.headers.forEach((val, key) => {
    resHeaders[key] = val;
  });
  res.writeHead(response.status, resHeaders);
  const buf = response.body ? Buffer.from(await response.arrayBuffer()) : null;
  res.end(buf);
}

function resolvePublicOrigin(req) {
  const rawHost = String(req.headers['x-forwarded-host'] || req.headers.host || '')
    .split(',')[0]
    .trim();
  const isLocal = !rawHost || /^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/i.test(rawHost);
  if (isLocal) {
    const envOrigin = process.env.APP_URL;
    if (envOrigin && /^https?:\/\//i.test(envOrigin) && !envOrigin.includes('MY_APP_URL')) {
      return envOrigin.replace(/\/+$/, '');
    }
  }
  const host = rawHost || `127.0.0.1:${PORT}`;
  const rawProto = String(req.headers['x-forwarded-proto'] || (isLocal ? 'http' : 'https'))
    .split(',')[0]
    .trim();
  return `${rawProto}://${host}`;
}

async function handleStatic(req, res, pathname) {
  let cleanPath = decodeURIComponent(pathname);
  if (cleanPath === '/') cleanPath = '/index.html';

  const isAllowed =
    ALLOWED_ROOT_FILES.has(cleanPath) || ALLOWED_PREFIXES.some((p) => cleanPath.startsWith(p));

  let fileToServe = path.resolve(STATIC_DIR, '.' + cleanPath);
  if (!fileToServe.startsWith(STATIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  let stat = isAllowed ? await fs.stat(fileToServe).catch(() => null) : null;
  if (!stat || stat.isDirectory()) {
    const hasFileExt = /\.[a-z0-9]{1,12}$/i.test(cleanPath);
    if (hasFileExt) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    // SPA fallback (/sala/* or client routes)
    fileToServe = path.join(STATIC_DIR, 'index.html');
    stat = await fs.stat(fileToServe).catch(() => null);
  }
  if (!stat) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const ext = path.extname(fileToServe).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  let data = await fs.readFile(fileToServe);
  if (ext === '.html') {
    const publicOrigin = resolvePublicOrigin(req);
    const html = data
      .toString('utf8')
      .replaceAll('https://spacesuite.pages.dev', publicOrigin);
    data = Buffer.from(html, 'utf8');
  }
  const headers = { 'Content-Type': contentType, 'Cache-Control': 'no-cache' };
  res.writeHead(200, headers);
  res.end(data);
}

const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host || `127.0.0.1:${PORT}`;
    const url = new URL(req.url || '/', `http://${host}`);
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
    } else {
      await handleStatic(req, res, url.pathname);
    }
  } catch (err) {
    console.error('Server error:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    }
    res.end(JSON.stringify({ ok: false, error: 'Error interno del servidor' }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`spaceSUITE static + Cloudflare Functions dev server listening on http://0.0.0.0:${PORT}`);
});
