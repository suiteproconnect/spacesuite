import {
  getInitial,
  MAX_ROOM_PARTICIPANTS,
  normalizeRoomCode,
  type ChatMessage,
  type PeerInfo,
  type RoomBroadcastState,
  type RoomInteractiveState,
  type RoomMeta,
  type WaitingGuest,
} from '../_shared/cf.ts';

interface StoredRoomSnapshot {
  meta: RoomMeta;
  peers: PeerInfo[];
  waiting: WaitingGuest[];
  messages: ChatMessage[];
  blockedClientIds: string[];
  admittedClientIds: string[];
  ended: boolean;
}

function defaultBroadcast(): RoomBroadcastState {
  return {
    emitterPeerId: null,
    emitterName: null,
    status: 'idle',
    sourceType: 'none',
    mediaTitle: null,
    callsSessionId: null,
    videoTrackName: null,
    audioTrackName: null,
    updatedAt: Date.now(),
  };
}

interface CloudflareWebSocket extends WebSocket {
  accept?: () => void;
}

interface DurableObjectStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
}

interface DurableObjectState {
  storage: DurableObjectStorage;
  acceptWebSocket(ws: WebSocket, tags?: string[]): void;
  getWebSockets(tag?: string): WebSocket[];
}

export class RoomDurableObject {
  private ctx: DurableObjectState;
  private state: StoredRoomSnapshot | null = null;
  private socketsByPeer = new Map<string, Set<WebSocket>>();
  private peerBySocket = new WeakMap<WebSocket, { peerId: string; status: 'active' | 'waiting' }>();

  constructor(ctx: DurableObjectState) {
    this.ctx = ctx;
  }

  private async loadState(roomCode = 'ORBIT6'): Promise<StoredRoomSnapshot> {
    if (this.state) return this.state;
    const saved = await this.ctx.storage.get<StoredRoomSnapshot>('room');
    if (saved) {
      this.state = saved;
      return saved;
    }
    this.state = {
      meta: {
        code: roomCode,
        locked: false,
        waitingRoom: false,
        hostId: null,
        startedAt: Date.now(),
        spotlightPeerId: null,
        emitterPeerId: null,
        broadcast: defaultBroadcast(),
        interactive: {},
      },
      peers: [],
      waiting: [],
      messages: [],
      blockedClientIds: [],
      admittedClientIds: [],
      ended: false,
    };
    return this.state;
  }

  private async saveState(): Promise<void> {
    if (!this.state) return;
    await this.ctx.storage.put('room', this.state);
  }

