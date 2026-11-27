import {
  getInitial,
  MAX_ROOM_PARTICIPANTS,
  normalizeRoomCode,
  type ChatMessage,
  type D1Database,
  type PagesEnv,
  type PeerInfo,
  type RoomInteractiveState,
  type RoomMeta,
  type WaitingGuest,
} from './cf.ts';
import {
  generateOtpCode,
  generateServerSuiteCode,
  generateServerSuitePass,
  hashPassword,
  randomHex,
  signTokenPayload,
  verifyPassword,
  verifyTokenPayload,
} from './crypto.ts';

export type StoredUserRole = 'admin' | 'user';

export interface StoredUser {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  passwordSalt: string;
  role: StoredUserRole;
  verified: boolean;
  verificationCode: string | null;
  verificationExpiresAt: number;
  lastCodeSentAt: number;
  suiteCode: string;
  suitePass: string;
  plan: string;
  createdAt: number;
  lastLoginAt: number;
}

export interface AuditEvent {
  id: string;
  type: 'auth' | 'room' | 'admin';
  actor: string;
  detail: string;
  timestamp: number;
}

export interface RoomEventRecord {
  id: number;
  roomCode: string;
  targetPeerId: string | null;
  fromPeerId: string | null;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: number;
}

interface MemParticipant {
  info: PeerInfo;
  status: 'active' | 'waiting';
  lastSeenAt: number;
}

interface MemRoom {
  meta: RoomMeta;
  updatedAt: number;
  ended: boolean;
  blockedClientIds: string[];
  admittedClientIds: string[];
  participants: Map<string, MemParticipant>;
  messages: ChatMessage[];
}

interface MemStore {
  secret: string;
  startedAt: number;
  totalMessages: number;
  nextEventId: number;
  users: StoredUser[];
  audit: AuditEvent[];
  rooms: Map<string, MemRoom>;
  events: RoomEventRecord[];
}

const STALE_PEER_MS = 45_000;
const EVENT_TTL_MS = 120_000;

const DDL_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS app_kv (
    k TEXT PRIMARY KEY,
    v TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    role TEXT NOT NULL,
    verified INTEGER NOT NULL DEFAULT 0,
    verification_code TEXT,
    verification_expires_at INTEGER NOT NULL DEFAULT 0,
    last_code_sent_at INTEGER NOT NULL DEFAULT 0,
    suite_code TEXT NOT NULL,
    suite_pass TEXT NOT NULL,
    plan TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_login_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS rooms (
    code TEXT PRIMARY KEY,
    pass TEXT,
    locked INTEGER NOT NULL DEFAULT 0,
    waiting_room INTEGER NOT NULL DEFAULT 0,
    host_id TEXT,
    spotlight_peer_id TEXT,
    emitter_peer_id TEXT,
    broadcast_json TEXT NOT NULL DEFAULT '{}',
    started_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    blocked_client_ids TEXT NOT NULL DEFAULT '[]',
    admitted_client_ids TEXT NOT NULL DEFAULT '[]',
    interactive_json TEXT NOT NULL DEFAULT '{}',
    ended INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS room_participants (
    room_code TEXT NOT NULL,
    peer_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    name TEXT NOT NULL,
    initial TEXT NOT NULL,
    role TEXT NOT NULL,
    status TEXT NOT NULL,
    mic_on INTEGER NOT NULL DEFAULT 0,
    cam_on INTEGER NOT NULL DEFAULT 1,
    is_emitter INTEGER NOT NULL DEFAULT 0,
    hand_raised INTEGER NOT NULL DEFAULT 0,
    screen_sharing INTEGER NOT NULL DEFAULT 0,
    speaking INTEGER NOT NULL DEFAULT 0,
    calls_session_id TEXT,
    cam_track_name TEXT,
    joined_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    PRIMARY KEY (room_code, peer_id)
  )`,
  `CREATE TABLE IF NOT EXISTS room_messages (
    id TEXT PRIMARY KEY,
    room_code TEXT NOT NULL,
    from_peer_id TEXT NOT NULL,
    from_name TEXT NOT NULL,
    to_peer_id TEXT,
    text TEXT NOT NULL,
    timestamp INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS room_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_code TEXT NOT NULL,
    target_peer_id TEXT,
    from_peer_id TEXT,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    actor TEXT NOT NULL,
    detail TEXT NOT NULL,
    timestamp INTEGER NOT NULL
  )`,
];

const SCHEMA_MIGRATIONS: Record<string, Array<[string, string]>> = {
  users: [
    ['name', "TEXT NOT NULL DEFAULT 'Usuario'"],
    ['email', "TEXT NOT NULL DEFAULT ''"],
    ['password_hash', "TEXT NOT NULL DEFAULT ''"],
    ['password_salt', "TEXT NOT NULL DEFAULT ''"],
    ['role', "TEXT NOT NULL DEFAULT 'user'"],
    ['verified', 'INTEGER NOT NULL DEFAULT 0'],
    ['verification_code', 'TEXT'],
    ['verification_expires_at', 'INTEGER NOT NULL DEFAULT 0'],
    ['last_code_sent_at', 'INTEGER NOT NULL DEFAULT 0'],
    ['suite_code', "TEXT NOT NULL DEFAULT ''"],
    ['suite_pass', "TEXT NOT NULL DEFAULT ''"],
    ['plan', "TEXT NOT NULL DEFAULT 'Prueba gratis'"],
    ['created_at', 'INTEGER NOT NULL DEFAULT 0'],
    ['last_login_at', 'INTEGER NOT NULL DEFAULT 0'],
  ],
  rooms: [
    ['pass', 'TEXT'],
    ['locked', 'INTEGER NOT NULL DEFAULT 0'],
    ['waiting_room', 'INTEGER NOT NULL DEFAULT 0'],
    ['host_id', 'TEXT'],
    ['spotlight_peer_id', 'TEXT'],
    ['emitter_peer_id', 'TEXT'],
    ['broadcast_json', "TEXT NOT NULL DEFAULT '{}'"],
    ['started_at', 'INTEGER NOT NULL DEFAULT 0'],
    ['updated_at', 'INTEGER NOT NULL DEFAULT 0'],
    ['blocked_client_ids', "TEXT NOT NULL DEFAULT '[]'"],
    ['admitted_client_ids', "TEXT NOT NULL DEFAULT '[]'"],
    ['interactive_json', "TEXT NOT NULL DEFAULT '{}'"],
    ['ended', 'INTEGER NOT NULL DEFAULT 0'],
  ],
  room_participants: [
    ['client_id', "TEXT NOT NULL DEFAULT ''"],
    ['name', "TEXT NOT NULL DEFAULT 'Invitado'"],
    ['initial', "TEXT NOT NULL DEFAULT 'I'"],
    ['role', "TEXT NOT NULL DEFAULT 'guest'"],
    ['status', "TEXT NOT NULL DEFAULT 'active'"],
    ['mic_on', 'INTEGER NOT NULL DEFAULT 0'],
    ['cam_on', 'INTEGER NOT NULL DEFAULT 1'],
    ['is_emitter', 'INTEGER NOT NULL DEFAULT 0'],
    ['hand_raised', 'INTEGER NOT NULL DEFAULT 0'],
    ['screen_sharing', 'INTEGER NOT NULL DEFAULT 0'],
    ['speaking', 'INTEGER NOT NULL DEFAULT 0'],
    ['calls_session_id', 'TEXT'],
    ['cam_track_name', 'TEXT'],
    ['joined_at', 'INTEGER NOT NULL DEFAULT 0'],
    ['last_seen_at', 'INTEGER NOT NULL DEFAULT 0'],
  ],
  room_messages: [
    ['to_peer_id', 'TEXT'],
    ['timestamp', 'INTEGER NOT NULL DEFAULT 0'],
  ],
  room_events: [
    ['target_peer_id', 'TEXT'],
    ['from_peer_id', 'TEXT'],
    ['payload', "TEXT NOT NULL DEFAULT '{}'"],
    ['created_at', 'INTEGER NOT NULL DEFAULT 0'],
  ],
  audit_events: [
    ['type', "TEXT NOT NULL DEFAULT 'auth'"],
    ['actor', "TEXT NOT NULL DEFAULT ''"],
    ['detail', "TEXT NOT NULL DEFAULT ''"],
    ['timestamp', 'INTEGER NOT NULL DEFAULT 0'],
  ],
};

const globalAny = globalThis as unknown as {
  __SPACESUITE_MEM_STORE__?: MemStore;
  __SPACESUITE_D1_READY__?: WeakSet<object>;
};

function getMem(): MemStore {
  if (!globalAny.__SPACESUITE_MEM_STORE__) {
    globalAny.__SPACESUITE_MEM_STORE__ = {
      secret: randomHex(32),
      startedAt: Date.now(),
      totalMessages: 0,
      nextEventId: 1,
      users: [],
      audit: [],
      rooms: new Map(),
      events: [],
    };
  }
  return globalAny.__SPACESUITE_MEM_STORE__;
}

async function migrateMissingColumns(db: D1Database): Promise<void> {
  for (const [table, expectedColumns] of Object.entries(SCHEMA_MIGRATIONS)) {
    try {
      const info = await db.prepare(`PRAGMA table_info(${table})`).all<Record<string, unknown>>();
      const existingNames = new Set(info.results.map((r) => String(r.name || '').toLowerCase()));
      for (const [col, def] of expectedColumns) {
        if (!existingNames.has(col.toLowerCase())) {
          await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`).run();
        }
      }
    } catch {
      // ignore per-table migration error if table doesn't allow pragma alteration
    }
  }
  try {
    await db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)').run();
  } catch {
    // ignore if duplicate legacy emails prevent unique index
  }
}

