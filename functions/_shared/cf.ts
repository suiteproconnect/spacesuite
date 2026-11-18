export interface D1PreparedStatement {
  bind(...values: Array<string | number | null>): D1PreparedStatement;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta?: Record<string, unknown>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<Array<D1Result<T>>>;
  exec(query: string): Promise<unknown>;
}

export interface PagesEnv {
  DB?: D1Database;
  METERED_DOMAIN?: string;
  METERED_SECRET_KEY?: string;
  METERED_API_KEY?: string;
  AUTH_SECRET?: string;
  ADMIN_EMAIL?: string;
  ADMIN_PASSWORD?: string;
  ADMIN_NAME?: string;
  ADMIN_SETUP_KEY?: string;
  [key: string]: unknown;
}

export interface PagesContext<Params = Record<string, string>> {
  request: Request;
  env: PagesEnv;
  params: Params;
  waitUntil?: (promise: Promise<unknown>) => void;
  next: () => Promise<Response>;
}

export const MAX_ROOM_PARTICIPANTS = 20;

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...CORS_HEADERS,
    },
  });
}

export async function parseJsonBody<T extends Record<string, unknown>>(request: Request): Promise<T> {
  try {
    const text = await request.text();
    if (!text) return {} as T;
    return JSON.parse(text) as T;
  } catch {
    return {} as T;
  }
}

export function normalizeMeteredDomain(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
}

export function normalizeRoomCode(raw: string): string {
  let value = String(raw || '').trim();
  if (value.includes('room=')) {
    const m = /[?&#]room=([^&#]+)/i.exec(value);
    if (m && m[1]) {
      try {
        value = decodeURIComponent(m[1]);
      } catch {
        value = m[1];
      }
    }
  }
  const cleaned = value
    .trim()
    .toUpperCase()
    .replace(/^HTTPS?:\/\/[^/]+\/?/i, '')
    .replace(/^\/?SALA\//i, '')
    .replace(/^SS-SALA-/i, '')
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 16);
  return cleaned || 'ORBIT6';
}

export type PeerRole = 'host' | 'guest';

export interface PeerInfo {
  peerId: string;
  clientId: string;
  name: string;
  initial: string;
  role: PeerRole;
  micOn: boolean;
  camOn: boolean;
  handRaised: boolean;
  screenSharing: boolean;
  speaking: boolean;
  joinedAt: number;
}

export interface WaitingGuest {
  peerId: string;
  clientId: string;
  name: string;
  initial: string;
  micOn?: boolean;
  camOn?: boolean;
  requestedAt: number;
}

export interface SuiteProfile {
  title?: string;
  description?: string;
  coverImage?: string;
  coverVideo?: string;
  updatedBy?: string;
  updatedAt?: number;
}

export interface RoomPollOption {
  id: string;
  label: string;
  votes: string[];
}

export interface RoomInteractiveState {
  mood?: 'cosmos' | 'emerald' | 'amber' | 'indigo' | null;
  suiteProfile?: SuiteProfile | null;
  card?: {
    id: string;
    category: string;
    prompt: string;
    byName: string;
  } | null;
  poll?: {
    id: string;
    question: string;
    options: RoomPollOption[];
    byName: string;
  } | null;
  timer?: {
    endsAt: number;
    label: string;
    byName: string;
  } | null;
}

export interface RoomMeta {
  code: string;
  pass?: string;
  locked: boolean;
  waitingRoom: boolean;
  hostId: string | null;
  startedAt: number;
  spotlightPeerId: string | null;
  suiteProfile?: SuiteProfile | null;
  interactive?: RoomInteractiveState;
}

export interface ChatMessage {
  id: string;
  roomCode: string;
  fromPeerId: string;
  fromName: string;
  toPeerId?: string | null;
  text: string;
  timestamp: number;
}

export interface WaveEvent {
  id: string;
  fromPeerId: string;
  fromName: string;
  toPeerId?: string | null;
  timestamp: number;
}

export function getInitial(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : 'S';
}