  private sendWs(ws: WebSocket, payload: unknown): void {
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      // ignore closed socket
    }
  }

  private broadcastAll(payload: unknown, onlyPeerIds?: Set<string>): void {
    const raw = JSON.stringify(payload);
    const allSockets = this.ctx.getWebSockets();
    for (const ws of allSockets) {
      const meta = this.peerBySocket.get(ws);
      if (!meta || meta.status !== 'active') continue;
      if (onlyPeerIds && !onlyPeerIds.has(meta.peerId)) continue;
      try {
        ws.send(raw);
      } catch {
        // ignore closed
      }
    }
  }

  private broadcastState(): void {
    if (!this.state) return;
    const { peers, meta, waiting } = this.state;
    const activePayload = JSON.stringify({
      type: 'room:state',
      peers,
      meta,
    });
    const allSockets = this.ctx.getWebSockets();
    for (const ws of allSockets) {
      const info = this.peerBySocket.get(ws);
      if (!info) continue;
      if (info.status === 'active') {
        try {
          ws.send(activePayload);
          const peerObj = peers.find((p) => p.peerId === info.peerId);
          if (peerObj?.role === 'host') {
            ws.send(JSON.stringify({ type: 'room:waiting_list', waiting }));
          }
        } catch {
          // ignore
        }
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const roomCode = normalizeRoomCode(url.searchParams.get('room') || request.headers.get('X-Room-Code') || '');
    const room = await this.loadState(roomCode);

    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response(
        JSON.stringify({
          ok: true,
          code: room.meta.code,
          participants: room.peers.length,
          maxParticipants: MAX_ROOM_PARTICIPANTS,
          emitterPeerId: room.meta.emitterPeerId,
        }),
        { headers: { 'Content-Type': 'application/json; charset=utf-8' } },
      );
    }

    const pair = new (globalThis as unknown as { WebSocketPair: new () => { 0: WebSocket; 1: CloudflareWebSocket } }).WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client } as ResponseInit & { webSocket: WebSocket });
  }

  async webSocketMessage(ws: WebSocket, rawMessage: string | ArrayBuffer): Promise<void> {
    const text = typeof rawMessage === 'string' ? rawMessage : new TextDecoder().decode(rawMessage);
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return;
    }

    const signalType = typeof body.type === 'string' ? body.type : '';
    if (signalType === 'ping') {
      this.sendWs(ws, { type: 'pong', ts: Date.now() });
      return;
    }

    const roomCode = normalizeRoomCode(typeof body.roomCode === 'string' ? body.roomCode : '');
    const room = await this.loadState(roomCode);

    if (signalType === 'room:join') {
      const peerId = (typeof body.peerId === 'string' ? body.peerId.trim() : '') || crypto.randomUUID();
      const clientId = (typeof body.clientId === 'string' ? body.clientId.trim() : '') || crypto.randomUUID();
      const cleanPass = typeof body.pass === 'string' ? body.pass.trim().toUpperCase().slice(0, 8) : '';
      const cleanName = (typeof body.name === 'string' ? body.name : 'Invitado').trim().slice(0, 32) || 'Invitado';
      const wantHost = Boolean(body.wantHost);

      if (room.ended && room.peers.length === 0) {
        room.ended = false;
        room.meta.locked = false;
        room.meta.waitingRoom = false;
        room.meta.hostId = null;
        room.meta.emitterPeerId = null;
        room.meta.broadcast = defaultBroadcast();
        room.blockedClientIds = [];
        room.admittedClientIds = [];
        room.messages = [];
      }

      if (room.blockedClientIds.includes(clientId)) {
        this.sendWs(ws, {
          type: 'room:rejected',
          reason: 'blocked',
          message: 'El anfitrión bloqueó el acceso a esta sala.',
        });
        return;
      }

      const existing = room.peers.find((p) => p.peerId === peerId);
      if (!existing && room.peers.length >= MAX_ROOM_PARTICIPANTS) {
        this.sendWs(ws, {
          type: 'room:rejected',
          reason: 'full',
          message: `La sala alcanzó el límite máximo de ${MAX_ROOM_PARTICIPANTS} participantes (1 emisor + 19 espectadores).`,
        });
        return;
      }

      const shouldBeHost =
        !room.meta.hostId ||
        (room.peers.length === 0 && wantHost) ||
        existing?.role === 'host';

      if (shouldBeHost && cleanPass && !room.meta.pass) {
        room.meta.pass = cleanPass;
      }

      if (room.meta.locked && !shouldBeHost) {
        this.sendWs(ws, {
          type: 'room:rejected',
          reason: 'locked',
          message: 'El anfitrión bloqueó la sala.',
        });
        return;
      }

      if (
        !shouldBeHost &&
        room.meta.pass &&
        cleanPass &&
        cleanPass !== room.meta.pass &&
        !room.admittedClientIds.includes(clientId)
      ) {
        this.sendWs(ws, {
          type: 'room:rejected',
          reason: 'pass',
          message: 'La clave de esta SUITE no coincide.',
        });
        return;
      }

      let sockSet = this.socketsByPeer.get(peerId);
      if (!sockSet) {
        sockSet = new Set();
        this.socketsByPeer.set(peerId, sockSet);
      }
      sockSet.add(ws);

      if (room.meta.waitingRoom && !shouldBeHost && !room.admittedClientIds.includes(clientId)) {
        this.peerBySocket.set(ws, { peerId, status: 'waiting' });
        if (!room.waiting.some((w) => w.peerId === peerId)) {
          room.waiting.push({
            peerId,
            clientId,
            name: cleanName,
            initial: getInitial(cleanName),
            micOn: false,
            camOn: Boolean(body.camOn),
            requestedAt: Date.now(),
          });
        }
        await this.saveState();
        this.sendWs(ws, { type: 'room:waiting', roomCode: room.meta.code, name: cleanName });
        this.broadcastState();
        return;
      }

      const role: PeerInfo['role'] = shouldBeHost ? 'host' : 'guest';
      if (role === 'host') room.meta.hostId = peerId;
      if (!room.admittedClientIds.includes(clientId)) room.admittedClientIds.push(clientId);

      const isEmitter = room.meta.emitterPeerId === peerId;
      const peerInfo: PeerInfo = {
        peerId,
        clientId,
        name: cleanName,
        initial: getInitial(cleanName),
        role,
        micOn: false,
        micLocked: true,
        camOn: isEmitter ? false : Boolean(body.camOn),
        isEmitter,
        handRaised: existing?.handRaised ?? false,
        screenSharing: isEmitter,
        speaking: false,
        callsSessionId: typeof body.callsSessionId === 'string' ? body.callsSessionId : existing?.callsSessionId ?? null,
        camTrackName: typeof body.camTrackName === 'string' ? body.camTrackName : existing?.camTrackName ?? null,
        joinedAt: existing?.joinedAt ?? Date.now(),
      };

      const idx = room.peers.findIndex((p) => p.peerId === peerId);
      if (idx >= 0) room.peers[idx] = peerInfo;
      else room.peers.push(peerInfo);

      this.peerBySocket.set(ws, { peerId, status: 'active' });
      await this.saveState();

      const visibleMessages = room.messages.filter(
        (m) => !m.toPeerId || m.toPeerId === peerId || m.fromPeerId === peerId,
      );
      this.sendWs(ws, {
        type: 'room:joined',
        self: peerInfo,
        peers: room.peers,
        waiting: role === 'host' ? room.waiting : [],
        messages: visibleMessages,
        meta: room.meta,
      });
      this.broadcastState();
      return;
    }

    const sockMeta = this.peerBySocket.get(ws);
    const peerId = (typeof body.peerId === 'string' ? body.peerId.trim() : '') || sockMeta?.peerId || '';
    if (!peerId) return;

    if (signalType === 'room:leave') {
      await this.removePeerAndBroadcast(peerId);
      return;
    }

    const sender = room.peers.find((p) => p.peerId === peerId);
    if (!sender) return;

    if (signalType === 'peer:state') {
      const rawPatch = (body.patch && typeof body.patch === 'object' ? body.patch : {}) as Partial<PeerInfo>;
      if (typeof rawPatch.camOn === 'boolean') {
        sender.camOn = room.meta.emitterPeerId === peerId ? false : rawPatch.camOn;
      }
      if (typeof rawPatch.handRaised === 'boolean') sender.handRaised = rawPatch.handRaised;
      if (typeof rawPatch.callsSessionId === 'string' || rawPatch.callsSessionId === null) {
        sender.callsSessionId = rawPatch.callsSessionId;
      }
      if (typeof rawPatch.camTrackName === 'string' || rawPatch.camTrackName === null) {
        sender.camTrackName = rawPatch.camTrackName;
      }
      if (typeof rawPatch.name === 'string' && rawPatch.name.trim()) {
        sender.name = rawPatch.name.trim().slice(0, 32);
        sender.initial = getInitial(sender.name);
      }
      sender.micOn = false;
      sender.micLocked = true;
      await this.saveState();
      this.broadcastState();
      return;
    }

    if (signalType === 'emitter:claim') {
      if (room.meta.emitterPeerId && room.meta.emitterPeerId !== peerId) {
        this.sendWs(ws, {
          type: 'emitter:denied',
          emitterPeerId: room.meta.emitterPeerId,
          message: 'Otro participante ya está emitiendo en este momento.',
        });
        return;
      }
      const sourceType = body.sourceType === 'media' ? 'media' : 'screen';
      const nextStatus = body.status === 'live' ? 'live' : 'preparing';
      room.meta.emitterPeerId = peerId;
      room.meta.broadcast = {
        emitterPeerId: peerId,
        emitterName: sender.name,
        status: nextStatus,
        sourceType,
        mediaTitle: typeof body.mediaTitle === 'string' ? body.mediaTitle.slice(0, 80) : null,
        callsSessionId: typeof body.callsSessionId === 'string' ? body.callsSessionId : sender.callsSessionId || null,
        videoTrackName: typeof body.videoTrackName === 'string' ? body.videoTrackName : null,
        audioTrackName: typeof body.audioTrackName === 'string' ? body.audioTrackName : null,
        updatedAt: Date.now(),
      };
      sender.isEmitter = true;
      sender.screenSharing = true;
      sender.camOn = false;
      await this.saveState();
      this.sendWs(ws, { type: 'emitter:granted', meta: room.meta });
      this.broadcastState();
      return;
    }

    if (signalType === 'broadcast:state') {
      if (room.meta.emitterPeerId !== peerId) {
        this.sendWs(ws, { type: 'emitter:denied', emitterPeerId: room.meta.emitterPeerId, message: 'No tienes el turno de emisión.' });
        return;
      }
      const nextStatus = body.status === 'live' ? 'live' : body.status === 'idle' ? 'idle' : 'preparing';
      if (nextStatus === 'idle') {
        room.meta.emitterPeerId = null;
        room.meta.broadcast = defaultBroadcast();
        sender.isEmitter = false;
        sender.screenSharing = false;
      } else {
        room.meta.broadcast = {
          ...room.meta.broadcast,
          emitterPeerId: peerId,
          emitterName: sender.name,
          status: nextStatus,
          sourceType: body.sourceType === 'media' ? 'media' : body.sourceType === 'screen' ? 'screen' : room.meta.broadcast.sourceType,
          mediaTitle: typeof body.mediaTitle === 'string' ? body.mediaTitle.slice(0, 80) : room.meta.broadcast.mediaTitle || null,
          callsSessionId: typeof body.callsSessionId === 'string' ? body.callsSessionId : room.meta.broadcast.callsSessionId || null,
          videoTrackName: typeof body.videoTrackName === 'string' ? body.videoTrackName : room.meta.broadcast.videoTrackName || null,
          audioTrackName: body.audioTrackName !== undefined ? (body.audioTrackName ? String(body.audioTrackName) : null) : room.meta.broadcast.audioTrackName || null,
          updatedAt: Date.now(),
        };
      }
      await this.saveState();
      this.broadcastState();
      return;
    }

    if (signalType === 'emitter:release') {
      if (room.meta.emitterPeerId === peerId || sender.role === 'host') {
        const prevEmitter = room.peers.find((p) => p.peerId === room.meta.emitterPeerId);
        if (prevEmitter) {
          prevEmitter.isEmitter = false;
          prevEmitter.screenSharing = false;
        }
        room.meta.emitterPeerId = null;
        room.meta.broadcast = defaultBroadcast();
        await this.saveState();
        this.broadcastState();
      }
      return;
    }

    if (signalType === 'chat:send') {
      const chatText = (typeof body.text === 'string' ? body.text : '').trim().slice(0, 500);
      if (!chatText) return;
      const toPeerId = typeof body.toPeerId === 'string' && body.toPeerId ? body.toPeerId : null;
      const msg: ChatMessage = {
        id: crypto.randomUUID(),
        roomCode: room.meta.code,
        fromPeerId: peerId,
        fromName: sender.name,
        toPeerId,
        text: chatText,
        timestamp: Date.now(),
      };
      room.messages.push(msg);
      if (room.messages.length > 120) room.messages.splice(0, room.messages.length - 120);
      await this.saveState();
      if (toPeerId) {
        this.broadcastAll({ type: 'chat:message', message: msg }, new Set([peerId, toPeerId]));
      } else {
        this.broadcastAll({ type: 'chat:message', message: msg });
      }
      return;
    }

    if (signalType === 'chat:typing') {
      const toPeerId = typeof body.toPeerId === 'string' && body.toPeerId ? body.toPeerId : null;
      const payload = {
        type: 'chat:typing',
        peerId,
        name: sender.name,
        isTyping: Boolean(body.isTyping),
        toPeerId,
      };
      if (toPeerId) {
        this.broadcastAll(payload, new Set([toPeerId]));
      } else {
        const targets = new Set(room.peers.filter((p) => p.peerId !== peerId).map((p) => p.peerId));
        this.broadcastAll(payload, targets);
      }
      return;
    }

    if (signalType === 'wave:send') {
      const toPeerId = typeof body.toPeerId === 'string' && body.toPeerId ? body.toPeerId : null;
      const wave = { id: crypto.randomUUID(), fromPeerId: peerId, fromName: sender.name, toPeerId, timestamp: Date.now() };
      const targets = toPeerId
        ? new Set([toPeerId])
        : new Set(room.peers.filter((p) => p.peerId !== peerId).map((p) => p.peerId));
      this.broadcastAll({ type: 'wave:received', wave }, targets);
      return;
    }

    if (signalType === 'reaction:send') {
      const allowedKinds = new Set(['pulse', 'spark', 'heart', 'heartbeat', 'orbit', 'toast']);
      const rawKind = typeof body.kind === 'string' ? body.kind.trim() : '';
      const kind = allowedKinds.has(rawKind) ? rawKind : 'heartbeat';
      const reaction = { id: crypto.randomUUID(), peerId, name: sender.name, kind, timestamp: Date.now() };
      const targets = new Set(room.peers.filter((p) => p.peerId !== peerId).map((p) => p.peerId));
      this.broadcastAll({ type: 'reaction:received', reaction }, targets);
      return;
    }

    if (signalType === 'subtitle:broadcast') {
      const subText = String(body.text || '').trim().slice(0, 300);
      if (subText) {
        const subtitle = { id: crypto.randomUUID(), peerId, name: sender.name, text: subText, timestamp: Date.now() };
        const targets = new Set(room.peers.filter((p) => p.peerId !== peerId).map((p) => p.peerId));
        this.broadcastAll({ type: 'subtitle:received', subtitle }, targets);
      }
      return;
    }

    if (signalType === 'room:interactive') {
      const act = typeof body.action === 'string' ? body.action.trim() : '';
      const payload = (body.payload && typeof body.payload === 'object' ? body.payload : {}) as Record<string, unknown>;
      const interactive: RoomInteractiveState = { ...(room.meta.interactive || {}) };
      if (act === 'mood:set') {
        const allowed = new Set(['cosmos', 'emerald', 'amber', 'indigo']);
        interactive.mood = typeof payload.mood === 'string' && allowed.has(payload.mood)
          ? (payload.mood as RoomInteractiveState['mood'])
          : null;
      } else if (act === 'card:deal') {
        const prompt = String(payload.prompt || '').trim().slice(0, 180);
        if (prompt) {
          interactive.card = {
            id: String(payload.id || crypto.randomUUID()).slice(0, 48),
            category: String(payload.category || 'Carta Cósmica').trim().slice(0, 32) || 'Carta Cósmica',
            prompt,
            byName: sender.name,
          };
        }
      } else if (act === 'card:clear') {
        interactive.card = null;
      } else if (act === 'poll:start') {
        const question = String(payload.question || '').trim().slice(0, 120);
        const rawOptions = Array.isArray(payload.options) ? payload.options : [];
        const cleanOpts = rawOptions.map((o) => (typeof o === 'string' ? o.trim().slice(0, 48) : '')).filter(Boolean).slice(0, 4);
        if (question && cleanOpts.length >= 2) {
          interactive.poll = {
            id: crypto.randomUUID(),
            question,
            options: cleanOpts.map((label, idx) => ({ id: String(idx), label, votes: [] })),
            byName: sender.name,
          };
        }
      } else if (act === 'poll:vote') {
        const optId = typeof payload.optionId === 'string' ? payload.optionId : '';
        if (interactive.poll && optId) {
          interactive.poll = {
            ...interactive.poll,
            options: interactive.poll.options.map((opt) => {
              const withoutSelf = (opt.votes || []).filter((id) => id !== peerId);
              return opt.id === optId ? { ...opt, votes: [...withoutSelf, peerId] } : { ...opt, votes: withoutSelf };
            }),
          };
        }
      } else if (act === 'poll:close') {
        interactive.poll = null;
      } else if (act === 'timer:start') {
        const mins = Math.max(1, Math.min(60, Math.round(Number(payload.minutes) || 5)));
        interactive.timer = {
          endsAt: Date.now() + mins * 60_000,
          label: String(payload.label || `Focus ${mins} min`).trim().slice(0, 40),
          byName: sender.name,
        };
      } else if (act === 'timer:stop') {
        interactive.timer = null;
      }
      room.meta.interactive = interactive;
      await this.saveState();
      this.broadcastState();
      return;
    }

    if (signalType === 'host:action') {
      if (sender.role !== 'host') return;
      const hostAct = typeof body.action === 'string' ? body.action : '';
      const targetPeerId = typeof body.targetPeerId === 'string' ? body.targetPeerId : null;

      if (hostAct === 'lock') {
        room.meta.locked = Boolean(body.value);
      } else if (hostAct === 'waitingRoom') {
        room.meta.waitingRoom = Boolean(body.value);
      } else if (hostAct === 'spotlight') {
        room.meta.spotlightPeerId = targetPeerId;
      } else if (hostAct === 'grantEmitter') {
        const prev = room.peers.find((p) => p.peerId === room.meta.emitterPeerId);
        if (prev && prev.peerId !== targetPeerId) {
          prev.isEmitter = false;
          prev.screenSharing = false;
        }
        if (targetPeerId) {
          const target = room.peers.find((p) => p.peerId === targetPeerId);
          if (target) {
            target.isEmitter = true;
            target.screenSharing = true;
            target.camOn = false;
            room.meta.emitterPeerId = targetPeerId;
            room.meta.broadcast = {
              ...defaultBroadcast(),
              emitterPeerId: targetPeerId,
              emitterName: target.name,
              status: 'preparing',
              sourceType: 'screen',
            };
            this.broadcastAll({ type: 'emitter:assigned', byName: sender.name }, new Set([targetPeerId]));
          }
        } else {
          room.meta.emitterPeerId = null;
          room.meta.broadcast = defaultBroadcast();
        }
      } else if (hostAct === 'admit' && targetPeerId) {
        const wIdx = room.waiting.findIndex((w) => w.peerId === targetPeerId);
        if (wIdx >= 0) {
          const waitGuest = room.waiting[wIdx];
          room.waiting.splice(wIdx, 1);
          const socks = this.socketsByPeer.get(targetPeerId);
          if (room.peers.length >= MAX_ROOM_PARTICIPANTS) {
            if (socks) {
              for (const s of socks) {
                this.sendWs(s, {
                  type: 'room:rejected',
                  reason: 'full',
                  message: `La sala alcanzó el límite máximo de ${MAX_ROOM_PARTICIPANTS} participantes.`,
                });
              }
            }
          } else {
            if (!room.admittedClientIds.includes(waitGuest.clientId)) {
              room.admittedClientIds.push(waitGuest.clientId);
            }
            const info: PeerInfo = {
              peerId: waitGuest.peerId,
              clientId: waitGuest.clientId,
              name: waitGuest.name,
              initial: waitGuest.initial,
              role: 'guest',
              micOn: false,
              micLocked: true,
              camOn: Boolean(waitGuest.camOn),
              isEmitter: false,
              handRaised: false,
              screenSharing: false,
              speaking: false,
              joinedAt: Date.now(),
            };
            room.peers.push(info);
            if (socks) {
              for (const s of socks) {
                this.peerBySocket.set(s, { peerId: targetPeerId, status: 'active' });
                this.sendWs(s, {
                  type: 'room:joined',
                  self: info,
                  peers: room.peers,
                  waiting: [],
                  messages: room.messages.filter((m) => !m.toPeerId || m.toPeerId === targetPeerId),
                  meta: room.meta,
                });
              }
            }
          }
        }
      } else if (hostAct === 'reject' && targetPeerId) {
        const wIdx = room.waiting.findIndex((w) => w.peerId === targetPeerId);
        if (wIdx >= 0) {
          const waitGuest = room.waiting[wIdx];
          room.waiting.splice(wIdx, 1);
          if (body.block && !room.blockedClientIds.includes(waitGuest.clientId)) {
            room.blockedClientIds.push(waitGuest.clientId);
          }
          const socks = this.socketsByPeer.get(targetPeerId);
          if (socks) {
            for (const s of socks) {
              this.sendWs(s, {
                type: 'room:rejected',
                reason: body.block ? 'blocked' : 'rejected',
                message: body.block ? 'El anfitrión bloqueó el acceso a esta sala.' : 'El anfitrión no aceptó tu solicitud.',
              });
            }
          }
        }
      } else if (hostAct === 'kick' && targetPeerId) {
        const tIdx = room.peers.findIndex((p) => p.peerId === targetPeerId);
        if (tIdx >= 0 && targetPeerId !== peerId) {
          const target = room.peers[tIdx];
          room.peers.splice(tIdx, 1);
          if (room.meta.emitterPeerId === targetPeerId) {
            room.meta.emitterPeerId = null;
            room.meta.broadcast = defaultBroadcast();
          }
          if (body.block && !room.blockedClientIds.includes(target.clientId)) {
            room.blockedClientIds.push(target.clientId);
          }
          const socks = this.socketsByPeer.get(targetPeerId);
          if (socks) {
            for (const s of socks) {
              this.sendWs(s, {
                type: 'room:rejected',
                reason: body.block ? 'blocked' : 'kicked',
                message: body.block ? 'Fuiste bloqueado de esta sala por el anfitrión.' : 'El anfitrión te quitó de esta sala.',
              });
            }
          }
        }
      } else if (hostAct === 'endRoom') {
        this.broadcastAll({
          type: 'room:rejected',
          reason: 'ended',
          message: 'El anfitrión cerró la sala.',
        });
        room.ended = true;
        room.peers = [];
        room.waiting = [];
        room.meta.emitterPeerId = null;
        room.meta.broadcast = defaultBroadcast();
      }
      await this.saveState();
      this.broadcastState();
    }
  }

  private async removePeerAndBroadcast(peerId: string): Promise<void> {
    const room = await this.loadState();
    const wasPeer = room.peers.some((p) => p.peerId === peerId);
    const wasWaiting = room.waiting.some((w) => w.peerId === peerId);
    room.peers = room.peers.filter((p) => p.peerId !== peerId);
    room.waiting = room.waiting.filter((w) => w.peerId !== peerId);
    if (room.meta.emitterPeerId === peerId) {
      room.meta.emitterPeerId = null;
      room.meta.broadcast = defaultBroadcast();
    }
    if (room.meta.spotlightPeerId === peerId) {
      room.meta.spotlightPeerId = null;
    }
    if (room.meta.hostId === peerId) {
      const nextHost = room.peers[0];
      if (nextHost) {
        nextHost.role = 'host';
        room.meta.hostId = nextHost.peerId;
      } else {
        room.meta.hostId = null;
      }
    }
    if (wasPeer || wasWaiting) {
      await this.saveState();
      this.broadcastState();
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const meta = this.peerBySocket.get(ws);
    if (!meta) return;
    const set = this.socketsByPeer.get(meta.peerId);
    if (set) {
      set.delete(ws);
      if (set.size === 0) {
        this.socketsByPeer.delete(meta.peerId);
        await this.removePeerAndBroadcast(meta.peerId);
      }
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }
}