async function getReadyDb(env: PagesEnv): Promise<D1Database | null> {
  const db = env.DB;
  if (!db) return null;
  if (!globalAny.__SPACESUITE_D1_READY__) {
    globalAny.__SPACESUITE_D1_READY__ = new WeakSet();
  }
  if (!globalAny.__SPACESUITE_D1_READY__.has(db as unknown as object)) {
    try {
      await db.batch(DDL_STATEMENTS.map((sql) => db.prepare(sql)));
      await migrateMissingColumns(db);
      globalAny.__SPACESUITE_D1_READY__.add(db as unknown as object);
    } catch {
      return null;
    }
  }
  return db;
}

function parseJsonStringArray(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function parseInteractiveState(raw: unknown): RoomInteractiveState {
  if (typeof raw !== 'string' || !raw) return {};
  try {
    const parsed = JSON.parse(raw) as RoomInteractiveState;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function rowToStoredUser(row: Record<string, unknown>): StoredUser {
  const role: StoredUserRole = row.role === 'admin' ? 'admin' : 'user';
  const rawCode = row.suite_code ? String(row.suite_code).trim() : '';
  const rawPass = row.suite_pass ? String(row.suite_pass).trim() : '';
  return {
    id: String(row.id || crypto.randomUUID()),
    name: String(row.name || 'Usuario'),
    email: String(row.email || '').trim().toLowerCase(),
    passwordHash: String(row.password_hash || ''),
    passwordSalt: String(row.password_salt || ''),
    role,
    verified: Number(row.verified) === 1 || row.verified === true,
    verificationCode: row.verification_code ? String(row.verification_code) : null,
    verificationExpiresAt: Number(row.verification_expires_at || 0),
    lastCodeSentAt: Number(row.last_code_sent_at || 0),
    suiteCode: rawCode || generateServerSuiteCode(),
    suitePass: rawPass || generateServerSuitePass(),
    plan: String(row.plan || (role === 'admin' ? 'Admin Pro · acceso total' : 'Prueba gratis')),
    createdAt: Number(row.created_at || 0),
    lastLoginAt: Number(row.last_login_at || 0),
  };
}

function defaultBroadcastState() {
  return {
    emitterPeerId: null,
    emitterName: null,
    status: 'idle' as const,
    sourceType: 'none' as const,
    mediaTitle: null,
    callsSessionId: null,
    videoTrackName: null,
    audioTrackName: null,
    updatedAt: Date.now(),
  };
}

function parseBroadcastState(raw: unknown) {
  const base = defaultBroadcastState();
  if (typeof raw !== 'string' || !raw) return base;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return base;
    return {
      ...base,
      emitterPeerId: parsed.emitterPeerId ? String(parsed.emitterPeerId) : null,
      emitterName: parsed.emitterName ? String(parsed.emitterName) : null,
      status:
        parsed.status === 'preparing' || parsed.status === 'live' ? parsed.status : ('idle' as const),
      sourceType:
        parsed.sourceType === 'screen' || parsed.sourceType === 'media'
          ? parsed.sourceType
          : ('none' as const),
      mediaTitle: parsed.mediaTitle ? String(parsed.mediaTitle) : null,
      callsSessionId: parsed.callsSessionId ? String(parsed.callsSessionId) : null,
      videoTrackName: parsed.videoTrackName ? String(parsed.videoTrackName) : null,
      audioTrackName: parsed.audioTrackName ? String(parsed.audioTrackName) : null,
      updatedAt: Number(parsed.updatedAt || Date.now()),
    };
  } catch {
    return base;
  }
}

function rowToPeerInfo(row: Record<string, unknown>): PeerInfo {
  return {
    peerId: String(row.peer_id),
    clientId: String(row.client_id),
    name: String(row.name),
    initial: String(row.initial),
    role: row.role === 'host' ? 'host' : 'guest',
    micOn: false,
    micLocked: true,
    camOn: Number(row.cam_on) === 1,
    isEmitter: Number(row.is_emitter) === 1,
    handRaised: Number(row.hand_raised) === 1,
    screenSharing: Number(row.screen_sharing) === 1,
    speaking: false,
    callsSessionId: row.calls_session_id ? String(row.calls_session_id) : null,
    camTrackName: row.cam_track_name ? String(row.cam_track_name) : null,
    joinedAt: Number(row.joined_at || 0),
  };
}

function rowToRoomMeta(row: Record<string, unknown>): RoomMeta {
  const broadcast = parseBroadcastState(row.broadcast_json);
  const interactive = parseInteractiveState(row.interactive_json);
  const mode = (interactive as { mode?: 'normal' | 'broadcast' }).mode === 'normal' ? 'normal' : 'broadcast';
  return {
    code: String(row.code),
    pass: row.pass ? String(row.pass) : undefined,
    locked: Number(row.locked) === 1,
    waitingRoom: Number(row.waiting_room) === 1,
    hostId: row.host_id ? String(row.host_id) : null,
    startedAt: Number(row.started_at || Date.now()),
    spotlightPeerId: row.spotlight_peer_id ? String(row.spotlight_peer_id) : null,
    emitterPeerId: row.emitter_peer_id ? String(row.emitter_peer_id) : broadcast.emitterPeerId,
    broadcast,
    interactive,
    mode,
  };
}

async function getKvValue(env: PagesEnv, db: D1Database | null, key: string): Promise<string | null> {
  if (!db) return null;
  const row = await db.prepare('SELECT v FROM app_kv WHERE k = ?').bind(key).first<{ v: string }>();
  return row ? String(row.v) : null;
}

async function setKvValue(db: D1Database | null, key: string, value: string): Promise<void> {
  if (!db) return;
  await db
    .prepare('INSERT INTO app_kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v')
    .bind(key, value)
    .run();
}

export async function getAuthSecret(env: PagesEnv): Promise<string> {
  const fromEnv = typeof env.AUTH_SECRET === 'string' ? env.AUTH_SECRET.trim() : '';
  if (fromEnv) return fromEnv;

  const db = await getReadyDb(env);
  if (db) {
    const existing = await getKvValue(env, db, 'auth_secret');
    if (existing) return existing;
    const generated = randomHex(32);
    await setKvValue(db, 'auth_secret', generated);
    return generated;
  }

  return getMem().secret;
}

export async function getServerStartedAt(env: PagesEnv): Promise<number> {
  const db = await getReadyDb(env);
  if (db) {
    const existing = await getKvValue(env, db, 'started_at');
    if (existing) return Number(existing) || Date.now();
    const now = Date.now();
    await setKvValue(db, 'started_at', String(now));
    return now;
  }
  return getMem().startedAt;
}

export async function createAuthToken(env: PagesEnv, user: StoredUser): Promise<string> {
  const secret = await getAuthSecret(env);
  return signTokenPayload(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      exp: Date.now() + 1000 * 60 * 60 * 24 * 14,
    },
    secret,
  );
}

export async function verifyAuthToken(env: PagesEnv, token: string): Promise<StoredUser | null> {
  if (!token) return null;
  const secret = await getAuthSecret(env);
  const payload = await verifyTokenPayload<{ sub?: string; exp?: number }>(token, secret);
  if (!payload?.sub || !payload.exp || payload.exp < Date.now()) return null;

  const db = await getReadyDb(env);
  if (db) {
    const row = await db
      .prepare('SELECT * FROM users WHERE id = ?')
      .bind(payload.sub)
      .first<Record<string, unknown>>();
    return row ? rowToStoredUser(row) : null;
  }

  return getMem().users.find((u) => u.id === payload.sub) || null;
}

export function sanitizePublicUser(user: StoredUser, token?: string) {
  return {
    name: user.name,
    email: user.email,
    suiteCode: user.suiteCode,
    suitePass: user.suitePass,
    plan: user.plan,
    role: user.role,
    verified: user.verified,
    ...(token ? { token } : {}),
  };
}

export async function findUserByEmail(env: PagesEnv, email: string): Promise<StoredUser | null> {
  const clean = email.trim().toLowerCase();
  if (!clean) return null;
  const db = await getReadyDb(env);
  if (db) {
    const row = await db
      .prepare('SELECT * FROM users WHERE LOWER(email) = ?')
      .bind(clean)
      .first<Record<string, unknown>>();
    if (!row) return null;
    const mapped = rowToStoredUser(row);
    // Persist migrated suite_code/suite_pass if legacy row lacked them
    if (!row.suite_code || !row.suite_pass) {
      await db
        .prepare('UPDATE users SET suite_code = ?, suite_pass = ? WHERE id = ?')
        .bind(mapped.suiteCode, mapped.suitePass, mapped.id)
        .run()
        .catch(() => {});
    }
    return mapped;
  }
  return getMem().users.find((u) => u.email === clean) || null;
}

export async function hasVerifiedAdmin(env: PagesEnv): Promise<boolean> {
  const db = await getReadyDb(env);
  if (db) {
    const row = await db
      .prepare("SELECT COUNT(*) as cnt FROM users WHERE role = 'admin' AND verified = 1")
      .first<{ cnt: number }>();
    return Number(row?.cnt || 0) > 0;
  }
  return getMem().users.some((u) => u.role === 'admin' && u.verified);
}

export async function ensureBootstrapAdmin(env: PagesEnv): Promise<void> {
  const rawEmail = typeof env.ADMIN_EMAIL === 'string' ? env.ADMIN_EMAIL.trim().toLowerCase() : '';
  const rawPassword = typeof env.ADMIN_PASSWORD === 'string' ? env.ADMIN_PASSWORD : '';
  if (!rawEmail || !rawPassword || rawPassword.length < 4) return;

  const cleanName =
    (typeof env.ADMIN_NAME === 'string' && env.ADMIN_NAME.trim()) || 'Administrador';
  const existing = await findUserByEmail(env, rawEmail);

  if (existing) {
    const passMatches =
      existing.passwordHash &&
      (await verifyPassword(rawPassword, existing.passwordSalt, existing.passwordHash));
    if (existing.role !== 'admin' || !existing.verified || !passMatches) {
      const { hash, salt } = await hashPassword(rawPassword);
      existing.role = 'admin';
      existing.verified = true;
      existing.verificationCode = null;
      existing.verificationExpiresAt = 0;
      existing.plan = 'Admin Pro · acceso total';
      existing.passwordHash = hash;
      existing.passwordSalt = salt;
      await updateUser(env, existing);
    }
    return;
  }

  await createVerifiedUserDirect(env, {
    name: cleanName,
    email: rawEmail,
    password: rawPassword,
    role: 'admin',
  });
}

export async function createVerifiedUserDirect(
  env: PagesEnv,
  params: { name: string; email: string; password: string; role: StoredUserRole },
): Promise<StoredUser> {
  const cleanEmail = params.email.trim().toLowerCase();
  const cleanName = params.name.trim().slice(0, 24) || 'Usuario';
  const { hash, salt } = await hashPassword(params.password);
  const now = Date.now();
  const created: StoredUser = {
    id: crypto.randomUUID(),
    name: cleanName,
    email: cleanEmail,
    passwordHash: hash,
    passwordSalt: salt,
    role: params.role,
    verified: true,
    verificationCode: null,
    verificationExpiresAt: 0,
    lastCodeSentAt: now,
    suiteCode: generateServerSuiteCode(),
    suitePass: generateServerSuitePass(),
    plan: params.role === 'admin' ? 'Admin Pro · acceso total' : 'Prueba gratis',
    createdAt: now,
    lastLoginAt: now,
  };

  const db = await getReadyDb(env);
  if (db) {
    await db
      .prepare(
        `INSERT INTO users (
          id, name, email, password_hash, password_salt, role, verified,
          verification_code, verification_expires_at, last_code_sent_at,
          suite_code, suite_pass, plan, created_at, last_login_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        created.id,
        created.name,
        created.email,
        created.passwordHash,
        created.passwordSalt,
        created.role,
        1,
        null,
        0,
        created.lastCodeSentAt,
        created.suiteCode,
        created.suitePass,
        created.plan,
        created.createdAt,
        created.lastLoginAt,
      )
      .run();
    return created;
  }

  getMem().users.push(created);
  return created;
}

export async function createOrUpdatePendingUser(
  env: PagesEnv,
  params: {
    name: string;
    email: string;
    password: string;
    wantAdmin?: boolean;
    adminKey?: string;
  },
): Promise<
  | { ok: true; user: StoredUser; code: string }
  | { ok: false; status: number; error: string }
> {
  const cleanEmail = params.email.trim().toLowerCase();
  const cleanName = params.name.trim().slice(0, 24);
  const code = generateOtpCode();
  const { hash, salt } = await hashPassword(params.password);
  const now = Date.now();
  const db = await getReadyDb(env);

  await ensureBootstrapAdmin(env);
  const adminExists = await hasVerifiedAdmin(env);
  const configuredKey = typeof env.ADMIN_SETUP_KEY === 'string' ? env.ADMIN_SETUP_KEY.trim() : '';
  const providedKey = typeof params.adminKey === 'string' ? params.adminKey.trim() : '';
  const keyMatches = Boolean(configuredKey && providedKey && providedKey === configuredKey);

  let assignedRole: StoredUserRole = 'user';
  if (!adminExists && params.wantAdmin !== false) {
    assignedRole = 'admin';
  } else if (params.wantAdmin) {
    if (keyMatches) {
      assignedRole = 'admin';
    } else if (adminExists) {
      return {
        ok: false,
        status: 403,
        error: configuredKey
          ? 'Clave de administrador incorrecta.'
          : 'Ya existe un administrador. Crea el nuevo admin desde Panel Admin Pro.',
      };
    }
  } else if (keyMatches) {
    assignedRole = 'admin';
  }

  const assignedPlan = assignedRole === 'admin' ? 'Admin Pro · acceso total' : 'Prueba gratis';

  if (db) {
    const existingRow = await db
      .prepare('SELECT * FROM users WHERE LOWER(email) = ?')
      .bind(cleanEmail)
      .first<Record<string, unknown>>();

    if (existingRow && Number(existingRow.verified) === 0) {
      await db
        .prepare(
          `UPDATE users
           SET name = ?, password_hash = ?, password_salt = ?, role = ?, plan = ?,
               verification_code = ?, verification_expires_at = ?, last_code_sent_at = ?,
               suite_code = COALESCE(NULLIF(suite_code, ''), ?),
               suite_pass = COALESCE(NULLIF(suite_pass, ''), ?)
           WHERE LOWER(email) = ?`,
        )
        .bind(
          cleanName,
          hash,
          salt,
          assignedRole,
          assignedPlan,
          code,
          now + 10 * 60 * 1000,
          now,
          generateServerSuiteCode(),
          generateServerSuitePass(),
          cleanEmail,
        )
        .run();
      const updated = await findUserByEmail(env, cleanEmail);
      if (updated) return { ok: true, user: updated, code };
    }

    const created: StoredUser = {
      id: crypto.randomUUID(),
      name: cleanName,
      email: cleanEmail,
      passwordHash: hash,
      passwordSalt: salt,
      role: assignedRole,
      verified: false,
      verificationCode: code,
      verificationExpiresAt: now + 10 * 60 * 1000,
      lastCodeSentAt: now,
      suiteCode: generateServerSuiteCode(),
      suitePass: generateServerSuitePass(),
      plan: assignedPlan,
      createdAt: now,
      lastLoginAt: now,
    };

    await db
      .prepare(
        `INSERT INTO users (
          id, name, email, password_hash, password_salt, role, verified,
          verification_code, verification_expires_at, last_code_sent_at,
          suite_code, suite_pass, plan, created_at, last_login_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        created.id,
        created.name,
        created.email,
        created.passwordHash,
        created.passwordSalt,
        created.role,
        0,
        created.verificationCode,
        created.verificationExpiresAt,
        created.lastCodeSentAt,
        created.suiteCode,
        created.suitePass,
        created.plan,
        created.createdAt,
        created.lastLoginAt,
      )
      .run();

    return { ok: true, user: created, code };
  }

  const mem = getMem();
  const existing = mem.users.find((u) => u.email === cleanEmail);
  if (existing && !existing.verified) {
    existing.name = cleanName;
    existing.passwordHash = hash;
    existing.passwordSalt = salt;
    existing.role = assignedRole;
    existing.plan = assignedPlan;
    existing.verificationCode = code;
    existing.verificationExpiresAt = now + 10 * 60 * 1000;
    existing.lastCodeSentAt = now;
    return { ok: true, user: existing, code };
  }

  const created: StoredUser = {
    id: crypto.randomUUID(),
    name: cleanName,
    email: cleanEmail,
    passwordHash: hash,
    passwordSalt: salt,
    role: assignedRole,
    verified: false,
    verificationCode: code,
    verificationExpiresAt: now + 10 * 60 * 1000,
    lastCodeSentAt: now,
    suiteCode: generateServerSuiteCode(),
    suitePass: generateServerSuitePass(),
    plan: assignedPlan,
    createdAt: now,
    lastLoginAt: now,
  };
  mem.users.push(created);
  return { ok: true, user: created, code };
}

export async function updateUser(env: PagesEnv, user: StoredUser): Promise<void> {
  const db = await getReadyDb(env);
  if (db) {
    await db
      .prepare(
        `UPDATE users
         SET name = ?, password_hash = ?, password_salt = ?, role = ?, verified = ?,
             verification_code = ?, verification_expires_at = ?, last_code_sent_at = ?,
             suite_code = ?, suite_pass = ?, plan = ?, last_login_at = ?
         WHERE id = ?`,
      )
      .bind(
        user.name,
        user.passwordHash,
        user.passwordSalt,
        user.role,
        user.verified ? 1 : 0,
        user.verificationCode ?? null,
        user.verificationExpiresAt,
        user.lastCodeSentAt,
        user.suiteCode,
        user.suitePass,
        user.plan,
        user.lastLoginAt,
        user.id,
      )
      .run();
    return;
  }

  const mem = getMem();
  const idx = mem.users.findIndex((u) => u.id === user.id);
  if (idx >= 0) {
    mem.users[idx] = user;
  }
}

export async function addAuditEvent(
  env: PagesEnv,
  type: AuditEvent['type'],
  actor: string,
  detail: string,
): Promise<void> {
  const ev: AuditEvent = {
    id: crypto.randomUUID(),
    type,
    actor: actor.slice(0, 48),
    detail: detail.slice(0, 160),
    timestamp: Date.now(),
  };

  const db = await getReadyDb(env);
  if (db) {
    await db
      .prepare('INSERT INTO audit_events (id, type, actor, detail, timestamp) VALUES (?, ?, ?, ?, ?)')
      .bind(ev.id, ev.type, ev.actor, ev.detail, ev.timestamp)
      .run();
    return;
  }

  const mem = getMem();
  mem.audit.unshift(ev);
  if (mem.audit.length > 80) {
    mem.audit.length = 80;
  }
}

export async function incrementTotalMessages(env: PagesEnv): Promise<void> {
  const db = await getReadyDb(env);
  if (db) {
    const cur = Number((await getKvValue(env, db, 'total_messages')) || '0');
    await setKvValue(db, 'total_messages', String(cur + 1));
    return;
  }
  getMem().totalMessages += 1;
}

// =======================
// ROOMS & SIGNALING STORE
// =======================

export async function cleanupStaleParticipants(env: PagesEnv, roomCode?: string): Promise<void> {
  const cutoff = Date.now() - STALE_PEER_MS;
  const eventCutoff = Date.now() - EVENT_TTL_MS;
  const db = await getReadyDb(env);

  if (db) {
    if (roomCode) {
      await db
        .prepare('DELETE FROM room_participants WHERE room_code = ? AND last_seen_at < ?')
        .bind(roomCode, cutoff)
        .run();
      await db
        .prepare('DELETE FROM room_events WHERE room_code = ? AND created_at < ?')
        .bind(roomCode, eventCutoff)
        .run();

      const roomRow = await db
        .prepare('SELECT host_id, spotlight_peer_id, emitter_peer_id FROM rooms WHERE code = ? AND ended = 0')
        .bind(roomCode)
        .first<Record<string, unknown>>();
      if (roomRow) {
        const activeRows = await db
          .prepare(
            "SELECT * FROM room_participants WHERE room_code = ? AND status = 'active' ORDER BY joined_at ASC",
          )
          .bind(roomCode)
          .all<Record<string, unknown>>();
        const active = activeRows.results;
        const hostId = roomRow.host_id ? String(roomRow.host_id) : null;
        const spotlight = roomRow.spotlight_peer_id ? String(roomRow.spotlight_peer_id) : null;
        const emitter = roomRow.emitter_peer_id ? String(roomRow.emitter_peer_id) : null;

        if (spotlight && !active.some((p) => String(p.peer_id) === spotlight)) {
          await db
            .prepare('UPDATE rooms SET spotlight_peer_id = NULL WHERE code = ?')
            .bind(roomCode)
            .run();
        }
        if (emitter && !active.some((p) => String(p.peer_id) === emitter)) {
          await db
            .prepare('UPDATE rooms SET emitter_peer_id = NULL, broadcast_json = ? WHERE code = ?')
            .bind(JSON.stringify(defaultBroadcastState()), roomCode)
            .run();
        }
        if (hostId && !active.some((p) => String(p.peer_id) === hostId)) {
          const next = active[0];
          if (next) {
            const nextId = String(next.peer_id);
            await db
              .prepare("UPDATE room_participants SET role = 'host' WHERE room_code = ? AND peer_id = ?")
              .bind(roomCode, nextId)
              .run();
            await db
              .prepare('UPDATE rooms SET host_id = ?, updated_at = ? WHERE code = ?')
              .bind(nextId, Date.now(), roomCode)
              .run();
          } else {
            await db
              .prepare('UPDATE rooms SET host_id = NULL, updated_at = ? WHERE code = ?')
              .bind(Date.now(), roomCode)
              .run();
          }
        }
      }
    } else {
      await db.prepare('DELETE FROM room_participants WHERE last_seen_at < ?').bind(cutoff).run();
      await db.prepare('DELETE FROM room_events WHERE created_at < ?').bind(eventCutoff).run();
    }
    return;
  }

  const mem = getMem();
  mem.events = mem.events.filter((e) => e.createdAt >= eventCutoff);
  for (const [code, room] of mem.rooms.entries()) {
    if (roomCode && code !== roomCode) continue;
    for (const [pid, entry] of room.participants.entries()) {
      if (entry.lastSeenAt < cutoff) {
        room.participants.delete(pid);
      }
    }
    const active = Array.from(room.participants.values())
      .filter((p) => p.status === 'active')
      .sort((a, b) => a.info.joinedAt - b.info.joinedAt);

    if (room.meta.spotlightPeerId && !active.some((p) => p.info.peerId === room.meta.spotlightPeerId)) {
      room.meta.spotlightPeerId = null;
    }
    if (room.meta.emitterPeerId && !active.some((p) => p.info.peerId === room.meta.emitterPeerId)) {
      room.meta.emitterPeerId = null;
      room.meta.broadcast = defaultBroadcastState();
    }
    if (room.meta.hostId && !active.some((p) => p.info.peerId === room.meta.hostId)) {
      if (active[0]) {
        active[0].info.role = 'host';
        room.meta.hostId = active[0].info.peerId;
      } else {
        room.meta.hostId = null;
      }
    }
    if (room.participants.size === 0 && Date.now() - room.updatedAt > 600_000) {
      mem.rooms.delete(code);
    }
  }
}

export async function getRoomSummary(env: PagesEnv, rawCode: string) {
  const code = normalizeRoomCode(rawCode);
  await cleanupStaleParticipants(env, code);
  const db = await getReadyDb(env);

  if (db) {
    const roomRow = await db
      .prepare('SELECT * FROM rooms WHERE code = ? AND ended = 0')
      .bind(code)
      .first<Record<string, unknown>>();
    if (!roomRow) {
      return {
        code,
        exists: false,
        participants: 0,
        maxParticipants: MAX_ROOM_PARTICIPANTS,
        locked: false,
        waitingRoom: false,
        hasPass: false,
      };
    }
    const cntRow = await db
      .prepare("SELECT COUNT(*) as cnt FROM room_participants WHERE room_code = ? AND status = 'active'")
      .bind(code)
      .first<{ cnt: number }>();
    return {
      code,
      exists: true,
      participants: Number(cntRow?.cnt || 0),
      maxParticipants: MAX_ROOM_PARTICIPANTS,
      locked: Number(roomRow.locked) === 1,
      waitingRoom: Number(roomRow.waiting_room) === 1,
      hasPass: Boolean(roomRow.pass),
    };
  }

  const room = getMem().rooms.get(code);
  if (!room || room.ended) {
    return {
      code,
      exists: false,
      participants: 0,
      maxParticipants: MAX_ROOM_PARTICIPANTS,
      locked: false,
      waitingRoom: false,
      hasPass: false,
    };
  }
  const activeCount = Array.from(room.participants.values()).filter((p) => p.status === 'active').length;
  return {
    code,
    exists: true,
    participants: activeCount,
    maxParticipants: MAX_ROOM_PARTICIPANTS,
    locked: room.meta.locked,
    waitingRoom: room.meta.waitingRoom,
    hasPass: Boolean(room.meta.pass),
  };
}

export async function getActiveRoomsCount(env: PagesEnv): Promise<number> {
  await cleanupStaleParticipants(env);
  const db = await getReadyDb(env);
  if (db) {
    const row = await db
      .prepare(
        "SELECT COUNT(DISTINCT room_code) as cnt FROM room_participants WHERE status = 'active'",
      )
      .first<{ cnt: number }>();
    return Number(row?.cnt || 0);
  }
  let count = 0;
  for (const room of getMem().rooms.values()) {
    if (!room.ended && Array.from(room.participants.values()).some((p) => p.status === 'active')) {
      count += 1;
    }
  }
  return count;
}

export async function pushRoomEvent(
  env: PagesEnv,
  roomCode: string,
  eventType: string,
  payload: Record<string, unknown>,
  targetPeerId: string | null = null,
  fromPeerId: string | null = null,
): Promise<number> {
  const now = Date.now();
  const db = await getReadyDb(env);
  if (db) {
    const res = await db
      .prepare(
        `INSERT INTO room_events (room_code, target_peer_id, from_peer_id, event_type, payload, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(roomCode, targetPeerId ?? null, fromPeerId ?? null, eventType, JSON.stringify(payload), now)
      .run();
    const lastId = Number((res.meta as { last_row_id?: number } | undefined)?.last_row_id || 0);
    return lastId;
  }

  const mem = getMem();
  const id = mem.nextEventId++;
  mem.events.push({
    id,
    roomCode,
    targetPeerId,
    fromPeerId,
    eventType,
    payload,
    createdAt: now,
  });
  if (mem.events.length > 2000) {
    mem.events.splice(0, mem.events.length - 2000);
  }
  return id;
}

export async function getOrCreateRoomState(
  env: PagesEnv,
  rawCode: string,
  pass?: string,
  resetIfEnded = false,
): Promise<{
  meta: RoomMeta;
  blockedClientIds: string[];
  admittedClientIds: string[];
  ended: boolean;
}> {
  const code = normalizeRoomCode(rawCode);
  const cleanPass = pass ? pass.trim().toUpperCase().slice(0, 8) : null;
  const now = Date.now();
  const db = await getReadyDb(env);

  if (db) {
    const existing = await db
      .prepare('SELECT * FROM rooms WHERE code = ?')
      .bind(code)
      .first<Record<string, unknown>>();

    if (!existing || (resetIfEnded && Number(existing.ended) === 1)) {
      const freshBroadcast = defaultBroadcastState();
      await db
        .prepare(
          `INSERT INTO rooms (code, pass, locked, waiting_room, host_id, spotlight_peer_id, emitter_peer_id, broadcast_json, started_at, updated_at, blocked_client_ids, admitted_client_ids, interactive_json, ended)
           VALUES (?, ?, 0, 0, NULL, NULL, NULL, ?, ?, ?, '[]', '[]', '{}', 0)
           ON CONFLICT(code) DO UPDATE SET
             pass = COALESCE(excluded.pass, rooms.pass),
             locked = 0,
             waiting_room = 0,
             host_id = NULL,
             spotlight_peer_id = NULL,
             emitter_peer_id = NULL,
             broadcast_json = excluded.broadcast_json,
             started_at = excluded.started_at,
             updated_at = excluded.updated_at,
             blocked_client_ids = '[]',
             admitted_client_ids = '[]',
             interactive_json = '{}',
             ended = 0`,
        )
        .bind(code, cleanPass, JSON.stringify(freshBroadcast), now, now)
        .run();

      if (resetIfEnded) {
        await db.prepare('DELETE FROM room_participants WHERE room_code = ?').bind(code).run();
        await db.prepare('DELETE FROM room_messages WHERE room_code = ?').bind(code).run();
      }

      return {
        meta: {
          code,
          pass: cleanPass || undefined,
          locked: false,
          waitingRoom: false,
          hostId: null,
          startedAt: now,
          spotlightPeerId: null,
          emitterPeerId: null,
          broadcast: freshBroadcast,
          interactive: {},
        },
        blockedClientIds: [],
        admittedClientIds: [],
        ended: false,
      };
    }

    return {
      meta: rowToRoomMeta(existing),
      blockedClientIds: parseJsonStringArray(existing.blocked_client_ids),
      admittedClientIds: parseJsonStringArray(existing.admitted_client_ids),
      ended: Number(existing.ended) === 1,
    };
  }

  const mem = getMem();
  let room = mem.rooms.get(code);
  if (!room || (resetIfEnded && room.ended)) {
    room = {
      meta: {
        code,
        pass: cleanPass || undefined,
        locked: false,
        waitingRoom: false,
        hostId: null,
        startedAt: now,
        spotlightPeerId: null,
        emitterPeerId: null,
        broadcast: defaultBroadcastState(),
        interactive: {},
      },
      updatedAt: now,
      ended: false,
      blockedClientIds: [],
      admittedClientIds: [],
      participants: new Map(),
      messages: [],
    };
    mem.rooms.set(code, room);
  }
  return {
    meta: room.meta,
    blockedClientIds: room.blockedClientIds,
    admittedClientIds: room.admittedClientIds,
    ended: room.ended,
  };
}

export async function getRoomParticipants(
  env: PagesEnv,
  roomCode: string,
): Promise<{ active: PeerInfo[]; waiting: WaitingGuest[] }> {
  const code = normalizeRoomCode(roomCode);
  const db = await getReadyDb(env);

  if (db) {
    const rows = await db
      .prepare('SELECT * FROM room_participants WHERE room_code = ? ORDER BY joined_at ASC')
      .bind(code)
      .all<Record<string, unknown>>();
    const active: PeerInfo[] = [];
    const waiting: WaitingGuest[] = [];
    for (const r of rows.results) {
      if (r.status === 'waiting') {
        waiting.push({
          peerId: String(r.peer_id),
          clientId: String(r.client_id),
          name: String(r.name),
          initial: String(r.initial),
          requestedAt: Number(r.joined_at || Date.now()),
        });
      } else {
        active.push(rowToPeerInfo(r));
      }
    }
    return { active, waiting };
  }

  const room = getMem().rooms.get(code);
  if (!room) return { active: [], waiting: [] };
  const active: PeerInfo[] = [];
  const waiting: WaitingGuest[] = [];
  for (const entry of room.participants.values()) {
    if (entry.status === 'waiting') {
      waiting.push({
        peerId: entry.info.peerId,
        clientId: entry.info.clientId,
        name: entry.info.name,
        initial: entry.info.initial,
        requestedAt: entry.info.joinedAt,
      });
    } else {
      active.push(entry.info);
    }
  }
  active.sort((a, b) => a.joinedAt - b.joinedAt);
  return { active, waiting };
}

export async function saveRoomMetaAndLists(
  env: PagesEnv,
  code: string,
  meta: RoomMeta,
  lists?: { blockedClientIds?: string[]; admittedClientIds?: string[]; ended?: boolean },
): Promise<void> {
  const now = Date.now();
  const db = await getReadyDb(env);
  if (db) {
    await db
      .prepare(
        `UPDATE rooms
         SET pass = ?, locked = ?, waiting_room = ?, host_id = ?, spotlight_peer_id = ?,
             emitter_peer_id = ?, broadcast_json = ?, interactive_json = ?, updated_at = ?
         WHERE code = ?`,
      )
      .bind(
        meta.pass ?? null,
        meta.locked ? 1 : 0,
        meta.waitingRoom ? 1 : 0,
        meta.hostId ?? null,
        meta.spotlightPeerId ?? null,
        meta.emitterPeerId ?? null,
        JSON.stringify(meta.broadcast || defaultBroadcastState()),
        JSON.stringify({ ...(meta.interactive || {}), mode: meta.mode || 'broadcast' }),
        now,
        code,
      )
      .run();

    if (lists?.blockedClientIds) {
      await db
        .prepare('UPDATE rooms SET blocked_client_ids = ? WHERE code = ?')
        .bind(JSON.stringify(lists.blockedClientIds), code)
        .run();
    }
    if (lists?.admittedClientIds) {
      await db
        .prepare('UPDATE rooms SET admitted_client_ids = ? WHERE code = ?')
        .bind(JSON.stringify(lists.admittedClientIds), code)
        .run();
    }
    if (typeof lists?.ended === 'boolean') {
      await db
        .prepare('UPDATE rooms SET ended = ? WHERE code = ?')
        .bind(lists.ended ? 1 : 0, code)
        .run();
    }
    return;
  }

  const room = getMem().rooms.get(code);
  if (room) {
    room.meta = { ...meta };
    room.updatedAt = now;
    if (lists?.blockedClientIds) room.blockedClientIds = lists.blockedClientIds;
    if (lists?.admittedClientIds) room.admittedClientIds = lists.admittedClientIds;
    if (typeof lists?.ended === 'boolean') room.ended = lists.ended;
  }
}

export async function upsertRoomParticipant(
  env: PagesEnv,
  roomCode: string,
  info: PeerInfo,
  status: 'active' | 'waiting',
): Promise<void> {
  const now = Date.now();
  const db = await getReadyDb(env);
  if (db) {
    await db
      .prepare(
        `INSERT INTO room_participants (
          room_code, peer_id, client_id, name, initial, role, status,
          mic_on, cam_on, is_emitter, hand_raised, screen_sharing, speaking,
          calls_session_id, cam_track_name, joined_at, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(room_code, peer_id) DO UPDATE SET
          client_id = excluded.client_id,
          name = excluded.name,
          initial = excluded.initial,
          role = excluded.role,
          status = excluded.status,
          mic_on = 0,
          cam_on = excluded.cam_on,
          is_emitter = excluded.is_emitter,
          hand_raised = excluded.hand_raised,
          screen_sharing = excluded.screen_sharing,
          speaking = 0,
          calls_session_id = excluded.calls_session_id,
          cam_track_name = excluded.cam_track_name,
          last_seen_at = excluded.last_seen_at`,
      )
      .bind(
        roomCode,
        info.peerId,
        info.clientId,
        info.name,
        info.initial,
        info.role,
        status,
        0,
        info.camOn ? 1 : 0,
        info.isEmitter ? 1 : 0,
        info.handRaised ? 1 : 0,
        info.screenSharing ? 1 : 0,
        0,
        info.callsSessionId ?? null,
        info.camTrackName ?? null,
        info.joinedAt,
        now,
      )
      .run();
    return;
  }

  const room = getMem().rooms.get(roomCode);
  if (room) {
    room.participants.set(info.peerId, {
      info: { ...info, micOn: false, micLocked: true, speaking: false },
      status,
      lastSeenAt: now,
    });
    room.updatedAt = now;
  }
}

export async function touchParticipant(env: PagesEnv, roomCode: string, peerId: string): Promise<void> {
  const now = Date.now();
  const db = await getReadyDb(env);
  if (db) {
    await db
      .prepare('UPDATE room_participants SET last_seen_at = ? WHERE room_code = ? AND peer_id = ?')
      .bind(now, roomCode, peerId)
      .run();
    return;
  }
  const room = getMem().rooms.get(roomCode);
  const entry = room?.participants.get(peerId);
  if (entry) entry.lastSeenAt = now;
}

export async function patchParticipantState(
  env: PagesEnv,
  roomCode: string,
  peerId: string,
  patch: Partial<PeerInfo>,
): Promise<void> {
  const now = Date.now();
  const db = await getReadyDb(env);
  if (db) {
    const row = await db
      .prepare('SELECT * FROM room_participants WHERE room_code = ? AND peer_id = ?')
      .bind(roomCode, peerId)
      .first<Record<string, unknown>>();
    if (!row) return;
    const current = rowToPeerInfo(row);
    const nextName =
      typeof patch.name === 'string' && patch.name.trim()
        ? patch.name.trim().slice(0, 32)
        : current.name;
    await db
      .prepare(
        `UPDATE room_participants
         SET name = ?, initial = ?, role = ?, mic_on = 0, cam_on = ?, is_emitter = ?, hand_raised = ?,
             screen_sharing = ?, speaking = 0, calls_session_id = ?, cam_track_name = ?, last_seen_at = ?
         WHERE room_code = ? AND peer_id = ?`,
      )
      .bind(
        nextName,
        getInitial(nextName),
        patch.role || current.role,
        (typeof patch.camOn === 'boolean' ? patch.camOn : current.camOn) ? 1 : 0,
        (typeof patch.isEmitter === 'boolean' ? patch.isEmitter : current.isEmitter) ? 1 : 0,
        (typeof patch.handRaised === 'boolean' ? patch.handRaised : current.handRaised) ? 1 : 0,
        (typeof patch.screenSharing === 'boolean' ? patch.screenSharing : current.screenSharing)
          ? 1
          : 0,
        patch.callsSessionId !== undefined ? patch.callsSessionId : (current.callsSessionId ?? null),
        patch.camTrackName !== undefined ? patch.camTrackName : (current.camTrackName ?? null),
        now,
        roomCode,
        peerId,
      )
      .run();
    return;
  }

  const room = getMem().rooms.get(roomCode);
  const entry = room?.participants.get(peerId);
  if (!entry) return;
  Object.assign(entry.info, patch, { micOn: false, micLocked: true, speaking: false });
  if (patch.name) {
    entry.info.name = patch.name.trim().slice(0, 32);
    entry.info.initial = getInitial(entry.info.name);
  }
  entry.lastSeenAt = now;
}

export async function removeParticipant(env: PagesEnv, roomCode: string, peerId: string): Promise<void> {
  const code = normalizeRoomCode(roomCode);
  const db = await getReadyDb(env);
  if (db) {
    await db
      .prepare('DELETE FROM room_participants WHERE room_code = ? AND peer_id = ?')
      .bind(code, peerId)
      .run();
    await cleanupStaleParticipants(env, code);
    return;
  }

  const room = getMem().rooms.get(code);
  if (!room) return;
  room.participants.delete(peerId);
  await cleanupStaleParticipants(env, code);
}

export async function addRoomMessage(env: PagesEnv, msg: ChatMessage): Promise<void> {
  const db = await getReadyDb(env);
  if (db) {
    await db
      .prepare(
        `INSERT INTO room_messages (id, room_code, from_peer_id, from_name, to_peer_id, text, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        msg.id,
        msg.roomCode,
        msg.fromPeerId,
        msg.fromName,
        msg.toPeerId ?? null,
        msg.text,
        msg.timestamp,
      )
      .run();
    await incrementTotalMessages(env);
    return;
  }

  const room = getMem().rooms.get(msg.roomCode);
  if (room) {
    room.messages.push(msg);
    if (room.messages.length > 100) room.messages.shift();
  }
  await incrementTotalMessages(env);
}

export async function getVisibleRoomMessages(
  env: PagesEnv,
  roomCode: string,
  peerId: string,
): Promise<ChatMessage[]> {
  const db = await getReadyDb(env);
  if (db) {
    const rows = await db
      .prepare(
        `SELECT * FROM room_messages
         WHERE room_code = ? AND (to_peer_id IS NULL OR to_peer_id = ? OR from_peer_id = ?)
         ORDER BY timestamp ASC
         LIMIT 100`,
      )
      .bind(roomCode, peerId, peerId)
      .all<Record<string, unknown>>();
    return rows.results.map((r) => ({
      id: String(r.id),
      roomCode: String(r.room_code),
      fromPeerId: String(r.from_peer_id),
      fromName: String(r.from_name),
      toPeerId: r.to_peer_id ? String(r.to_peer_id) : null,
      text: String(r.text),
      timestamp: Number(r.timestamp),
    }));
  }

  const room = getMem().rooms.get(roomCode);
  if (!room) return [];
  return room.messages.filter(
    (m) => !m.toPeerId || m.toPeerId === peerId || m.fromPeerId === peerId,
  );
}

export async function getRoomEventsAfter(
  env: PagesEnv,
  roomCode: string,
  peerId: string,
  afterEventId: number,
): Promise<{ events: RoomEventRecord[]; lastEventId: number }> {
  const db = await getReadyDb(env);
  if (db) {
    const rows = await db
      .prepare(
        `SELECT * FROM room_events
         WHERE room_code = ? AND id > ?
           AND (target_peer_id IS NULL OR target_peer_id = ?)
           AND (from_peer_id IS NULL OR from_peer_id != ?)
         ORDER BY id ASC
         LIMIT 100`,
      )
      .bind(roomCode, afterEventId, peerId, peerId)
      .all<Record<string, unknown>>();

    const events: RoomEventRecord[] = rows.results.map((r) => {
      let parsedPayload: Record<string, unknown> = {};
      try {
        parsedPayload = JSON.parse(String(r.payload || '{}')) as Record<string, unknown>;
      } catch {
        parsedPayload = {};
      }
      return {
        id: Number(r.id),
        roomCode: String(r.room_code),
        targetPeerId: r.target_peer_id ? String(r.target_peer_id) : null,
        fromPeerId: r.from_peer_id ? String(r.from_peer_id) : null,
        eventType: String(r.event_type),
        payload: parsedPayload,
        createdAt: Number(r.created_at),
      };
    });
    const hitLimit = rows.results.length >= 100 && events.length > 0;
    let lastEventId = afterEventId;
    if (hitLimit) {
      lastEventId = events[events.length - 1].id;
    } else {
      const maxRow = await db
        .prepare('SELECT COALESCE(MAX(id), 0) as max_id FROM room_events WHERE room_code = ?')
        .bind(roomCode)
        .first<{ max_id: number }>();
      lastEventId = Math.max(afterEventId, Number(maxRow?.max_id || 0));
    }
    return { events, lastEventId };
  }

  const mem = getMem();
  const matching = mem.events.filter(
    (e) =>
      e.roomCode === roomCode &&
      e.id > afterEventId &&
      (!e.targetPeerId || e.targetPeerId === peerId) &&
      e.fromPeerId !== peerId,
  );
  const events = matching.slice(0, 100);
  const hitLimit = matching.length > 100 && events.length > 0;
  const maxId = hitLimit
    ? events[events.length - 1].id
    : mem.events.reduce(
        (acc, e) => (e.roomCode === roomCode && e.id > acc ? e.id : acc),
        afterEventId,
      );
  return { events, lastEventId: maxId };
}

export async function getAdminSnapshot(env: PagesEnv) {
  await cleanupStaleParticipants(env);
  const startedAt = await getServerStartedAt(env);
  const db = await getReadyDb(env);

  if (db) {
    const [usersRes, roomsRes, partsRes, msgsRes, auditRes, totalMsgStr] = await Promise.all([
      db.prepare('SELECT * FROM users ORDER BY created_at DESC').all<Record<string, unknown>>(),
      db.prepare('SELECT * FROM rooms WHERE ended = 0').all<Record<string, unknown>>(),
      db.prepare('SELECT * FROM room_participants').all<Record<string, unknown>>(),
      db.prepare('SELECT room_code, COUNT(*) as cnt FROM room_messages GROUP BY room_code').all<{
        room_code: string;
        cnt: number;
      }>(),
      db.prepare('SELECT * FROM audit_events ORDER BY timestamp DESC LIMIT 40').all<Record<string, unknown>>(),
      getKvValue(env, db, 'total_messages'),
    ]);

    const msgCounts = new Map<string, number>();
    for (const r of msgsRes.results) {
      msgCounts.set(String(r.room_code), Number(r.cnt || 0));
    }

    const partsByRoom = new Map<string, Record<string, unknown>[]>();
    for (const p of partsRes.results) {
      const code = String(p.room_code);
      const arr = partsByRoom.get(code) || [];
      arr.push(p);
      partsByRoom.set(code, arr);
    }

    let totalParticipants = 0;
    let totalWaiting = 0;
    const liveRooms = [];

    for (const r of roomsRes.results) {
      const code = String(r.code);
      const list = partsByRoom.get(code) || [];
      const active = list.filter((p) => p.status === 'active');
      const waiting = list.filter((p) => p.status === 'waiting');
      if (active.length === 0 && waiting.length === 0) continue;

      totalParticipants += active.length;
      totalWaiting += waiting.length;
      const hostId = r.host_id ? String(r.host_id) : null;
      const host = active.find((p) => String(p.peer_id) === hostId);

      liveRooms.push({
        code,
        participants: active.length,
        waiting: waiting.length,
        locked: Number(r.locked) === 1,
        waitingRoom: Number(r.waiting_room) === 1,
        hasPass: Boolean(r.pass),
        startedAt: Number(r.started_at || Date.now()),
        messagesCount: msgCounts.get(code) || 0,
        hostName: host ? String(host.name) : 'Sin anfitrión',
      });
    }

    const users = usersRes.results.map(rowToStoredUser);
    const verifiedUsers = users.filter((u) => u.verified).length;
    const audit: AuditEvent[] = auditRes.results.map((a) => ({
      id: String(a.id),
      type: (a.type === 'auth' || a.type === 'room' || a.type === 'admin' ? a.type : 'auth') as AuditEvent['type'],
      actor: String(a.actor),
      detail: String(a.detail),
      timestamp: Number(a.timestamp),
    }));

    return {
      summary: {
        uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
        activeRooms: liveRooms.length,
        totalParticipants,
        totalWaiting,
        totalMessages: Number(totalMsgStr || '0'),
        registeredUsers: users.length,
        verifiedUsers,
        emailProvider: 'dev' as const,
      },
      rooms: liveRooms,
      users: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        verified: u.verified,
        suiteCode: u.suiteCode,
        createdAt: u.createdAt,
        lastLoginAt: u.lastLoginAt,
      })),
      audit,
    };
  }

  const mem = getMem();
  let totalParticipants = 0;
  let totalWaiting = 0;
  const liveRooms = [];

  for (const room of mem.rooms.values()) {
    if (room.ended) continue;
    const active = Array.from(room.participants.values()).filter((p) => p.status === 'active');
    const waiting = Array.from(room.participants.values()).filter((p) => p.status === 'waiting');
    if (active.length === 0 && waiting.length === 0) continue;

    totalParticipants += active.length;
    totalWaiting += waiting.length;
    const hostPeer = room.meta.hostId ? room.participants.get(room.meta.hostId)?.info : null;

    liveRooms.push({
      code: room.meta.code,
      participants: active.length,
      waiting: waiting.length,
      locked: room.meta.locked,
      waitingRoom: room.meta.waitingRoom,
      hasPass: Boolean(room.meta.pass),
      startedAt: room.meta.startedAt,
      messagesCount: room.messages.length,
      hostName: hostPeer?.name || 'Sin anfitrión',
    });
  }

  const verifiedUsers = mem.users.filter((u) => u.verified).length;
  return {
    summary: {
      uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
      activeRooms: liveRooms.length,
      totalParticipants,
      totalWaiting,
      totalMessages: mem.totalMessages,
      registeredUsers: mem.users.length,
      verifiedUsers,
      emailProvider: 'dev' as const,
    },
    rooms: liveRooms,
    users: mem.users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      verified: u.verified,
      suiteCode: u.suiteCode,
      createdAt: u.createdAt,
      lastLoginAt: u.lastLoginAt,
    })),
    audit: mem.audit.slice(0, 40),
  };
}

export async function adminMutateRoom(
  env: PagesEnv,
  rawCode: string,
  adminName: string,
  adminEmail: string,
  action: 'endRoom' | 'lock' | 'waitingRoom' | 'muteAll',
  value?: boolean,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const code = normalizeRoomCode(rawCode);
  const summary = await getRoomSummary(env, code);
  if (!summary.exists) {
    return { ok: false, status: 404, error: 'La sala ya no está activa.' };
  }

  const state = await getOrCreateRoomState(env, code);

  if (action === 'lock') {
    state.meta.locked = Boolean(value);
    await saveRoomMetaAndLists(env, code, state.meta);
    await addAuditEvent(env, 'admin', adminEmail, `${state.meta.locked ? 'Bloqueó' : 'Abrió'} sala ${code}`);
    return { ok: true };
  }

  if (action === 'waitingRoom') {
    state.meta.waitingRoom = Boolean(value);
    await saveRoomMetaAndLists(env, code, state.meta);
    await addAuditEvent(
      env,
      'admin',
      adminEmail,
      `${state.meta.waitingRoom ? 'Activó' : 'Desactivó'} sala de espera en ${code}`,
    );
    return { ok: true };
  }

  if (action === 'muteAll') {
    const { active } = await getRoomParticipants(env, code);
    for (const p of active) {
      await patchParticipantState(env, code, p.peerId, { micOn: false });
      await pushRoomEvent(
        env,
        code,
        'host:mute',
        { byName: `Admin (${adminName})` },
        p.peerId,
        null,
      );
    }
    await addAuditEvent(env, 'admin', adminEmail, `Silenció sala ${code}`);
    return { ok: true };
  }

  if (action === 'endRoom') {
    await pushRoomEvent(
      env,
      code,
      'room:rejected',
      { reason: 'ended', message: 'La sala fue cerrada por el administrador.' },
      null,
      null,
    );
    await saveRoomMetaAndLists(env, code, state.meta, { ended: true });
    const db = await getReadyDb(env);
    if (db) {
      await db.prepare('DELETE FROM room_participants WHERE room_code = ?').bind(code).run();
    } else {
      getMem().rooms.delete(code);
    }
    await addAuditEvent(env, 'admin', adminEmail, `Cerró sala ${code}`);
    return { ok: true };
  }

  return { ok: false, status: 400, error: 'Acción no válida.' };
}
